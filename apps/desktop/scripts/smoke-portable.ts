/** Exercise the packaged seed and bundled Node with an empty, disposable offline profile. */
import assert from 'node:assert/strict'
import type { ChildProcess } from 'node:child_process'
import { subscribe, unsubscribe } from 'node:diagnostics_channel'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import extractZip from '@electron-internal/extract-zip'
import { DesktopProjectManager } from '../src/project-manager.ts'
import { DesktopHostProcess } from '../src/host-process.ts'
import { DesktopExperiments } from '../src/experiments.ts'
import { resolveDesktopPaths } from '../src/paths.ts'
import { desktopTargetBuildPaths } from './desktop-build-paths.mjs'
import { DESKTOP_PORTABLE_PLUGINS } from '../src/portable-plugins.ts'

const target = process.argv[2]
if (target !== 'mac-arm64' && target !== 'win-x64') throw new Error('Expected mac-arm64 or win-x64')
const archive = process.argv[3]
const artifacts = archive === undefined
  ? desktopTargetBuildPaths(target).artifacts
  : mkdtempSync(join(tmpdir(), 'dsh-portable-archive-'))
if (archive !== undefined) {
  const unpacked = join(artifacts, target === 'mac-arm64' ? 'mac-arm64' : 'win-unpacked')
  console.log(`Packaged smoke: extracting ${archive}`)
  try {
    await extractZip(archive, { dir: unpacked })
  } catch (error) {
    rmSync(artifacts, { recursive: true, force: true })
    throw error
  }
}
const resources = target === 'mac-arm64'
  ? join(artifacts, 'mac-arm64', 'DSH Desktop.app', 'Contents', 'Resources')
  : join(artifacts, 'win-unpacked', 'resources')
const home = mkdtempSync(join(tmpdir(), 'dsh-portable-smoke-'))
process.env.DSH_HOME = home
process.env.DSH_TELEMETRY_MODE = 'DISABLED'
process.env.npm_config_registry = 'http://127.0.0.1:1/unreachable/'
process.env.npm_config_userconfig = join(home, 'absent.npmrc')
const runtime = {
  node: join(resources, 'runtime', 'node', target === 'win-x64' ? 'node.exe' : 'node'),
  pnpm: join(resources, 'runtime', 'pnpm', 'bin', 'pnpm.mjs'),
}
const paths = resolveDesktopPaths(home)
const manager = new DesktopProjectManager(paths, runtime)
const seed = join(resources, 'seed')
const release = JSON.parse(readFileSync(join(seed, 'desktop-release.json'), 'utf8')) as { distributionVersion: string }
let host: DesktopHostProcess | undefined
let stage = 'installing the packaged seed'
const children = new Set<ChildProcess>()
const failedChildren: Array<{ code: number | null; signal: NodeJS.Signals | null }> = []
function childDiagnostic(message: unknown): void {
  const { process: child } = message as { process: ChildProcess }
  children.add(child)
  const stdout = (chunk: Buffer | string): void => { process.stdout.write(chunk) }
  const stderr = (chunk: Buffer | string): void => { process.stderr.write(chunk) }
  child.once('spawn', () => {
    console.log(`Packaged smoke: child ${String(child.pid)} spawned`)
    child.stdout?.on('data', stdout)
    child.stderr?.on('data', stderr)
  })
  child.once('exit', (code, signal) => {
    console.log(`Packaged smoke: child ${String(child.pid)} exited (${String(code ?? signal)})`)
    if (code !== 0 || signal !== null) failedChildren.push({ code, signal })
  })
  child.once('close', () => {
    child.stdout?.off('data', stdout)
    child.stderr?.off('data', stderr)
    children.delete(child)
  })
}
function progress(next: string): void {
  stage = next
  console.log(`Packaged smoke: ${stage}`)
}
// Windows cold-store preparation measured 154s before the roughly 53s dependency install.
const timeout = setTimeout(() => {
  console.error(`Packaged host smoke timed out while ${stage}`)
  for (const child of children) console.error({ pid: child.pid, exitCode: child.exitCode, signalCode: child.signalCode })
  process.exit(1)
}, target === 'win-x64' ? 300_000 : 180_000)
subscribe('child_process', childDiagnostic)
try {
  progress(stage)
  await manager.applyRelease(seed, release.distributionVersion, {
    healthCheck: async (project) => {
      progress('starting the installed host')
      host = new DesktopHostProcess(runtime.node, project)
      const ready = await host.start()
      assert.equal(ready.dshVersion, '0.1.5-rc.2')
      progress('fetching the frontend asset')
      const response = await host.fetch(new Request('dsh-app://app/index.html'))
      assert.equal(response.status, 200)
      const html = await response.text()
      assert.match(html, /<html/u)
      progress('checking the default Teams profile and client module')
      const installed = JSON.parse(readFileSync(join(project, 'package.json'), 'utf8')) as { dsh: { profile: { bundles: string[] } } }
      const expected = JSON.parse(readFileSync(new URL('../tests/expected/rc2-profile.json', import.meta.url), 'utf8')) as { bundles: string[] }
      assert.deepEqual(installed.dsh.profile.bundles, [...expected.bundles, '@zaimokuza/dsh-plugin-hub'])
      const bootJson = html.match(/<script>globalThis\["__DSH_BOOT__"\] = (.*?)<\/script>/u)?.[1]
      assert.notEqual(bootJson, undefined)
      const graph = JSON.parse(bootJson!) as { entries: { id: string; url: string }[] }
      const teamEntry = graph.entries.find(entry => entry.id === '@deepseek-ai/dsh-experimental-client-ui-agent-team')
      assert.notEqual(teamEntry, undefined)
      const teamClient = await host.fetch(new Request(new URL(teamEntry!.url, 'dsh-app://app')))
      assert.equal(teamClient.status, 200)
      assert.match(teamClient.headers.get('content-type') ?? '', /javascript/u)
      assert.match(await teamClient.text(), /agentTeams/u)
      const teamRpc = await host.fetch(new Request('dsh-app://app/api/agentTeams/view', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type: 'client-request', rpcId: 'teams-smoke', method: 'agentTeams/view', payload: { args: {} } }),
      }))
      assert.equal(teamRpc.status, 200)
      const teamResult = await teamRpc.json() as { result: { ok: boolean; error?: { code: string; message: string } } }
      assert.equal(teamResult.result.ok, false)
      assert.equal(teamResult.result.error?.code, 'gateway/arguments-invalid')
      assert.match(teamResult.result.error?.message ?? '', /agentId/u)
      progress('checking the bundled Plugin Hub client and desktop Teams state')
      const hubEntry = graph.entries.find(entry => entry.id === '@zaimokuza/dsh-plugin-hub')
      assert.notEqual(hubEntry, undefined)
      const hubClient = await host.fetch(new Request(new URL(hubEntry!.url, 'dsh-app://app')))
      assert.equal(hubClient.status, 200)
      assert.match(hubClient.headers.get('content-type') ?? '', /javascript/u)
      assert.match(await hubClient.text(), /Plugin Hub/u)
      const hubRpc = await host.fetch(new Request('dsh-app://app/api/dshPluginHub_hub/experiments', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type: 'client-request', rpcId: 'hub-smoke', method: 'dshPluginHub_hub/experiments', payload: {} }),
      }))
      assert.equal(hubRpc.status, 200)
      const hubResult = await hubRpc.json() as { result: { ok: boolean; value: { id: string; enabled: boolean; installed: boolean }[] } }
      assert.equal(hubResult.result.ok, true)
      const teamFeature = hubResult.result.value.find(feature => feature.id === 'agent-teams')
      assert.equal(teamFeature?.enabled, true)
      assert.equal(teamFeature?.installed, true)
      progress('stopping the staged host')
      await host.stop()
      host = undefined
    },
    beforeActivate: async () => { progress('activating the installed profile') },
    afterActivate: async () => { progress('checking the active plugin inventory') },
  })
  assert.deepEqual(manager.listPlugins(), DESKTOP_PORTABLE_PLUGINS.map(({ name, version }) => ({ name, version })))
  progress('switching Teams off and on through the experiment controller without registry access')
  const startActive = async (): Promise<void> => {
    host = new DesktopHostProcess(runtime.node, paths.profile)
    await host.start()
  }
  await startActive()
  let busy = false
  const experiments = new DesktopExperiments({
    profile: paths.profile, supported: true,
    enabled: () => manager.agentTeamsEnabled(), busy: () => busy, setBusy: (value) => { busy = value },
    stopIfIdle: async () => {
      assert.notEqual(host, undefined)
      if (!await host!.stopIfIdle()) return false
      host = undefined
      return true
    },
    change: enabled => manager.mutate({ type: 'agent-teams', enabled }, {
      healthCheck: async (project) => {
        const probe = new DesktopHostProcess(runtime.node, project)
        try { await probe.start() } finally { await probe.stop() }
      },
      beforeActivate: async () => {},
      afterActivate: startActive,
    }),
    recover: async () => { if (host === undefined) await startActive() },
  })
  for (const enabled of [false, true]) {
    const result = await experiments.setEnabled({ profile: paths.profile, id: 'agent-teams', expectedEnabled: !enabled, enabled })
    assert.equal(result.ok, true, JSON.stringify(result))
    if (result.ok) {
      assert.equal(result.reloadRequired, true)
      assert.equal(result.value.features[0]?.enabled, enabled)
      assert.equal(result.value.features[0]?.activeEnabled, enabled)
    }
    const html = await (await host!.fetch(new Request('dsh-app://app/index.html'))).text()
    const graph = JSON.parse(html.match(/<script>globalThis\["__DSH_BOOT__"\] = (.*?)<\/script>/u)![1]!) as { entries: { id: string }[] }
    assert.equal(graph.entries.some(entry => entry.id === '@deepseek-ai/dsh-experimental-client-ui-agent-team'), enabled)
    assert.equal(graph.entries.some(entry => entry.id === '@zaimokuza/dsh-plugin-hub'), true)
    assert.deepEqual(manager.listPlugins(), DESKTOP_PORTABLE_PLUGINS.map(({ name, version }) => ({ name, version })))
  }
  await host!.stop()
  host = undefined
  assert.deepEqual(failedChildren, [], 'All package and backend processes must exit cleanly')
  console.log('Packaged offline install, host boot, frontend assets, Agent Teams, ACP adapter and Plugin Hub: passed')
} finally {
  await host?.stop()
  clearTimeout(timeout)
  unsubscribe('child_process', childDiagnostic)
  rmSync(home, { recursive: true, force: true })
  if (archive !== undefined) rmSync(artifacts, { recursive: true, force: true })
}
