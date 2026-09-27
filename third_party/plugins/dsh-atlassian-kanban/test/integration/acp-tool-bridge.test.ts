import { afterEach, describe, expect, it } from 'vitest'
import { createServer, type Server } from 'node:http'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { AtlassianService } from '../../src/host/service.ts'
import { registerTools } from '../../src/host/tools.ts'
import type { AtlassianKanbanConfig } from '../../src/shared/config.ts'
import { createTeamBridge } from '../../../dsh-acp-adapter/src/host/teams/bridge.ts'
import type { Context as CordisContext } from '@deepseek-ai/cordis'

const closers: Array<() => Promise<unknown>> = []
afterEach(async () => { await Promise.allSettled(closers.splice(0).reverse().map(close => close())) })

describe('Atlassian tools over the native ACP MCP bridge', () => {
  it('lists and calls the real plugin tool through the DSH registry and adapter bridge', async () => {
    let seen: { path?: string; authorization?: string } = {}
    const mockAtlassian = createServer((request, response) => {
      seen = { path: request.url, authorization: request.headers.authorization }
      response.setHeader('content-type', 'application/json')
      const pathname = new URL(request.url ?? '/', 'http://local').pathname
      if (pathname.endsWith('/issue/KAN-401')) {
        response.statusCode = 401
        response.end(JSON.stringify({ errorMessages: ['Credential integration-secret is not authorized'] }))
        return
      }
      if (pathname.endsWith('/issue/KAN-400')) {
        response.statusCode = 400
        response.end(JSON.stringify({ errors: { summary: 'Required field', customfield_12345: 'Invalid option; integration-secret must not appear' } }))
        return
      }
      response.end(JSON.stringify({ total: 1, issues: [{
        key: 'KAN-44', id: '44', fields: { summary: 'Bridge integration issue', issuetype: { name: 'Bug' }, priority: { name: 'High' } },
      }] }))
    })
    await new Promise<void>((resolve, reject) => {
      mockAtlassian.once('error', reject)
      mockAtlassian.listen(0, '127.0.0.1', () => { mockAtlassian.off('error', reject); resolve() })
    })
    closers.push(() => new Promise<void>((resolve, reject) => mockAtlassian.close(error => error ? reject(error) : resolve())))
    const address = mockAtlassian.address()
    if (address === null || typeof address === 'string') throw new Error('Mock Atlassian server did not bind')

    const ctx = new Context()
    await ctx.plugin(SystemPrompt, {})
    await ctx.plugin(ToolRuntime)
    const config: AtlassianKanbanConfig = {
      refreshMentions: true,
      jira: { baseUrl: `http://127.0.0.1:${address.port}/jira`, bearerToken: 'integration-secret', jql: [{ id: 'assigned', name: 'Assigned to me', query: 'assignee = currentUser()' }] },
      bitbucket: { baseUrl: '', bearerToken: '', repositories: [] },
      confluence: { baseUrl: '', bearerToken: '', cql: [] },
    }
    const service = new AtlassianService(ctx as unknown as CordisContext, () => config)
    const disposeTools = registerTools(ctx as unknown as CordisContext, service)
    closers.push(async () => { for (const dispose of disposeTools.reverse()) dispose() })

    const agent = { id: 'integration-session', inbox: { nextStep: [] }, steer() {} }
    const services: Record<string, unknown> = {
      tools: ctx.get('tools'),
      agents: { get: (id: string) => id === agent.id ? agent : undefined },
    }
    // Keep the adapter bridge implementation intact while supplying only the
    // live-session lookup absent from this focused tools-registry fixture.
    const bridgeContext = {
      get(name: string) { return services[name] ?? ctx.get(name, false) },
      on(name: string, listener: (...args: any[]) => void) { return ctx.on(name, listener) },
    } as unknown as CordisContext
    const lease = await createTeamBridge(bridgeContext, agent.id, { mcpCapabilities: { http: true } })
    if (lease === undefined) throw new Error('The adapter did not create an MCP bridge')
    closers.push(() => lease.close())
    const server = lease.servers[0]
    if (server === undefined || !('url' in server)) throw new Error('Expected adapter HTTP MCP transport')

    const client = new Client({ name: 'atlassian-kanban-integration', version: '1.0.0' })
    await client.connect(new StreamableHTTPClientTransport(new URL(server.url)) as Parameters<Client['connect']>[0])
    closers.push(() => client.close())
    const discovered = await client.listTools()
    const configurationTools = [
      'atlassian_get_settings', 'atlassian_update_connections', 'atlassian_set_preferences',
      'atlassian_upsert_queries', 'atlassian_delete_queries', 'atlassian_upsert_repositories',
      'atlassian_delete_repositories', 'atlassian_validate_repositories',
    ]
    for (const name of configurationTools) expect(discovered.tools.some(tool => tool.name === name), `MCP tools/list contains ${name}`).toBe(true)
    const jiraSearch = discovered.tools.find(tool => tool.name === 'jira_search_issues')
    expect(jiraSearch).toBeDefined()
    expect(jiraSearch?.inputSchema).toMatchObject({ type: 'object', properties: { jqlId: { type: 'string' } } })

    lease.beginPrompt(new AbortController().signal)
    const settingsResult = await client.callTool({ name: 'atlassian_get_settings', arguments: {} })
    expect(settingsResult.isError).not.toBe(true)
    const settingsText = settingsResult.content.filter(item => item.type === 'text').map(item => item.text).join('\n')
    const settings = JSON.parse(settingsText)
    expect(settings).toMatchObject({
      revision: 0,
      refreshMentions: true,
      jira: { baseUrl: config.jira.baseUrl, hasToken: true, jql: config.jira.jql },
      bitbucket: { baseUrl: '', hasToken: false, repositories: [] },
      confluence: { baseUrl: '', hasToken: false, cql: [] },
    })
    expect(JSON.stringify(settings)).not.toContain('integration-secret')
    expect(settings.jira).not.toHaveProperty('bearerToken')

    const result = await client.callTool({ name: 'jira_search_issues', arguments: { jqlId: 'assigned' } })
    expect(result.isError).not.toBe(true)
    expect(result.content).toEqual([expect.objectContaining({ type: 'text', text: expect.stringContaining('KAN-44') })])
    expect(result.content).toEqual([expect.objectContaining({ type: 'text', text: expect.stringContaining('Bridge integration issue') })])
    expect(seen.path).toContain('/jira/rest/api/2/search?')
    expect(seen.path).toContain('jql=assignee+%3D+currentUser%28%29')
    expect(seen.authorization).toBe('Bearer integration-secret')
    expect(JSON.stringify(discovered.tools)).not.toContain('integration-secret')

    const toolError = async (issueKey: string) => {
      const failed = await client.callTool({ name: 'jira_get_issue', arguments: { issueKey } })
      expect(failed.isError).toBe(true)
      const errorText = failed.content.filter(item => item.type === 'text').map(item => item.text).join('\n')
      expect(errorText.length).toBeLessThan(2_000)
      expect(errorText).not.toContain('integration-secret')
      expect(errorText).toMatch(/^Error: \{/)
      return JSON.parse(errorText.slice('Error: '.length)) as Record<string, unknown>
    }
    expect(await toolError('KAN-401')).toMatchObject({ code: 'ATLASSIAN_HTTP_401', httpStatus: 401, retryable: false })
    const invalid = await toolError('KAN-400')
    expect(invalid).toMatchObject({ code: 'ATLASSIAN_HTTP_400', httpStatus: 400, retryable: false })
    expect(JSON.stringify(invalid)).toContain('customfield_12345')
    expect(JSON.stringify(invalid)).toContain('summary')
    expect(typeof invalid.nextAction).toBe('string')
  })
})
