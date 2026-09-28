import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { boot, initProfile, readProfilePatches, type ProfileContext } from '@deepseek-ai/dsh-app-boot'
import Timer from '@deepseek-ai/cordis-plugin-timer'
import ConfigEditor from '@deepseek-ai/dsh-config-editor'
import Hmr from '@deepseek-ai/dsh-hmr'
import DefaultModel from '@deepseek-ai/dsh-agent-default-model'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { type ToolRunContext } from '@deepseek-ai/dsh-tools'
import Settings from '@deepseek-ai/dsh-settings'
import { Config as KanbanConfigSchema, type NativeConfig } from '../../src/shared/native-config.ts'
import { AtlassianService } from '../../src/host/service.ts'
import { registerTools } from '../../src/host/tools.ts'
import type { AtlassianSettingsView } from '../../src/shared/config.ts'

const live = new Map<Context, { home: string; disposed: boolean }>()
afterEach(async () => {
  const homes = new Set<string>()
  await Promise.all([...live].map(async ([ctx, state]) => {
    homes.add(state.home)
    if (!state.disposed) await ctx.fiber.dispose()
  }))
  live.clear()
  await Promise.all([...homes].map(home => rm(home, { recursive: true, force: true })))
})

const KanbanProbe = {
  Config: KanbanConfigSchema,
  inject: ['tools', 'settings'],
  apply(ctx: Context, config: NativeConfig) {
    const service = new AtlassianService(ctx, () => ({
      refreshMentions: config.refreshMentions.get(),
      jira: { baseUrl: config.jira.baseUrl.get(), bearerToken: config.jira.bearerToken.get(), jql: config.jira.jql.get() },
      bitbucket: { baseUrl: config.bitbucket.baseUrl.get(), bearerToken: config.bitbucket.bearerToken.get(), repositories: config.bitbucket.repositories.get() },
      confluence: { baseUrl: config.confluence.baseUrl.get(), bearerToken: config.confluence.bearerToken.get(), cql: config.confluence.cql.get() },
    }))
    const disposers = registerTools(ctx, service)
    ctx.effect(() => () => { for (const dispose of disposers.reverse()) dispose() }, 'settings-tools-test')
  },
}

async function bootProfile() {
  const home = await mkdtemp(join(tmpdir(), 'dsh-atlassian-settings-'))
  const dir = join(home, 'profiles', 'test')
  initProfile(dir, ['kanban-test'])
  const bundle = join(dir, 'node_modules', 'kanban-test')
  await mkdir(bundle, { recursive: true })
  await writeFile(join(home, 'package.json'), '{"name":"dsh-atlassian-settings-test"}\n')
  await writeFile(join(bundle, 'package.json'), JSON.stringify({ name: 'kanban-test', version: '1.0.0', dsh: { bundle: { patch: 'cordis.patch.yml' } } }))
  const entry = {
    id: 'dsh-atlassian-kanban', name: 'dsh-atlassian-kanban', config: {
      refreshMentions: true,
      jira: { baseUrl: '', bearerToken: 'jira-private-token', jql: [{ id: 'assigned', name: 'Assigned', query: 'assignee = currentUser()' }] },
      bitbucket: { baseUrl: '', bearerToken: 'bb-private-token', repositories: [{ id: 'legacy', projectKey: 'OLD', repositorySlug: 'old-repo' }] },
      confluence: { baseUrl: '', bearerToken: '', cql: [] },
    },
  }
  const rows = [
    { id: 'editor', name: 'cordis:editor' },
    { id: 'settings', name: 'cordis:settings' },
    { id: 'model', name: 'cordis:model', config: { provider: 'test', model: 'test' } },
    { id: 'system-prompt', name: 'cordis:systemPrompt' },
    { id: 'tools', name: 'cordis:tools' },
    { id: 'dsh-atlassian-kanban', name: 'cordis:kanban', config: entry.config },
  ]
  await writeFile(join(bundle, 'cordis.patch.yml'), JSON.stringify([{ insert: rows }]))
  await writeFile(join(dir, 'cordis.yml'), '[]\n')
  const profile: ProfileContext = {
    name: 'test', startedBundles: ['kanban-test'], dir, patchPath: join(dir, 'cordis.patch.yml'),
    installAnchor: join(home, 'package.json'), cwd: home, home, overlays: [], telemetryDisabledEnv: undefined,
  }
  const start = async (): Promise<Context> => {
    const ctx = await boot('test', join(dir, 'cordis.yml'), readProfilePatches('test', profile), root => {
      root.provide('profileContext', profile)
      root.provide('appReady', { onReady: (listener: () => void) => { listener(); return () => {} } })
      Object.assign(root.loader.builtins, {
        editor: ConfigEditor, settings: Settings, model: DefaultModel, systemPrompt: SystemPrompt,
        tools: ToolRuntime, kanban: KanbanProbe,
      })
    })
    await ctx.plugin(Timer)
    const hmr = ctx.plugin(Hmr, { root: [], ignored: [], debounce: 0 })
    await hmr.await()
    await ctx.hmr.runExclusive(async () => {})
    live.set(ctx, { home, disposed: false })
    return ctx
  }
  const dispose = async (ctx: Context) => {
    const state = live.get(ctx)
    await ctx.fiber.dispose()
    if (state) state.disposed = true
  }
  return { ctx: await start(), start, dispose, profile, entry }
}

async function run(ctx: Context, name: string, args: Record<string, unknown>): Promise<unknown> {
  const tool = ctx.tools.get(name)
  if (!tool) throw new Error(`Missing tool ${name}`)
  return tool.execute(args, {
    name, callId: `settings-${name}`, rootCallId: `settings-${name}`, signal: new AbortController().signal,
    deferContext() {}, concludeTurn() {},
  } as ToolRunContext)
}

const batch = Array.from({ length: 10 }, (_, index) => ({ projectKey: 'TEAM', repositorySlug: `repo-${index}` }))

describe('native configuration tools and real profile persistence', () => {
  it('atomically adds a ten-repository batch without replacing existing rows and deduplicates stable identities', async () => {
    const fixture = await bootProfile()
    const firstView = await run(fixture.ctx, 'kanban_get_settings', {}) as AtlassianSettingsView
    expect(firstView.revision).toBe(0)
    expect(firstView.bitbucket.repositories).toEqual([{ id: 'legacy', projectKey: 'OLD', repositorySlug: 'old-repo' }])
    expect(JSON.stringify(firstView)).not.toContain('jira-private-token')

    const updated = await run(fixture.ctx, 'kanban_upsert_repositories', { expectedRevision: firstView.revision, repositories: batch }) as AtlassianSettingsView
    expect(updated.bitbucket.repositories).toHaveLength(11)
    expect(updated.bitbucket.repositories[0]).toEqual({ id: 'legacy', projectKey: 'OLD', repositorySlug: 'old-repo' })
    expect(new Set(updated.bitbucket.repositories.map(row => row.id)).size).toBe(11)
    const repeated = await run(fixture.ctx, 'kanban_upsert_repositories', { expectedRevision: updated.revision, repositories: batch }) as AtlassianSettingsView
    expect(repeated.bitbucket.repositories).toHaveLength(11)
    expect(repeated.bitbucket.repositories.slice(1).map(row => row.id)).toEqual(updated.bitbucket.repositories.slice(1).map(row => row.id))

    const beforeConflict = await readFile(fixture.profile.patchPath, 'utf8')
    await expect(run(fixture.ctx, 'kanban_upsert_repositories', { expectedRevision: repeated.revision, repositories: [
      { id: 'replacement-id', projectKey: 'OLD', repositorySlug: 'old-repo' },
      { projectKey: 'TEAM', repositorySlug: 'another-valid-repo' },
    ] })).rejects.toThrow('Repository identity is already bound to a different id')
    expect(await readFile(fixture.profile.patchPath, 'utf8')).toBe(beforeConflict)
    await expect(run(fixture.ctx, 'kanban_upsert_repositories', { expectedRevision: repeated.revision, repositories: [
      { id: 'legacy', projectKey: 'TEAM', repositorySlug: 'repo-0' },
    ] })).rejects.toThrow('Repository identity is already bound to a different id')
    expect(await readFile(fixture.profile.patchPath, 'utf8')).toBe(beforeConflict)

    const moved = await run(fixture.ctx, 'kanban_upsert_repositories', { expectedRevision: repeated.revision, repositories: [{ id: 'legacy', projectKey: 'NEW', repositorySlug: 'moved' }] }) as AtlassianSettingsView
    expect(moved.bitbucket.repositories).toHaveLength(11)
    expect(moved.bitbucket.repositories.filter(row => row.id === 'legacy')).toEqual([{ id: 'legacy', projectKey: 'NEW', repositorySlug: 'moved' }])
    expect(moved.bitbucket.repositories.some(row => row.projectKey === 'OLD' && row.repositorySlug === 'old-repo')).toBe(false)

    const queries = await run(fixture.ctx, 'kanban_upsert_queries', { expectedRevision: moved.revision, product: 'jira', queries: [
      { name: 'Open work', query: 'statusCategory != Done' }, { name: 'Open work', query: 'statusCategory != Done' },
    ] }) as AtlassianSettingsView
    expect(queries.jira.jql).toHaveLength(2)
    expect(queries.jira.jql[0]).toMatchObject({ id: 'assigned', name: 'Assigned' })
    expect(new Set(queries.jira.jql.map(row => row.id)).size).toBe(2)
  })

  it('rejects malformed batches without profile changes and refuses concurrent stale revisions', async () => {
    const fixture = await bootProfile()
    const patchBefore = await readFile(fixture.profile.patchPath, 'utf8')
    const view = await run(fixture.ctx, 'kanban_get_settings', {}) as AtlassianSettingsView
    await expect(run(fixture.ctx, 'kanban_upsert_repositories', { expectedRevision: view.revision, repositories: [{ projectKey: 'TEAM', repositorySlug: 'good' }, { projectKey: 'BAD/KEY', repositorySlug: 'bad' }] })).rejects.toThrow('projectKey is invalid')
    expect(await readFile(fixture.profile.patchPath, 'utf8')).toBe(patchBefore)
    await expect(run(fixture.ctx, 'kanban_upsert_repositories', { expectedRevision: view.revision, repositories: [{ id: 'shared', projectKey: 'TEAM', repositorySlug: 'one' }, { id: 'shared', projectKey: 'TEAM', repositorySlug: 'two' }] })).rejects.toThrow('Batch reuses a repository id')
    expect(await readFile(fixture.profile.patchPath, 'utf8')).toBe(patchBefore)
    await expect(run(fixture.ctx, 'kanban_upsert_queries', { expectedRevision: view.revision, product: 'jira', queries: [{ id: 'shared', name: 'First', query: 'project = APP' }, { id: 'shared', name: 'Second', query: 'project = OPS' }] })).rejects.toThrow('Batch reuses a query id')
    expect(await readFile(fixture.profile.patchPath, 'utf8')).toBe(patchBefore)

    const race = await Promise.allSettled([
      run(fixture.ctx, 'kanban_set_preferences', { expectedRevision: view.revision, refreshMentions: false }),
      run(fixture.ctx, 'kanban_set_preferences', { expectedRevision: view.revision, refreshMentions: false }),
    ])
    expect(race.filter(row => row.status === 'fulfilled')).toHaveLength(1)
    expect(race.filter(row => row.status === 'rejected')).toHaveLength(1)
    const rejected = race.find(row => row.status === 'rejected') as PromiseRejectedResult
    expect(String(rejected.reason)).toContain('Configuration revision conflict')
  })

  it('persists token retention, replacement, and explicit clearing while never echoing the secret', async () => {
    const fixture = await bootProfile()
    const current = await run(fixture.ctx, 'kanban_get_settings', {}) as AtlassianSettingsView
    const baseChanged = await run(fixture.ctx, 'kanban_update_connections', { expectedRevision: current.revision, jira: { baseUrl: 'https://jira.example/jira' } }) as AtlassianSettingsView
    expect(baseChanged.jira).toMatchObject({ baseUrl: 'https://jira.example/jira', hasToken: true })
    const token = 'new-private-token-never-return-this'
    const tokenChanged = await run(fixture.ctx, 'kanban_update_connections', { expectedRevision: baseChanged.revision, jira: { bearerToken: token } }) as AtlassianSettingsView
    expect(JSON.stringify(tokenChanged)).not.toContain(token)
    expect(JSON.stringify(fixture.ctx.settings.describe({ redactSecrets: true }))).not.toContain(token)
    const storedToken = await readFile(fixture.profile.patchPath, 'utf8')
    expect(storedToken.includes(token)).toBe(true)

    const cleared = await run(fixture.ctx, 'kanban_update_connections', { expectedRevision: tokenChanged.revision, jira: { clearToken: true } }) as AtlassianSettingsView
    expect(cleared.jira.hasToken).toBe(false)

    const contents = await readFile(fixture.profile.patchPath, 'utf8')
    expect(contents.includes(token)).toBe(false)
    await fixture.dispose(fixture.ctx)
    const restarted = await fixture.start()
    const afterRestart = await run(restarted, 'kanban_get_settings', {}) as AtlassianSettingsView
    expect(afterRestart.jira).toMatchObject({ baseUrl: 'https://jira.example/jira', hasToken: false })
    expect(afterRestart.bitbucket.repositories).toHaveLength(1)
  })
})
