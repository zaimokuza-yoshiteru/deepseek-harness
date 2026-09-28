import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { type ToolRunContext } from '@deepseek-ai/dsh-tools'
import type { AtlassianKanbanConfig } from '../../src/shared/config.ts'
import { AtlassianService } from '../../src/host/service.ts'
import { registerTools } from '../../src/host/tools.ts'

describe('bounded review and Confluence read tools', () => {
  let server: Server
  let baseUrl: string
  let seen: string[]
  let attachmentType: string
  let jiraAttachmentType: string
  let attachmentDownload: string
  let attachmentText: string

  beforeEach(async () => {
    seen = []
    attachmentType = 'text/plain'
    jiraAttachmentType = 'text/plain'
    attachmentDownload = '/conf/download/attachments/99/readme.txt?version=3&modificationDate=2&api=v2'
    attachmentText = 'A😀B'
    server = createServer(async (request, response) => {
      const url = new URL(request.url ?? '/', 'http://local')
      seen.push(`${request.method} ${url.pathname}${url.search}`)
      const bb = '/bb/rest/api/1.0/projects/ENG/repos/site'
      response.setHeader('content-type', 'application/json')
      if (url.pathname === '/rest/api/2/issue/APP-1') {
        response.end(JSON.stringify({ key: 'APP-1', fields: { attachment: [{ id: '501', filename: 'hello.txt', size: 6, mimeType: 'text/plain' }] } }))
      } else if (url.pathname === '/rest/api/2/attachment/501') {
        response.end(JSON.stringify({ id: '501', filename: 'hello.txt', content: '/secure/attachment/501/hello.txt' }))
      } else if (url.pathname === '/secure/attachment/501/hello.txt') {
        response.setHeader('content-type', jiraAttachmentType); response.end('A😀B')
      } else if (url.pathname === `${bb}/pull-requests/7/diff/src/new%20name.txt`) {
        response.end(JSON.stringify({ truncated: true, diffs: [{ truncated: false, hunks: [{ truncated: true, segments: [{ truncated: true }] }] }] }))
      } else if (url.pathname === `${bb}/pull-requests/400`) {
        response.statusCode = 400
        response.end(JSON.stringify({ errors: { summary: 'Summary is required' }, errorMessages: ['invalid request secret-token-should-not-appear'] }))
      } else if (url.pathname === `${bb}/pull-requests/7/changes`) {
        response.end(JSON.stringify({ values: [], isLastPage: false, nextPageStart: 13, start: 10, limit: 3 }))
      } else if (url.pathname === `${bb}/browse/src/file.txt`) {
        response.end(JSON.stringify({ path: 'src/file.txt', revision: 'a'.repeat(40), size: 10, lines: [{ line: 1, text: 'server-page-placeholder' }], type: 'FILE' }))
      } else if (url.pathname === `${bb}/raw/src/file.txt`) {
        response.setHeader('content-type', 'text/plain; charset=utf-8')
        response.end('α😀\nsecond\nthird\n')
      } else if (url.pathname === '/conf/rest/api/content/search') {
        response.end(JSON.stringify({ results: [], _links: { next: '/conf/rest/api/content/search?cql=ancestor%3D42&start=25&limit=25' } }))
      } else if (url.pathname === '/conf/rest/api/content/42/child/page') {
        response.end(JSON.stringify({ results: [], _links: {} }))
      } else if (url.pathname === '/conf/rest/api/content/99') {
        response.end(JSON.stringify({ id: '99', type: 'attachment', title: 'readme.txt', version: { number: 3 }, extensions: { mediaType: 'text/plain' }, _links: { download: attachmentDownload } }))
      } else if (url.pathname === '/conf/rest/api/content/100') {
        response.end(JSON.stringify({ id: '100', type: 'attachment', title: 'notes.txt', version: { number: 1 }, extensions: { mediaType: 'text/plain' }, _links: { download: 'https://evil.invalid/notes.txt' } }))
      } else if (url.pathname === '/conf/rest/api/content/101') {
        response.end(JSON.stringify({ id: '101', type: 'attachment', title: 'manual.pdf', version: { number: 2 }, extensions: { mediaType: 'application/pdf' }, _links: { download: '/conf/download/attachments/101/manual.pdf' } }))
      } else if (url.pathname === '/conf/rest/api/content/102') {
        response.end(JSON.stringify({ id: '102', type: 'attachment', title: 'bad.txt', extensions: { mediaType: 'text/plain' }, _links: { download: '/conf/download/attachments/123/%2e%2e%2frest%2fapi%2fuser%2fcurrent' } }))
      } else if (url.pathname === '/conf/download/attachments/99/readme.txt') {
        response.setHeader('content-type', attachmentType)
        response.end(attachmentText)
      } else if (url.pathname.startsWith('/conf/download/attachments/')) {
        response.setHeader('content-type', 'application/pdf')
        response.end('%PDF-1.4')
      } else if (url.pathname === '/bb/rest/api/1.0/projects/ENG/repos/site/pull-requests/7/activities') {
        response.end(JSON.stringify({ values: [], isLastPage: false, nextPageStart: 29 }))
      } else {
        response.statusCode = 403
        response.end(JSON.stringify({ message: 'private request rejected; secret-token-should-not-appear' }))
      }
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })

  afterEach(async () => { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())) })

  const config = (): AtlassianKanbanConfig => ({
    refreshMentions: true,
    jira: { baseUrl, bearerToken: 'jira-secret', jql: [] },
    bitbucket: { baseUrl: `${baseUrl}/bb`, bearerToken: 'secret-token-should-not-appear', repositories: [{ id: 'site', projectKey: 'ENG', repositorySlug: 'site' }] },
    confluence: { baseUrl: `${baseUrl}/conf`, bearerToken: 'conf-secret', cql: [] },
  })

  const run = async (name: string, args: Record<string, unknown>, provider?: unknown): Promise<unknown> => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt, {})
    await ctx.plugin(ToolRuntime)
    if (provider !== undefined) ctx.provide('attachments', provider as never)
    const disposers = registerTools(ctx, new AtlassianService(ctx, config))
    try {
      const tool = ctx.tools.get(name)
      if (!tool) throw new Error(`Tool was not registered: ${name}`)
      return await tool.execute(args, { name, callId: 'test', rootCallId: 'test', signal: new AbortController().signal, deferContext() {}, concludeTurn() {} } as ToolRunContext)
    } finally { for (const dispose of disposers.reverse()) dispose(); await ctx.fiber.dispose() }
  }

  it('marks nested Bitbucket diff truncation and routes renamed-file context through supported parameters', async () => {
    const result = await run('kanban_bitbucket_get_pull_request_diff', { projectKey: 'ENG', repositorySlug: 'site', pullRequestId: 7, path: 'src/new name.txt', srcPath: 'src/old name.txt', contextLines: 0 }) as Record<string, any>
    expect(result).toMatchObject({ complete: false, serverTruncated: true, paged: false, path: 'src/new name.txt', srcPath: 'src/old name.txt', contextLines: 0 })
    expect(result.nextAction).toContain('cannot return a later diff page')
    const request = new URL(seen[0].replace(/^GET /, ''), baseUrl)
    expect(request.pathname).toContain('/pull-requests/7/diff/src/new%20name.txt')
    expect(request.searchParams.get('srcPath')).toBe('src/old name.txt')
    expect(request.searchParams.get('contextLines')).toBe('0')
  })

  it('continues Bitbucket even when comment filtering returns an empty values array', async () => {
    const result = await run('kanban_bitbucket_list_pull_request_comments', { projectKey: 'ENG', repositorySlug: 'site', pullRequestId: 7, cursor: '20', limit: 9 }) as Record<string, any>
    expect(result).toMatchObject({ complete: false, nextPageStart: 29, values: [] })
    expect(result.nextAction).toContain('Continue from nextPageStart=29')
    await expect(run('kanban_bitbucket_list_pull_request_activities', { projectKey: 'ENG', repositorySlug: 'site', pullRequestId: 7, cursor: '-1' })).rejects.toThrow('non-negative integer')
    await expect(run('kanban_bitbucket_list_pull_request_activities', { projectKey: 'ENG', repositorySlug: 'site', pullRequestId: 7, limit: 0 })).rejects.toThrow('integer from 1 to 100')
  })

  it('pages a pinned UTF-8 Bitbucket file as line objects while preserving the browse envelope', async () => {
    const sha = 'a'.repeat(40)
    const first = await run('kanban_bitbucket_get_review_file', { projectKey: 'ENG', repositorySlug: 'site', path: 'src/file.txt', at: sha, start: 0, limit: 2 }) as Record<string, any>
    expect(first).toMatchObject({ path: 'src/file.txt', revision: sha, complete: false, pageComplete: true, nextStart: 2, size: 10, linePage: { start: 0, totalLines: 3, isLastPage: false } })
    expect(first.lines).toEqual([{ text: 'α😀', line: 1, charOffset: 0 }, { text: 'second', line: 2, charOffset: 0 }])
    const second = await run('kanban_bitbucket_get_review_file', { projectKey: 'ENG', repositorySlug: 'site', path: 'src/file.txt', at: sha, start: 2, limit: 2 }) as Record<string, any>
    expect(second).toMatchObject({ complete: true, nextStart: null, linePage: { start: 2, totalLines: 3, isLastPage: true } })
    expect(second.lines).toEqual([{ text: 'third', line: 3, charOffset: 0 }])
    expect(seen.filter(item => item.includes('/raw/src/file.txt')).every(item => item.includes(`at=${sha}`))).toBe(true)
  })

  it('uses Data Center ancestor CQL and preserves continuation even for an empty result page', async () => {
    const result = await run('kanban_confluence_list_descendants', { pageId: '42', start: 0, limit: 25 }) as Record<string, any>
    expect(result).toMatchObject({ complete: false, nextStart: 25, results: [] })
    expect(result.nextAction).toContain('Continue with start=25')
    const request = new URL(seen[0].replace(/^GET /, ''), baseUrl)
    expect(request.pathname).toBe('/conf/rest/api/content/search')
    expect(request.searchParams.get('cql')).toBe('ancestor = 42 AND type = page')
  })

  it('reads bounded attachment text with Unicode codepoint offsets and passes only whitelisted server link query values', async () => {
    const result = await run('kanban_confluence_read_attachment', { attachmentId: '99', offset: 1, maxChars: 1 }) as Record<string, any>
    expect(result).toMatchObject({ supported: true, offset: 1, totalCharacters: 3, text: '😀', nextOffset: 2 })
    expect(seen.at(-1)).toBe('GET /conf/download/attachments/99/readme.txt?version=3&modificationDate=2&api=v2')
  })

  it('lists Jira attachment metadata and reads content only through the matching Jira attachment route', async () => {
    const listed = await run('kanban_jira_list_attachments', { issueKey: 'APP-1' }) as Record<string, any>
    expect(listed.attachments).toEqual([{ id: '501', filename: 'hello.txt', size: 6, mimeType: 'text/plain', created: undefined, author: { displayName: null, key: null } }])
    const page = await run('kanban_jira_read_attachment', { attachmentId: '501', offset: 1, maxChars: 1 }) as Record<string, any>
    expect(page).toMatchObject({ supported: true, text: '😀', offset: 1, nextOffset: 2 })
    jiraAttachmentType = 'application/pdf'
    const spoofed = await run('kanban_jira_read_attachment', { attachmentId: '501' }) as Record<string, any>
    expect(spoofed).toMatchObject({ supported: false, mediaType: 'application/pdf' })
    expect(seen.slice(-2)).toEqual(['GET /rest/api/2/attachment/501', 'GET /secure/attachment/501/hello.txt'])
  })

  it('does not fetch a cross-origin link or claim a PDF is read when disguised with a text filename', async () => {
    await expect(run('kanban_confluence_read_attachment', { attachmentId: '100' })).rejects.toThrow('same-origin')
    expect(seen.some(item => item.includes('evil.invalid'))).toBe(false)
    const pdf = await run('kanban_confluence_read_attachment', { attachmentId: '101' }) as Record<string, any>
    expect(pdf).toMatchObject({ supported: false, filename: 'manual.pdf', mediaType: 'application/pdf' })
    attachmentType = 'application/pdf'
    attachmentText = '%PDF-1.4'
    // Metadata remains a .txt, but an authoritative non-text response MIME wins.
    const spoof = await run('kanban_confluence_read_attachment', { attachmentId: '99' }) as Record<string, any>
    expect(spoof).toMatchObject({ supported: false, mediaType: 'application/pdf' })
  })

  it('throws structured sanitized HTTP errors so MCP marks the operation as failed', async () => {
    await expect(run('kanban_bitbucket_get_pull_request', { projectKey: 'ENG', repositorySlug: 'site', pullRequestId: 404 })).rejects.toSatisfy((error: Error) => {
      expect(() => JSON.parse(error.message)).not.toThrow()
      const parsed = JSON.parse(error.message)
      expect(parsed).toMatchObject({ code: 'ATLASSIAN_HTTP_403', httpStatus: 403, retryable: false })
      expect(parsed.message).toContain('HTTP 403')
      expect(parsed.message).not.toContain('secret-token-should-not-appear')
      return true
    })
    await expect(run('kanban_bitbucket_get_pull_request', { projectKey: 'ENG', repositorySlug: 'site', pullRequestId: 400 })).rejects.toSatisfy((error: Error) => {
      const parsed = JSON.parse(error.message)
      expect(parsed.httpStatus).toBe(400)
      expect(parsed.message).toContain('fields: summary')
      expect(parsed.message).toContain('Summary is required')
      expect(parsed.message).not.toContain('secret-token-should-not-appear')
      expect(parsed.nextAction).toContain('metadata')
      return true
    })
  })

  it('downloads through the optional native provider and reports provider failures safely', async () => {
    const unavailable = await run('kanban_confluence_download_attachment', { attachmentId: '99' }) as Record<string, any>
    expect(unavailable).toMatchObject({ available: false })
    const stored: { data?: Uint8Array; name?: string } = {}
    const provider = {
      async saveFile(input: { data: Uint8Array; name?: string }) { stored.data = input.data; stored.name = input.name; return { attachmentId: 'file-ref', name: input.name ?? 'file', bytes: input.data.byteLength } },
      fileHostPath() { return '/provider-owned/file-ref' },
    }
    const result = await run('kanban_confluence_download_attachment', { attachmentId: '99' }, provider) as Record<string, any>
    expect(result).toMatchObject({ available: true, attachmentId: '99', filename: 'readme.txt', version: 3, bytes: 6, hostPath: '/provider-owned/file-ref' })
    expect(Buffer.from(stored.data!).toString()).toBe('A😀B')
    expect(stored.name).toBe('readme.txt')
    const broken = { async saveFile() { throw new Error('save failed conf-secret /private/path') }, fileHostPath() { return '/private/path' } }
    await expect(run('kanban_confluence_download_attachment', { attachmentId: '99' }, broken)).rejects.toThrow('could not be stored')
    await expect(run('kanban_confluence_read_attachment', { attachmentId: '102' })).rejects.toThrow('path is invalid')
    expect(seen.some(item => item.includes('/rest/api/user/current'))).toBe(false)
  })
})
