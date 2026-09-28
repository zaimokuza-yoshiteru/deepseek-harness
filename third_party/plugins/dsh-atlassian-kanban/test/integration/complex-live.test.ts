/** Opt-in, read-only assertions against separately seeded Data Center fixtures. */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { createTeamBridge } from '../../../dsh-acp-adapter/src/host/teams/bridge.ts'
import type { Context as CordisContext } from '@deepseek-ai/cordis'
import { AtlassianService } from '../../src/host/service.ts'
import { registerTools } from '../../src/host/tools.ts'
import type { AtlassianKanbanConfig } from '../../src/shared/config.ts'

type Json = Record<string, any>
type LiveTool = (name: string, args?: Record<string, unknown>) => Promise<Json>
type LiveToolError = (name: string, args?: Record<string, unknown>) => Promise<Json>
type AttachmentStub = {
  saveFile(input: { data: Uint8Array; name?: string }): Promise<{ attachmentId: string; name: string; bytes: number }>
  fileHostPath(ref: { attachmentId: string; name: string; bytes: number }): string | undefined
}

const mode = process.env.KANBAN_COMPLEX_PRODUCT
if (mode !== undefined && mode !== 'bitbucket' && mode !== 'confluence') {
  throw new Error('KANBAN_COMPLEX_PRODUCT must be bitbucket or confluence')
}
const onlyBitbucket = mode === 'bitbucket' ? describe : describe.skip
const onlyConfluence = mode === 'confluence' ? describe : describe.skip

async function privateJson(path: string | URL): Promise<Json> {
  try { return JSON.parse(await readFile(path, 'utf8')) as Json }
  catch { throw new Error('Required private live fixture state or manifest is missing or invalid; contents suppressed.') }
}

function requiredFixturePath(name: string): string {
  const path = process.env[name]
  if (!path) throw new Error(`Set ${name} to an explicitly selected private fixture file.`)
  return path
}

function requiredText(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value) throw new Error(`Fixture is missing ${label}`)
  return value
}

function requiredPositive(value: unknown, label: string): number {
  const number = Number(value)
  if (!Number.isSafeInteger(number) || number < 1) throw new Error(`Fixture is missing a valid ${label}`)
  return number
}

function requiredNonNegative(value: unknown, label: string): number {
  const number = Number(value)
  if (!Number.isSafeInteger(number) || number < 0) throw new Error(`Fixture or response is missing a valid ${label}`)
  return number
}

function rows(value: Json, label: string): Json[] {
  const selected = value.values ?? value.results ?? value.items
  if (!Array.isArray(selected)) throw new Error(`${label} did not return a list`)
  return selected as Json[]
}

function commentNodes(values: Json[]): Array<{ id: string; parentId: string | null }> {
  const found: Array<{ id: string; parentId: string | null }> = []
  const visit = (comment: Json, parentId: string | null) => {
    if (comment?.id == null) return
    const id = String(comment.id)
    found.push({ id, parentId: comment.parent?.id == null ? parentId : String(comment.parent.id) })
    const children = Array.isArray(comment.comments) ? comment.comments : Array.isArray(comment.comments?.values) ? comment.comments.values : []
    for (const child of children) if (typeof child === 'object' && child !== null) visit(child, id)
  }
  for (const row of values) {
    const comment = row.comment ?? row
    if (typeof comment === 'object' && comment !== null) visit(comment, null)
  }
  return found
}

function continuation(value: Json, label: string): string | null {
  if (value.nextCursor !== undefined) return value.nextCursor === null ? null : String(value.nextCursor)
  if (value.nextStart !== undefined) {
    if (value.nextStart === null) {
      if (value.complete === false || value._links?.next) throw new Error(`${label} signalled completion despite a required continuation`)
      return null
    }
    return String(value.nextStart)
  }
  if (value.isLastPage !== undefined) {
    if (value.isLastPage === true) return null
    if (value.nextPageStart === undefined || value.nextPageStart === null) throw new Error(`${label} omitted nextPageStart from a nonfinal page`)
    return String(value.nextPageStart)
  }
  const next = value._links?.next
  if (typeof next !== 'string' || !next) return null
  const start = new URL(next, 'http://localhost').searchParams.get('start')
  if (start === null) throw new Error(`${label} returned an unparseable next link`)
  return start
}

async function walk(
  call: LiveTool, name: string, args: Record<string, unknown>, label: string,
  cursorArg: 'cursor' | 'start', limit = 3,
): Promise<{ pages: Json[]; values: Json[] }> {
  const pages: Json[] = []
  const values: Json[] = []
  const seen = new Set<string>()
  let cursor: string | null = null
  for (let page = 0; page < 500; page += 1) {
    const response = await call(name, { ...args, limit, ...(cursor === null ? {} : { [cursorArg]: cursorArg === 'start' ? Number(cursor) : cursor }) })
    pages.push(response)
    values.push(...rows(response, label))
    const next = continuation(response, label)
    if (next === null) return { pages, values }
    if (seen.has(next)) throw new Error(`${label} repeated a pagination cursor`)
    seen.add(next)
    cursor = next
  }
  throw new Error(`${label} exceeded the bounded pagination walk`)
}

async function withBridge(config: AtlassianKanbanConfig, expected: readonly string[], run: (call: LiveTool, error: LiveToolError) => Promise<void>, attachmentStub?: AttachmentStub): Promise<void> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt, {})
  await ctx.plugin(ToolRuntime)
  const serviceContext = attachmentStub === undefined ? ctx : {
    get(name: string, required?: boolean) { return name === 'attachments' ? attachmentStub : ctx.get(name, required) },
  }
  const service = new AtlassianService(serviceContext as unknown as CordisContext, () => config)
  const disposeTools = registerTools(ctx as unknown as CordisContext, service)
  const agent = { id: `kanban-complex-${mode}`, inbox: { nextStep: [] }, steer() {} }
  const bridgeContext = {
    get(name: string) { return name === 'tools' ? ctx.get('tools') : name === 'agents' ? { get: (id: string) => id === agent.id ? agent : undefined } : ctx.get(name, false) },
    on(name: string, listener: (...args: any[]) => void) { return ctx.on(name, listener) },
  } as unknown as CordisContext
  let lease: Awaited<ReturnType<typeof createTeamBridge>> | undefined
  let client: Client | undefined
  try {
    lease = await createTeamBridge(bridgeContext, agent.id, { mcpCapabilities: { http: true } })
    if (!lease) throw new Error('The real DSH tool registry did not open its ACP MCP bridge')
    const server = lease.servers[0]
    if (!server || !('url' in server)) throw new Error('The ACP bridge did not expose loopback HTTP')
    client = new Client({ name: 'atlassian-kanban-complex-live-test', version: '1.0.0' })
    await client.connect(new StreamableHTTPClientTransport(new URL(server.url)) as Parameters<Client['connect']>[0])
    const listed = await client.listTools()
    for (const name of expected) expect(listed.tools.some(tool => tool.name === name), `MCP tools/list contains ${name}`).toBe(true)
    lease.beginPrompt(new AbortController().signal)
    const redactDiagnostic = (value: string) => {
      let safe = value
      for (const token of [config.jira.bearerToken, config.bitbucket.bearerToken, config.confluence.bearerToken]) {
        if (token) safe = safe.split(token).join('[redacted]')
      }
      return safe.replace(/[\r\n\t]+/g, ' ').slice(0, 300)
    }
    const call: LiveTool = async (name, args = {}) => {
      const result = await client!.callTool({ name, arguments: args })
      if (result.isError) {
        const raw = result.content.filter(item => item.type === 'text').map(item => item.text).join('\n')
        let detail = redactDiagnostic(raw)
        if (raw.startsWith('Error: {')) {
          try {
            const failure = JSON.parse(raw.slice('Error: '.length)) as Json
            const status = Number.isSafeInteger(Number(failure.httpStatus)) ? ` HTTP ${Number(failure.httpStatus)}` : ''
            detail = `${redactDiagnostic(String(failure.code ?? 'TOOL_ERROR'))}${status}: ${redactDiagnostic(String(failure.message ?? 'request failed'))}`
          } catch { /* keep the bounded redacted diagnostic */ }
        }
        throw new Error(`Live ${name} failed: ${detail}`)
      }
      const text = result.content.filter(item => item.type === 'text').map(item => item.text).join('\n')
      try { return JSON.parse(text) as Json }
      catch { throw new Error(`Live ${name} did not return JSON; response content suppressed`) }
    }
    const error: LiveToolError = async (name, args = {}) => {
      const result = await client!.callTool({ name, arguments: args })
      if (!result.isError) throw new Error(`Live ${name} unexpectedly succeeded`)
      const message = result.content.filter(item => item.type === 'text').map(item => item.text).join('\n')
      if (!message.startsWith('Error: ')) throw new Error(`Live ${name} returned an unstructured error; contents suppressed`)
      try { return JSON.parse(message.slice('Error: '.length)) as Json }
      catch { throw new Error(`Live ${name} returned an unparseable error; contents suppressed`) }
    }
    await run(call, error)
  } finally {
    await client?.close()
    await lease?.close()
    for (const dispose of disposeTools.reverse()) dispose()
  }
}

onlyBitbucket('Bitbucket complex fixture through the real DSH registry and ACP bridge', () => {
  it('walks small pages and checks the large PR without claiming a truncated diff is complete', async () => {
    const manifest = await privateJson(requiredFixturePath('KANBAN_COMPLEX_BITBUCKET_MANIFEST'))
    const state = await privateJson(requiredFixturePath('KANBAN_COMPLEX_BITBUCKET_STATE'))
    const projectKey = requiredText(manifest.projectKey, 'projectKey')
    const repositorySlug = requiredText(manifest.complexRepository, 'complexRepository')
    const open = (manifest.pullRequests as Json[] | undefined)?.find(pr => pr.state === 'OPEN' && pr.repositorySlug === repositorySlug)
    if (!open) throw new Error('Fixture lacks the complex open PR')
    const pullRequestId = requiredPositive(open.id, 'open PR id')
    const config: AtlassianKanbanConfig = {
      jira: { baseUrl: '', bearerToken: '', jql: [] },
      bitbucket: { baseUrl: requiredText(state.baseUrl, 'Bitbucket base URL'), bearerToken: requiredText(state.bearerToken, 'Bitbucket token'), repositories: [{ id: 'complex-live-repo', projectKey, repositorySlug }] },
      confluence: { baseUrl: '', bearerToken: '', cql: [] },
    }
    await withBridge(config, [
      'kanban_bitbucket_list_pull_request_changes', 'kanban_bitbucket_list_pull_request_commits', 'kanban_bitbucket_list_pull_request_comments',
      'kanban_bitbucket_get_pull_request_comment', 'kanban_bitbucket_add_pull_request_comment', 'kanban_bitbucket_edit_pull_request_comment',
      'kanban_bitbucket_delete_pull_request_comment', 'kanban_bitbucket_get_pull_request_diff', 'kanban_bitbucket_get_review_file',
    ], async (call, error) => {
      const common = { projectKey, repositorySlug, pullRequestId }
      const changes = await walk(call, 'kanban_bitbucket_list_pull_request_changes', common, 'PR changes', 'cursor')
      const expectedChanges = requiredPositive(open.changedFiles ?? open.targetFiles, 'changedFiles')
      expect(changes.values.length).toBe(expectedChanges)
      expect(changes.pages.length).toBeGreaterThan(1)
      const changedPaths = changes.values.map(row => {
        const path = row.path
        return typeof path === 'string' ? path : typeof path?.toString === 'string' ? path.toString : undefined
      }).filter((path): path is string => typeof path === 'string' && path.length > 0)
      expect(changedPaths.length).toBe(changes.values.length)
      expect(new Set(changedPaths).size).toBe(changedPaths.length)
      expect(changedPaths).toContain(requiredText(open.longFilePath, 'longFilePath'))

      const commits = await walk(call, 'kanban_bitbucket_list_pull_request_commits', common, 'PR commits', 'cursor')
      if (open.commits !== undefined) expect(commits.values.length).toBe(requiredPositive(open.commits, 'commits'))
      expect(commits.pages.length).toBeGreaterThan(1)

      const comments = await walk(call, 'kanban_bitbucket_list_pull_request_comments', common, 'PR comments', 'cursor')
      const observedCommentIds = new Set(commentNodes(comments.values).map(row => row.id))
      for (const id of open.commentIds ?? []) expect(observedCommentIds.has(String(id)), `comment ${String(id)} appears across activity pages`).toBe(true)
      if (open.replyId != null) expect(observedCommentIds.has(String(open.replyId)), 'nested reply appears across activity pages').toBe(true)
      if (open.commentIds?.length > 3) expect(comments.pages.length).toBeGreaterThan(1)
      if (open.replyId != null) {
        const reply = await call('kanban_bitbucket_get_pull_request_comment', { ...common, commentId: Number(open.replyId) })
        expect(String(reply.id)).toBe(String(open.replyId))
        const expectedParentId = open.comments?.find((row: Json) => String(row.id) === String(open.replyId))?.parentId
        if (expectedParentId != null && reply.parent?.id != null) expect(String(reply.parent.id)).toBe(String(expectedParentId))
      }
      if (open.inlineCommentId != null && open.inlineCommentPath) {
        const inline = await walk(call, 'kanban_bitbucket_list_pull_request_comments', { ...common, path: String(open.inlineCommentPath) }, 'inline PR comments', 'cursor')
        expect(commentNodes(inline.values).some(row => row.id === String(open.inlineCommentId))).toBe(true)
      }

      const diff = await call('kanban_bitbucket_get_pull_request_diff', common)
      expect(typeof diff.complete).toBe('boolean')
      expect(typeof diff.serverTruncated).toBe('boolean')
      expect(diff.paged).toBe(false)
      if (typeof open.serverTruncatedExpected === 'boolean') expect(diff.serverTruncated).toBe(open.serverTruncatedExpected)
      if (diff.serverTruncated) {
        expect(diff.complete).toBe(false)
        expect(typeof diff.nextAction).toBe('string')
      }
      const fileDiff = await call('kanban_bitbucket_get_pull_request_diff', { ...common, path: requiredText(open.longFilePath, 'longFilePath'), contextLines: 3 })
      expect(fileDiff.paged).toBe(false)
      expect(typeof fileDiff.complete).toBe('boolean')
      for (const renamed of open.renamedFiles ?? []) {
        const renamedDiff = await call('kanban_bitbucket_get_pull_request_diff', { ...common, path: requiredText(renamed.path, 'renamed path'), srcPath: requiredText(renamed.srcPath, 'renamed srcPath'), contextLines: 3 })
        expect(renamedDiff.path).toBe(renamed.path)
        expect(renamedDiff.srcPath).toBe(renamed.srcPath)
      }

      const at = requiredText(open.headSha, 'immutable headSha')
      const longFilePath = requiredText(open.longFilePath, 'longFilePath')
      const first = await call('kanban_bitbucket_get_review_file', { projectKey, repositorySlug, path: longFilePath, at, start: 0, limit: 5 })
      expect(first.pageComplete).toBe(true)
      expect(first.complete).toBe(false)
      expect(Number.isSafeInteger(Number(first.nextStart))).toBe(true)
      const totalLines = requiredPositive(first.linePage?.totalLines, 'review file totalLines')
      expect(totalLines).toBeGreaterThan(5)
      expect(first.nextStart).toBe(5)
      const tail = await call('kanban_bitbucket_get_review_file', { projectKey, repositorySlug, path: longFilePath, at, start: Math.max(0, totalLines - 20), limit: 20 })
      expect(tail.complete).toBe(true)
      expect(tail.nextStart).toBeNull()
      expect(tail.linePage?.isLastPage).toBe(true)
      expect(tail.lines.map((line: Json) => line.text).join('\n')).toContain(requiredText(open.longFileTailMarker, 'longFileTailMarker'))

      // Mutate only a uniquely named comment on the already authorized disposable PR.
      // Always delete that self-created comment, including when an assertion fails.
      const initialText = `Kanban complex live comment ${randomUUID()}`
      const updatedText = `${initialText} edited`
      let createdId: number | null = null
      try {
        const created = await call('kanban_bitbucket_add_pull_request_comment', { ...common, text: initialText })
        createdId = requiredPositive(created.id, 'created comment id')
        const listed = await walk(call, 'kanban_bitbucket_list_pull_request_comments', common, 'PR comments after create', 'cursor')
        expect(commentNodes(listed.values).some(row => row.id === String(createdId))).toBe(true)
        const before = await call('kanban_bitbucket_get_pull_request_comment', { ...common, commentId: createdId })
        expect(before.text).toBe(initialText)
        await call('kanban_bitbucket_edit_pull_request_comment', { ...common, commentId: String(createdId), text: updatedText, version: requiredNonNegative(before.version, 'comment version') })
        const edited = await call('kanban_bitbucket_get_pull_request_comment', { ...common, commentId: createdId })
        expect(edited.text).toBe(updatedText)
        expect(Number(edited.version)).toBeGreaterThan(Number(before.version))
      } finally {
        if (createdId !== null) {
          const current = await call('kanban_bitbucket_get_pull_request_comment', { ...common, commentId: createdId })
          await call('kanban_bitbucket_delete_pull_request_comment', { ...common, commentId: String(createdId), version: requiredNonNegative(current.version, 'current comment version') })
        }
      }
      const deleted = await error('kanban_bitbucket_get_pull_request_comment', { ...common, commentId: createdId })
      expect(deleted).toMatchObject({ code: 'ATLASSIAN_HTTP_404', httpStatus: 404 })
      const afterDelete = await walk(call, 'kanban_bitbucket_list_pull_request_comments', common, 'PR comments after delete', 'cursor')
      expect(commentNodes(afterDelete.values).some(row => row.id === String(createdId))).toBe(false)
    })
  }, 180_000)
})

onlyConfluence('Confluence complex fixture through the real DSH registry and ACP bridge', () => {
  it('walks descendants and attachments, reads bounded UTF-8, and identifies unsupported binary files', async () => {
    const manifest = await privateJson(requiredFixturePath('KANBAN_COMPLEX_CONFLUENCE_MANIFEST'))
    const state = await privateJson(requiredFixturePath('KANBAN_COMPLEX_CONFLUENCE_STATE'))
    const rootPageId = requiredText(String(manifest.rootPageId ?? ''), 'rootPageId')
    const expectedPages = manifest.pages as Json[] | undefined
    const expectedAttachments = manifest.attachments as Json[] | undefined
    if (!Array.isArray(expectedPages) || expectedPages.length < 20 || !Array.isArray(expectedAttachments) || expectedAttachments.length < 1) {
      throw new Error('Confluence complex manifest needs at least 20 pages and attachment facts')
    }
    const config: AtlassianKanbanConfig = {
      jira: { baseUrl: '', bearerToken: '', jql: [] },
      bitbucket: { baseUrl: '', bearerToken: '', repositories: [] },
      confluence: { baseUrl: requiredText(state.baseUrl, 'Confluence base URL'), bearerToken: requiredText(state.bearerToken, 'Confluence token'), cql: [] },
    }
    let savedAttachment: { data: Uint8Array; name?: string } | undefined
    const attachmentStub: AttachmentStub = {
      async saveFile(input) {
        savedAttachment = { data: Uint8Array.from(input.data), name: input.name }
        return { attachmentId: 'complex-live-captured-file', name: input.name ?? 'attachment.bin', bytes: input.data.byteLength }
      },
      fileHostPath() { return undefined },
    }
    await withBridge(config, [
      'kanban_confluence_list_descendants', 'kanban_confluence_get_page', 'kanban_confluence_list_comments', 'kanban_confluence_list_attachments',
      'kanban_confluence_get_attachment', 'kanban_confluence_read_attachment', 'kanban_confluence_download_attachment',
    ], async call => {
      const descendants = await walk(call, 'kanban_confluence_list_descendants', { pageId: rootPageId }, 'Confluence descendants', 'start')
      const observedIds = descendants.values.map(row => String(row.id))
      expect(new Set(observedIds).size).toBe(observedIds.length)
      const expectedDescendantIds = expectedPages.map(page => String(page.id)).filter(id => id !== rootPageId)
      expect(new Set(observedIds)).toEqual(new Set(expectedDescendantIds))
      expect(descendants.pages.length).toBeGreaterThan(1)
      for (const page of expectedPages) {
        const actual = await call('kanban_confluence_get_page', { pageId: String(page.id) })
        expect(String(actual.id)).toBe(String(page.id))
        expect(Number.isSafeInteger(Number(actual.version?.number))).toBe(true)
        if (page.parentId !== undefined && page.parentId !== null) {
          expect(String(actual.ancestors?.at(-1)?.id)).toBe(String(page.parentId))
        }
        expect(actual.body?.storage?.value).toContain(requiredText(page.factMarker, 'page factMarker'))
      }
      const expectedComments = manifest.comments as Json[] | undefined
      if (Array.isArray(expectedComments) && expectedComments.length) {
        const comments = await walk(call, 'kanban_confluence_list_comments', { pageId: rootPageId }, 'Confluence root comments', 'start')
        expect(new Set(comments.values.map(row => String(row.id)))).toEqual(new Set(expectedComments.map(row => String(row.id))))
        if (expectedComments.length > 3) expect(comments.pages.length).toBeGreaterThan(1)
      }

      const attachmentsByPage = new Map<string, Json[]>()
      for (const attachment of expectedAttachments) {
        const pageId = String(attachment.pageId)
        const values = attachmentsByPage.get(pageId) ?? []
        values.push(attachment)
        attachmentsByPage.set(pageId, values)
      }
      for (const page of expectedPages) {
        const pageId = String(page.id)
        const expected = attachmentsByPage.get(pageId) ?? []
        const listed = await walk(call, 'kanban_confluence_list_attachments', { pageId }, `attachments on ${pageId}`, 'start')
        expect(listed.values.length).toBe(expected.length)
        expect(new Set(listed.values.map(row => String(row.id)))).toEqual(new Set(expected.map(row => String(row.id))))
        if (expected.length > 3) expect(listed.pages.length).toBeGreaterThan(1)
        for (const attachment of expected) {
          const metadata = await call('kanban_confluence_get_attachment', { attachmentId: String(attachment.id) })
          expect(String(metadata.id)).toBe(String(attachment.id))
          expect(metadata.title).toBe(attachment.title)
          expect(Number.isSafeInteger(Number(metadata.version?.number))).toBe(true)
          if (attachment.utf8TailMarker == null) continue
          let text = ''
          let offset = 0
          const visited = new Set<number>()
          let completed = false
          for (let chunk = 0; chunk < 500; chunk += 1) {
            const read = await call('kanban_confluence_read_attachment', { attachmentId: String(attachment.id), offset, maxChars: chunk === 0 ? 17 : 4096 })
            expect(read.supported).toBe(true)
            expect(typeof read.text).toBe('string')
            text += read.text
            if (read.nextOffset === null) { completed = true; break }
            const next = Number(read.nextOffset)
            if (!Number.isSafeInteger(next) || next <= offset || visited.has(next)) throw new Error('Attachment text cursor did not advance')
            visited.add(next)
            offset = next
          }
          expect(completed, 'Attachment text finished within bounded reads').toBe(true)
          expect(text).toContain(requiredText(attachment.utf8TailMarker, 'utf8TailMarker'))
        }
      }
      const binaryId = requiredText(String(manifest.binaryAttachmentId ?? ''), 'binaryAttachmentId')
      const binary = await call('kanban_confluence_read_attachment', { attachmentId: binaryId, offset: 0, maxChars: 64 })
      expect(binary.supported).toBe(false)
      expect(typeof binary.reason).toBe('string')
      expect(JSON.stringify(binary)).not.toContain('base64')
      const download = await call('kanban_confluence_download_attachment', { attachmentId: binaryId })
      expect(download.available).toBe(true)
      expect(download.file?.attachmentId).toBe('complex-live-captured-file')
      const binaryFixture = expectedAttachments.find(item => String(item.id) === binaryId)
      if (!binaryFixture) throw new Error('The binary attachment is absent from the manifest')
      expect(download.bytes).toBe(binaryFixture.byteLength)
      expect(savedAttachment?.name).toBe(binaryFixture.title)
      expect(Buffer.from(savedAttachment?.data ?? [])).toEqual(await readFile(join(requiredText(manifest.localFixtureFiles, 'localFixtureFiles'), requiredText(binaryFixture.title, 'binary filename'))))
    }, attachmentStub)
  }, 180_000)
})
