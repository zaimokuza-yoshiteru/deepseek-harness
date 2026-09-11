import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, relative, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { resolveDesktopPaths } from '../src/paths.ts'
import {
  createSeedMetadata,
  DesktopProjectManager,
  packageNameFromSpec,
  verifySeedIntegrity,
  type DesktopPluginRecord,
  type DesktopProjectHooks,
} from '../src/project-manager.ts'
import { DESKTOP_HOST_PROTOCOL_VERSION } from '../src/host-protocol.ts'
import { DESKTOP_PACKAGES_DIR, DESKTOP_PACKAGE_SET_FILE } from '../src/core-package-set.ts'
import type { DesktopRelease } from '../src/release.ts'
import { archivePnpmStore } from '../src/seed-store.ts'

const roots: string[] = []
const releaseWorkers: Array<() => Promise<void>> = []

function temporaryRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'dsh-desktop-test-'))
  roots.push(root)
  return root
}

function writeIntegrity(seed: string): void {
  const paths: string[] = []
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) visit(path)
      else if (entry.name !== 'integrity.json') paths.push(path)
    }
  }
  visit(seed)
  const files = paths.sort().map((path) => {
    const body = readFileSync(path)
    return {
      path: relative(seed, path).split(sep).join('/'),
      bytes: statSync(path).size,
      sha256: createHash('sha256').update(body).digest('hex'),
    }
  })
  writeFileSync(join(seed, 'integrity.json'), `${JSON.stringify({ schemaVersion: 2, files })}\n`)
}

function archiveStore(seed: string): void {
  const store = join(seed, 'store')
  mkdirSync(store, { recursive: true })
  if (readdirSync(store).length === 0) writeFileSync(join(store, 'test-entry'), 'content')
  archivePnpmStore(seed, store)
}

function writeCorePackageSet(seed: string, version: string): void {
  const packages = [
    { name: '@deepseek-ai/dsh', file: `deepseek-ai-dsh-${version}.tgz`, body: Buffer.from(`dsh-${version}`) },
    {
      name: '@deepseek-ai/dsh-desktop-host',
      file: `deepseek-ai-dsh-desktop-host-${version}.tgz`,
      body: Buffer.from(`desktop-host-${version}`),
    },
  ]
  mkdirSync(join(seed, DESKTOP_PACKAGES_DIR), { recursive: true })
  for (const entry of packages) writeFileSync(join(seed, DESKTOP_PACKAGES_DIR, entry.file), entry.body)
  writeFileSync(join(seed, DESKTOP_PACKAGE_SET_FILE), `${JSON.stringify({
    schemaVersion: 1,
    packages: packages.map(({ name, file, body }) => ({
      name,
      version,
      file,
      bytes: body.byteLength,
      integrity: `sha512-${createHash('sha512').update(body).digest('base64')}`,
    })),
  })}\n`)
}

function createTestSeedMetadata(seed: string, desktopRelease: DesktopRelease, plugins: readonly DesktopPluginRecord[] = []): void {
  writeCorePackageSet(seed, desktopRelease.version)
  createSeedMetadata(seed, desktopRelease, plugins)
}

function writeFakePnpm(root: string): string {
  const path = join(root, 'pnpm.mjs')
  writeFileSync(path, String.raw`
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
const args = process.argv.slice(2)
const project = process.cwd()
const command = args.find(value => value === 'install' || value === 'add' || value === 'remove')
const manifestPath = join(project, 'package.json')
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
const packageName = spec => spec.startsWith('@')
  ? spec.slice(0, spec.indexOf('@', spec.indexOf('/') + 1) === -1 ? undefined : spec.indexOf('@', spec.indexOf('/') + 1))
  : spec.split('@')[0]
const packageVersion = spec => {
  const index = spec.startsWith('@') ? spec.indexOf('@', spec.indexOf('/') + 1) : spec.indexOf('@')
  return index === -1 ? '1.0.0' : spec.slice(index + 1)
}

if (command === 'add') {
  const spec = args[args.indexOf('add') + 1]
  manifest.dependencies[packageName(spec)] = packageVersion(spec)
}
if (command === 'remove') delete manifest.dependencies[args[args.indexOf('remove') + 1]]
writeFileSync(manifestPath, JSON.stringify(manifest))
rmSync(join(project, 'node_modules'), { recursive: true, force: true })
for (const [name, version] of Object.entries(manifest.dependencies)) {
  const packageRoot = join(project, 'node_modules', ...name.split('/'))
  mkdirSync(packageRoot, { recursive: true })
  const core = name === '@deepseek-ai/dsh' || name === '@deepseek-ai/dsh-desktop-host'
  const plugin = !core
  const installedVersion = plugin
    ? version
    : JSON.parse(readFileSync(join(project, 'desktop-release.json'), 'utf8')).version
  writeFileSync(join(packageRoot, 'package.json'), JSON.stringify({
    name, version: installedVersion,
    ...(plugin ? { dsh: { bundle: { patch: './bundle.yml' } } } : {}),
  }))
  if (plugin) writeFileSync(join(packageRoot, 'bundle.yml'), '[]\n')
  else if (name === '@deepseek-ai/dsh-desktop-host') {
    mkdirSync(join(packageRoot, 'lib'), { recursive: true })
    writeFileSync(join(packageRoot, 'lib', 'index.js'), '')
  }
}
writeFileSync(join(project, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n')
if (process.env.TEST_PNPM_LOG) writeFileSync(process.env.TEST_PNPM_LOG, JSON.stringify({ args, env: process.env }))
`)
  return path
}

function writeBlockingFakePnpm(root: string, ready: string, release: string): string {
  const path = join(root, 'blocking-pnpm.mjs')
  const delegate = writeFakePnpm(root)
  writeFileSync(path, `
import { existsSync, writeFileSync } from 'node:fs'
import { setTimeout as sleep } from 'node:timers/promises'
writeFileSync(${JSON.stringify(ready)}, String(process.pid))
while (!existsSync(${JSON.stringify(release)})) await sleep(10)
await import(${JSON.stringify(pathToFileURL(delegate).href)})
`)
  return path
}

function hooks(overrides: Partial<DesktopProjectHooks> = {}): DesktopProjectHooks {
  return {
    healthCheck: async () => {},
    beforeActivate: async () => {},
    afterActivate: async () => {},
    ...overrides,
  }
}

function release(version = '1.0.0'): DesktopRelease {
  return {
    schemaVersion: 1,
    version,
    hostProtocolVersion: DESKTOP_HOST_PROTOCOL_VERSION,
    nodeVersion: '24.17.0',
    pnpmVersion: '11.7.0',
  }
}

afterEach(async () => {
  const cleanups = releaseWorkers.splice(0)
  const directories = roots.splice(0)
  const results = await Promise.allSettled(cleanups.map(cleanup => cleanup()))
  for (const root of directories) rmSync(root, { recursive: true, force: true })
  const failures: unknown[] = results.flatMap((result): unknown[] => result.status === 'rejected' ? [result.reason] : [])
  if (failures.length > 0) throw new AggregateError(failures, 'desktop worker cleanup failed')
})

describe('desktop package policy', () => {
  it('accepts registry package specs but rejects alternate sources and flags', () => {
    expect(packageNameFromSpec('@scope/plugin@1.2.3')).toBe('@scope/plugin')
    expect(packageNameFromSpec('plugin@next')).toBe('plugin')
    expect(() => packageNameFromSpec('file:../plugin')).toThrow(/unsupported npm package spec/u)
    expect(() => packageNameFromSpec('--registry=evil')).toThrow(/unsupported npm package spec/u)
    expect(() => packageNameFromSpec('https://example.test/plugin.tgz')).toThrow(/unsupported npm package spec/u)
  })

  it('rejects any seed content changed after release inventory generation', () => {
    const seed = join(temporaryRoot(), 'seed')
    createTestSeedMetadata(seed, release())
    writeFileSync(join(seed, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n')
    writeIntegrity(seed)
    expect(() => { verifySeedIntegrity(seed) }).not.toThrow()
    writeFileSync(join(seed, 'package.json'), '{}\n')
    expect(() => { verifySeedIntegrity(seed) }).toThrow(/integrity verification failed/u)
  })
})

describe('desktop project transactions', () => {
  it('switches Teams offline, retains packages and plugins, and preserves disabled state through upgrades', async () => {
    const root = temporaryRoot()
    const seed = join(root, 'seed')
    const paths = resolveDesktopPaths(join(root, 'home'))
    const runtime = { node: process.execPath, pnpm: writeFakePnpm(root) }
    const manager = new DesktopProjectManager(paths, runtime)
    const base = release('0.1.5-rc.2')
    const adapter = { name: '@zaimokuza/dsh-acp-adapter', version: '0.1.5-rc.2.1' }
    createTestSeedMetadata(seed, { ...base, distributionVersion: '0.1.5-rc.2.1' }, [adapter])
    archiveStore(seed)
    writeIntegrity(seed)
    await manager.applyRelease(seed, '0.1.5-rc.2.1', hooks())
    await manager.mutate({ type: 'plugin-add', spec: '@scope/plugin@2.0.0' }, hooks())
    const manifestPath = join(paths.profile, 'package.json')
    const readManifest = () => JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      dependencies: Record<string, string>
      dsh: { desktop?: { agentTeams: boolean }; profile: { bundles: string[] } }
    }
    const before = readManifest()
    const log = join(root, 'pnpm-log.json')
    const previousLog = process.env.TEST_PNPM_LOG
    process.env.TEST_PNPM_LOG = log
    try {
      expect(manager.agentTeamsEnabled()).toBe(true)
      await manager.mutate({ type: 'agent-teams', enabled: false }, hooks())
      expect(new DesktopProjectManager(paths, runtime).agentTeamsEnabled()).toBe(false)
      expect(readManifest().dependencies).toEqual(before.dependencies)
      const expected = JSON.parse(readFileSync(new URL('./expected/teams-disabled.json', import.meta.url), 'utf8')) as unknown
      expect(readManifest().dsh).toEqual(expected)
      const invocation = JSON.parse(readFileSync(log, 'utf8')) as { args: string[] }
      expect(invocation.args).toEqual(expect.arrayContaining(['install', '--offline', '--frozen-lockfile']))
      expect(invocation.args).not.toContain('remove')

      await expect(manager.mutate({ type: 'agent-teams', enabled: true }, hooks({
        healthCheck: async () => { throw new Error('probe rejected Teams') },
      }))).rejects.toThrow('probe rejected Teams')
      expect(manager.agentTeamsEnabled()).toBe(false)
      await manager.mutate({ type: 'plugin-update', name: '@scope/plugin', version: '2.1.0' }, hooks())
      expect(manager.agentTeamsEnabled()).toBe(false)
      await expect(manager.mutate({
        type: 'plugin-add', spec: '@deepseek-ai/dsh-experimental-agent-team-profile@0.1.5-rc.2',
      }, hooks())).rejects.toThrow('use the Agent Teams switch')

      createSeedMetadata(seed, { ...base, distributionVersion: '0.1.5-rc.2.2' }, [adapter])
      writeIntegrity(seed)
      await manager.applyRelease(seed, '0.1.5-rc.2.2', hooks())
      expect(manager.agentTeamsEnabled()).toBe(false)
      expect(manager.listPlugins()).toEqual([adapter, { name: '@scope/plugin', version: '2.1.0' }])
      await manager.mutate({ type: 'agent-teams', enabled: true }, hooks())
      expect(manager.agentTeamsEnabled()).toBe(true)
      expect(readManifest().dsh.profile.bundles).toEqual([
        ...before.dsh.profile.bundles.slice(0, 4), adapter.name, '@scope/plugin',
      ])
      const enabledInvocation = JSON.parse(readFileSync(log, 'utf8')) as { args: string[] }
      expect(enabledInvocation.args).toEqual(expect.arrayContaining(['install', '--offline', '--frozen-lockfile']))
    } finally {
      if (previousLog === undefined) delete process.env.TEST_PNPM_LOG
      else process.env.TEST_PNPM_LOG = previousLog
    }
  })

  it('installs the offline seed and reconciles a mismatched private Host', async () => {
    const root = temporaryRoot()
    const seed = join(root, 'seed')
    const log = join(root, 'pnpm-log.json')
    createTestSeedMetadata(seed, release())
    writeFileSync(join(seed, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n')
    mkdirSync(join(seed, 'store'), { recursive: true })
    writeFileSync(join(seed, 'store', 'seed-entry'), 'content')
    archiveStore(seed)
    writeIntegrity(seed)
    const paths = resolveDesktopPaths(join(root, '.dsh'))
    const manager = new DesktopProjectManager(paths, { node: process.execPath, pnpm: writeFakePnpm(root) })
    const previousLog = process.env.TEST_PNPM_LOG
    const previousRegistry = process.env.npm_config_registry
    process.env.TEST_PNPM_LOG = log
    process.env.npm_config_registry = 'https://user-registry.invalid'
    try {
      await expect(manager.applyRelease(seed, '2.0.0', hooks())).rejects.toThrow(/does not match Electron/u)
      await manager.applyRelease(seed, '1.0.0', hooks())
      expect(readFileSync(join(paths.pnpm.store, 'seed-entry'), 'utf8')).toBe('content')
      writeFileSync(join(paths.pnpm.store, 'plugin-store-entry'), 'installed plugin')
      writeFileSync(
        join(paths.profile, 'node_modules', '@deepseek-ai', 'dsh-desktop-host', 'package.json'),
        '{"name":"@deepseek-ai/dsh-desktop-host","version":"0.9.0"}\n',
      )
      await expect(manager.applyRelease(seed, '1.0.0', hooks())).resolves.toBe(true)
      expect(readFileSync(join(paths.pnpm.store, 'plugin-store-entry'), 'utf8')).toBe('installed plugin')
    } finally {
      if (previousLog === undefined) delete process.env.TEST_PNPM_LOG
      else process.env.TEST_PNPM_LOG = previousLog
      if (previousRegistry === undefined) delete process.env.npm_config_registry
      else process.env.npm_config_registry = previousRegistry
    }
    expect(manager.dshVersion()).toBe('1.0.0')
    expect(manager.releaseVersion()).toBe('1.0.0')
    expect(paths.profile).toBe(join(root, '.dsh', 'profiles', 'desktop'))
    expect(existsSync(join(paths.profile, 'node_modules', '@deepseek-ai', 'dsh'))).toBe(true)
    const installedHost = JSON.parse(readFileSync(
      join(paths.profile, 'node_modules', '@deepseek-ai', 'dsh-desktop-host', 'package.json'),
      'utf8',
    )) as { version: string }
    expect(installedHost.version).toBe('1.0.0')
    expect(existsSync(join(paths.profile, 'desktop-plugins.json'))).toBe(false)
    expect(readFileSync(join(paths.pnpm.store, 'seed-entry'), 'utf8')).toBe('content')
    const invocation = JSON.parse(readFileSync(log, 'utf8')) as { args: string[]; env: Record<string, string> }
    expect(invocation.args).toContain('--offline')
    expect(invocation.args).toContain('--trust-lockfile')
    expect(invocation.args).toContain(`--config.store-dir=${paths.pnpm.store}`)
    expect(invocation.args).toContain('--config.enable-global-virtual-store=false')
    expect(invocation.args.some(arg => arg.startsWith('--config.registry='))).toBe(false)
    expect(invocation.env.NPM_CONFIG_REGISTRY).toBeUndefined()
    expect(invocation.env.NPM_CONFIG_STORE_DIR).toBe(paths.pnpm.store)
    expect(invocation.env.npm_config_userconfig).toBe(process.env.npm_config_userconfig ?? process.env.NPM_CONFIG_USERCONFIG ?? join(homedir(), '.npmrc'))
    expect(invocation.env.npm_config_registry).toBe('https://user-registry.invalid')
  })

  it('reinstalls a new desktop build on the same pinned DSH base', async () => {
    const root = temporaryRoot()
    const seed = join(root, 'seed')
    const paths = resolveDesktopPaths(join(root, 'home'))
    const manager = new DesktopProjectManager(paths, { node: process.execPath, pnpm: writeFakePnpm(root) })
    const base = release('0.1.5-alpha.2')
    createTestSeedMetadata(seed, { ...base, distributionVersion: '0.1.5-alpha.2.1' })
    archiveStore(seed)
    writeIntegrity(seed)
    await expect(manager.applyRelease(seed, '0.1.5-alpha.2.1', hooks())).resolves.toBe(true)
    await expect(manager.applyRelease(seed, '0.1.5-alpha.2.1', hooks())).resolves.toBe(false)
    createSeedMetadata(seed, { ...base, distributionVersion: '0.1.5-alpha.2.2' })
    writeIntegrity(seed)
    await expect(manager.applyRelease(seed, '0.1.5-alpha.2.2', hooks())).resolves.toBe(true)
    expect(manager.dshVersion()).toBe('0.1.5-alpha.2')
  })

  it.each([false, true])('upgrades the bundled adapter from alpha to rc while preserving extra plugins: %s', async (extraPlugin) => {
    const root = temporaryRoot()
    const paths = resolveDesktopPaths(join(root, 'home'))
    const manager = new DesktopProjectManager(paths, { node: process.execPath, pnpm: writeFakePnpm(root) })
    const adapter = '@zaimokuza/dsh-acp-adapter'
    const oldSeed = join(root, 'alpha-seed')
    createTestSeedMetadata(oldSeed, {
      ...release('0.1.5-alpha.2'), distributionVersion: '0.1.5-alpha.2.2',
    }, [{ name: adapter, version: '0.1.5-alpha.2' }])
    archiveStore(oldSeed)
    writeIntegrity(oldSeed)
    await manager.applyRelease(oldSeed, '0.1.5-alpha.2.2', hooks())
    if (extraPlugin) await manager.mutate({ type: 'plugin-add', spec: '@scope/plugin@2.0.0' }, hooks())
    expect(readFileSync(join(paths.profile, 'pnpm-workspace.yaml'), 'utf8')).toContain(`${adapter}@0.1.5-alpha.2`)

    const nextSeed = join(root, 'rc-seed')
    createTestSeedMetadata(nextSeed, {
      ...release('0.1.5-rc.1'), distributionVersion: '0.1.5-rc.1.1',
    }, [{ name: adapter, version: '0.1.5-rc.1' }])
    archiveStore(nextSeed)
    writeIntegrity(nextSeed)
    await expect(manager.applyRelease(nextSeed, '0.1.5-rc.1.1', hooks())).resolves.toBe(true)
    expect(manager.dshVersion()).toBe('0.1.5-rc.1')
    expect(manager.listPlugins()).toEqual([
      { name: adapter, version: '0.1.5-rc.1' },
      ...(extraPlugin ? [{ name: '@scope/plugin', version: '2.0.0' }] : []),
    ])
    expect(readFileSync(join(paths.profile, 'pnpm-workspace.yaml'), 'utf8')).toContain(`${adapter}@0.1.5-rc.1`)
    await expect(manager.applyRelease(nextSeed, '0.1.5-rc.1.1', hooks())).resolves.toBe(false)
  })

  it.each([
    ['0.1.5-alpha.2', false], ['0.1.5-rc.1', false], ['0.1.5-rc.1', true],
  ] as const)('enables Teams when upgrading %s (previously installed: %s) and preserves extra plugins', async (base, hadTeams) => {
    const root = temporaryRoot()
    const paths = resolveDesktopPaths(join(root, 'home'))
    const manager = new DesktopProjectManager(paths, { node: process.execPath, pnpm: writeFakePnpm(root) })
    const adapter = '@zaimokuza/dsh-acp-adapter'
    const seed = join(root, 'old-seed')
    createTestSeedMetadata(seed, release(base), [
      { name: adapter, version: base },
      ...(hadTeams ? [
        { name: '@deepseek-ai/dsh-experimental-agent-team-profile', version: base },
        { name: '@deepseek-ai/dsh-experimental-agent-team-web-profile', version: base },
      ] : []),
    ])
    archiveStore(seed)
    writeIntegrity(seed)
    await manager.applyRelease(seed, base, hooks())
    await manager.mutate({ type: 'plugin-add', spec: '@scope/plugin@2.0.0' }, hooks())
    const nextSeed = join(root, 'teams-seed')
    createTestSeedMetadata(nextSeed, {
      ...release('0.1.5-rc.2'), distributionVersion: '0.1.5-rc.2.1',
    }, [{ name: adapter, version: '0.1.5-rc.2.1' }])
    archiveStore(nextSeed)
    writeIntegrity(nextSeed)
    await manager.applyRelease(nextSeed, '0.1.5-rc.2.1', hooks())
    const installed = JSON.parse(readFileSync(join(paths.profile, 'package.json'), 'utf8')) as { dsh: { profile: { bundles: string[] } } }
    const expected = JSON.parse(readFileSync(new URL('./expected/rc2-profile.json', import.meta.url), 'utf8')) as { bundles: string[] }
    expect(installed.dsh.profile.bundles).toEqual([...expected.bundles, '@scope/plugin'])
    expect(manager.listPlugins()).toEqual([
      { name: adapter, version: '0.1.5-rc.2.1' },
      { name: '@scope/plugin', version: '2.0.0' },
    ])
    expect(readFileSync(join(paths.profile, 'pnpm-workspace.yaml'), 'utf8')).toContain(`${adapter}@0.1.5-rc.2.1`)
    await manager.mutate({ type: 'plugin-remove', name: '@scope/plugin' }, hooks())
    const afterRemove = JSON.parse(readFileSync(join(paths.profile, 'package.json'), 'utf8')) as { dsh: { profile: { bundles: string[] } } }
    expect(afterRemove.dsh.profile.bundles).toEqual(expected.bundles)
    await expect(manager.applyRelease(nextSeed, '0.1.5-rc.2.1', hooks())).resolves.toBe(false)
  })

  it('restores the active project when the replacement backend cannot start', async () => {
    const root = temporaryRoot()
    const seed = join(root, 'seed')
    createTestSeedMetadata(seed, release())
    writeFileSync(join(seed, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n')
    archiveStore(seed)
    writeIntegrity(seed)
    const paths = resolveDesktopPaths(join(root, '.dsh'))
    const manager = new DesktopProjectManager(paths, { node: process.execPath, pnpm: writeFakePnpm(root) })
    await manager.applyRelease(seed, '1.0.0', hooks())
    let starts = 0
    await expect(manager.mutate({ type: 'plugin-add', spec: '@scope/plugin@2.0.0' }, hooks({
      afterActivate: async () => {
        starts += 1
        if (starts === 1) throw new Error('backend rejected staged graph')
      },
    }))).rejects.toThrow(/backend rejected staged graph/u)
    expect(manager.listPlugins()).toEqual([])
    expect(manager.dshVersion()).toBe('1.0.0')
    expect(starts).toBe(2)
  })

  it('restores rollback when the active move completed before its journal update', async () => {
    const root = temporaryRoot()
    const seed = join(root, 'seed')
    createTestSeedMetadata(seed, release())
    writeFileSync(join(seed, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n')
    archiveStore(seed)
    writeIntegrity(seed)
    const paths = resolveDesktopPaths(join(root, '.dsh'))
    const manager = new DesktopProjectManager(paths, { node: process.execPath, pnpm: writeFakePnpm(root) })
    await manager.applyRelease(seed, '1.0.0', hooks())
    await manager.mutate({ type: 'plugin-add', spec: '@scope/plugin@2.0.0' }, hooks())
    const stagingProfile = join(paths.staging, 'interrupted', 'profile')
    mkdirSync(stagingProfile, { recursive: true })
    writeFileSync(join(stagingProfile, 'marker'), 'staging')
    rmSync(paths.rollback, { recursive: true, force: true })
    mkdirSync(dirname(paths.rollback), { recursive: true })
    renameSync(paths.profile, paths.rollback)
    writeFileSync(paths.pending, `${JSON.stringify({
      schemaVersion: 1,
      id: 'interrupted',
      stagingProfile,
      step: 'prepared',
    })}\n`)

    manager.recover()

    expect(manager.listPlugins()).toEqual([{ name: '@scope/plugin', version: '2.0.0' }])
    expect(existsSync(stagingProfile)).toBe(false)
    expect(existsSync(paths.pending)).toBe(false)
  })

  it('records the live pnpm worker as transaction owner until it exits', async ({ task, signal }) => {
    const root = temporaryRoot()
    const seed = join(root, 'seed')
    const ready = join(root, 'pnpm-ready')
    const releaseWorker = join(root, 'pnpm-release')
    createTestSeedMetadata(seed, release())
    writeFileSync(join(seed, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n')
    archiveStore(seed)
    writeIntegrity(seed)
    const paths = resolveDesktopPaths(join(root, '.dsh'))
    const runtime = { node: process.execPath, pnpm: writeBlockingFakePnpm(root, ready, releaseWorker) }
    const manager = new DesktopProjectManager(paths, runtime)
    const installing = manager.applyRelease(seed, '1.0.0', hooks())
    // Teardown observes failures even if the runner has abandoned the test body.
    const completed = installing.then(value => ({ value }), (error: unknown) => ({ error }))
    releaseWorkers.push(async () => {
      writeFileSync(releaseWorker, 'continue')
      const outcome = await completed
      if ('error' in outcome) throw outcome.error
    })
    // Child startup shares the test budget; an aborted poll must not resume ownership assertions.
    await expect.poll(() => {
      signal.throwIfAborted()
      return existsSync(ready)
    }, { timeout: task.timeout }).toBe(true)
    signal.throwIfAborted()
    const workerPid = Number.parseInt(readFileSync(ready, 'utf8'), 10)
    expect(readFileSync(paths.lock, 'utf8')).toBe(`${String(workerPid)}\n`)
    const competing = new DesktopProjectManager(paths, runtime)
    await expect(competing.applyRelease(seed, '1.0.0', hooks())).rejects.toThrow(/another package transaction is active/u)
    writeFileSync(releaseWorker, 'continue')
    await expect(installing).resolves.toBe(true)
    expect(existsSync(paths.lock)).toBe(false)
  })

  it('keeps core packages local while installing plugins from the desktop registry', async () => {
    const root = temporaryRoot()
    const seed = join(root, 'seed')
    const log = join(root, 'pnpm-log.json')
    createTestSeedMetadata(seed, release())
    writeFileSync(join(seed, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n')
    archiveStore(seed)
    writeIntegrity(seed)
    const paths = resolveDesktopPaths(join(root, '.dsh'))
    const manager = new DesktopProjectManager(paths, { node: process.execPath, pnpm: writeFakePnpm(root) })
    await manager.applyRelease(seed, '1.0.0', hooks())
    const previousLog = process.env.TEST_PNPM_LOG
    process.env.TEST_PNPM_LOG = log
    try {
      await manager.mutate({ type: 'plugin-add', spec: '@scope/plugin@2.0.0' }, hooks())
    } finally {
      if (previousLog === undefined) delete process.env.TEST_PNPM_LOG
      else process.env.TEST_PNPM_LOG = previousLog
    }

    const manifest = JSON.parse(readFileSync(join(paths.profile, 'package.json'), 'utf8')) as {
      dependencies: Record<string, string>
    }
    const coreSpec = manifest.dependencies['@deepseek-ai/dsh']
    expect(coreSpec).toMatch(/^file:\.\/desktop-packages\//u)
    expect(readFileSync(join(paths.profile, 'pnpm-workspace.yaml'), 'utf8'))
      .toContain(`${JSON.stringify('@deepseek-ai/dsh')}: ${JSON.stringify(coreSpec)}`)
    expect(manifest.dependencies['@scope/plugin']).toBe('2.0.0')
    const invocation = JSON.parse(readFileSync(log, 'utf8')) as { args: string[]; env: Record<string, string> }
    expect(invocation.args).toContain('add')
    expect(invocation.args).toContain('@scope/plugin@2.0.0')
    expect(invocation.args.some(arg => arg.startsWith('--config.registry='))).toBe(false)
    expect(invocation.env.NPM_CONFIG_REGISTRY).toBeUndefined()
  })

  it('reconciles dsh to the packaged release without removing desktop plugins', async () => {
    const root = temporaryRoot()
    const paths = resolveDesktopPaths(join(root, '.dsh'))
    const manager = new DesktopProjectManager(paths, { node: process.execPath, pnpm: writeFakePnpm(root) })
    const firstSeed = join(root, 'seed-1')
    createTestSeedMetadata(firstSeed, release('1.0.0'))
    writeFileSync(join(firstSeed, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n')
    mkdirSync(join(firstSeed, 'store'), { recursive: true })
    writeFileSync(join(firstSeed, 'store', 'release-1'), 'one')
    archiveStore(firstSeed)
    writeIntegrity(firstSeed)
    await manager.applyRelease(firstSeed, '1.0.0', hooks())
    await manager.mutate({ type: 'plugin-add', spec: '@scope/plugin@2.0.0' }, hooks())

    const nextSeed = join(root, 'seed-2')
    createTestSeedMetadata(nextSeed, release('1.1.0'))
    writeFileSync(join(nextSeed, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n')
    mkdirSync(join(nextSeed, 'store'), { recursive: true })
    writeFileSync(join(nextSeed, 'store', 'release-2'), 'two')
    archiveStore(nextSeed)
    writeIntegrity(nextSeed)

    await expect(manager.applyRelease(nextSeed, '1.1.0', hooks())).resolves.toBe(true)
    expect(manager.releaseVersion()).toBe('1.1.0')
    expect(manager.dshVersion()).toBe('1.1.0')
    expect(manager.listPlugins()).toEqual([{ name: '@scope/plugin', version: '2.0.0' }])
    const profile = JSON.parse(readFileSync(join(paths.profile, 'package.json'), 'utf8')) as {
      dsh: { profile: { bundles: string[] } }
    }
    expect(profile.dsh.profile.bundles).toEqual([
      '@deepseek-ai/dsh-base',
      '@deepseek-ai/dsh-web-app',
      '@deepseek-ai/dsh-experimental-agent-team-profile',
      '@deepseek-ai/dsh-experimental-agent-team-web-profile',
      '@scope/plugin',
    ])
    expect(readFileSync(join(paths.pnpm.store, 'release-1'), 'utf8')).toBe('one')
    expect(readFileSync(join(paths.pnpm.store, 'release-2'), 'utf8')).toBe('two')
    await expect(manager.applyRelease(nextSeed, '1.1.0', hooks())).resolves.toBe(false)
  })
})
