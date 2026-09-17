/** Exercise the packaged seed and bundled Node with an empty, disposable offline profile. */
import assert from 'node:assert/strict'
import { spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { Writable } from 'node:stream'
import { subscribe, unsubscribe } from 'node:diagnostics_channel'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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
// Re-execute under packaged Electron so filesystem reads exercise the actual ASAR layout.
const executable = target === 'mac-arm64'
  ? join(resources, '..', 'MacOS', 'DSH Desktop') : join(resources, '..', 'DSH Desktop.exe')
if (process.versions.electron === undefined) {
  const child = spawn(executable, ['--import', 'tsx/esm', import.meta.filename, target], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', DSH_DESKTOP_SMOKE_RESOURCES: resources }, stdio: 'inherit',
  })
  const [code, signal] = await once(child, 'exit')
  if (archive !== undefined) rmSync(artifacts, { recursive: true, force: true })
  assert.equal(signal, null)
  assert.equal(code, 0)
  process.exit(0)
}
const packagedResources = process.env.DSH_DESKTOP_SMOKE_RESOURCES ?? resources
const home = mkdtempSync(join(tmpdir(), 'dsh-portable-smoke-'))
process.env.DSH_HOME = home
process.env.DSH_TELEMETRY_MODE = 'DISABLED'
process.env.npm_config_registry = 'http://127.0.0.1:1/unreachable/'
process.env.npm_config_userconfig = join(home, 'absent.npmrc')
const runtime = {
  node: process.execPath,
  packageNode: join(packagedResources, 'runtime', 'node', target === 'win-x64' ? 'node.exe' : 'node'),
  pnpm: join(packagedResources, 'runtime', 'pnpm', 'bin', 'pnpm.mjs'),
  dsh: join(packagedResources, 'app.asar', 'dsh'),
  pluginSeed: join(packagedResources, 'plugin-seed'),
  profileResolution: 'runtime' as const,
}
const paths = resolveDesktopPaths(home)
const manager = new DesktopProjectManager(paths, runtime)
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
  timeout.refresh()
  console.log(`Packaged smoke: ${stage}`)
}
async function assertOfficeState(expected: 'unselected' | 'disabled'): Promise<void> {
  const response = await host!.fetch(new Request('dsh-app://app/api/dshOffice/snapshot', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'client-request', rpcId: 'office-smoke', method: 'dshOffice/snapshot', payload: { sessionId: null } }),
  }))
  assert.equal(response.status, 200)
  const result = await response.json() as { result: { ok: boolean; value?: { state: string } } }
  assert.equal(result.result.ok, true, JSON.stringify(result))
  assert.equal(result.result.value?.state, expected)
}
// Bound each phase separately: cold-store installation and both offline mutations
// each do real filesystem work (Windows cold preparation previously measured 154s).
const timeout = setTimeout(() => {
  console.error(`Packaged host smoke timed out while ${stage}`)
  for (const child of children) console.error({ pid: child.pid, exitCode: child.exitCode, signalCode: child.signalCode })
  process.exit(1)
}, target === 'win-x64' ? 300_000 : 180_000)
subscribe('child_process', childDiagnostic)
try {
  progress(stage)
  for (const plugin of DESKTOP_PORTABLE_PLUGINS) {
    assert.ok(existsSync(join(runtime.pluginSeed, 'node_modules', plugin.name, 'package.json')),
      `Packaged seed is missing ${plugin.name}; include plugin-seed/node_modules explicitly`)
  }
  for (const file of ['LICENSE', 'THIRD_PARTY_NOTICES.md', 'vendor/munder/LICENSE', 'vendor/the-office/LICENSE', 'vendor/three/LICENSE', 'lib/THIRD_PARTY_LICENSES.txt']) {
    assert.ok(existsSync(join(runtime.pluginSeed, 'node_modules', '@zaimokuza/dsh-agent-teams-office', file)), `Missing Office notice ${file}`)
  }
  const firstStart = performance.now()
  await manager.applyRelease()
  const prepared = performance.now()
  const metadata = spawn(runtime.node, [join(import.meta.dirname, '../tests/fixtures/plugin-metadata-smoke.mjs'), runtime.dsh, paths.profile], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit',
  })
  const [metadataCode, metadataSignal] = await once(metadata, 'exit')
  assert.equal(metadataSignal, null)
  assert.equal(metadataCode, 0, 'Final plugin metadata must register on the packaged host and client registry')
  const devinConfig = spawn(runtime.node, [join(import.meta.dirname, '../tests/fixtures/devin-config-smoke.mjs'), paths.profile], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit',
  })
  const [devinCode, devinSignal] = await once(devinConfig, 'exit')
  assert.equal(devinSignal, null)
  assert.equal(devinCode, 0, 'Packaged Devin config must support ordinary Windows users and preserve original files')
  const hostStart = performance.now()
  host = new DesktopHostProcess(runtime.node, runtime.dsh, paths.profile)
  const ready = await host.start()
  assert.equal(ready.dshVersion, '0.1.6-alpha.1')
  const response = await host.fetch(new Request('dsh-app://app/index.html'))
  assert.equal(response.status, 200)
  const html = await response.text()
  assert.match(html, /<html/u)
  console.log(JSON.stringify({ firstPreparationMs: prepared - firstStart,
    firstReadyMs: prepared - firstStart + performance.now() - hostStart, metadataProbeMs: hostStart - prepared }))
  const graph = JSON.parse(html.match(/globalThis\["__DSH_BOOT__"\] = (.*?)<\/script>/u)![1]!) as { entries: { id: string; url: string }[] }
  for (const name of [...DESKTOP_PORTABLE_PLUGINS.map(plugin => plugin.name), '@deepseek-ai/dsh-experimental-client-ui-agent-team']) {
    const entry = graph.entries.find(item => item.id === name)
    assert.ok(entry, `Missing client module ${name}`)
    const client = await host.fetch(new Request(new URL(entry.url, 'dsh-app://app')))
    assert.equal(client.status, 200)
    assert.ok((await client.text()).length > 0)
  }
  const hubRpc = await host.fetch(new Request('dsh-app://app/api/dshPluginHub_hub/resources', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'client-request', rpcId: 'hub-smoke', method: 'dshPluginHub_hub/resources', payload: {} }),
  }))
  assert.equal(hubRpc.status, 200)
  const hubResult = await hubRpc.json() as { result: { ok: boolean } }
  assert.equal(hubResult.result.ok, true, JSON.stringify(hubResult))
  const acpRpc = await host.fetch(new Request('dsh-app://app/api/dshAcp/health', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'client-request', rpcId: 'acp-smoke', method: 'dshAcp/health', payload: { args: {} } }),
  }))
  assert.equal(acpRpc.status, 200)
  const acpResult = await acpRpc.json() as { result: { ok: boolean; value?: { providers: unknown[] } } }
  assert.equal(acpResult.result.ok, true, JSON.stringify(acpResult))
  assert.ok(Array.isArray(acpResult.result.value?.providers), 'ACP health must execute successfully')
  await assertOfficeState('unselected')
  assert.deepEqual(manager.listPlugins(),
    DESKTOP_PORTABLE_PLUGINS.map(({ name, version }) => ({ name, version, enabled: true })).sort((a, b) => a.name.localeCompare(b.name)),
  )
  await host.stop()
  host = undefined
  const warmStart = performance.now()
  assert.equal(await manager.applyRelease(), false)
  progress('switching Teams off and on through the experiment controller without registry access')
  const startActive = async (): Promise<void> => {
    host = new DesktopHostProcess(runtime.node, runtime.dsh, paths.profile)
    await host.start()
  }
  await startActive()
  await (await host!.fetch(new Request('dsh-app://app/index.html'))).text()
  console.log(JSON.stringify({ warmReadyMs: performance.now() - warmStart }))
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
      beforeChange: async () => { await host?.stop(); host = undefined },
      afterChange: startActive,
    }),
    recover: async () => { if (host === undefined) await startActive() },
  })
  for (const enabled of [false, true]) {
    progress(`switching Teams ${enabled ? 'on' : 'off'} without registry access`)
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
    await assertOfficeState(enabled ? 'unselected' : 'disabled')
    assert.deepEqual(manager.listPlugins(),
      DESKTOP_PORTABLE_PLUGINS.map(({ name, version }) => ({ name, version, enabled: true })).sort((a, b) => a.name.localeCompare(b.name)),
    )
  }
  await host!.stop()
  host = undefined
  assert.deepEqual(failedChildren, [], 'All package and backend processes must exit cleanly')
  progress('migrating retired core tarball references offline')
  const legacyHome = join(home, 'legacy-upgrade')
  const legacyPaths = resolveDesktopPaths(legacyHome)
  mkdirSync(legacyPaths.profile, { recursive: true })
  const retiredNames = ['@deepseek-ai/dsh-code-runtime', '@deepseek-ai/dsh-code-runtime-worker-thread', '@deepseek-ai/dsh-workflow-worker-thread']
  const legacyNames = ['@deepseek-ai/dsh', '@deepseek-ai/dsh-desktop-host', ...retiredNames].sort((a, b) => a.localeCompare(b))
  const packages = legacyNames.map(name => ({ name, version: '0.1.5-rc.2',
    file: `${name.replace('@deepseek-ai/', '')}-0.1.5-rc.2.tgz`, bytes: 0, integrity: 'sha512-AA==' }))
  writeFileSync(join(legacyPaths.profile, 'desktop-packages.json'), JSON.stringify({ schemaVersion: 1, packages }))
  writeFileSync(join(legacyPaths.profile, 'package.json'), JSON.stringify({
    name: '@deepseek-ai/dsh-desktop-runtime', private: true, version: '0.0.0',
    dependencies: { ...Object.fromEntries(packages.map(entry => [entry.name, `file:./desktop-packages/${entry.file}`])),
      '@zaimokuza/dsh-acp-adapter': '0.1.5-rc.2.5', '@zaimokuza/dsh-plugin-hub': '0.2.1' },
    dsh: { desktop: { agentTeams: false }, profile: { bundles: [
      '@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', ...DESKTOP_PORTABLE_PLUGINS.map(plugin => plugin.name),
    ] } },
  }))
  const upgrade = new DesktopProjectManager(legacyPaths, runtime)
  assert.equal(await upgrade.applyRelease(), true)
  assert.equal(upgrade.agentTeamsEnabled(), false)
  const migrated = JSON.parse(readFileSync(join(legacyPaths.profile, 'package.json'), 'utf8')) as { dependencies: Record<string, string> }
  assert.deepEqual(migrated.dependencies, Object.fromEntries(DESKTOP_PORTABLE_PLUGINS.map(plugin => [plugin.name, plugin.version])))
  assert.equal(await upgrade.applyRelease(), false)
  console.log('Packaged legacy profile migration: retired tarballs removed offline; disabled Teams preserved')
  unsubscribe('child_process', childDiagnostic)
  for (const truncated of [false, true]) {
    progress(`checking request-pipe EOF before IPC shutdown (truncated=${String(truncated)})`)
    const child = spawn(runtime.node, [join(runtime.dsh, 'node_modules', '@deepseek-ai', 'dsh-desktop-host', 'lib', 'index.js'), runtime.dsh, paths.profile], {
      cwd: paths.profile, stdio: ['ignore', 'pipe', 'pipe', 'pipe', 'pipe', 'ipc'],
    })
    children.add(child)
    const closed = once(child, 'close')
    const fatal: string[] = []
    const ready = Promise.withResolvers<void>()
    child.on('message', (message: { type: string; message?: string }) => {
      if (message.type === 'ready') ready.resolve()
      if (message.type === 'fatal') { fatal.push(message.message ?? 'fatal'); ready.reject(new Error(message.message)) }
    })
    child.once('error', ready.reject)
    child.once('exit', () => { ready.reject(new Error('Host exited before readiness')) })
    child.stdout!.resume()
    child.stderr!.pipe(process.stderr, { end: false })
    try {
      await ready.promise
      const pipe = child.stdio[3]
      assert(pipe instanceof Writable)
      // Deliberately send no IPC shutdown: EOF wins deterministically.
      pipe.end(truncated ? Buffer.from([0x44]) : undefined)
      const [code, signal] = await closed
      assert.equal(code, truncated ? 1 : 0)
      assert.equal(signal, null)
      assert.equal(fatal.length, truncated ? 1 : 0)
    } finally {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
      await closed
      children.delete(child)
    }
  }
  console.log('Packaged offline install, host boot, frontend assets, Agent Teams, ACP adapter, Plugin Hub and Office: passed')
} finally {
  await host?.stop()
  clearTimeout(timeout)
  unsubscribe('child_process', childDiagnostic)
  rmSync(home, { recursive: true, force: true })
  if (archive !== undefined) rmSync(artifacts, { recursive: true, force: true })
}
