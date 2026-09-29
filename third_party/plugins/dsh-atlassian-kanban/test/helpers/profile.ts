import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { boot, initProfile, readProfilePatches, type ProfileContext } from '@deepseek-ai/dsh-app-boot'
import Timer from '@deepseek-ai/cordis-plugin-timer'
import ConfigEditor from '@deepseek-ai/dsh-config-editor'
import Hmr from '@deepseek-ai/dsh-hmr'
import DefaultModel from '@deepseek-ai/dsh-agent-default-model'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { type ToolRunContext } from '@deepseek-ai/dsh-tools'
import Settings from '@deepseek-ai/dsh-settings'
import * as KanbanPlugin from '../../src/index.ts'

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

export async function bootProfile() {
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
        tools: ToolRuntime, kanban: KanbanPlugin,
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

export async function run(ctx: Context, name: string, args: Record<string, unknown>): Promise<unknown> {
  const tool = ctx.tools.get(name)
  if (!tool) throw new Error(`Missing tool ${name}`)
  return tool.execute(args, {
    name, callId: `settings-${name}`, rootCallId: `settings-${name}`, signal: new AbortController().signal,
    deferContext() {}, concludeTurn() {},
  } as ToolRunContext)
}
