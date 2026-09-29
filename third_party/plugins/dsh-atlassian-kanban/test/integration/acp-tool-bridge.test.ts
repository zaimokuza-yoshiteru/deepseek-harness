import { afterEach, describe, expect, it, vi } from 'vitest'
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { AtlassianService } from '../../src/host/service.ts'
import { registerTools } from '../../src/host/tools.ts'
import { bootProfile, run } from '../helpers/profile.ts'
import type { AtlassianSettingsView } from '../../src/shared/config.ts'
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
    closers.push(() => ctx.fiber.dispose())
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
    const lease = await createTeamBridge(
      bridgeContext, agent.id, { mcpCapabilities: { http: true } }, undefined, undefined, undefined,
      ctx.tools.schemas(agent),
    )
    if (lease === undefined) throw new Error('The adapter did not create an MCP bridge')
    closers.push(() => lease.close())
    const server = lease.servers[0]
    if (server === undefined || !('url' in server)) throw new Error('Expected adapter HTTP MCP transport')

    const client = new Client({ name: 'atlassian-kanban-integration', version: '1.0.0' })
    await client.connect(new StreamableHTTPClientTransport(new URL(server.url)) as Parameters<Client['connect']>[0])
    closers.push(() => client.close())
    const discovered = await client.listTools()
    const kanbanTools = discovered.tools.filter(tool => tool.name.startsWith('kanban_'))
    expect(kanbanTools).toHaveLength(69)
    expect(new Set(kanbanTools.map(tool => tool.name)).size).toBe(69)
    expect(discovered.tools.some(tool => /^(atlassian|jira|bitbucket|confluence)_/.test(tool.name))).toBe(false)
    const configurationTools = [
      'kanban_get_settings', 'kanban_update_connections', 'kanban_set_preferences',
      'kanban_upsert_queries', 'kanban_delete_queries', 'kanban_upsert_repositories',
      'kanban_delete_repositories', 'kanban_validate_repositories',
    ]
    for (const name of configurationTools) expect(discovered.tools.some(tool => tool.name === name), `MCP tools/list contains ${name}`).toBe(true)
    const jiraSearch = discovered.tools.find(tool => tool.name === 'kanban_jira_search_issues')
    expect(jiraSearch).toBeDefined()
    expect(jiraSearch?.inputSchema).toMatchObject({ type: 'object', properties: { jqlId: { type: 'string' } } })

    lease.beginPrompt(new AbortController().signal)
    const settingsResult = await client.callTool({ name: 'kanban_get_settings', arguments: {} })
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

    const result = await client.callTool({ name: 'kanban_jira_search_issues', arguments: { jqlId: 'assigned' } })
    expect(result.isError).not.toBe(true)
    expect(result.content).toEqual([expect.objectContaining({ type: 'text', text: expect.stringContaining('KAN-44') })])
    expect(result.content).toEqual([expect.objectContaining({ type: 'text', text: expect.stringContaining('Bridge integration issue') })])
    expect(seen.path).toContain('/jira/rest/api/2/search?')
    expect(seen.path).toContain('jql=assignee+%3D+currentUser%28%29')
    expect(seen.authorization).toBe('Bearer integration-secret')
    expect(JSON.stringify(discovered.tools)).not.toContain('integration-secret')

    const toolError = async (issueKey: string) => {
      const failed = await client.callTool({ name: 'kanban_jira_get_issue', arguments: { issueKey } })
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


describe('board configuration workflow over ACP', () => {
  it('keeps searches temporary, persists and reads back queries, and returns save failures as errors', async () => {
    const fixture = await bootProfile()
    const { ctx } = fixture
    const remoteQueries: string[] = []
    const mockAtlassian = createServer((request, response) => {
      const url = new URL(request.url ?? '/', 'http://local')
      remoteQueries.push(url.searchParams.get('cql') ?? url.searchParams.get('jql') ?? '')
      response.setHeader('content-type', 'application/json')
      response.end(JSON.stringify({ results: [], issues: [], total: 0, size: 0 }))
    })
    await new Promise<void>((resolve, reject) => {
      mockAtlassian.once('error', reject)
      mockAtlassian.listen(0, '127.0.0.1', () => { mockAtlassian.off('error', reject); resolve() })
    })
    closers.push(() => new Promise<void>((resolve, reject) => mockAtlassian.close(error => error ? reject(error) : resolve())))
    const address = mockAtlassian.address()
    if (!address || typeof address === 'string') throw new Error('Missing mock server address')
    const initial = await run(ctx, 'kanban_get_settings', {}) as AtlassianSettingsView
    await run(ctx, 'kanban_update_connections', { expectedRevision: initial.revision,
      jira: { baseUrl: `http://127.0.0.1:${address.port}/jira` },
      confluence: { baseUrl: `http://127.0.0.1:${address.port}/wiki`, bearerToken: 'confluence-private-token' },
    })
    const agent = { id: 'configuration-session', inbox: { nextStep: [] }, steer() {} }
    const bridgeContext = {
      get(name: string) { return name === 'agents' ? { get: (id: string) => id === agent.id ? agent : undefined } : ctx.get(name, false) },
      on(name: string, listener: (...args: any[]) => void) { return ctx.on(name, listener) },
    } as unknown as CordisContext
    let policy: 'auto' | 'ask' = 'ask'
    const lease = await createTeamBridge(
      bridgeContext, agent.id, { mcpCapabilities: { http: true } }, undefined, async () => policy, undefined,
      ctx.tools.schemas(agent),
    )
    if (!lease) throw new Error('Missing MCP bridge')
    closers.push(() => lease.close())
    const server = lease.servers[0]
    if (!server || !('url' in server)) throw new Error('Expected HTTP transport')
    const client = new Client({ name: 'kanban-configuration-test', version: '1.0.0' })
    await client.connect(new StreamableHTTPClientTransport(new URL(server.url)) as Parameters<Client['connect']>[0])
    closers.push(() => client.close())
    lease.beginPrompt(new AbortController().signal)
    const permission = {
      sessionId: agent.id,
      toolCall: { toolCallId: 'save-query', name: `mcp__${server.name}__kanban_upsert_queries` },
      options: [{ optionId: 'once', kind: 'allow_once' as const, name: 'Allow once' }],
    }
    expect(await lease.inspectPermission!(permission)).toMatchObject({ reason: 'approval-required', toolName: 'kanban_upsert_queries' })
    policy = 'auto'
    expect(await lease.inspectPermission!(permission)).toMatchObject({ reason: 'auto-approved', toolName: 'kanban_upsert_queries' })
    const listed = (await client.listTools()).tools
    const upsert = listed.find(tool => tool.name === 'kanban_upsert_queries')!
    expect(upsert.description).toContain('DSH Atlassian Kanban')
    expect(upsert.description).toContain('kanban_get_settings again')
    expect(upsert.inputSchema).toMatchObject({ required: expect.arrayContaining(['expectedRevision', 'product', 'queries']), properties: {
      product: { enum: ['jira', 'confluence'] }, queries: { items: { properties: { id: { description: expect.stringContaining('editing or renaming') } } } },
    } })
    for (const name of ['kanban_confluence_search', 'kanban_jira_search_issues']) {
      expect(listed.find(tool => tool.name === name)?.description).toContain('never saves board configuration')
    }
    const call = async (name: string, args: Record<string, unknown> = {}) => {
      const result = await client.callTool({ name, arguments: args })
      const text = result.content.filter(item => item.type === 'text').map(item => item.text).join('\n')
      expect(text).not.toContain('private-token')
      return { result, text }
    }
    const read = async (): Promise<AtlassianSettingsView> => {
      const { result, text } = await call('kanban_get_settings')
      expect(result.isError).not.toBe(true)
      return JSON.parse(text)
    }
    const before = await read()
    const rawBefore = ctx.settings.describe().find(row => row.ns === 'dsh-atlassian-kanban')!.value as AtlassianKanbanConfig
    const patchBefore = await readFile(fixture.profile.patchPath, 'utf8')
    for (const [name, args] of [
      ['kanban_confluence_search', { cql: 'space = TEMP' }],
      ['kanban_jira_search_issues', { jql: 'project = TEMP' }],
    ] as const) expect((await call(name, args)).result.isError).not.toBe(true)
    expect(await read()).toEqual(before)
    expect(await readFile(fixture.profile.patchPath, 'utf8')).toBe(patchBefore)
    expect(remoteQueries).toEqual(['space = TEMP', 'project = TEMP'])

    const queries = [{ name: 'Team pages', query: 'space = TEAM AND type = page' }]
    expect((await call('kanban_upsert_queries', { expectedRevision: before.revision, product: 'confluence', queries })).result.isError).not.toBe(true)
    const saved = await read()
    const target = saved.confluence.cql.find(row => row.name === 'Team pages')!
    expect(target).toEqual({ id: expect.any(String), ...queries[0] })
    expect(saved.jira).toEqual(before.jira)
    expect(saved.bitbucket).toEqual(before.bitbucket)
    expect(remoteQueries).toHaveLength(2) // Configuration saving made no remote request.
    const patchSaved = await readFile(fixture.profile.patchPath, 'utf8')
    expect((await call('kanban_confluence_search', { cqlId: target.id })).result.isError).not.toBe(true)
    expect(remoteQueries.at(-1)).toBe(target.query)
    expect(await read()).toEqual(saved)
    const stale = await call('kanban_upsert_queries', { expectedRevision: before.revision, product: 'confluence', queries: [{ ...target, query: 'space = STALE' }] })
    expect(stale.result.isError).toBe(true)
    expect(stale.text).toContain('Configuration revision conflict')
    expect(await read()).toEqual(saved)
    const failedSave = vi.spyOn(ctx.settings, 'mutate').mockRejectedValueOnce(new Error('backend failure: private-token'))
    try {
      const failed = await call('kanban_upsert_queries', { expectedRevision: saved.revision, product: 'confluence', queries: [{ ...target, query: 'space = FAILED' }] })
      expect(failed.result.isError).toBe(true)
      expect(failed.text).toContain('Could not save Atlassian settings.')
      expect(await read()).toEqual(saved)
      expect(await readFile(fixture.profile.patchPath, 'utf8')).toBe(patchSaved)
    } finally { failedSave.mockRestore() }
    const fresh = await read()
    expect((await call('kanban_upsert_queries', { expectedRevision: fresh.revision, product: 'confluence', queries: [{ name: 'More pages', query: 'space = MORE' }] })).result.isError).not.toBe(true)
    const confirmed = await read()
    expect(confirmed.confluence.cql).toEqual([target, expect.objectContaining({ name: 'More pages', query: 'space = MORE' })])
    expect(ctx.settings.describe().find(row => row.ns === 'dsh-atlassian-kanban')!.value).toEqual({ ...rawBefore, confluence: { ...rawBefore.confluence, cql: confirmed.confluence.cql } })
  })
})
