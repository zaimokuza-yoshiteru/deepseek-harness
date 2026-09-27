import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { type ToolRunContext } from '@deepseek-ai/dsh-tools'
import type { AtlassianKanbanConfig } from '../../src/shared/config.ts'
import { AtlassianService } from '../../src/host/service.ts'
import { registerTools } from '../../src/host/tools.ts'

describe('Confluence child parent validation', () => {
  let server: Server
  let baseUrl: string
  let writes: string[]
  let commentRequests: string[]
  let dispose: (() => void)[]
  let ctx: Context

  beforeEach(async () => {
    writes = []
    commentRequests = []
    server = createServer((request, response) => {
      if (request.method === 'GET' && request.url?.startsWith('/rest/api/content/42/child/comment')) {
        commentRequests.push(request.url)
        const start = new URL(request.url, 'http://local').searchParams.get('start')
        response.setHeader('content-type', 'application/json')
        response.end(JSON.stringify(start === '0'
          ? { results: [{ id: 'root-comment' }], _links: { next: '/rest/api/content/42/child/comment?start=1&limit=1' } }
          : { results: [{ id: 'reply-comment', parentId: 'root-comment' }], _links: {} }))
        return
      }
      if (request.method === 'GET' && request.url?.startsWith('/rest/api/content/child')) {
        response.setHeader('content-type', 'application/json')
        response.end(JSON.stringify({ id: 'child', type: 'page', ancestors: [{ id: 'grandparent' }, { id: 'parent' }] }))
        return
      }
      writes.push(`${request.method} ${request.url}`)
      response.setHeader('content-type', 'application/json')
      if (request.method === 'DELETE') { response.statusCode = 204; response.end(); return }
      response.end(JSON.stringify({ id: 'child', type: 'page', title: 'Updated' }))
    })
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', () => { server.off('error', reject); resolve() })
    })
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
    ctx = new Context()
    await ctx.plugin(SystemPrompt, {})
    await ctx.plugin(ToolRuntime)
    const config: AtlassianKanbanConfig = {
      refreshMentions: true,
      jira: { baseUrl: '', bearerToken: '', jql: [] },
      bitbucket: { baseUrl: '', bearerToken: '', repositories: [] },
      confluence: { baseUrl, bearerToken: 'test-token', cql: [] },
    }
    dispose = registerTools(ctx, new AtlassianService(ctx, () => config))
  })

  afterEach(async () => {
    for (const remove of dispose.reverse()) remove()
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  })

  const run = (name: string, args: Record<string, unknown>) => {
    const tool = ctx.tools.get(name)
    if (!tool) throw new Error(`Missing tool ${name}`)
    return tool.execute(args, { name, callId: 'child-test', rootCallId: 'child-test', signal: new AbortController().signal, deferContext() {}, concludeTurn() {} } as ToolRunContext)
  }

  it('rejects a grandparent for update and delete before any PUT or DELETE', async () => {
    const update = { parentId: 'grandparent', childId: 'child', spaceKey: 'DOC', title: 'Updated', body: '<p>Updated</p>', version: 1 }
    await expect(run('confluence_update_child', update)).rejects.toThrow('does not belong to the supplied parent')
    await expect(run('confluence_delete_child', { parentId: 'grandparent', childId: 'child' })).rejects.toThrow('does not belong to the supplied parent')
    expect(writes).toEqual([])
  })

  it('accepts the direct parent for update and delete', async () => {
    const update = { parentId: 'parent', childId: 'child', spaceKey: 'DOC', title: 'Updated', body: '<p>Updated</p>', version: 1 }
    await run('confluence_update_child', update)
    await run('confluence_delete_child', { parentId: 'parent', childId: 'child' })
    expect(writes.map(item => item.split(' ')[0])).toEqual(['PUT', 'DELETE'])
  })

  it('requests all comment depths and follows the server cursor across root comments and replies', async () => {
    const first = await run('confluence_list_comments', { pageId: '42', start: 0, limit: 1 }) as Record<string, any>
    expect(first.results).toEqual([{ id: 'root-comment' }])
    expect(first.complete).toBe(false)
    expect(first.nextStart).toBe(1)
    const second = await run('confluence_list_comments', { pageId: '42', start: first.nextStart, limit: 1 }) as Record<string, any>
    expect(second.results).toEqual([{ id: 'reply-comment', parentId: 'root-comment' }])
    expect(second.complete).toBe(true)
    expect(commentRequests).toHaveLength(2)
    expect(commentRequests.every(url => new URL(url, 'http://local').searchParams.get('depth') === 'all')).toBe(true)
  })
})
