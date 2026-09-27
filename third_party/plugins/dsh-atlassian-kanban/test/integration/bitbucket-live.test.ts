import { randomUUID } from 'node:crypto'
import { chmod, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { mkdir } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'
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

const run = promisify(execFile)
const baseUrl = process.env.KANBAN_BITBUCKET_URL
const statePath = process.env.KANBAN_BITBUCKET_STATE
const adminStatePath = process.env.KANBAN_BITBUCKET_ADMIN_STATE
const active = process.env.KANBAN_BITBUCKET_STATE ? describe : describe.skip
const closers: Array<() => Promise<unknown>> = []

afterEach(async () => { await Promise.allSettled(closers.splice(0).reverse().map(close => close())) })

function auth(username: string, password: string): string {
  return `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`
}

async function request(path: string, options: { method?: string; body?: unknown; authorization: string; expected: number[] }): Promise<any> {
  if (!baseUrl) throw new Error('Bitbucket URL is missing; run scripts/bitbucket-e2e.mjs up first.')
  const response = await fetch(new URL(path, baseUrl), {
    method: options.method ?? 'GET',
    headers: { authorization: options.authorization, accept: 'application/json', ...(options.body === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  })
  const text = await response.text()
  if (!options.expected.includes(response.status)) throw new Error(`Bitbucket fixture setup failed with HTTP ${response.status} at ${new URL(path, baseUrl).pathname}; query and response body suppressed.`)
  try { return text ? JSON.parse(text) : undefined } catch { return text }
}

function findText(result: { content: Array<{ type: string; text?: string }>; isError?: boolean }): string {
  if (result.isError) throw new Error(`A registered Bitbucket plugin tool returned an error: ${result.content.map(item => item.text ?? '').join(' ')}`)
  return result.content.filter(item => item.type === 'text').map(item => item.text ?? '').join('\n')
}

async function pushBranches(url: string, username: string, password: string, marker: string): Promise<void> {
  const directory = `/tmp/dsh-kanban-bitbucket-${randomUUID()}`
  await mkdir(directory, { recursive: true })
  const gitEnv = {
    ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_COUNT: '1',
    GIT_CONFIG_KEY_0: 'http.extraHeader', GIT_CONFIG_VALUE_0: `Authorization: ${auth(username, password)}`,
  }
  const git = async (...args: string[]) => {
    try { await run('git', args, { cwd: directory, env: gitEnv }) }
    catch { throw new Error('The local Git fixture push failed; command output suppressed.') }
  }
  try {
    await git('init', '-q', '-b', 'main')
    await git('config', 'user.name', 'Kanban Test Author')
    await git('config', 'user.email', 'kanban-test@example.invalid')
    await writeFile(`${directory}/README.md`, `# ${marker}\n`)
    await git('add', 'README.md')
    await git('commit', '-q', '-m', 'base')
    await git('remote', 'add', 'origin', url)
    await git('push', '-q', '-u', 'origin', 'main')
    await git('checkout', '-q', '-b', `feature/${marker.toLowerCase()}`)
    await writeFile(`${directory}/change.txt`, `${marker} pull request diff marker\n`)
    await git('add', 'change.txt')
    await git('commit', '-q', '-m', `change ${marker}`)
    await git('push', '-q', 'origin', `feature/${marker.toLowerCase()}`)
  } finally {
    await run('rm', ['-rf', directory])
  }
}

active('Bitbucket 10.4.1 plugin tools through the live MCP bridge', () => {
  it('lists and calls the registered plugin tools against a disposable real PR', async () => {
    if (!statePath || !adminStatePath) throw new Error('Private Bitbucket E2E paths are missing.')
    const { username: admin, password } = JSON.parse(await readFile(adminStatePath, 'utf8')) as { username?: string; password?: string }
    if (!admin || !password || !baseUrl) throw new Error('Private Bitbucket bootstrap properties are incomplete.')
    const adminAuth = auth(admin, password)
    const marker = randomUUID().replaceAll('-', '').slice(0, 8).toUpperCase()
    const projectKey = `KB${marker.slice(0, 5)}`
    const repositorySlug = `kanban-${marker.toLowerCase()}`
    const authorUsername = `kanban-author-${marker.toLowerCase()}`
    const authorPassword = `${randomUUID()}!Aa9`
    const prefix = `/rest/api/1.0/projects/${projectKey}`
    const repoPath = `${prefix}/repos/${repositorySlug}`

    await request('/rest/api/1.0/users?limit=1', { authorization: adminAuth, expected: [200] })
    await request('/rest/api/1.0/projects', { method: 'POST', authorization: adminAuth, body: { key: projectKey, name: `DSH Kanban ${marker}` }, expected: [201] })
    await request(`${prefix}/repos`, { method: 'POST', authorization: adminAuth, body: { name: repositorySlug, scmId: 'git', forkable: false }, expected: [201] })
    const newUser = new URLSearchParams({
      name: authorUsername, password: authorPassword, displayName: `Kanban PR author ${marker}`,
      emailAddress: `${authorUsername}@example.invalid`, addToDefaultGroup: 'true',
    })
    await request(`/rest/api/1.0/admin/users?${newUser}`, { method: 'POST', authorization: adminAuth, expected: [204] })
    await request(`${repoPath}/permissions/users?name=${encodeURIComponent(authorUsername)}&permission=REPO_WRITE`, { method: 'PUT', authorization: adminAuth, expected: [204] })

    const cloneUrl = `http://localhost:7990/scm/${projectKey.toLowerCase()}/${repositorySlug}.git`
    await pushBranches(cloneUrl, admin, password, marker)
    await request(`${repoPath}/branches/default`, { method: 'PUT', authorization: adminAuth, body: { id: 'refs/heads/main' }, expected: [204] })
    const created = await request(`${repoPath}/pull-requests`, { method: 'POST', authorization: auth(authorUsername, authorPassword), body: {
      title: `DSH Kanban live test ${marker}`, description: `Disposable PR fixture ${marker}`,
      fromRef: { id: `refs/heads/feature/${marker.toLowerCase()}` }, toRef: { id: 'refs/heads/main' },
    }, expected: [201] })
    const pullRequestId = Number(created?.id)
    if (!Number.isSafeInteger(pullRequestId) || pullRequestId < 1) throw new Error('Bitbucket did not return a valid pull request id.')

    const users = await request(`/rest/api/1.0/users?filter=${encodeURIComponent(admin)}&limit=10`, { authorization: adminAuth, expected: [200] })
    const adminUser = users?.values?.find((user: any) => user.name === admin || user.slug === admin) ?? users?.values?.[0]
    const adminSlug = adminUser?.slug
    if (typeof adminSlug !== 'string') throw new Error('Could not resolve the test reviewer slug.')
    const token = await request(`/rest/access-tokens/latest/users/${encodeURIComponent(adminSlug)}`, {
      method: 'PUT', authorization: adminAuth,
      body: { name: `Kanban test ${marker}`, expiryDays: 1, permissions: ['PROJECT_READ', 'REPO_READ', 'REPO_WRITE'] }, expected: [200, 201],
    })
    if (typeof token?.token !== 'string' || token.token.length < 8) throw new Error('Bitbucket did not return a short-lived user access token.')
    await mkdir(dirname(statePath), { recursive: true })
    await writeFile(statePath, JSON.stringify({
      baseUrl, bearerToken: token.token, projectKey, repositorySlug, pullRequestId,
      reviewerSlug: adminSlug, authorUsername, createdAt: new Date().toISOString(),
    }, null, 2), { mode: 0o600 })
    await chmod(statePath, 0o600)

    const config: AtlassianKanbanConfig = {
      jira: { baseUrl: '', bearerToken: '', jql: [] },
      bitbucket: { baseUrl, bearerToken: token.token, repositories: [{ id: 'live-test-repo', projectKey, repositorySlug }] },
      confluence: { baseUrl: '', bearerToken: '', cql: [] },
    }
    const ctx = new Context()
    await ctx.plugin(SystemPrompt, {})
    await ctx.plugin(ToolRuntime)
    const service = new AtlassianService(ctx as unknown as CordisContext, () => config)
    const disposeTools = registerTools(ctx as unknown as CordisContext, service)
    closers.push(async () => { for (const dispose of disposeTools.reverse()) dispose() })

    const agent = { id: 'bitbucket-live-integration', inbox: { nextStep: [] }, steer() {} }
    const bridgeContext = {
      get(name: string) { return name === 'tools' ? ctx.get('tools') : name === 'agents' ? { get: (id: string) => id === agent.id ? agent : undefined } : ctx.get(name, false) },
      on(name: string, listener: (...args: any[]) => void) { return ctx.on(name, listener) },
    } as unknown as CordisContext
    const lease = await createTeamBridge(bridgeContext, agent.id, { mcpCapabilities: { http: true } })
    if (!lease) throw new Error('The DSH ACP adapter did not open its MCP bridge.')
    closers.push(() => lease.close())
    const server = lease.servers[0]
    if (!server || !('url' in server)) throw new Error('Expected the adapter to expose an HTTP MCP server.')
    const client = new Client({ name: 'atlassian-kanban-bitbucket-live-test', version: '1.0.0' })
    await client.connect(new StreamableHTTPClientTransport(new URL(server.url)) as Parameters<Client['connect']>[0])
    closers.push(() => client.close())

    const discovered = await client.listTools()
    const expectedTools = [
      'bitbucket_list_repositories', 'bitbucket_get_repository', 'bitbucket_list_pull_requests',
      'bitbucket_get_pull_request', 'bitbucket_get_pull_request_diff', 'bitbucket_list_pull_request_comments',
      'bitbucket_get_pull_request_comment', 'bitbucket_add_pull_request_comment', 'bitbucket_approve_pull_request', 'bitbucket_unapprove_pull_request',
      'bitbucket_needs_work_pull_request', 'bitbucket_decline_pull_request',
    ]
    for (const name of expectedTools) expect(discovered.tools.some(tool => tool.name === name), `MCP tools/list contains ${name}`).toBe(true)
    lease.beginPrompt(new AbortController().signal)
    const callRaw = (name: string, args: Record<string, unknown> = {}) => client.callTool({ name, arguments: args })
    const call = async (name: string, args: Record<string, unknown> = {}) => findText(await callRaw(name, args))
    const common = { projectKey, repositorySlug }

    expect(await call('bitbucket_list_repositories')).toContain(repositorySlug)
    expect(await call('bitbucket_get_repository', common)).toContain(repositorySlug)
    expect(await call('bitbucket_list_pull_requests', { ...common, state: 'open' })).toContain(`DSH Kanban live test ${marker}`)
    expect(await call('bitbucket_get_pull_request', { ...common, pullRequestId })).toContain(`DSH Kanban live test ${marker}`)
    expect(await call('bitbucket_get_pull_request_diff', { ...common, pullRequestId })).toContain(`${marker} pull request diff marker`)
    const beforeComment = JSON.parse(await call('bitbucket_list_pull_request_comments', { ...common, pullRequestId }))
    expect(Array.isArray(beforeComment.values)).toBe(true)
    await call('bitbucket_add_pull_request_comment', { ...common, pullRequestId, text: `live plugin comment ${marker}` })
    const createdComments = JSON.parse(await call('bitbucket_list_pull_request_comments', { ...common, pullRequestId }))
    const createdActivity = createdComments.values.find((row: any) => row.comment?.text === `live plugin comment ${marker}`)
    expect(createdActivity?.comment).toBeDefined()
    const commentId = Number(createdActivity.comment.id)
    const createdCommentVersion = Number(createdActivity.comment.version)
    expect(Number.isSafeInteger(commentId)).toBe(true)
    expect(Number.isSafeInteger(createdCommentVersion)).toBe(true)
    const getComment = () => call('bitbucket_get_pull_request_comment', { ...common, pullRequestId, commentId })
    const freshComment = JSON.parse(await getComment())
    expect(Number(freshComment.id)).toBe(commentId)
    expect(freshComment.text).toBe(`live plugin comment ${marker}`)
    const editedText = `edited plugin comment ${marker}`
    await call('bitbucket_edit_pull_request_comment', { ...common, pullRequestId, commentId: String(commentId), text: editedText, version: Number(freshComment.version) })
    const editedComments = JSON.parse(await call('bitbucket_list_pull_request_comments', { ...common, pullRequestId }))
    expect(editedComments.values.some((row: any) => String(row.comment?.id) === String(commentId))).toBe(true)
    const editedComment = JSON.parse(await getComment())
    expect(Number(editedComment.id)).toBe(commentId)
    expect(editedComment.text).toBe(editedText)
    expect(Number(editedComment.version)).toBeGreaterThan(Number(freshComment.version))
    await call('bitbucket_delete_pull_request_comment', { ...common, pullRequestId, commentId: String(commentId), version: Number(editedComment.version) })
    expect((await callRaw('bitbucket_get_pull_request_comment', { ...common, pullRequestId, commentId })).isError).toBe(true)
    const afterDelete = JSON.parse(await call('bitbucket_list_pull_request_comments', { ...common, pullRequestId }))
    expect(afterDelete.values.some((row: any) => String(row.comment?.id) === String(commentId))).toBe(false)
    expect(JSON.stringify(afterDelete)).not.toContain(editedText)

    const currentPull = async () => {
      const pull = JSON.parse(await call('bitbucket_get_pull_request', { ...common, pullRequestId }))
      expect(typeof pull.version).toBe('number')
      return pull as { version: number }
    }
    const currentParticipants = async () => request(`${repoPath}/pull-requests/${pullRequestId}/participants`, { authorization: adminAuth, expected: [200] })
    const rows = (response: any) => Array.isArray(response) ? response : Array.isArray(response?.values) ? response.values : []
    await call('bitbucket_approve_pull_request', { ...common, pullRequestId, version: (await currentPull()).version })
    const approved = rows(await currentParticipants())
    if (!approved.some((row: any) => row.user?.slug === adminSlug && (row.approved === true || row.status === 'APPROVED'))) {
      throw new Error(`Approval participant state: ${JSON.stringify(approved.map((row: any) => ({ slug: row.user?.slug, approved: row.approved, status: row.status })))}`)
    }
    await call('bitbucket_unapprove_pull_request', { ...common, pullRequestId, version: (await currentPull()).version })
    const unapproved = rows(await currentParticipants())
    expect(unapproved.some((row: any) => row.user?.slug === adminSlug && row.approved === false)).toBe(true)
    await call('bitbucket_needs_work_pull_request', { ...common, pullRequestId, userSlug: adminSlug, version: (await currentPull()).version })
    const needsWork = rows(await currentParticipants())
    expect(needsWork.some((row: any) => row.user?.slug === adminSlug && row.status === 'NEEDS_WORK')).toBe(true)
    await call('bitbucket_decline_pull_request', { ...common, pullRequestId, version: (await currentPull()).version, comment: `declined by live plugin test ${marker}` })

    const finalPull = await call('bitbucket_get_pull_request', { ...common, pullRequestId })
    expect(finalPull).toContain('DECLINED')
    expect(JSON.stringify(discovered.tools)).not.toContain(token.token)
    expect(JSON.stringify(discovered.tools)).not.toContain(password)
  }, 180_000)
})
