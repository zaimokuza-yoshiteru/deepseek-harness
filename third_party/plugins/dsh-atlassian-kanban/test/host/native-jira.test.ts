import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { type ToolRunContext } from '@deepseek-ai/dsh-tools'
import type { AtlassianKanbanConfig } from '../../src/shared/config.ts'
import { AtlassianService } from '../../src/host/service.ts'
import { jiraCustomFieldOptionsPath, jiraGetCloneStatus, jiraNativeClone, registerTools } from '../../src/host/tools.ts'

describe('Jira native clone and metadata contracts', () => {
  let server: Server
  let baseUrl: string
  let postCount: number
  let submitted = new URLSearchParams()
  let postMode: 'success' | 'pending' | 'cross-origin'
  let requests: string[]
  let deletedIssues: string[]

  beforeEach(async () => {
    postCount = 0
    submitted = new URLSearchParams()
    postMode = 'success'
    requests = []
    deletedIssues = []
    server = createServer((request, response) => {
      requests.push(request.url ?? '')
      const chunks: Buffer[] = []
      request.on('data', chunk => chunks.push(Buffer.from(chunk)))
      request.on('end', () => {
        if (request.method === 'DELETE' && request.url?.startsWith('/jira/rest/api/2/issue/APP-1')) {
          deletedIssues.push(request.url)
          response.statusCode = 204
          response.end()
        } else if (request.url?.startsWith('/jira/rest/api/2/issue/APP-1')) {
          response.setHeader('content-type', 'application/json')
          response.end(JSON.stringify({ id: '101', key: 'APP-1', fields: { summary: 'Source' } }))
        } else if (request.url?.startsWith('/jira/secure/CloneIssueDetails!default.jspa')) {
          response.setHeader('content-type', 'text/html')
          response.end(`<form><input name="summary" value="CLONE - It's &quot;fine&quot;"><input type="checkbox" name="cloneAttachments" value="true" checked><input type="checkbox" name="cloneLinks" value="true"></form>`)
        } else if (request.url === '/jira/secure/CloneIssueDetails.jspa') {
          postCount += 1
          submitted = new URLSearchParams(Buffer.concat(chunks).toString())
          const location = postMode === 'success'
            ? '/jira/browse/APP-2'
            : postMode === 'pending'
              ? '/jira/secure/CloneIssueProgress.jspa?taskId=clone-7'
              : 'https://attacker.invalid/browse/APP-2'
          response.writeHead(302, { location })
          response.end()
        } else if (request.url?.startsWith('/jira/secure/CloneIssueProgress.jspa')) {
          response.setHeader('content-type', 'text/html')
          response.end('<html><body>Clone still running; source <a href="/jira/browse/APP-1">APP-1</a></body></html>')
        } else if (request.url?.startsWith('/jira/rest/api/2/issue/createmeta/')) {
          response.setHeader('content-type', 'application/json')
          response.end(JSON.stringify({ values: [{ id: '10002' }] }))
        } else if (request.url?.startsWith('/jira/rest/api/2/customFields/10110/options')) {
          response.setHeader('content-type', 'application/json')
          response.end(JSON.stringify({ options: [], total: 0 }))
        } else if (request.url?.startsWith('/jira/rest/api/2/issue/APP-1/transitions')) {
          response.setHeader('content-type', 'application/json')
          response.end(JSON.stringify({ transitions: [{ id: '31', fields: { resolution: { required: true, allowedValues: [] } } }] }))
        } else if (request.url?.startsWith('/jira/rest/api/2/field')) {
          response.setHeader('content-type', 'application/json')
          response.end(JSON.stringify([{ id: 'customfield_10110', name: 'Release Train' }]))
        } else {
          response.statusCode = 404
          response.end('not found')
        }
      })
    })
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', () => { server.off('error', reject); resolve() })
    })
    const { port } = server.address() as AddressInfo
    baseUrl = `http://127.0.0.1:${port}/jira`
  })

  afterEach(async () => { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())) })

  const service = () => new AtlassianService(new Context(), () => ({
    refreshMentions: true,
    jira: { baseUrl, bearerToken: 'clone-test-token', jql: [] },
    bitbucket: { baseUrl: '', bearerToken: '', repositories: [] },
    confluence: { baseUrl: '', bearerToken: '', cql: [] },
  } satisfies AtlassianKanbanConfig))

  it('submits Jira’s native form once and confirms only a same-origin browse redirect', async () => {
    const summary = `Clone's "quoted" title & more`
    const result = await jiraNativeClone(service(), 'APP-1', { summary, cloneAttachments: false, cloneLinks: true }, new AbortController().signal)
    expect(result).toMatchObject({ sourceIssueKey: 'APP-1', issueKey: 'APP-2', pending: false, usedNativeAction: 'CloneIssueDetails.jspa (Jira Data Center 11.3.5)' })
    expect(submitted.get('summary')).toBe(summary)
    expect(submitted.get('id')).toBe('101')
    expect(submitted.get('Create')).toBe('Create')
    expect(submitted.has('cloneAttachments')).toBe(false)
    expect(submitted.get('cloneLinks')).toBe('true')
    expect(postCount).toBe(1)
  })

  it('returns a safe progress task for Jira’s native asynchronous redirect without repeating POST', async () => {
    postMode = 'pending'
    const result = await jiraNativeClone(service(), 'APP-1', {}, new AbortController().signal)
    expect(result).toMatchObject({ pending: true, taskId: 'clone-7', progressAction: 'CloneIssueProgress.jspa' })
    expect(postCount).toBe(1)
  })

  it('rejects cross-origin clone redirects and never retries the POST', async () => {
    postMode = 'cross-origin'
    await expect(jiraNativeClone(service(), 'APP-1', {}, new AbortController().signal)).rejects.toThrow('unconfirmed')
    expect(postCount).toBe(1)
  })

  it('keeps a 200 progress page pending even if it links to the source issue', async () => {
    const result = await jiraGetCloneStatus(service(), 'clone-7', 'CloneIssueProgress.jspa', new AbortController().signal)
    expect(result).toMatchObject({ taskId: 'clone-7', pending: true })
    expect(result).not.toHaveProperty('issueKey')
    expect(postCount).toBe(0)
  })

  it('uses Jira’s numeric-only custom field options path', () => {
    expect(jiraCustomFieldOptionsPath('customfield_10110')).toBe('/rest/api/2/customFields/10110/options')
    expect(jiraCustomFieldOptionsPath('10110')).toBe('/rest/api/2/customFields/10110/options')
    expect(() => jiraCustomFieldOptionsPath('bad-id')).toThrow('fieldId')
  })

  it('keeps deleteSubtasks opt-in and metadata reads on their exact Jira routes', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt, {})
    await ctx.plugin(ToolRuntime)
    const dispose = registerTools(ctx, service())
    try {
      const signal = new AbortController().signal
      const run = (name: string, args: Record<string, unknown>) => {
        const tool = ctx.tools.get(name)
        if (!tool) throw new Error(`Missing registered tool: ${name}`)
        return tool.execute(args, { name, callId: `test-${name}`, rootCallId: `test-${name}`, signal, deferContext() {}, concludeTurn() {} } as ToolRunContext)
      }
      await run('kanban_jira_get_create_metadata', { projectKey: 'APP', issueTypeId: '10002' })
      await run('kanban_jira_list_custom_field_options', { fieldId: 'customfield_10110', projectId: '10100', issueTypeId: '10002', page: 1, maxResults: 10 })
      await run('kanban_jira_list_transitions', { issueKey: 'APP-1' })
      await run('kanban_jira_delete_issue', { issueKey: 'APP-1' })
      await run('kanban_jira_delete_issue', { issueKey: 'APP-1', deleteSubtasks: true })
      expect(deletedIssues).toEqual([
        '/jira/rest/api/2/issue/APP-1',
        '/jira/rest/api/2/issue/APP-1?deleteSubtasks=true',
      ])
      expect(requests.some(url => url.startsWith('/jira/rest/api/2/issue/createmeta/APP/issuetypes/10002?'))).toBe(true)
      expect(requests.some(url => url.startsWith('/jira/rest/api/2/customFields/10110/options?') && url.includes('projectIds=10100') && url.includes('issueTypeIds=10002'))).toBe(true)
      expect(requests.some(url => url.includes('/jira/rest/api/2/issue/APP-1/transitions?expand=transitions.fields'))).toBe(true)
    } finally { for (const disposeTool of dispose.reverse()) disposeTool() }
  })
})
