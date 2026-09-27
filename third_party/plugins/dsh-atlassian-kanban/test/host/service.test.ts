import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createServer, type Server } from 'node:http'
import { readFileSync } from 'node:fs'
import type { AddressInfo } from 'node:net'
import { Context } from '@deepseek-ai/cordis'
import type { AtlassianKanbanConfig } from '../../src/shared/config.ts'
import { AtlassianService } from '../../src/host/service.ts'

const jiraMediumSvg = readFileSync(new URL('./fixtures/jira-priority-medium.svg', import.meta.url), 'utf8')

describe('AtlassianService', () => {
  let server: Server
  let baseUrl: string
  let seen: { url?: string; authorization?: string } = {}
  let requestUrls: string[] = []
  let searchRequests = 0
  let releaseOldSearch: (() => void) | undefined
  let oldSearchRequested: Promise<void>
  let resolveOldSearchRequested: () => void
  let oldSearchResponse: Promise<void>

  beforeEach(async () => {
    seen = {}
    requestUrls = []
    searchRequests = 0
    releaseOldSearch = undefined
    oldSearchRequested = new Promise(resolve => { resolveOldSearchRequested = resolve })
    oldSearchResponse = new Promise(resolve => { releaseOldSearch = resolve })
    server = createServer(async (request, response) => {
      seen = { url: request.url, authorization: request.headers.authorization }
      requestUrls.push(request.url ?? '')
      if (request.url?.startsWith('/jira-prefix/images/issue.png')) {
        response.setHeader('content-type', 'image/png')
        response.end(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]))
        return
      }
      if (request.url?.startsWith('/jira-prefix/images/priority.svg')) {
        response.setHeader('content-type', 'image/svg+xml; charset=utf-8')
        response.end(jiraMediumSvg)
        return
      }
      if (request.url?.startsWith('/jira-prefix/images/priority-malicious.svg')) {
        response.setHeader('content-type', 'image/svg+xml')
        response.end('<svg xmlns="http://www.w3.org/2000/svg"><style>.st0{fill:url(https://evil.example/x);}</style><path class="st0" d="M0 0"/></svg>')
        return
      }
      if (request.url?.startsWith('/jira-prefix/images/priority-unlisted.svg')) {
        response.setHeader('content-type', 'image/svg+xml')
        response.end('<svg xmlns="http://www.w3.org/2000/svg"><style>.st0{fill:red;}</style><path class="st0" d="M0 0"/></svg>')
        return
      }
      if (request.url?.startsWith('/jira-prefix/rest/api/2/myself')) {
        if (request.headers.authorization === 'Bearer broken-secret') {
          response.statusCode = 403
          response.end(JSON.stringify({ errorMessages: ['Permission denied'] }))
          return
        }
        if (request.headers.authorization !== 'Bearer jira-secret' && request.headers.authorization !== 'Bearer draft-secret') {
          response.statusCode = 401
          response.end(JSON.stringify({ errorMessages: ['authentication required'] }))
          return
        }
        response.end(JSON.stringify({ displayName: 'Test User' }))
        return
      }
      response.setHeader('content-type', 'application/json')
      if (request.url?.startsWith('/jira-prefix/rest/api/2/search')) {
        searchRequests++
        const url = new URL(request.url, 'http://local')
        const jql = url.searchParams.get('jql')
        if (jql === 'old query') { resolveOldSearchRequested(); await oldSearchResponse }
        if (jql === 'bad query') { response.statusCode = 500; response.end(JSON.stringify({ errorMessages: ['bad query'] })); return }
        const summary = jql === 'old query' ? 'OLD RESULT' : jql === 'new query' ? 'NEW RESULT' : 'Example'
        response.end(JSON.stringify({ total: 5, issues: [
          { key: 'KAN-4', id: '4', fields: { summary, issuetype: { name: 'Task', iconUrl: '/images/issue.png' }, priority: { name: 'High', iconUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}/jira-prefix/images/priority.svg` }, status: { name: 'In Progress', statusCategory: { key: 'indeterminate' } } } },
          { key: 'KAN-5', id: '5', fields: { summary: 'External icon', issuetype: { name: 'Bug', iconUrl: 'https://untrusted.example/icon.png' }, priority: { name: 'Low', iconUrl: '/images/priority-malicious.svg' }, status: { name: 'Open', statusCategory: { name: 'To Do' } } } },
          { key: 'KAN-6', id: '6', fields: { summary: 'Unlisted CSS', issuetype: { name: 'Task' }, priority: { name: 'Custom', iconUrl: '/images/priority-unlisted.svg' }, status: { name: 'Open', statusCategory: { name: 'To Do' } } } },
        ] }))
      } else if (request.url?.includes('/rest/api/1.0/projects/ENG/repos/site/pull-requests')) {
        response.end(JSON.stringify({ values: [{ id: 3, title: 'Fix typo', state: 'OPEN', version: 0 }], nextPageStart: 12, isLastPage: false }))
      } else if (request.url?.includes('/rest/api/content/search')) {
        response.end(JSON.stringify({ results: [{ id: '9', title: 'Guide', type: 'page', status: 'current', space: { key: 'DOC' }, _links: { webui: '/confluence/display/DOC/Guide' } }], _links: { next: '/confluence/rest/api/content/search?cql=type%3Dpage&start=25&limit=25' } }))
      } else if (request.url?.includes('/rest/api/1.0/projects/ENG/repos/site')) {
        response.end(JSON.stringify({ name: 'site', project: { key: 'ENG' }, links: { clone: [{ name: 'http', href: 'https://bb.example/scm/ENG/site.git' }], self: [{ href: 'https://bb.example/projects/ENG/repos/site' }] } }))
      } else if (request.url?.includes('/rest/api/1.0/projects/ENG/repos/new-repo')) {
        response.end(JSON.stringify({ name: 'new-repo', project: { key: 'ENG' }, links: { clone: [{ name: 'http', href: 'https://bb.example/scm/ENG/new-repo.git' }] } }))
      } else if (request.url?.includes('/rest/api/1.0/projects/ENG/repos/private-error')) {
        response.statusCode = 404
        response.end(JSON.stringify({ message: 'upstream echoed bb-secret' }))
      } else response.end(JSON.stringify({ displayName: 'Test User' }))
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const { port } = server.address() as AddressInfo
    baseUrl = `http://127.0.0.1:${port}/jira-prefix`
  })
  afterEach(async () => { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())) })

  const config = (): AtlassianKanbanConfig => ({
    refreshMentions: true,
    jira: { baseUrl, bearerToken: 'jira-secret', jql: [{ id: 'mine', name: 'Mine', query: 'assignee = currentUser()' }] },
    bitbucket: { baseUrl, bearerToken: 'bb-secret', repositories: [{ id: 'site', projectKey: 'ENG', repositorySlug: 'site' }] },
    confluence: { baseUrl: `${baseUrl}/confluence`, bearerToken: 'conf-secret', cql: [{ id: 'docs', name: 'Docs', query: 'type = page' }] },
  })
  const service = () => new AtlassianService(new Context(), config)

  it('keeps the configured base path, uses bearer auth, and follows Jira offsets', async () => {
    const result = await service().query({ kind: 'jira-search', jqlId: 'mine', maxResults: 99 })
    expect(requestUrls[0]).toContain('/jira-prefix/rest/api/2/search?')
    expect(seen.authorization).toBe('Bearer jira-secret')
    expect(result.items[0]).toMatchObject({ key: 'KAN-4', title: 'Example', type: 'Task', priority: 'High' })
    expect(result.items[0]?.['statusCategory']).toBe('indeterminate')
    expect(result.items[0]?.['typeIcon']).toBe(`data:image/png;base64,${Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]).toString('base64')}`)
    expect(result.items[0]?.['priorityIcon']).toBe(`data:image/svg+xml;base64,${Buffer.from(jiraMediumSvg).toString('base64')}`)
    expect(requestUrls).toContain('/jira-prefix/images/issue.png')
    expect(requestUrls).toContain('/jira-prefix/images/priority.svg')
    expect(requestUrls.every(url => !url.includes('/jira-prefix/jira-prefix/'))).toBe(true)
    const iconRequestsBeforeToolSearch = requestUrls.filter(url => url.includes('/images/')).length
    expect(result.nextCursor).toBe('3')
    expect(result.items[1]).toMatchObject({ typeIcon: null, priorityIcon: null, statusCategory: 'To Do' })
    expect(requestUrls).toContain('/jira-prefix/images/priority-malicious.svg')
    expect(result.items[2]?.['priorityIcon']).toBeNull()
    expect(requestUrls).toContain('/jira-prefix/images/priority-unlisted.svg')
    expect(requestUrls.some(url => url.includes('untrusted.example'))).toBe(false)
    const modelResult = await service().searchJira('project = KAN')
    expect(modelResult.items[0]?.['typeIcon']).toBeUndefined()
    expect(modelResult.items[0]?.['priorityIcon']).toBeUndefined()
    expect(requestUrls.filter(url => url.includes('/images/'))).toHaveLength(iconRequestsBeforeToolSearch)
    expect(JSON.stringify(service().settings())).not.toContain('jira-secret')
  })

  it('tests unsaved connection credentials without saving and honors explicit token clearing', async () => {
    const api = service()
    expect(await api.testConnection('jira', { baseUrl, bearerToken: 'draft-secret' })).toMatchObject({ ok: true, displayName: 'Test User' })
    expect(seen.authorization).toBe('Bearer draft-secret')
    expect(await api.testConnection('jira', { baseUrl, bearerToken: '' })).toMatchObject({ ok: true })
    expect(seen.authorization).toBe('Bearer jira-secret')
    expect(await api.testConnection('jira', { baseUrl, clearToken: true })).toMatchObject({ ok: false })
    expect(String(seen.authorization ?? '')).not.toContain('jira-secret')
    expect(JSON.stringify(api.settings())).not.toContain('draft-secret')
    const denied = await api.testConnection('jira', { baseUrl, bearerToken: 'broken-secret' })
    expect(denied.message).toBe(`jira request to 127.0.0.1:${(server.address() as AddressInfo).port} failed: Permission denied`)
    expect(denied.message.match(/jira request to/g)).toHaveLength(1)
    expect(denied.message).not.toContain('broken-secret')
  })

  it('uses Bitbucket server continuation and returns server clone links', async () => {
    const api = service()
    const page = await api.query({ kind: 'bitbucket-pull-requests', repositoryId: 'site', state: 'open' })
    expect(page.nextCursor).toBe('12')
    expect(page.items[0]).toMatchObject({ id: 3, version: 0 })
    const repo = await api.query({ kind: 'bitbucket-repository', repositoryId: 'site' })
    expect(repo.items[0]?.['cloneUrl']).toBe('https://bb.example/scm/ENG/site.git')
  })

  it('validates an unconfigured Bitbucket repository by exact identity and redacts upstream token echoes', async () => {
    const api = service()
    const results = await api.validateRepositories([
      { projectKey: 'ENG', repositorySlug: 'new-repo' },
      { projectKey: 'ENG', repositorySlug: 'private-error' },
    ])
    expect(results[0]).toMatchObject({ projectKey: 'ENG', repositorySlug: 'new-repo', ok: true, cloneUrl: 'https://bb.example/scm/ENG/new-repo.git' })
    expect(results[1]).toMatchObject({ projectKey: 'ENG', repositorySlug: 'private-error', ok: false })
    expect(JSON.stringify(results)).not.toContain('bb-secret')
    expect(requestUrls).toHaveLength(2)
    expect(requestUrls.some(url => url.startsWith('/jira-prefix/rest/api/1.0/projects/ENG/repos/new-repo'))).toBe(true)
    expect(requestUrls.some(url => url.startsWith('/jira-prefix/rest/api/1.0/projects/ENG/repos/private-error'))).toBe(true)
    expect(seen.authorization).toBe('Bearer bb-secret')
  })

  it('uses the Confluence next link cursor and avoids duplicating its context prefix', async () => {
    const result = await service().query({ kind: 'confluence-search', cqlId: 'docs' })
    expect(result.nextCursor).toBe('25')
    expect(result.items[0]?.['url']).toContain('/jira-prefix/confluence/display/DOC/Guide')
  })

  it('rejects arbitrary or malformed pagination cursors before a request', async () => {
    await expect(service().query({ kind: 'jira-search', jqlId: 'mine', cursor: '0&maxResults=999' })).rejects.toThrow('Invalid pagination cursor')
    expect(seen.url).toBeUndefined()
  })

  it('shows a useful safe diagnostic when the Atlassian host is unavailable', async () => {
    baseUrl = 'http://127.0.0.1:1/jira-prefix'
    await expect(service().query({ kind: 'jira-search', jqlId: 'mine' })).rejects.toThrow(/jira request to 127\.0\.0\.1:1 failed:.*ECONNREFUSED/i)
  })

  it('uses only successful cached results for disabled mention refresh while board queries stay online', async () => {
    let current = config()
    const api = new AtlassianService(new Context(), () => current)
    const input = { kind: 'jira-search', jqlId: 'mine' } as const
    const live = await api.suggestions(input)
    expect(live.fromCache).toBe(false)
    expect(live.result?.items[0]?.['title']).toBe('Example')
    expect(JSON.stringify(live)).not.toContain('data:image')
    expect(requestUrls.some(url => url.includes('/images/'))).toBe(false)
    expect(searchRequests).toBe(1)

    current = { ...current, refreshMentions: false }
    const cached = await api.suggestions(input)
    expect(cached.fromCache).toBe(true)
    expect(cached.result?.items[0]?.['title']).toBe('Example')
    expect(JSON.stringify(cached)).not.toContain('data:image')
    expect(await api.suggestions({ ...input, cursor: '1' })).toEqual({ result: null, fromCache: false })
    expect(searchRequests).toBe(1)

    await api.query(input)
    expect(searchRequests).toBe(2)
    expect(requestUrls.some(url => url.includes('/images/'))).toBe(true)
    const postBoardCache = await api.suggestions(input)
    expect(postBoardCache.fromCache).toBe(true)
    expect(postBoardCache.result?.items[0]?.['title']).toBe('Example')
    const failed = new AtlassianService(new Context(), () => ({ ...current, jira: { ...current.jira, jql: [{ id: 'mine', name: 'Mine', query: 'bad query' }] } }))
    await expect(failed.query(input)).rejects.toThrow(/HTTP 500/)
    expect(await failed.suggestions(input)).toEqual({ result: null, fromCache: false })
  })

  it('does not let an old in-flight server reply overwrite a newer query cache after settings change', async () => {
    let current = { ...config(), jira: { ...config().jira, jql: [{ id: 'mine', name: 'Mine', query: 'old query' }] } }
    const api = new AtlassianService(new Context(), () => current)
    const query = { kind: 'jira-search', jqlId: 'mine' } as const
    const older = api.query(query)
    await oldSearchRequested
    current = { ...current, jira: { ...current.jira, jql: [{ id: 'mine', name: 'Mine', query: 'new query' }] } }
    const newer = await api.query(query)
    expect(newer.items[0]?.['title']).toBe('NEW RESULT')
    releaseOldSearch?.()
    await older
    current = { ...current, refreshMentions: false }
    const cached = await api.suggestions(query)
    expect(cached.fromCache).toBe(true)
    expect(cached.result?.items[0]?.['title']).toBe('NEW RESULT')
    expect(searchRequests).toBe(2)
  })

  it('does not forward configuration backend errors that may contain a saved token', async () => {
    const sentinel = 'settings-backend-token-sentinel'
    let dispose = () => {}
    const ctx = {
      settings: { mutate: async () => { throw new Error(`profile parser source contained ${sentinel}`) } },
      effect(callback: () => () => void) { dispose = callback() },
    } as unknown as Context
    const api = new AtlassianService(ctx, config)
    let failure: unknown
    try { await api.mutateSettings(0, [{ op: 'set', path: ['refreshMentions'], value: false }]) }
    catch (error) { failure = error }
    expect(failure).toBeInstanceOf(Error)
    expect((failure as Error).message).toBe('Could not save Atlassian settings.')
    expect(JSON.stringify(failure)).not.toContain(sentinel)
    dispose()
  })
})
