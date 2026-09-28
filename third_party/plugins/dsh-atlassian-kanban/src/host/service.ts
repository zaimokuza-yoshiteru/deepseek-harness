import type { Context } from '@deepseek-ai/cordis'
import type { AttachmentStore, FileAttachmentRef } from '@deepseek-ai/dsh-attachment'
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { readFile } from 'node:fs/promises'
import type {} from '@deepseek-ai/dsh-settings'
import type { SettingsPathOp } from '@deepseek-ai/dsh-settings'
import type { AtlassianKanbanConfig, AtlassianProduct, AtlassianSettingsView, BitbucketRepositoryRef, BitbucketRepositoryCandidate, BitbucketRepositoryValidation, NamedQuery } from '../shared/config.ts'
import type { ConnectionDraft, ConnectionTestResult, KanbanQuery, KanbanQueryResult, KanbanSuggestionsResult } from '../shared/remote.ts'
import { AtlassianHttp, AtlassianHttpError, parseBaseUrl } from './http.ts'
import { ResourceCache, HeavyOperationGate } from './resource-cache.ts'
import { readUtf8TextPage, readUtf8LinePage, UnsupportedTextFileError } from './text-pages.ts'
import type { AtlassianResponse } from './http.ts'

type Json = Record<string, any>

function redact(config: AtlassianKanbanConfig, revision: number): AtlassianSettingsView {
  return {
    revision,
    refreshMentions: config.refreshMentions,
    jira: { baseUrl: config.jira.baseUrl, hasToken: config.jira.bearerToken.length > 0, jql: config.jira.jql.map(({ id, name, query }) => ({ id, name, query })) },
    bitbucket: { baseUrl: config.bitbucket.baseUrl, hasToken: config.bitbucket.bearerToken.length > 0, repositories: config.bitbucket.repositories.map(row => ({ ...row })) },
    confluence: { baseUrl: config.confluence.baseUrl, hasToken: config.confluence.bearerToken.length > 0, cql: config.confluence.cql.map(({ id, name, query }) => ({ id, name, query })) },
  }
}

function queryById(rows: readonly NamedQuery[], id: string, kind: string): NamedQuery {
  const row = rows.find(entry => entry.id === id)
  if (!row) throw new TypeError(`Unknown ${kind} query id`)
  return row
}
function repoById(rows: readonly BitbucketRepositoryRef[], id: string): BitbucketRepositoryRef {
  const row = rows.find(entry => entry.id === id)
  if (!row) throw new TypeError('Unknown configured Bitbucket repository id')
  return row
}
function cursorNumber(cursor: string | undefined): number {
  if (cursor === undefined) return 0
  if (!/^(0|[1-9]\d*)$/.test(cursor)) throw new TypeError('Invalid pagination cursor')
  const value = Number(cursor)
  if (!Number.isSafeInteger(value)) throw new TypeError('Invalid pagination cursor')
  return value
}
function countArg(value: number | undefined, fallback: number, max: number): number {
  if (value === undefined) return fallback
  if (!Number.isSafeInteger(value) || value < 1) throw new TypeError('Page size must be a positive integer')
  return Math.min(value, max)
}
function field(value: unknown): string { return typeof value === 'string' ? value : '' }
function errorDetails(error: unknown): string {
  if (error instanceof AggregateError) {
    const causes = [...error.errors].map(errorDetails).filter(Boolean)
    return causes.length ? causes.join('; ') : 'multiple connection failures'
  }
  if (typeof error === 'object' && error !== null) {
    const code = typeof Reflect.get(error, 'code') === 'string' ? Reflect.get(error, 'code') as string : ''
    const message = error instanceof Error ? error.message.trim() : ''
    if (message && code && !message.includes(code)) return `${message} (${code})`
    if (message) return message
    if (code) return code
    const name = error instanceof Error ? error.name : ''
    if (name) return name
  }
  return typeof error === 'string' && error.trim() ? error.trim() : 'request failed without a diagnostic'
}
function atlassianToolError(product: AtlassianProduct, baseUrl: string, error: unknown, token: string, method: string): Error {
  const status = error instanceof AtlassianHttpError ? error.status : undefined
  const errorCode = typeof error === 'object' && error !== null && typeof Reflect.get(error, 'code') === 'string'
    ? String(Reflect.get(error, 'code'))
    : undefined
  const readOnly = method === 'GET' || method === 'HEAD'
  const timedOut = error instanceof Error && /deadline|timed out/i.test(error.message)
  const tooLarge = error instanceof Error && /safety limit/.test(error.message)
  const retryable = readOnly && (timedOut || status === 408 || status === 429 || (status !== undefined && status >= 500) || Boolean(errorCode && /^(?:ECONN|EHOST|ENET|ETIMEDOUT|EAI_)/.test(errorCode)))
  let message = status === undefined
    ? timedOut ? 'Atlassian request exceeded its configured deadline.' : tooLarge ? 'Atlassian response exceeded the configured size limit.' : errorDetails(error).slice(0, 1000)
    : status === 409
      ? 'Version conflict (HTTP 409); read the current resource version before retrying.'
      : status === 401 || status === 403
        ? `Authentication or permission check failed (HTTP ${status}).`
        : status === 400 || status === 422
          ? `Atlassian rejected the request (HTTP ${status}).${error instanceof AtlassianHttpError ? validationDetail(error.data, token) : ''}`
          : status === 404
          ? 'The requested Atlassian resource was not found (HTTP 404).'
          : `Atlassian rejected the request (HTTP ${status}).`
  if (token) message = message.split(token).join('[redacted]')
  const host = safeHost(baseUrl)
  if (!message.startsWith(`${product} request to `)) message = `${product} request to ${host} failed: ${message}`
  const payload = {
    code: status === undefined ? timedOut ? 'ATLASSIAN_TIMEOUT' : tooLarge ? 'ATLASSIAN_RESPONSE_TOO_LARGE' : errorCode ?? 'ATLASSIAN_REQUEST_FAILED' : `ATLASSIAN_HTTP_${status}`,
    ...(status === undefined ? {} : { httpStatus: status }),
    message,
    retryable,
    nextAction: timedOut ? readOnly ? 'Retry the read after checking service availability.' : 'Inspect the current resource before retrying because the request may have been applied.'
      : tooLarge ? 'Use a smaller page or a supported bounded reader.'
        : retryable ? 'Retry this read after checking service availability.'
          : status === 401 || status === 403 ? 'Check the configured base URL and bearer token permissions.'
            : status === 400 || status === 422 ? 'Inspect field metadata/edit metadata or correct the reported field values before retrying.' : null,
  }
  const failure = new Error(message)
  Object.defineProperty(failure, 'toolErrorPayload', { value: payload, enumerable: false })
  return failure
}

function validationDetail(data: unknown, token: string): string {
  if (typeof data !== 'object' || data === null) return ''
  const row = data as Record<string, unknown>
  const fields = typeof row.errors === 'object' && row.errors !== null && !Array.isArray(row.errors)
    ? Object.keys(row.errors as Record<string, unknown>).filter(key => /^[\w.-]{1,100}$/.test(key)).slice(0, 20)
    : []
  const messages: string[] = []
  if (Array.isArray(row.errorMessages)) for (const item of row.errorMessages) if (typeof item === 'string') messages.push(item)
  if (typeof row.errors === 'object' && row.errors !== null && !Array.isArray(row.errors)) {
    for (const item of Object.values(row.errors as Record<string, unknown>)) if (typeof item === 'string') messages.push(item)
  }
  if (Array.isArray(row.errors)) for (const item of row.errors) {
    if (typeof item === 'object' && item !== null && typeof Reflect.get(item, 'message') === 'string') messages.push(String(Reflect.get(item, 'message')))
  }
  const safeMessages = messages.slice(0, 8).map(value => {
    let safe = value.replace(/<[^>]*>/g, ' ').replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim().slice(0, 240)
    if (token) safe = safe.split(token).join('[redacted]')
    return safe
  }).filter(Boolean)
  const details = [fields.length ? `fields: ${fields.join(', ')}` : '', safeMessages.length ? `details: ${safeMessages.join('; ')}` : ''].filter(Boolean).join('; ')
  return details ? ` ${details}` : ''
}

const ATTACHMENT_MAX_BYTES = 5 * 1024 * 1024
const REVIEW_FILE_MAX_BYTES = 5 * 1024 * 1024
const ATTACHMENT_TEXT_MAX_CHARS = 20_000
const ATTACHMENT_TEXT_TYPES = new Set([
  'application/json', 'application/xml', 'application/yaml', 'application/x-yaml',
  'text/csv', 'text/markdown', 'text/plain', 'text/tab-separated-values', 'text/xml', 'text/yaml',
])
const ATTACHMENT_TEXT_EXTENSIONS = new Set(['csv', 'json', 'md', 'markdown', 'tsv', 'txt', 'xml', 'yaml', 'yml'])
function noItems(kind: KanbanQuery['kind']): KanbanQueryResult { return { kind, items: [], total: null, nextCursor: null } }
function signalOption(signal: AbortSignal | undefined): { signal?: AbortSignal } { return signal === undefined ? {} : { signal } }

/** Host-owned REST operations used by the native Remote and model tools. */
export class AtlassianService {
  readonly http = new AtlassianHttp()
  private cacheFingerprint = ''
  private readonly resultCache = new Map<string, KanbanQueryResult>()
  private readonly maxCacheEntries = 128
  private readonly iconCache = new Map<string, { readonly dataUrl: string; readonly bytes: number }>()
  private iconCacheBytes = 0
  private readonly maxIconCacheEntries = 256
  private readonly maxIconCacheBytes = 4 * 1024 * 1024
  private cacheGeneration = 0
  private readonly resourceCache = new ResourceCache()
  private readonly heavyOperations = new HeavyOperationGate(2, 8)
  constructor(private readonly ctx: Context, private readonly getConfig: () => AtlassianKanbanConfig) {
    this.ctx.effect(() => () => { void this.resourceCache.clear().catch(() => undefined) }, 'dsh-atlassian-kanban: temporary resource cache')
  }

  settings(): AtlassianSettingsView {
    const settings = Reflect.get(this.ctx, 'settings') as typeof this.ctx.settings | undefined
    const descriptor = settings?.describe({ redactSecrets: true }).find(row => row.ns === 'dsh-atlassian-kanban')
    return redact(this.getConfig(), descriptor?.revision ?? 0)
  }

  /** Direct read of host-only config; callers must never serialize its credentials. */
  configSnapshot(): AtlassianKanbanConfig { return this.getConfig() }

  async mutateSettings(expectedRevision: number, ops: readonly SettingsPathOp[], invalidateCache = false): Promise<AtlassianSettingsView> {
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) throw new TypeError('expectedRevision must be a non-negative integer')
    try {
      const settings = Reflect.get(this.ctx, 'settings') as typeof this.ctx.settings | undefined
      if (!settings) throw new Error('Native settings service is unavailable')
      await settings.mutate('dsh-atlassian-kanban', ops, expectedRevision)
    } catch (error) {
      if (error instanceof Error && Reflect.get(error, 'code') === 'SETTINGS_CONFLICT') {
        throw new Error('Configuration revision conflict; read settings again and retry the update.')
      }
      // Configuration editor/parser errors may include the full profile patch. Never
      // propagate those details through model-visible tool failures.
      throw new Error('Could not save Atlassian settings.')
    }
    if (invalidateCache) this.clearQueryCache()
    return this.settings()
  }

  /** Mention-only lookup; when refresh is disabled this is a strictly local cache read. */
  async suggestions(input: KanbanQuery, signal?: AbortSignal): Promise<KanbanSuggestionsResult> {
    signal?.throwIfAborted()
    this.syncCacheFingerprint()
    const key = this.cacheKey(input)
    if (this.getConfig().refreshMentions) return { result: await this.queryAndCache(input, signal, false), fromCache: false }
    const cached = this.resultCache.get(key)
    if (cached === undefined) return { result: null, fromCache: false }
    this.resultCache.delete(key)
    this.resultCache.set(key, cached)
    return { result: stripSuggestionIcons(cached), fromCache: true }
  }

  /** Validate candidates with one exact repo GET each; never performs a repository search. */
  async validateRepositories(candidates: readonly BitbucketRepositoryCandidate[], signal?: AbortSignal): Promise<BitbucketRepositoryValidation[]> {
    if (!Array.isArray(candidates) || candidates.length > 100) throw new TypeError('Provide at most 100 repository candidates')
    return Promise.all(candidates.map(async candidate => {
      const projectKey = validateSegment(candidate?.projectKey, 'project key')
      const repositorySlug = validateSegment(candidate?.repositorySlug, 'repository slug')
      try {
        const repository = await this.call<Json>('bitbucket', 'GET', `/rest/api/1.0/projects/${encodeURIComponent(projectKey)}/repos/${encodeURIComponent(repositorySlug)}`, signalOption(signal))
        const clone = Array.isArray(repository.links?.clone) ? repository.links.clone.find((item: Json) => item.name === 'http' || item.name === 'https') ?? repository.links.clone[0] : undefined
        return { projectKey, repositorySlug, ok: true, name: field(repository.name) || null, url: field(repository.links?.self?.[0]?.href) || null, cloneUrl: field(clone?.href) || null, message: 'Repository is accessible.' }
      } catch (error) {
        return { projectKey, repositorySlug, ok: false, name: null, url: null, cloneUrl: null, message: this.safeError('bitbucket', error) }
      }
    }))
  }

  clearQueryCache(): void { this.resultCache.clear(); this.cacheFingerprint = this.fingerprint(); this.cacheGeneration++ }

  /** Internal API helper for operations whose path is assembled by typed host code. */
  api<T>(product: AtlassianProduct, method: string, path: string, options: Parameters<AtlassianHttp['request']>[4] = {}): Promise<T> {
    return this.call<T>(product, method, path, options)
  }

  async nativeRequest(product: AtlassianProduct, method: string, path: string, options: Parameters<AtlassianHttp['request']>[4] = {}): Promise<AtlassianResponse<unknown>> {
    const config = this.config(product)
    try { return await this.http.request(config.baseUrl, config.bearerToken, method, path, options) }
    catch (error) { throw atlassianToolError(product, config.baseUrl, error, config.bearerToken, method) }
  }

  async bitbucketPullRequestDiff(projectKey: string, repositorySlug: string, pullRequestId: number, options: { path?: string; srcPath?: string; contextLines?: number }, signal?: AbortSignal): Promise<Record<string, unknown>> {
    const repo = this.getConfig().bitbucket.repositories.find(row => row.projectKey === projectKey && row.repositorySlug === repositorySlug)
    if (!repo) throw new TypeError('Unknown configured Bitbucket repository')
    if (!Number.isSafeInteger(pullRequestId) || pullRequestId < 1) throw new TypeError('Pull request id must be a positive integer')
    if (options.contextLines !== undefined && (!Number.isSafeInteger(options.contextLines) || options.contextLines < 0 || options.contextLines > 20)) throw new TypeError('contextLines must be an integer from 0 to 20')
    if (options.srcPath !== undefined && options.path === undefined) throw new TypeError('srcPath is only valid with a per-file diff path')
    const query = new URLSearchParams()
    if (options.contextLines !== undefined) query.set('contextLines', String(options.contextLines))
    if (options.srcPath !== undefined) query.set('srcPath', options.srcPath)
    const root = `/rest/api/1.0/projects/${encodeURIComponent(repo.projectKey)}/repos/${encodeURIComponent(repo.repositorySlug)}/pull-requests/${pullRequestId}`
    const path = options.path === undefined ? `${root}/diff` : `${root}/diff/${encodeRepoPath(options.path)}`
    let response: AtlassianResponse<unknown>
    try {
      response = await this.heavyOperations.run(signal, () => this.nativeRequest('bitbucket', 'GET', path, {
        ...(signal ? { signal } : {}), ...(query.size ? { query } : {}), accept: 'application/json', maxResponseBytes: 256 * 1024,
      }))
    } catch (error) {
      const payload = typeof error === 'object' && error !== null ? Reflect.get(error, 'toolErrorPayload') : undefined
      if (typeof payload === 'object' && payload !== null && Reflect.get(payload, 'code') === 'ATLASSIAN_RESPONSE_TOO_LARGE') return { complete: false, serverTruncated: null, outputLimited: true, paged: false, path: options.path ?? null, ...(options.srcPath === undefined ? {} : { srcPath: options.srcPath }), ...(options.contextLines === undefined ? {} : { contextLines: options.contextLines }), nextAction: 'The diff response exceeded the local 256 KiB output budget. Request a per-file diff or inspect the affected file at its immutable commit with kanban_bitbucket_get_review_file.' }
      throw error
    }
    const serverTruncated = hasTruncatedFlag(response.data)
    const knownStructured = typeof response.data === 'object' && response.data !== null
    const complete = knownStructured && !serverTruncated
    if (Buffer.byteLength(JSON.stringify(response.data), 'utf8') > 64 * 1024) return {
      complete: false, serverTruncated: knownStructured ? serverTruncated : null, outputLimited: true, paged: false,
      path: options.path ?? null, ...(options.srcPath === undefined ? {} : { srcPath: options.srcPath }), ...(options.contextLines === undefined ? {} : { contextLines: options.contextLines }),
      nextAction: 'The diff exceeded the 64 KiB model-output budget. Request a per-file diff with fewer context lines, or inspect the affected file at its immutable commit with kanban_bitbucket_get_review_file.',
    }
    return {
      complete,
      serverTruncated: serverTruncated || !knownStructured,
      paged: false,
      path: options.path ?? null,
      ...(options.srcPath === undefined ? {} : { srcPath: options.srcPath }),
      ...(options.contextLines === undefined ? {} : { contextLines: options.contextLines }),
      nextAction: complete
        ? 'Diff endpoint is not paged. If the response omits a file or looks too large, list changes and request a per-file diff; if that file is truncated, inspect its fixed commit with kanban_bitbucket_get_review_file.'
        : 'Diff was truncated or returned without a structured completeness flag. This endpoint cannot return a later diff page. List changes, request each per-file diff with srcPath for renamed files, and inspect fixed-commit file content if a per-file diff is also truncated.',
      diff: response.data,
    }
  }

  async bitbucketReviewFile(projectKey: string, repositorySlug: string, filePath: string, at: string, start: number, limit: number, signal?: AbortSignal, charOffset = 0, maxChars = 20_000): Promise<Record<string, unknown>> {
    const repo = this.getConfig().bitbucket.repositories.find(row => row.projectKey === projectKey && row.repositorySlug === repositorySlug)
    if (!repo) throw new TypeError('Unknown configured Bitbucket repository')
    if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(at)) throw new TypeError('at must be a full immutable commit SHA')
    validatePageStart(start)
    validatePageLimit(limit, 200)
    validatePageStart(charOffset, 'charOffset'); validatePageLimit(maxChars, 20_000, 'maxChars')
    const encodedPath = encodeRepoPath(filePath)
    const root = `/rest/api/1.0/projects/${encodeURIComponent(repo.projectKey)}/repos/${encodeURIComponent(repo.repositorySlug)}`
    const query = new URLSearchParams({ at })
    const browseQuery = new URLSearchParams({ at, noContent: 'true', size: 'true', type: 'true' })
    const browseResponse = await this.nativeRequest('bitbucket', 'GET', `${root}/browse/${encodedPath}`, { query: browseQuery, ...(signal ? { signal } : {}), maxResponseBytes: 64 * 1024 })
    const browse = typeof browseResponse.data === 'object' && browseResponse.data !== null ? browseResponse.data as Json : {}
    const cfg = this.config('bitbucket')
    const cacheKey = this.resourceCache.key(['bitbucket', cfg.baseUrl, createHash('sha256').update(cfg.bearerToken).digest('hex'), repo.projectKey, repo.repositorySlug, at, filePath])
    try {
      const page = await this.heavyOperations.run(signal, () => this.resourceCache.singleFlight(cacheKey, async () => {
        if (!(await this.resourceCache.has(cacheKey))) {
          const cachePath = await this.resourceCache.pathFor(cacheKey)
          await this.resourceCache.reserve(cacheKey, REVIEW_FILE_MAX_BYTES)
          try {
            const result = await this.http.requestToFile(cfg.baseUrl, cfg.bearerToken, 'GET', `${root}/raw/${encodedPath}`, cachePath, { query, ...(signal ? { signal } : {}), accept: 'text/plain, application/octet-stream', maxResponseBytes: REVIEW_FILE_MAX_BYTES })
            await this.resourceCache.commit(cacheKey, cachePath, result.bytes)
          } catch (error) { await this.resourceCache.release(cacheKey); throw atlassianToolError('bitbucket', cfg.baseUrl, error, cfg.bearerToken, 'GET') }
        }
        return this.resourceCache.withFile(cacheKey, path => readUtf8LinePage(path, start, charOffset, limit, maxChars, signal))
      }, signal))
      const { lines: zeroBasedLines, nextStart, nextCharOffset, totalLines } = page
      const lines = zeroBasedLines.map(line => ({ ...line, line: line.line + 1 }))
      const { lines: _lines, start: _start, limit: _limit, isLastPage: _isLastPage, nextPageStart: _nextPageStart, complete: _complete, nextStart: _nextStart, nextAction: _nextAction, ...browseEnvelope } = browse ?? {}
      return {
        ...browseEnvelope, path: filePath, revision: at, lines, complete: nextStart === null, pageComplete: true, nextStart, nextCharOffset,
        nextAction: nextStart === null ? null : `Read the next page with start=${nextStart}, charOffset=${nextCharOffset ?? 0}, and the same at commit.`,
        linePage: { start, charOffset, limit, totalLines, isLastPage: nextStart === null, maxChars, maxFileBytes: REVIEW_FILE_MAX_BYTES, pagingMode: 'bounded UTF-8 stream with resumable long-line chunks' },
      }
    } catch (error) {
      const payload = typeof error === 'object' && error !== null ? Reflect.get(error, 'toolErrorPayload') : undefined
      const tooLarge = typeof payload === 'object' && payload !== null && Reflect.get(payload, 'code') === 'ATLASSIAN_RESPONSE_TOO_LARGE'
      if (tooLarge || error instanceof Error && error.message.includes(`configured ${REVIEW_FILE_MAX_BYTES} byte safety limit`)) return {
        complete: false, pageComplete: false, start, limit, nextStart: null,
        nextAction: 'The full file exceeded the 5 MiB local read limit; line offsets cannot fetch a later slice from Bitbucket. Use a local repository checkout or a smaller file.',
        path: filePath, at, browse, supported: false, reason: 'file exceeds the bounded 5 MiB raw read limit',
      }
      if (error instanceof UnsupportedTextFileError) return { complete: false, start, limit, nextStart: null, nextCharOffset: null, nextAction: 'This file is not valid UTF-8 text; use the repository browser or a binary-aware local workflow.', path: filePath, at, browse, supported: false, reason: 'non-UTF-8 or binary file content is not returned as review text' }
      throw error
    }
  }

  async confluenceGetAttachment(attachmentId: string, signal?: AbortSignal): Promise<Json> {
    if (!/^\d+$/.test(attachmentId)) throw new TypeError('Confluence attachment id must be numeric')
    const attachment = await this.call<Json>('confluence', 'GET', `/rest/api/content/${encodeURIComponent(attachmentId)}`, { query: new URLSearchParams({ expand: 'container,metadata,version,extensions' }), ...signalOption(signal) })
    if (attachment.type !== 'attachment') throw new TypeError('Confluence content id does not identify an attachment')
    return attachment
  }

  async jiraListAttachments(issueKey: string, start = 0, limit = 50, signal?: AbortSignal): Promise<Record<string, unknown>> {
    validatePageStart(start); validatePageLimit(limit, 100)
    const key = validateIssueKey(issueKey)
    const issue = await this.call<Json>('jira', 'GET', `/rest/api/2/issue/${encodeURIComponent(key)}`, { query: new URLSearchParams({ fields: 'attachment' }), ...signalOption(signal) })
    const values = Array.isArray(issue?.fields?.attachment) ? issue.fields.attachment : []
    const attachments = values.slice(start, start + limit).map((item: Json) => ({ id: item.id, filename: item.filename, size: item.size, mimeType: item.mimeType, created: item.created, author: { displayName: field(item.author?.displayName) || null, key: field(item.author?.key) || null } }))
    const nextStart = start + attachments.length < values.length ? start + attachments.length : null
    return { issueKey: key, attachments, start, limit, totalAttachments: values.length, pagingMode: 'local', complete: nextStart === null, nextStart, nextAction: nextStart === null ? null : `Continue with start=${nextStart}.` }
  }

  async jiraGetAttachment(id: string, signal?: AbortSignal): Promise<Json> {
    if (!/^\d+$/.test(id)) throw new TypeError('Jira attachment id must be numeric')
    return this.call<Json>('jira', 'GET', `/rest/api/2/attachment/${id}`, signalOption(signal))
  }

  async jiraAttachmentContent(id: string, maxBytes: number, signal?: AbortSignal): Promise<{ attachment: Json; bytes: number; mediaType: string; cacheKey: string }> {
    const attachment = await this.jiraGetAttachment(id, signal)
    const link = field(attachment.content)
    if (!link) throw new TypeError('Jira did not provide an attachment content URL')
    const config = this.config('jira'), path = jiraAttachmentPath(config.baseUrl, link, id)
    const version = String(attachment.version ?? attachment.size ?? attachment.created ?? '')
    const cacheKey = this.resourceCache.key(['jira', config.baseUrl, createHash('sha256').update(config.bearerToken).digest('hex'), id, version, link])
    return this.resourceCache.singleFlight(cacheKey, async () => {
      if (!(await this.resourceCache.has(cacheKey))) {
        const cachePath = await this.resourceCache.pathFor(cacheKey)
        await this.resourceCache.reserve(cacheKey, maxBytes)
        try {
          const downloaded = await this.http.requestToFile(config.baseUrl, config.bearerToken, 'GET', path, cachePath, { ...(signal ? { signal } : {}), accept: '*/*', maxResponseBytes: maxBytes })
          const contentType = downloaded.headers['content-type']
          const mediaType = (Array.isArray(contentType) ? contentType[0] : contentType)?.split(';', 1)[0]?.trim().toLowerCase() ?? ''
          await this.resourceCache.commit(cacheKey, cachePath, downloaded.bytes, mediaType)
        } catch (error) { await this.resourceCache.release(cacheKey); throw atlassianToolError('jira', config.baseUrl, error, config.bearerToken, 'GET') }
      }
      const bytes = await this.resourceCache.size(cacheKey)
      if (bytes > maxBytes) throw new Error(`Atlassian response exceeded the configured ${maxBytes} byte safety limit`)
      return { attachment, bytes, mediaType: await this.resourceCache.metadata(cacheKey) ?? '', cacheKey }
    }, signal)
  }

  async jiraReadAttachment(id: string, offset: number, maxChars: number, signal?: AbortSignal): Promise<Record<string, unknown>> {
    return this.heavyOperations.run(signal, async () => {
    validatePageStart(offset, 'offset'); validatePageLimit(maxChars, ATTACHMENT_TEXT_MAX_CHARS, 'maxChars')
    const { attachment, bytes, mediaType, cacheKey } = await this.jiraAttachmentContent(id, ATTACHMENT_MAX_BYTES, signal)
    const filename = field(attachment.filename), ext = filename.split('.').at(-1)?.toLowerCase() ?? ''
    if (bytes > ATTACHMENT_MAX_BYTES) throw new Error(`Atlassian response exceeded the configured ${ATTACHMENT_MAX_BYTES} byte safety limit`)
    if (mediaType && mediaType !== 'application/octet-stream' && !ATTACHMENT_TEXT_TYPES.has(mediaType)) return { supported: false, attachmentId: id, filename, mediaType, reason: 'The attachment response is not a supported UTF-8 text media type.', nextAction: 'Use kanban_jira_download_attachment with a compatible document reader.' }
    if (!(ATTACHMENT_TEXT_TYPES.has(mediaType) || mediaType === 'application/octet-stream' && ATTACHMENT_TEXT_EXTENSIONS.has(ext) || !mediaType && ATTACHMENT_TEXT_EXTENSIONS.has(ext))) return { supported: false, attachmentId: id, filename, mediaType: mediaType || null, reason: 'Attachment is not a supported UTF-8 text format.', nextAction: 'Use kanban_jira_download_attachment with a compatible document reader.' }
    try {
      let verifiedBytes = bytes
      const page = await this.resourceCache.withFile(cacheKey, (path, actualBytes, actualType) => {
        if (actualBytes > ATTACHMENT_MAX_BYTES) throw new Error(`Atlassian response exceeded the configured ${ATTACHMENT_MAX_BYTES} byte safety limit`)
        if (actualType && actualType !== 'application/octet-stream' && !ATTACHMENT_TEXT_TYPES.has(actualType)) throw new Error('Attachment response MIME type is not supported as UTF-8 text')
        verifiedBytes = actualBytes
        return readUtf8TextPage(path, offset, maxChars, signal)
      })
      return { supported: true, attachmentId: id, filename, offset, totalCharacters: page.totalCharacters, nextOffset: page.nextOffset, text: page.text, downloadedBytes: verifiedBytes, maxAttachmentBytes: ATTACHMENT_MAX_BYTES, nextAction: page.nextOffset === null ? null : `Continue with attachmentId=${id} and offset=${page.nextOffset}.` }
    } catch (error) {
      const message = error instanceof Error ? error.message : ''
      if (error instanceof UnsupportedTextFileError) return { supported: false, attachmentId: id, filename, reason: message, nextAction: 'Use kanban_jira_download_attachment with a compatible document reader.' }
      throw error
    }
    })
  }

  async jiraDownloadAttachment(id: string, signal?: AbortSignal): Promise<Record<string, unknown>> {
    return this.heavyOperations.run(signal, async () => {
    const store = this.ctx.get('attachments', false)
    if (!store) return { available: false, attachmentId: id, reason: 'The host has no native file attachment provider.', nextAction: 'Use an environment with DSH attachment storage enabled.' }
    const { attachment, bytes, mediaType, cacheKey } = await this.jiraAttachmentContent(id, 10 * 1024 * 1024, signal)
    const filename = field(attachment.filename) || `jira-${id}`
    let file: FileAttachmentRef
    try { file = await this.saveNativeAttachment(store, cacheKey, filename, bytes, signal) }
    catch (error) { if (signal?.aborted) throw error; throw new Error('The downloaded Jira attachment could not be stored in the native DSH attachment provider.') }
    return { available: true, attachmentId: id, filename, mediaType: mediaType || null, bytes, file, hostPath: store.fileHostPath(file) ?? null, storageMode: typeof store.saveFileStream === 'function' ? 'stream' : 'bounded-memory-fallback', nextAction: 'The DSH native attachment is durable and is not removed with temporary download caches.' }
    })
  }

  private async saveNativeAttachment(store: AttachmentStore, cacheKey: string, filename: string, bytes: number, signal?: AbortSignal): Promise<FileAttachmentRef> {
    const streamSave = store.saveFileStream
    if (typeof streamSave === 'function') return this.resourceCache.withFile(cacheKey, (path, actualBytes) => {
        if (actualBytes > 10 * 1024 * 1024) throw new Error('The attachment exceeds the 10 MiB download limit.')
      return streamSave.call(store, { data: createReadStream(path), ...(signal ? { signal } : {}), name: filename })
    })
    if (typeof store.saveFile !== 'function') throw new Error('The host attachment provider supports neither streamed nor bounded file storage.')
    if (bytes > 10 * 1024 * 1024) throw new Error('The attachment exceeds the 10 MiB memory fallback limit for this host provider.')
    const data = await this.resourceCache.withFile(cacheKey, (path, actualBytes) => {
      if (actualBytes > 10 * 1024 * 1024) throw new Error('The attachment exceeds the 10 MiB memory fallback limit for this host provider.')
      return readFile(path)
    })
    return store.saveFile({ data, name: filename })
  }

  async confluenceDownloadAttachment(attachmentId: string, signal?: AbortSignal): Promise<Record<string, unknown>> {
    return this.heavyOperations.run(signal, async () => {
    if (!/^\d+$/.test(attachmentId)) throw new TypeError('Confluence attachment id must be numeric')
    const store = this.ctx.get('attachments', false)
    if (!store) return { available: false, attachmentId, reason: 'The host has no native file attachment provider.', nextAction: 'Use an environment with DSH attachment storage enabled.' }
    const attachment = await this.confluenceGetAttachment(attachmentId, signal)
    const { bytes, mediaType, cacheKey } = await this.fetchConfluenceAttachment(attachment, attachmentId, 10 * 1024 * 1024, signal)
    const filename = field(attachment.title) || `confluence-${attachmentId}`
    const version = Number(attachment.version?.number)
    let file: FileAttachmentRef
    try { file = await this.saveNativeAttachment(store, cacheKey, filename, bytes, signal) }
    catch { throw new Error('The downloaded Confluence attachment could not be stored in the native DSH attachment provider.') }
    const hostPath = store.fileHostPath(file)
    return {
      available: true,
      attachmentId,
      filename,
      version: Number.isSafeInteger(version) ? version : null,
      mediaType: mediaType || field(attachment.extensions?.mediaType) || null,
      bytes,
      storageMode: typeof store.saveFileStream === 'function' ? 'stream' : 'bounded-memory-fallback',
      file,
      hostPath: hostPath ?? null,
      nextAction: hostPath ? 'Read this provider-owned local path with the configured local file reader. This host path is not portable across remote machines.' : 'The native file reference is stored, but this attachment provider does not expose a host file path.',
    }
    })
  }

  async confluenceReadAttachment(attachmentId: string, offset: number, maxChars: number, expectedVersion?: number, signal?: AbortSignal): Promise<Record<string, unknown>> {
    return this.heavyOperations.run(signal, async () => {
    validatePageStart(offset, 'offset')
    validatePageLimit(maxChars, ATTACHMENT_TEXT_MAX_CHARS, 'maxChars')
    const attachment = await this.confluenceGetAttachment(attachmentId, signal)
    const title = field(attachment.title)
    const version = Number(attachment.version?.number)
    if (expectedVersion !== undefined && expectedVersion !== version) throw new TypeError(`Confluence attachment version changed from ${expectedVersion} to ${version}; restart at offset=0 with expectedVersion=${version}`)
    const mediaType = field(attachment.extensions?.mediaType ?? attachment.metadata?.mediaType).split(';', 1)[0]?.trim().toLowerCase() ?? ''
    const downloadLink = field(attachment._links?.download)
    if (!downloadLink) throw new TypeError('Confluence did not provide a download link for this attachment')
    const filenameExt = title.includes('.') ? title.split('.').at(-1)!.toLowerCase() : ''
    const nominallyText = ATTACHMENT_TEXT_TYPES.has(mediaType) || ATTACHMENT_TEXT_EXTENSIONS.has(filenameExt)
    if (!nominallyText) return {
      supported: false, attachmentId, filename: title || null, version: Number.isSafeInteger(version) ? version : null, mediaType: mediaType || null,
      reason: 'This attachment type is not parsed as UTF-8 text. PDF, Office, image, and other binary content is not represented as read.',
      nextAction: 'Use a document or image reader that supports this file type; do not treat attachment metadata as its content.',
    }
    const { bytes, mediaType: actualType, cacheKey } = await this.fetchConfluenceAttachment(attachment, attachmentId, ATTACHMENT_MAX_BYTES, signal)
    if (bytes > ATTACHMENT_MAX_BYTES) throw new Error(`Atlassian response exceeded the configured ${ATTACHMENT_MAX_BYTES} byte safety limit`)
    if (actualType && actualType !== 'application/octet-stream' && !ATTACHMENT_TEXT_TYPES.has(actualType)) return {
      supported: false, attachmentId, filename: title || null, version: Number.isSafeInteger(version) ? version : null, mediaType: actualType,
      reason: 'The attachment response is not a supported UTF-8 text media type.',
      nextAction: 'Use kanban_confluence_download_attachment and a compatible document reader; this tool did not return its binary content as text.',
    }
    let page: Awaited<ReturnType<typeof readUtf8TextPage>>
    try { page = await this.resourceCache.withFile(cacheKey, (path, actualBytes, actualType) => {
      if (actualBytes > ATTACHMENT_MAX_BYTES) throw new Error(`Atlassian response exceeded the configured ${ATTACHMENT_MAX_BYTES} byte safety limit`)
      if (actualType && actualType !== 'application/octet-stream' && !ATTACHMENT_TEXT_TYPES.has(actualType)) throw new Error('Attachment response MIME type is not supported as UTF-8 text')
      return readUtf8TextPage(path, offset, maxChars, signal)
    }) }
    catch (error) {
      if (error instanceof UnsupportedTextFileError) return { supported: false, attachmentId, filename: title || null, version: Number.isSafeInteger(version) ? version : null, mediaType: actualType || mediaType || null, reason: error.message, nextAction: 'Use kanban_confluence_download_attachment and a compatible binary/document reader.' }
      throw error
    }
    return {
      supported: true, attachmentId, filename: title || null, version: Number.isSafeInteger(version) ? version : null, expectedVersion: Number.isSafeInteger(version) ? version : null, mediaType: actualType || mediaType || null,
      offset, totalCharacters: page.totalCharacters,
      nextOffset: page.nextOffset, nextAction: page.nextOffset === null ? null : `Continue with offset=${page.nextOffset} and expectedVersion=${version}; maximum text is ${ATTACHMENT_TEXT_MAX_CHARS} characters per call.`,
      text: page.text,
      downloadedBytes: bytes, maxAttachmentBytes: ATTACHMENT_MAX_BYTES,
    }
    })
  }

  private async fetchConfluenceAttachment(attachment: Json, attachmentId: string, maxBytes: number, signal?: AbortSignal): Promise<{ cacheKey: string; bytes: number; mediaType: string }> {
    const config = this.config('confluence')
    const downloadLink = field(attachment._links?.download)
    if (!downloadLink) throw new TypeError('Confluence did not provide a download link for this attachment')
    const download = confluenceDownloadPath(config.baseUrl, downloadLink)
    const metadataVersion = Number(attachment.version?.number)
    if (Number.isSafeInteger(metadataVersion) && metadataVersion > 0) {
      const linkedVersion = download.query?.get('version')
      if (linkedVersion !== null && linkedVersion !== undefined && linkedVersion !== String(metadataVersion)) throw new TypeError('Confluence attachment download link version does not match current metadata')
      download.query?.set('version', String(metadataVersion))
      if (!download.query) download.query = new URLSearchParams({ version: String(metadataVersion) })
    }
    const version = String(attachment.version?.number ?? ''), modified = String(attachment.extensions?.mediaType ?? attachment.metadata?.mediaType ?? '')
    const cacheKey = this.resourceCache.key(['confluence', config.baseUrl, createHash('sha256').update(config.bearerToken).digest('hex'), attachmentId, version, modified, field(attachment._links?.download)])
    return this.resourceCache.singleFlight(cacheKey, async () => {
      let mediaType = ''
      if (!(await this.resourceCache.has(cacheKey))) {
        const cachePath = await this.resourceCache.pathFor(cacheKey)
        await this.resourceCache.reserve(cacheKey, maxBytes)
        try {
          const downloaded = await this.http.requestToFile(config.baseUrl, config.bearerToken, 'GET', download.path, cachePath, { ...(download.query ? { query: download.query } : {}), ...(signal ? { signal } : {}), accept: '*/*', maxResponseBytes: maxBytes })
          const rawType = downloaded.headers['content-type']
          mediaType = (Array.isArray(rawType) ? rawType[0] : rawType)?.split(';', 1)[0]?.trim().toLowerCase() ?? ''
          await this.resourceCache.commit(cacheKey, cachePath, downloaded.bytes, mediaType)
        } catch (error) { await this.resourceCache.release(cacheKey); throw atlassianToolError('confluence', config.baseUrl, error, config.bearerToken, 'GET') }
      }
      const bytes = await this.resourceCache.size(cacheKey)
      if (bytes > maxBytes) throw new Error(`Atlassian response exceeded the configured ${maxBytes} byte safety limit`)
      if (!mediaType) mediaType = field(attachment.extensions?.mediaType ?? attachment.metadata?.mediaType).split(';', 1)[0]?.trim().toLowerCase() ?? ''
      return { cacheKey, bytes, mediaType: await this.resourceCache.metadata(cacheKey) ?? mediaType }
    }, signal)
  }

  async testConnection(product: AtlassianProduct, draft?: ConnectionDraft): Promise<ConnectionTestResult> {
    const saved = this.getConfig()[product]
    const baseUrl = draft?.baseUrl ?? saved.baseUrl
    // Blank draft fields deliberately retain the existing token; clearing it is explicit.
    const token = draft?.clearToken ? '' : draft?.bearerToken?.trim() ? draft.bearerToken : saved.bearerToken
    if (!baseUrl || (!token && !draft?.clearToken)) return { product, ok: false, displayName: null, message: 'Set a base URL and bearer token in this plugin’s configuration.' }
    try {
      let name: string | null = null
      if (product === 'jira') { const user = await this.requestConnection<Json>(product, baseUrl, token, '/rest/api/2/myself'); name = field(user.displayName) || field(user.name) }
      else if (product === 'bitbucket') { await this.requestConnection('bitbucket' as AtlassianProduct, baseUrl, token, '/rest/api/1.0/users', { query: new URLSearchParams({ limit: '1' }) }) }
      else { const user = await this.requestConnection<Json>(product, baseUrl, token, '/rest/api/user/current'); name = field(user.displayName) || field(user.username) }
      return { product, ok: true, displayName: name, message: 'Connection succeeded.' }
    } catch (error) {
      const detail = errorDetails(error)
      const message = detail.startsWith(`${product} request to `) ? detail : `${product} request to ${safeHost(baseUrl)} failed: ${detail}`
      return { product, ok: false, displayName: null, message: token ? message.split(token).join('[redacted]') : message }
    }
  }

  private async requestConnection<T>(product: AtlassianProduct, baseUrl: string, token: string, path: string, options: Parameters<AtlassianHttp['request']>[4] = {}): Promise<T> {
    try { return (await this.http.request<T>(baseUrl, token, 'GET', path, options)).data }
    catch (error) {
      const detail = errorDetails(error)
      const message = `${product} request to ${safeHost(baseUrl)} failed: ${detail}`
      throw new Error(token ? message.split(token).join('[redacted]') : message)
    }
  }

  async query(input: KanbanQuery, signal?: AbortSignal): Promise<KanbanQueryResult> {
    return this.queryAndCache(input, signal, true)
  }

  private async queryAndCache(input: KanbanQuery, signal: AbortSignal | undefined, includeIcons: boolean): Promise<KanbanQueryResult> {
    this.syncCacheFingerprint()
    const key = this.cacheKey(input)
    const fingerprint = this.cacheFingerprint
    const generation = this.cacheGeneration
    const result = await this.queryUncached(input, signal, includeIcons)
    signal?.throwIfAborted()
    this.syncCacheFingerprint()
    // An old request may finish after a credential or saved-query update. Its result
    // is still returned to its caller, but must never repopulate the mention cache.
    if (this.cacheFingerprint === fingerprint && this.cacheGeneration === generation) {
      this.resultCache.delete(key)
      this.resultCache.set(key, result)
      while (this.resultCache.size > this.maxCacheEntries) this.resultCache.delete(this.resultCache.keys().next().value as string)
    }
    return result
  }

  private async queryUncached(input: KanbanQuery, signal?: AbortSignal, includeIcons = true): Promise<KanbanQueryResult> {
    if (!input || typeof input !== 'object' || typeof input.kind !== 'string') throw new TypeError('Query must be a supported query object')
    signal?.throwIfAborted()
    switch (input.kind) {
      case 'jira-issue': return this.jiraIssue(requiredText(input.issueKey, 'issueKey'), signal, includeIcons)
      case 'jira-search': return this.jiraSearch(requiredText(input.jqlId, 'jqlId'), input.cursor, input.maxResults, signal, includeIcons)
      case 'bitbucket-repository': return this.repository(requiredText(input.repositoryId, 'repositoryId'), signal)
      case 'bitbucket-pull-request': return this.pullRequest(requiredText(input.repositoryId, 'repositoryId'), input.pullRequestId, signal)
      case 'bitbucket-pull-requests':
        if (!['all', 'open', 'merged'].includes(input.state)) throw new TypeError('Pull request state must be all, open, or merged')
        return this.pullRequests(requiredText(input.repositoryId, 'repositoryId'), input.state, input.cursor, input.limit, signal)
      case 'confluence-page': return this.confluencePage(requiredText(input.pageId, 'pageId'), signal)
      case 'confluence-search': return this.confluenceSearch(requiredText(input.cqlId, 'cqlId'), input.cursor, input.limit, signal)
      default: return assertNever(input)
    }
  }

  private cacheKey(input: KanbanQuery): string {
    if (!input || typeof input !== 'object' || typeof input.kind !== 'string') throw new TypeError('Query must be a supported query object')
    let encoded: string | undefined
    try { encoded = JSON.stringify(input) } catch { throw new TypeError('Query must be JSON-compatible') }
    if (!encoded || encoded.length > 16_384) throw new TypeError('Query is invalid or too large')
    return encoded
  }

  private fingerprint(): string {
    const config = this.getConfig()
    return createHash('sha256').update(JSON.stringify({
      jira: config.jira,
      bitbucket: config.bitbucket,
      confluence: config.confluence,
    })).digest('hex')
  }

  private syncCacheFingerprint(): void {
    const next = this.fingerprint()
    if (this.cacheFingerprint !== next) {
      this.cacheFingerprint = next
      this.resultCache.clear()
      this.cacheGeneration++
    }
  }

  async searchJira(jql: string, cursor?: string, maxResults?: number, signal?: AbortSignal): Promise<KanbanQueryResult> {
    const result = await this.jiraSearchExpression(requiredText(jql, 'JQL'), cursor, maxResults, signal, false)
    // Avoid both image payloads and icon requests in model tool calls.
    return { ...result, items: result.items.map(({ typeIcon: _typeIcon, priorityIcon: _priorityIcon, ...item }) => item) }
  }
  async repositoryByIdentity(projectKey: string, repositorySlug: string, signal?: AbortSignal): Promise<KanbanQueryResult> {
    const repo = this.getConfig().bitbucket.repositories.find(row => row.projectKey === projectKey && row.repositorySlug === repositorySlug)
    if (!repo) throw new TypeError('Unknown configured Bitbucket repository')
    return this.repository(repo.id, signal)
  }
  async pullRequestsByIdentity(projectKey: string, repositorySlug: string, state: 'all' | 'open' | 'merged', cursor?: string, limit?: number, signal?: AbortSignal): Promise<KanbanQueryResult> {
    const repo = this.getConfig().bitbucket.repositories.find(row => row.projectKey === projectKey && row.repositorySlug === repositorySlug)
    if (!repo) throw new TypeError('Unknown configured Bitbucket repository')
    return this.pullRequests(repo.id, state, cursor, limit, signal)
  }
  async searchConfluence(cql: string, cursor?: string, limit?: number, signal?: AbortSignal): Promise<KanbanQueryResult> {
    return this.confluenceSearchExpression(requiredText(cql, 'CQL'), cursor, limit, signal)
  }

  private config(product: AtlassianProduct) {
    const value = this.getConfig()[product]
    if (!value.baseUrl || !value.bearerToken) throw new Error(`${product} is not configured`)
    return value
  }
  private async call<T>(product: AtlassianProduct, method: string, path: string, options: Parameters<AtlassianHttp['request']>[4] = {}): Promise<T> {
    const config = this.config(product)
    try { return (await this.http.request<T>(config.baseUrl, config.bearerToken, method, path, options)).data }
    catch (error) { throw atlassianToolError(product, config.baseUrl, error, config.bearerToken, method) }
  }
  private safeError(product: AtlassianProduct, error: unknown): string {
    const config = this.getConfig()[product]
    const rawDetail = errorDetails(error)
    let detail = rawDetail
    try {
      const parsed = JSON.parse(rawDetail) as { message?: unknown }
      if (typeof parsed.message === 'string') detail = parsed.message
    } catch { /* ordinary validation/network error */ }
    const message = detail.startsWith(`${product} request to `) ? detail : `${product} request to ${safeHost(config.baseUrl)} failed: ${detail}`
    const token = config.bearerToken
    return token ? message.split(token).join('[redacted]') : message
  }
  private async jiraIssue(key: string, signal?: AbortSignal, includeIcons = true): Promise<KanbanQueryResult> {
    if (!/^[A-Z][A-Z0-9_]*-\d+$/.test(key)) throw new TypeError('Issue key is invalid')
    const issue = await this.call<Json>('jira', 'GET', `/rest/api/2/issue/${encodeURIComponent(key)}`, { query: new URLSearchParams({ fields: '*all' }), ...signalOption(signal) })
    const items = await this.jiraViews([issue], signal, includeIcons)
    return { kind: 'jira-issue', items: [{ ...items[0], key: issue.key ?? key, id: field(issue.id), url: this.absolute('jira', `/browse/${encodeURIComponent(issue.key ?? key)}`) }], total: 1, nextCursor: null }
  }
  private async jiraSearch(id: string, cursor: string | undefined, requested: number | undefined, signal?: AbortSignal, includeIcons = true): Promise<KanbanQueryResult> {
    const saved = queryById(this.getConfig().jira.jql, id, 'JQL')
    return this.jiraSearchExpression(saved.query, cursor, requested, signal, includeIcons)
  }
  private async jiraSearchExpression(jql: string, cursor: string | undefined, requested: number | undefined, signal?: AbortSignal, includeIcons = true): Promise<KanbanQueryResult> {
    const startAt = cursorNumber(cursor), maxResults = countArg(requested, 50, 100)
    const result = await this.call<Json>('jira', 'GET', '/rest/api/2/search', { query: new URLSearchParams({ jql, startAt: String(startAt), maxResults: String(maxResults), fields: 'summary,issuetype,priority,status,assignee,updated' }), ...signalOption(signal) })
    const issues: Json[] = Array.isArray(result.issues) ? result.issues : []
    const views = await this.jiraViews(issues, signal, includeIcons)
    const items = views.map((view, index) => ({ ...view, key: field(issues[index]?.key), id: field(issues[index]?.id), url: this.absolute('jira', `/browse/${encodeURIComponent(field(issues[index]?.key))}`), updated: field(issues[index]?.fields?.updated) }))
    const next = startAt + issues.length
    return { kind: 'jira-search', items, total: typeof result.total === 'number' ? result.total : null, nextCursor: issues.length > 0 && next < Number(result.total ?? Infinity) ? String(next) : null }
  }

  private async jiraViews(issues: readonly Json[], signal?: AbortSignal, includeIcons = true): Promise<Record<string, string | number | boolean | null>[]> {
    const views = new Array<Record<string, string | number | boolean | null>>(issues.length)
    let next = 0
    const worker = async () => {
      while (true) {
        const index = next++
        if (index >= issues.length) return
        const issue = issues[index]
        const fields = issue?.fields ?? {}
        const [typeIcon, priorityIcon] = includeIcons ? await Promise.all([
          this.jiraIcon(fields.issuetype?.iconUrl, signal),
          this.jiraIcon(fields.priority?.iconUrl, signal),
        ]) : [null, null]
        views[index] = {
          title: field(fields.summary),
          type: field(fields.issuetype?.name),
          typeIcon,
          priority: field(fields.priority?.name),
          priorityIcon,
          status: field(fields.status?.name),
          statusCategory: field(fields.status?.statusCategory?.key) || field(fields.status?.statusCategory?.name) || null,
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(4, issues.length) }, worker))
    signal?.throwIfAborted()
    return views
  }

  private async jiraIcon(raw: unknown, signal?: AbortSignal): Promise<string | null> {
    if (typeof raw !== 'string' || raw.length < 1 || raw.length > 2048) return null
    let resolved: { path: string; query?: URLSearchParams; cacheKey: string }
    const config = this.getConfig().jira
    if (!config.baseUrl || !config.bearerToken) return null
    try { resolved = jiraIconPath(config.baseUrl, raw, config.bearerToken) }
    catch { return null }
    const cached = this.iconCache.get(resolved.cacheKey)
    if (cached) {
      this.iconCache.delete(resolved.cacheKey)
      this.iconCache.set(resolved.cacheKey, cached)
      return cached.dataUrl
    }
    try {
      const response = await this.http.request<Buffer>(config.baseUrl, config.bearerToken, 'GET', resolved.path, {
        ...(resolved.query ? { query: resolved.query } : {}),
        ...(signal ? { signal } : {}),
        accept: 'image/png,image/jpeg,image/gif,image/webp,image/svg+xml',
        responseType: 'buffer',
        maxResponseBytes: 64 * 1024,
        timeoutMs: 5_000,
      })
      if (!Buffer.isBuffer(response.data)) return null
      const mediaType = safeImageMediaType(response.headers['content-type'], response.data)
      if (!mediaType) return null
      const dataUrl = `data:${mediaType};base64,${response.data.toString('base64')}`
      if (response.data.byteLength <= this.maxIconCacheBytes) {
        const previous = this.iconCache.get(resolved.cacheKey)
        if (previous) this.iconCacheBytes -= previous.bytes
        const entry = { dataUrl, bytes: response.data.byteLength }
        this.iconCache.set(resolved.cacheKey, entry)
        this.iconCacheBytes += entry.bytes
        while (this.iconCache.size > this.maxIconCacheEntries || this.iconCacheBytes > this.maxIconCacheBytes) {
          const oldestKey = this.iconCache.keys().next().value as string | undefined
          if (oldestKey === undefined) break
          this.iconCacheBytes -= this.iconCache.get(oldestKey)?.bytes ?? 0
          this.iconCache.delete(oldestKey)
        }
      }
      return dataUrl
    } catch { return null }
  }
  private async repository(id: string, signal?: AbortSignal): Promise<KanbanQueryResult> {
    const ref = repoById(this.getConfig().bitbucket.repositories, id)
    const repository = await this.call<Json>('bitbucket', 'GET', `/rest/api/1.0/projects/${encodeURIComponent(ref.projectKey)}/repos/${encodeURIComponent(ref.repositorySlug)}`, signalOption(signal))
    const clone = Array.isArray(repository.links?.clone) ? repository.links.clone.find((x: Json) => x.name === 'http' || x.name === 'https') ?? repository.links.clone[0] : undefined
    return { kind: 'bitbucket-repository', items: [{ id: ref.id, projectKey: ref.projectKey, repositorySlug: ref.repositorySlug, name: field(repository.name), description: field(repository.description), url: field(repository.links?.self?.[0]?.href), cloneUrl: field(clone?.href), public: Boolean(repository.public), state: field(repository.state) }], total: 1, nextCursor: null }
  }
  private async pullRequest(repositoryId: string, prId: number, signal?: AbortSignal): Promise<KanbanQueryResult> {
    if (!Number.isSafeInteger(prId) || prId < 1) throw new TypeError('Pull request id must be a positive integer')
    const ref = repoById(this.getConfig().bitbucket.repositories, repositoryId)
    const pr = await this.call<Json>('bitbucket', 'GET', `/rest/api/1.0/projects/${encodeURIComponent(ref.projectKey)}/repos/${encodeURIComponent(ref.repositorySlug)}/pull-requests/${prId}`, signalOption(signal))
    return { kind: 'bitbucket-pull-request', items: [this.prView(pr)], total: 1, nextCursor: null }
  }
  private prView(pr: Json): Record<string, string | number | boolean | null> {
    const version = typeof pr.version === 'number' && Number.isSafeInteger(pr.version) ? pr.version : typeof pr.version === 'string' && /^\d+$/.test(pr.version) && Number.isSafeInteger(Number(pr.version)) ? Number(pr.version) : null
    return { id: Number(pr.id) || 0, title: field(pr.title), state: field(pr.state), version, url: field(pr.links?.self?.[0]?.href), author: field(pr.author?.user?.displayName), fromRef: field(pr.fromRef?.displayId), toRef: field(pr.toRef?.displayId), createdDate: Number(pr.createdDate) || null, updatedDate: Number(pr.updatedDate) || null }
  }
  private async pullRequests(id: string, state: 'all' | 'open' | 'merged', cursor: string | undefined, requested: number | undefined, signal?: AbortSignal): Promise<KanbanQueryResult> {
    const ref = repoById(this.getConfig().bitbucket.repositories, id), start = cursorNumber(cursor), limit = countArg(requested, 25, 100)
    const query = new URLSearchParams({ state: state === 'open' ? 'OPEN' : state === 'merged' ? 'MERGED' : 'ALL', start: String(start), limit: String(limit) })
    const result = await this.call<Json>('bitbucket', 'GET', `/rest/api/1.0/projects/${encodeURIComponent(ref.projectKey)}/repos/${encodeURIComponent(ref.repositorySlug)}/pull-requests`, { query, ...signalOption(signal) })
    const values: Json[] = Array.isArray(result.values) ? result.values : []
    const next = typeof result.nextPageStart === 'number' && result.isLastPage !== true ? String(result.nextPageStart) : null
    return { kind: 'bitbucket-pull-requests', items: values.map(pr => this.prView(pr)), total: null, nextCursor: next }
  }
  private async confluencePage(id: string, signal?: AbortSignal): Promise<KanbanQueryResult> {
    if (!/^\d+$/.test(id)) throw new TypeError('Confluence page id must be numeric')
    const page = await this.call<Json>('confluence', 'GET', `/rest/api/content/${encodeURIComponent(id)}`, { query: new URLSearchParams({ expand: 'body.storage,space,version,ancestors' }), ...signalOption(signal) })
    return { kind: 'confluence-page', items: [this.pageView(page)], total: 1, nextCursor: null }
  }
  private pageView(page: Json): Record<string, string | number | boolean | null> {
    return { id: field(page.id), title: field(page.title), type: field(page.type), status: field(page.status), spaceKey: field(page.space?.key), url: this.absolute('confluence', field(page._links?.webui)), body: field(page.body?.storage?.value), version: Number(page.version?.number) || null }
  }
  private async confluenceSearch(id: string, cursor: string | undefined, requested: number | undefined, signal?: AbortSignal): Promise<KanbanQueryResult> {
    const saved = queryById(this.getConfig().confluence.cql, id, 'CQL')
    return this.confluenceSearchExpression(saved.query, cursor, requested, signal)
  }
  private async confluenceSearchExpression(cql: string, cursor: string | undefined, requested: number | undefined, signal?: AbortSignal): Promise<KanbanQueryResult> {
    const start = cursorNumber(cursor), limit = countArg(requested, 25, 100)
    const result = await this.call<Json>('confluence', 'GET', '/rest/api/content/search', { query: new URLSearchParams({ cql, start: String(start), limit: String(limit), expand: 'space,version' }), ...signalOption(signal) })
    const values: Json[] = Array.isArray(result.results) ? result.results : []
    const next = confluenceNextCursor(result._links?.next)
    return { kind: 'confluence-search', items: values.map(page => this.pageView(page)), total: typeof result.totalSize === 'number' ? result.totalSize : null, nextCursor: next }
  }
  private absolute(product: AtlassianProduct, path: string): string {
    if (!path) return ''
    const base = parseBaseUrl(this.config(product).baseUrl)
    const basePath = base.pathname.replace(/\/+$/, '')
    if (/^https?:\/\//i.test(path)) return path
    if (basePath && (path === basePath || path.startsWith(`${basePath}/`))) return new URL(path, base.origin).toString()
    if (product === 'confluence' && basePath.endsWith('/confluence') && path.startsWith('/confluence/')) {
      return new URL(`${basePath}${path.slice('/confluence'.length)}`, base.origin).toString()
    }
    return new URL(path.replace(/^\//, ''), `${base.origin}${base.pathname}`).toString()
  }
}

function assertNever(value: never): never { throw new TypeError(`Unsupported query kind: ${JSON.stringify(value)}`) }
function requiredText(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.length === 0 || value !== value.trim() || /[\u0000-\u001f\u007f]/.test(value)) throw new TypeError(`${name} must be a non-empty string`)
  return value
}
function validateSegment(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.length === 0 || value !== value.trim() || value.length > 128 || /[\\/\u0000-\u001f\u007f]/.test(value)) throw new TypeError(`${name} is invalid`)
  return value
}
function confluenceNextCursor(link: unknown): string | null {
  if (typeof link !== 'string' || link.length === 0) return null
  try {
    const url = new URL(link, 'https://placeholder.invalid')
    const start = url.searchParams.get('start')
    if (start !== null && /^(0|[1-9]\d*)$/.test(start) && Number.isSafeInteger(Number(start))) return start
  } catch { /* convert an unparseable server cursor into an explicit tool error below */ }
  throw new TypeError('Confluence returned a next link without a valid start cursor')
}
function confluenceDownloadPath(baseUrl: string, link: string): { path: string; query?: URLSearchParams } {
  const base = parseBaseUrl(baseUrl)
  let target: URL
  try { target = new URL(link, base) }
  catch { throw new TypeError('Confluence attachment download link is invalid') }
  if (target.origin !== base.origin || target.username || target.password || target.hash) throw new TypeError('Confluence attachment download must be a same-origin path without credentials or fragment')
  const basePath = base.pathname
  if (!target.pathname.startsWith(basePath)) throw new TypeError('Confluence attachment download is outside the configured base path')
  const relative = target.pathname.slice(basePath.length)
  const parts = relative.split('/')
  if (!relative.startsWith('download/attachments/') || parts.some(part => !safeDownloadSegment(part))) throw new TypeError('Confluence attachment download path is invalid')
  const allowedQuery = new URLSearchParams()
  const seen = new Set<string>()
  for (const [key, value] of target.searchParams) {
    if (!['version', 'modificationDate', 'api'].includes(key) || seen.has(key) || value.length > 128 || /[\u0000-\u001f\u007f]/.test(value)) throw new TypeError('Confluence attachment download query contains an unsupported parameter')
    seen.add(key)
    allowedQuery.set(key, value)
  }
  return { path: relative, ...(allowedQuery.size ? { query: allowedQuery } : {}) }
}
function validateIssueKey(value: string): string {
  if (!/^[A-Za-z][A-Za-z0-9_]{0,63}-\d+$/.test(value)) throw new TypeError('Jira issue key is invalid')
  return value
}
function jiraAttachmentPath(baseUrl: string, link: string, id: string): string {
  const base = parseBaseUrl(baseUrl)
  let target: URL
  try { target = new URL(link, base) } catch { throw new TypeError('Jira attachment content URL is invalid') }
  if (target.origin !== base.origin || target.username || target.password || target.hash || target.search) throw new TypeError('Jira attachment content URL must be same-origin without query or credentials')
  if (!target.pathname.startsWith(base.pathname)) throw new TypeError('Jira attachment content URL is outside the configured base path')
  const rel = target.pathname.slice(base.pathname.length)
  const decoded = rel.split('/').map(part => { try { return decodeURIComponent(part) } catch { return '' } })
  if (!((decoded[0] === 'secure' && decoded[1] === 'attachment' && decoded[2] === id) || (decoded[0] === 'rest' && decoded[1] === 'api' && /^2$/.test(decoded[2] ?? '') && decoded[3] === 'attachment' && decoded[4] === id && decoded[5] === 'content')) || decoded.some(part => !part || part === '.' || part === '..' || /[\\\u0000-\u001f\u007f]/.test(part))) throw new TypeError('Jira attachment content URL is not a legal attachment route for this id')
  return rel
}
function safeDownloadSegment(segment: string): boolean {
  if (!segment) return false
  try {
    let decoded = decodeURIComponent(segment)
    // Decode a second time only when an encoded byte sequence remains. A
    // literal percent in a filename (encoded as %25) is otherwise legitimate.
    if (/%[0-9a-f]{2}/i.test(decoded)) decoded = decodeURIComponent(decoded)
    return decoded !== '.' && decoded !== '..' && !/[\\/\u0000-\u001f\u007f]/.test(decoded)
  } catch { return false }
}

function validatePageStart(value: number, label = 'start'): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new TypeError(`${label} must be a non-negative integer`)
}
function validatePageLimit(value: number, max: number, label = 'limit'): void {
  if (!Number.isSafeInteger(value) || value < 1 || value > max) throw new TypeError(`${label} must be an integer from 1 to ${max}`)
}
function encodeRepoPath(value: string): string {
  if (typeof value !== 'string' || !value || value !== value.trim() || value.startsWith('/') || value.endsWith('/') || value.includes('\\') || /[\u0000-\u001f\u007f]/.test(value)) throw new TypeError('Repository-relative file path is invalid')
  const parts = value.split('/')
  if (parts.some(part => !part || part === '.' || part === '..')) throw new TypeError('Repository-relative file path is invalid')
  return parts.map(part => encodeURIComponent(part)).join('/')
}
function splitLines(value: string): string[] {
  if (value === '') return []
  const lines = value.split(/\r\n|\n|\r/)
  if (/[\r\n]$/.test(value)) lines.pop()
  return lines
}
function hasTruncatedFlag(value: unknown, depth = 0): boolean {
  if (depth > 20 || typeof value !== 'object' || value === null) return false
  if (Array.isArray(value)) return value.some(item => hasTruncatedFlag(item, depth + 1))
  for (const [key, item] of Object.entries(value)) {
    if (key.toLowerCase() === 'truncated' && item === true) return true
    if (hasTruncatedFlag(item, depth + 1)) return true
  }
  return false
}
function safeHost(baseUrl: string): string {
  try { return new URL(baseUrl).host || 'configured host' }
  catch { return 'configured host' }
}

function stripSuggestionIcons(result: KanbanQueryResult): KanbanQueryResult {
  if (result.kind !== 'jira-search' && result.kind !== 'jira-issue') return result
  return { ...result, items: result.items.map(({ typeIcon: _typeIcon, priorityIcon: _priorityIcon, ...item }) => item) }
}

function jiraIconPath(baseUrl: string, raw: string, token: string): { path: string; query?: URLSearchParams; cacheKey: string } {
  const base = parseBaseUrl(baseUrl)
  let icon: URL
  try { icon = new URL(raw, base) }
  catch { throw new TypeError('Invalid Jira icon URL') }
  if (icon.origin !== base.origin || icon.username || icon.password || icon.hash || !['http:', 'https:'].includes(icon.protocol)) throw new TypeError('Jira icon must be same-origin')
  const basePath = base.pathname
  let pathname = icon.pathname
  if (!pathname.startsWith(basePath)) pathname = `${basePath}${pathname.replace(/^\/+/, '')}`
  const path = pathname.slice(basePath.length)
  if (!path || path.split('/').some(segment => segment === '.' || segment === '..') || path.includes('\\')) throw new TypeError('Invalid Jira icon path')
  const query = new URLSearchParams(icon.searchParams)
  const canonical = new URL(pathname, base.origin)
  canonical.search = query.toString()
  return { path, ...(query.size ? { query } : {}), cacheKey: createHash('sha256').update(token).update('\0').update(canonical.toString()).digest('hex') }
}

function safeImageMediaType(header: string | string[] | undefined, body: Buffer): string | null {
  const type = (Array.isArray(header) ? header[0] : header)?.split(';', 1)[0]?.trim().toLowerCase()
  if (type === 'image/png' && body.length >= 8 && body.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return type
  if (type === 'image/jpeg' && body.length >= 3 && body[0] === 0xff && body[1] === 0xd8 && body[2] === 0xff) return type
  if (type === 'image/gif' && (body.subarray(0, 6).toString('ascii') === 'GIF87a' || body.subarray(0, 6).toString('ascii') === 'GIF89a')) return type
  if (type === 'image/webp' && body.length >= 12 && body.subarray(0, 4).toString('ascii') === 'RIFF' && body.subarray(8, 12).toString('ascii') === 'WEBP') return type
  if (type === 'image/svg+xml') {
    const svg = body.toString('utf8')
    // Only permit standalone, inert SVG documents suitable for <img src>. Reject active
    // content and all external references; embedded styles are limited to class fill colors.
    if (!/<svg(?:\s|>)/i.test(svg) || !/<\/svg\s*>\s*$/i.test(svg) || /<!DOCTYPE|<!ENTITY|<\s*(?:script|foreignObject|iframe|object|embed)\b|\bon[a-z]+\s*=|(?:href|src)\s*=|url\s*\(|@import/i.test(svg) || !safeSvgStyle(svg)) return null
    return type
  }
  return null
}

/** Allow only Jira's inert class fill-color rules; all other SVG CSS is rejected. */
function safeSvgStyle(svg: string): boolean {
  const styleTags = [...svg.matchAll(/<style\b([^>]*)>([\s\S]*?)<\/style\s*>/gi)]
  const openCount = [...svg.matchAll(/<style\b/gi)].length
  const closeCount = [...svg.matchAll(/<\/style\s*>/gi)].length
  if (openCount !== styleTags.length || closeCount !== styleTags.length) return false

  const withoutStyle = svg.replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, '')
  const styleAttributes = [...withoutStyle.matchAll(/<([a-z][a-z0-9:-]*)\b([^>]*)>/gi)].flatMap(tag => {
    const attrs = tag[2] ?? ''
    const values = [...attrs.matchAll(/\bstyle\s*=\s*(["'])(.*?)\1/gi)].map(match => ({ tag: (tag[1] ?? '').toLowerCase(), index: tag.index, value: match[2] ?? '' }))
    if ([...attrs.matchAll(/\bstyle\s*=/gi)].length !== values.length) return [{ tag: '', index: -1, value: '' }]
    return values
  })
  if ([...withoutStyle.matchAll(/\bstyle\s*=/gi)].length !== styleAttributes.length) return false
  if (styleAttributes.length > 1) return false
  if (styleAttributes.length === 1) {
    const inline = styleAttributes[0]!
    const root = /<svg\b[^>]*>/i.exec(svg)
    // Jira 11.3.5's priority assets include this inert root viewport declaration.
    // Do not generalize inline CSS: no other element/property/value is accepted.
    if (inline.tag !== 'svg' || root?.index !== inline.index || !/^enable-background\s*:\s*new(?:\s+\d+(?:\.\d+)?){4}\s*;?$/i.test(inline.value)) return false
  }
  if (styleTags.length === 0) return true

  const fillRule = /\.(-?[_a-z][\w-]*)\s*\{\s*fill\s*:\s*#(?:[\da-f]{3}|[\da-f]{6})\s*;?\s*\}/gi
  for (const [, attributes, css] of styleTags) {
    if (attributes?.trim() && !/^\s+type\s*=\s*(["'])text\/css\1\s*$/i.test(attributes)) return false
    if (typeof css !== 'string') return false
    const rules = [...css.matchAll(fillRule)]
    if (rules.length === 0 || css.replace(fillRule, '').trim() !== '') return false
  }
  return true
}
