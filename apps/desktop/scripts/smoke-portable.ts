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
import { resolveDesktopPaths } from '../src/paths.ts'
import { desktopTargetBuildPaths } from './desktop-build-paths.mjs'

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
      assert.deepEqual(installed.dsh.profile.bundles, expected.bundles)
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
      progress('stopping the staged host')
      await host.stop()
      host = undefined
    },
    beforeActivate: async () => { progress('activating the installed profile') },
    afterActivate: async () => { progress('checking the active plugin inventory') },
  })
  assert.deepEqual(manager.listPlugins(), [{ name: '@zaimokuza/dsh-acp-adapter', version: '0.1.5-rc.2.1' }])
  console.log('Packaged offline install, host boot, frontend asset, Agent Teams and ACP adapter: passed')
} finally {
  clearTimeout(timeout)
  unsubscribe('child_process', childDiagnostic)
  await host?.stop()
  rmSync(home, { recursive: true, force: true })
  if (archive !== undefined) rmSync(artifacts, { recursive: true, force: true })
}
