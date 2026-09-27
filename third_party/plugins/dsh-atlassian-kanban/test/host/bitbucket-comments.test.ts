import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { type ToolRunContext } from '@deepseek-ai/dsh-tools'
import type { AtlassianKanbanConfig } from '../../src/shared/config.ts'
import { AtlassianService } from '../../src/host/service.ts'
import { registerTools } from '../../src/host/tools.ts'

describe('Bitbucket pull request comment listing', () => {
  let server: Server
  let baseUrl: string
  let requestUrls: string[]

  beforeEach(async () => {
    requestUrls = []
    server = createServer((request, response) => {
      requestUrls.push(request.url ?? '')
      response.setHeader('content-type', 'application/json')
      if (request.url?.startsWith('/prefix/rest/api/1.0/projects/ENG/repos/site/pull-requests/7/activities?')) {
        response.end(JSON.stringify({
          values: [
            { id: 100, action: 'COMMENTED', createdDate: 100, comment: { id: 21, text: 'top level', comments: [{ id: 22, text: 'reply', parent: { id: 21 } }] } },
            { id: 101, action: 'UPDATED', createdDate: 110, comment: { id: 21, text: 'stale duplicate' } },
            { id: 102, action: 'DELETED', createdDate: 120, comment: { id: 23, text: 'deleted' } },
            { id: 103, action: 'REVIEW_COMMENTED', createdDate: 130, comment: { id: 24, text: 'inline activity' } },
          ],
          size: 4,
          start: 25,
          limit: 4,
          isLastPage: false,
          nextPageStart: 29,
        }))
      } else if (request.url === '/prefix/rest/api/1.0/projects/ENG/repos/site/pull-requests/7/comments/31') {
        response.end(JSON.stringify({ id: 31, text: 'inline', version: 4 }))
      } else if (request.url?.startsWith('/prefix/rest/api/1.0/projects/ENG/repos/site/pull-requests/7/comments?')) {
        response.end(JSON.stringify({ values: [{ id: 31, text: 'inline' }], isLastPage: true, nextPageStart: null }))
      } else {
        response.statusCode = 404
        response.end(JSON.stringify({ errors: [{ message: 'not found' }] }))
      }
    })
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', () => { server.off('error', reject); resolve() })
    })
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/prefix`
  })

  afterEach(async () => { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())) })

  const service = () => new AtlassianService(new Context(), () => ({
    refreshMentions: true,
    jira: { baseUrl: '', bearerToken: '', jql: [] },
    bitbucket: { baseUrl, bearerToken: 'test-token', repositories: [{ id: 'site', projectKey: 'ENG', repositorySlug: 'site' }] },
    confluence: { baseUrl: '', bearerToken: '', cql: [] },
  } satisfies AtlassianKanbanConfig))

  async function run(args: Record<string, unknown>, toolName = 'bitbucket_list_pull_request_comments') {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt, {})
    await ctx.plugin(ToolRuntime)
    const disposers = registerTools(ctx, service())
    try {
      const tool = ctx.tools.get(toolName)
      if (!tool) throw new Error('Comment listing tool was not registered')
      return await tool.execute({ projectKey: 'ENG', repositorySlug: 'site', pullRequestId: 7, ...args }, {
        name: tool.name, callId: 'test', rootCallId: 'test', signal: new AbortController().signal,
        deferContext() {}, concludeTurn() {},
      } as ToolRunContext)
    } finally { for (const dispose of disposers.reverse()) dispose() }
  }

  it('uses paginated activities for general discussion and excludes update/delete duplicates while retaining replies and cursor', async () => {
    const result = await run({ cursor: '25', limit: 4 }) as Record<string, any>
    expect(requestUrls[0]).toContain('/prefix/rest/api/1.0/projects/ENG/repos/site/pull-requests/7/activities?start=25&limit=4')
    expect(result.isLastPage).toBe(false)
    expect(result.nextPageStart).toBe(29)
    expect(result.values).toHaveLength(2)
    expect(result.values[0].comment.comments[0]).toMatchObject({ id: 22, parent: { id: 21 } })
    expect(result.values.map((row: any) => row.comment.id)).toEqual([21, 24])
  })

  it('uses the required path query for inline comments and preserves Bitbucket pagination', async () => {
    const result = await run({ path: 'src/a file.ts', cursor: '10', limit: 8 }) as Record<string, any>
    const url = new URL(requestUrls[0], baseUrl)
    expect(url.pathname).toBe('/prefix/rest/api/1.0/projects/ENG/repos/site/pull-requests/7/comments')
    expect(url.searchParams.get('path')).toBe('src/a file.ts')
    expect(url.searchParams.get('start')).toBe('10')
    expect(url.searchParams.get('limit')).toBe('8')
    expect(result).toMatchObject({ values: [{ id: 31, text: 'inline' }], isLastPage: true, nextPageStart: null })
  })

  it('reads a comment by id to retrieve its current version before mutation', async () => {
    const result = await run({ commentId: 31 }, 'bitbucket_get_pull_request_comment')
    expect(requestUrls[0]).toBe('/prefix/rest/api/1.0/projects/ENG/repos/site/pull-requests/7/comments/31')
    expect(result).toMatchObject({ id: 31, version: 4 })
  })
})
