/** Exercise the packaged seed and bundled Node with an empty, disposable offline profile. */
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DesktopProjectManager } from '../src/project-manager.ts'
import { DesktopHostProcess } from '../src/host-process.ts'
import { resolveDesktopPaths } from '../src/paths.ts'
import { desktopTargetBuildPaths } from './desktop-build-paths.mjs'

const target = process.argv[2]
if (target !== 'mac-arm64' && target !== 'win-x64') throw new Error('Expected mac-arm64 or win-x64')
const artifacts = desktopTargetBuildPaths(target).artifacts
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
const timeout = setTimeout(() => { console.error('Packaged host smoke timed out'); process.exit(1) }, 180_000)
try {
  await manager.applyRelease(seed, release.distributionVersion, {
    healthCheck: async (project) => {
      host = new DesktopHostProcess(runtime.node, project)
      const ready = await host.start()
      assert.equal(ready.dshVersion, '0.1.5-alpha.2')
      const response = await host.fetch(new Request('dsh-app://app/index.html'))
      assert.equal(response.status, 200)
      assert.match(await response.text(), /<html/u)
      await host.stop()
      host = undefined
    },
    beforeActivate: async () => {},
    afterActivate: async () => {},
  })
  assert.deepEqual(manager.listPlugins(), [{ name: '@zaimokuza/dsh-acp-adapter', version: '0.1.5-alpha.2' }])
  console.log('Packaged offline install, host boot, frontend asset and ACP adapter: passed')
} finally {
  clearTimeout(timeout)
  await host?.stop()
  rmSync(home, { recursive: true, force: true })
}
