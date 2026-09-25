/** Exercise the packaged seed and bundled Node with an empty, disposable offline profile. */
import assert from 'node:assert/strict'
import { spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { subscribe, unsubscribe } from 'node:diagnostics_channel'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import extractZip from '@electron-internal/extract-zip'
import { readAsar } from 'app-builder-lib/out/asar/asar.js'
import { DesktopProjectManager } from '../src/project-manager.ts'
import { DesktopHostProcess } from '../src/host-process.ts'
import { authenticateWebHost, forwardWebRequest } from '../src/web-document.ts'
import { DESKTOP_AGENT_TEAM_BUNDLES } from '../src/profile-defaults.ts'
import { readDesktopRuntime, type DesktopRuntimeDescriptor } from '../src/runtime-tree.ts'
import { resolveDesktopPaths } from '../src/paths.ts'
import { desktopTargetBuildPaths } from './desktop-build-paths.mjs'
import { DESKTOP_PORTABLE_PLUGINS } from '../src/portable-plugins.ts'
import { smokeDesktopRuntime } from './smoke-runtime.ts'
import { verifyRuntimeArchive } from './verify-runtime-archive.ts'
import { assertPackagedWindowsTrayIcon } from './verify-packaged-tray-icon.ts'

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
  try {
    if (target === 'win-x64') assertPackagedWindowsTrayIcon(resources)
    // Inspect the physical archive under Node before Electron installs its ASAR filesystem hooks.
    console.log('Packaged smoke: verifying final ASAR bytes against the prepared runtime inventory')
    const archivePath = join(resources, 'app.asar')
    const inventory = JSON.parse((await (await readAsar(archivePath)).readFile(join('dsh', 'desktop-runtime.json'))).toString()) as DesktopRuntimeDescriptor
    await verifyRuntimeArchive(archivePath, inventory)
    const child = spawn(executable, ['--expose-internals', '--import', 'tsx/esm', import.meta.filename, target], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', DSH_DESKTOP_SMOKE_RESOURCES: resources }, stdio: 'inherit',
    })
    const [code, signal] = await once(child, 'exit')
    assert.equal(signal, null)
    assert.equal(code, 0)
  } finally {
    if (archive !== undefined) rmSync(artifacts, { recursive: true, force: true })
  }
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
  nodeBin: join(packagedResources, 'runtime', 'bin'),
  pnpm: join(packagedResources, 'runtime', 'pnpm', 'bin', 'pnpm.mjs'),
  dsh: join(packagedResources, 'app.asar', 'dsh'),
  pluginSeed: join(packagedResources, 'plugin-seed'),
}
const paths = resolveDesktopPaths(home)
const manager = new DesktopProjectManager(paths, runtime)
let host: DesktopHostProcess | undefined
let hostUrl = ''
let hostCookie = ''
const request = (input: Request): Promise<Response> => forwardWebRequest(input, hostUrl, hostCookie)
async function startHost(): Promise<void> {
  host = new DesktopHostProcess(runtime.node, runtime.dsh, paths.profile, undefined, process.env, undefined,
    join(packagedResources, 'runtime', 'primary-runtime'), runtime)
  const ready = await host.start()
  hostUrl = ready.url
  hostCookie = await authenticateWebHost(hostUrl)
}
async function rpc<T>(method: string, payload: unknown = {}): Promise<T> {
  const response = await request(new Request(`dsh-app://app/api/${method}`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'client-request', rpcId: 'portable-smoke', method, payload: { args: payload } }),
  }))
  assert.equal(response.status, 200)
  const result = await response.json() as { result: { ok: boolean; value: T } }
  assert.equal(result.result.ok, true, JSON.stringify(result))
  return result.result.value
}
interface Bundle { name: string; version?: string; enabled: boolean; error?: unknown }
async function assertBundles(): Promise<void> {
  const bundles = await rpc<Bundle[]>('pluginManager/listBundles')
  for (const plugin of DESKTOP_PORTABLE_PLUGINS) {
    const bundle = bundles.find(item => item.name === plugin.name)
    assert.equal(bundle?.version, plugin.version)
    assert.equal(bundle.enabled, true)
    assert.equal(bundle.error, undefined)
  }
  assert.equal(bundles.some(item => item.name === '@zaimokuza/dsh-plugin-hub'), false)
}
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
  const response = await request(new Request('dsh-app://app/api/dshOffice/snapshot', {
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
  // Use the final resource directory selected for this packaged Electron process,
  // including the temporary extraction passed by the ZIP replay path.
  if (target === 'win-x64') assertPackagedWindowsTrayIcon(packagedResources)
  progress('converting Office documents and resolving the skill CLI from the final ASAR')
  await smokeDesktopRuntime(runtime.dsh, runtime.node, readDesktopRuntime(runtime.dsh), process.env,
    join(packagedResources, 'runtime'))
  progress('installing the packaged seed')
  for (const plugin of DESKTOP_PORTABLE_PLUGINS) {
    assert.ok(existsSync(join(runtime.pluginSeed, 'node_modules', plugin.name, 'package.json')),
      `Packaged seed is missing ${plugin.name}; include plugin-seed/node_modules explicitly`)
  }
  for (const file of ['LICENSE', 'THIRD_PARTY_NOTICES.md', 'vendor/munder/LICENSE', 'vendor/the-office/LICENSE', 'vendor/three/LICENSE', 'lib/THIRD_PARTY_LICENSES.txt']) {
    assert.ok(existsSync(join(runtime.pluginSeed, 'node_modules', '@zaimokuza/dsh-agent-teams-office', file)), `Missing Office notice ${file}`)
  }
  const firstStart = performance.now()
  await manager.applyRelease(true)
  writeFileSync(join(paths.profile, 'cordis.patch.yml'), '- id: webserver\n  config:\n    host: 127.0.0.1\n    port: 0\n')
  const prepared = performance.now()
  const metadata = spawn(runtime.node, ['--expose-internals', join(import.meta.dirname, '../tests/fixtures/plugin-metadata-smoke.mjs'), runtime.dsh, paths.profile], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit',
  })
  const [metadataCode, metadataSignal] = await once(metadata, 'exit')
  assert.equal(metadataSignal, null)
  assert.equal(metadataCode, 0, 'Final plugin metadata must register on the packaged host and client registry')
  const devinConfig = spawn(runtime.node, ['--expose-internals', join(import.meta.dirname, '../tests/fixtures/devin-config-smoke.mjs'), runtime.dsh, paths.profile], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit',
  })
  const [devinCode, devinSignal] = await once(devinConfig, 'exit')
  assert.equal(devinSignal, null)
  assert.equal(devinCode, 0, 'Packaged Devin config must support ordinary Windows users and preserve original files')
  const hostStart = performance.now()
  await startHost()
  assert.equal(readDesktopRuntime(runtime.dsh).release.version, '0.1.7-rc.2')
  const response = await request(new Request('dsh-app://app/index.html'))
  assert.equal(response.status, 200)
  const html = await response.text()
  assert.match(html, /<html/u)
  console.log(JSON.stringify({ firstPreparationMs: prepared - firstStart,
    firstReadyMs: prepared - firstStart + performance.now() - hostStart, metadataProbeMs: hostStart - prepared }))
  const graph = JSON.parse(html.match(/globalThis\["__DSH_BOOT__"\] = (.*?)<\/script>/u)![1]!) as { entries: { id: string; url: string }[] }
  for (const name of [...DESKTOP_PORTABLE_PLUGINS.map(plugin => plugin.name), '@deepseek-ai/dsh-experimental-client-ui-agent-team']) {
    const entry = graph.entries.find(item => item.id === name)
    assert.ok(entry, `Missing client module ${name}`)
    const client = await request(new Request(new URL(entry.url, 'dsh-app://app')))
    assert.equal(client.status, 200)
    assert.ok((await client.text()).length > 0)
  }
  const acpRpc = await request(new Request('dsh-app://app/api/dshAcp/health', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'client-request', rpcId: 'acp-smoke', method: 'dshAcp/health', payload: { args: {} } }),
  }))
  assert.equal(acpRpc.status, 200)
  const acpResult = await acpRpc.json() as { result: { ok: boolean; value?: { providers: unknown[] } } }
  assert.equal(acpResult.result.ok, true, JSON.stringify(acpResult))
  assert.ok(Array.isArray(acpResult.result.value?.providers), 'ACP health must execute successfully')
  await assertOfficeState('unselected')
  await assertBundles()
  await host!.stop()
  host = undefined
  const warmStart = performance.now()
  await manager.applyRelease(true)
  await startHost()
  console.log(JSON.stringify({ warmReadyMs: performance.now() - warmStart }))
  for (const enabled of [false, true]) {
    progress(`switching native Teams ${enabled ? 'on' : 'off'} without registry access`)
    for (const name of enabled ? DESKTOP_AGENT_TEAM_BUNDLES : [...DESKTOP_AGENT_TEAM_BUNDLES].reverse()) {
      const changed = await rpc<{ error?: unknown }>('pluginManager/setBundleEnabled', { name, enabled })
      assert.equal(changed.error, undefined, JSON.stringify(changed))
    }
    const bundles = await rpc<Bundle[]>('pluginManager/listBundles')
    for (const name of DESKTOP_AGENT_TEAM_BUNDLES) assert.equal(bundles.find(item => item.name === name)?.enabled, enabled)
    await assertOfficeState(enabled ? 'unselected' : 'disabled')
    await assertBundles()
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
  await upgrade.applyRelease(true)
  const migrated = JSON.parse(readFileSync(join(legacyPaths.profile, 'package.json'), 'utf8')) as { dependencies: Record<string, string> }
  assert.deepEqual(migrated.dependencies, Object.fromEntries(DESKTOP_PORTABLE_PLUGINS.map(plugin => [plugin.name, plugin.version])))
  await upgrade.applyRelease(true)
  console.log('Packaged legacy profile migration: retired tarballs removed offline; disabled Teams preserved')
  const state = JSON.parse(readFileSync(join(legacyPaths.profile, 'package.json'), 'utf8')) as { dsh: { profile: { bundles: string[] } } }
  assert.equal(state.dsh.profile.bundles.some(name => DESKTOP_AGENT_TEAM_BUNDLES.some(team => team === name)), false)
  console.log('Native plugin manager, offline Teams toggles, migration and packaged ACP/Office checks passed')
} finally {
  await host?.stop()
  clearTimeout(timeout)
  unsubscribe('child_process', childDiagnostic)
  rmSync(home, { recursive: true, force: true })
  if (archive !== undefined) rmSync(artifacts, { recursive: true, force: true })
}
