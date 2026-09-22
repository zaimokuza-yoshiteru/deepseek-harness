import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { applyPluginSeed, needsPluginSeed } from '../src/plugin-seed.ts'
import { runtimeFixture } from './runtime-fixture.ts'
import { DESKTOP_PORTABLE_PLUGINS } from '../src/portable-plugins.ts'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'desktop-migration-')); roots.push(root)
  const profile = join(root, 'profile'); const seed = join(root, 'seed'); const backup = join(root, 'backups')
  mkdirSync(profile); mkdirSync(seed)
  writeFileSync(join(profile, 'lock'), 'owned')
  writeFileSync(join(seed, 'desktop-plugin-seed.json'), '{"id":"new"}')
  writeFileSync(join(seed, 'package.json'), JSON.stringify({ dependencies: Object.fromEntries(DESKTOP_PORTABLE_PLUGINS.map(p => [p.name, p.version])) }))
  const runtime = runtimeFixture(join(root, 'runtime'), '0.1.6-alpha.1')
  return { root, profile, seed, backup, runtime }
}
it('initializes offline with Teams and all bundled plugins, retaining the held lock', async () => {
  const f = fixture()
  await applyPluginSeed(f.profile, f.seed, f.backup, f.runtime, async (install) => { expect(install).toBe(false) })
  const manifest = JSON.parse(readFileSync(join(f.profile, 'package.json'), 'utf8')) as {
    dependencies: Record<string, string>
    dsh: { desktop: { agentTeams: boolean }; profile: { bundles: string[] } }
  }
  expect(manifest.dsh.desktop.agentTeams).toBeUndefined()
  expect(manifest.dsh.profile.bundles).toContain('@deepseek-ai/dsh-experimental-agent-team-profile')
  expect(manifest.dependencies['@zaimokuza/dsh-plugin-hub']).toBeUndefined()
  expect(manifest.dsh.profile.bundles).toContain('@zaimokuza/dsh-agent-teams-office')
  expect(readFileSync(join(f.profile, 'lock'), 'utf8')).toBe('owned')
  expect(needsPluginSeed(f.profile, f.seed)).toBe(false)
})
it('migrates an old profile without losing disabled Teams, plugin activation or user configuration', async () => {
  const f = fixture()
  const old = { dependencies: { '@deepseek-ai/dsh': 'file:./old.tgz', '@zaimokuza/dsh-plugin-hub': '0.2.1', 'user-plugin': '1.2.3' }, dsh: { desktop: { agentTeams: false }, profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', 'user-plugin'] } } }
  writeFileSync(join(f.profile, 'package.json'), JSON.stringify(old))
  writeFileSync(join(f.profile, 'cordis.yml'), 'user-settings')
  await applyPluginSeed(f.profile, f.seed, f.backup, f.runtime, async (install) => { expect(install).toBe(true) })
  const manifest = JSON.parse(readFileSync(join(f.profile, 'package.json'), 'utf8')) as {
    dependencies: Record<string, string>
    dsh: { desktop: { agentTeams: boolean }; profile: { bundles: string[] } }
  }
  expect(manifest.dependencies['@deepseek-ai/dsh']).toBeUndefined()
  expect(manifest.dependencies['user-plugin']).toBe('1.2.3')
  expect(manifest.dsh.desktop.agentTeams).toBeUndefined()
  expect(manifest.dsh.profile.bundles).not.toContain('@deepseek-ai/dsh-experimental-agent-team-profile')
  expect(manifest.dsh.profile.bundles).not.toContain('@zaimokuza/dsh-plugin-hub')
  expect(manifest.dsh.profile.bundles).toContain('user-plugin')
  expect(manifest.dsh.profile.bundles).toContain('@zaimokuza/dsh-agent-teams-office')
  expect(readFileSync(join(f.profile, 'cordis.yml'), 'utf8')).toBe('user-settings')
  expect(JSON.parse(readFileSync(join(f.backup, readdirSync(f.backup)[0]!, 'package.json'), 'utf8'))).toEqual(old)
})
it('restores the exact original files if preparation fails', async () => {
  const f = fixture(); const original = '{"dependencies":{}}'
  writeFileSync(join(f.profile, 'package.json'), original)
  await expect(applyPluginSeed(f.profile, f.seed, f.backup, f.runtime, async () => { throw new Error('incompatible plugin') })).rejects.toThrow('incompatible plugin')
  expect(readFileSync(join(f.profile, 'package.json'), 'utf8')).toBe(original)
  expect(existsSync(join(f.profile, 'desktop-plugin-seed.json'))).toBe(false)
  expect(readFileSync(join(f.profile, 'lock'), 'utf8')).toBe('owned')
})

it('discards build-machine pnpm state while keeping prebuilt dependency files', async () => {
  const f = fixture()
  const modules = join(f.seed, 'node_modules')
  mkdirSync(join(modules, 'example'), { recursive: true })
  mkdirSync(join(modules, '.pnpm'))
  writeFileSync(join(modules, '.modules.yaml'), 'storeDir: /build-machine/store')
  writeFileSync(join(modules, '.pnpm-workspace-state-v1.json'), '{}')
  writeFileSync(join(modules, 'example', 'index.js'), 'export default 1')
  await applyPluginSeed(f.profile, f.seed, f.backup, f.runtime, async () => {})
  expect(readdirSync(join(f.profile, 'node_modules'))).toEqual(['example'])
  expect(readFileSync(join(f.profile, 'node_modules', 'example', 'index.js'), 'utf8')).toBe('export default 1')
})

it('removes retired release-owned tarballs without an offline install, preserving explicitly installed plugins', async () => {
  const f = fixture()
  const names = ['@deepseek-ai/dsh', '@deepseek-ai/dsh-desktop-host', '@deepseek-ai/dsh-code-runtime', '@deepseek-ai/dsh-workflow-worker-thread'].sort((a, b) => a.localeCompare(b))
  const packages = names.map(name => ({ name, version: '0.1.5-rc.2', file: `${name.replace('@deepseek-ai/', '')}.tgz`, bytes: 1, integrity: 'sha512-AA==' }))
  writeFileSync(join(f.profile, 'desktop-packages.json'), JSON.stringify({ schemaVersion: 1, packages }))
  const dependencies = Object.fromEntries(packages.map(p => [p.name, `file:./desktop-packages/${p.file}`]))
  writeFileSync(join(f.profile, 'package.json'), JSON.stringify({ dependencies }))
  await applyPluginSeed(f.profile, f.seed, f.backup, f.runtime, async (install) => { expect(install).toBe(false) })
  const migrated = JSON.parse(readFileSync(join(f.profile, 'package.json'), 'utf8')) as { dependencies: Record<string, string> }
  expect(Object.keys(migrated.dependencies)).toEqual(DESKTOP_PORTABLE_PLUGINS.map(p => p.name))

  // A registry version explicitly selected by the user is not the old local core tarball.
  writeFileSync(join(f.profile, 'desktop-packages.json'), JSON.stringify({ schemaVersion: 1, packages }))
  writeFileSync(join(f.profile, 'package.json'), JSON.stringify({ dependencies: { '@deepseek-ai/dsh-code-runtime': '0.1.5-rc.2' } }))
  await applyPluginSeed(f.profile, f.seed, f.backup, f.runtime, async (install) => { expect(install).toBe(true) })
  const preserved = JSON.parse(readFileSync(join(f.profile, 'package.json'), 'utf8')) as { dependencies: Record<string, string> }
  expect(preserved.dependencies['@deepseek-ai/dsh-code-runtime']).toBe('0.1.5-rc.2')
})

it('preserves native per-bundle Teams choices across subsequent seed upgrades', async () => {
  const f = fixture()
  const host = '@deepseek-ai/dsh-experimental-agent-team-profile'
  const web = '@deepseek-ai/dsh-experimental-agent-team-web-profile'
  const old = { dependencies: { '@zaimokuza/dsh-plugin-hub': '0.2.3' },
    dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', host, '@zaimokuza/dsh-plugin-hub'] } } }
  writeFileSync(join(f.profile, 'package.json'), JSON.stringify(old))
  await applyPluginSeed(f.profile, f.seed, f.backup, f.runtime, async (install) => { expect(install).toBe(false) })
  const manifest = JSON.parse(readFileSync(join(f.profile, 'package.json'), 'utf8')) as typeof old
  expect(manifest.dsh.profile.bundles).toContain(host)
  expect(manifest.dsh.profile.bundles).not.toContain(web)
  expect(manifest.dsh.profile.bundles).not.toContain('@zaimokuza/dsh-plugin-hub')
  expect(manifest.dependencies).not.toHaveProperty('@zaimokuza/dsh-plugin-hub')
  await applyPluginSeed(f.profile, f.seed, f.backup, f.runtime, async (install) => { expect(install).toBe(false) })
  expect(JSON.parse(readFileSync(join(f.profile, 'package.json'), 'utf8'))).toEqual(manifest)
})


it('removes the retired Teams web package while retaining the merged Teams selection and user plugin', async () => {
  const f = fixture()
  const host = '@deepseek-ai/dsh-experimental-agent-team-profile'
  const web = '@deepseek-ai/dsh-experimental-agent-team-web-profile'
  writeFileSync(join(f.profile, 'package.json'), JSON.stringify({
    dependencies: { [web]: '0.1.6-alpha.2', 'user-plugin': '1.2.3' },
    dsh: { profile: { bundles: [host, web, 'user-plugin'] } },
  }))
  writeFileSync(join(f.profile, 'settings.yaml'), 'agents: []\n')
  await applyPluginSeed(f.profile, f.seed, f.backup, f.runtime, async (install) => { expect(install).toBe(true) })
  const manifest = JSON.parse(readFileSync(join(f.profile, 'package.json'), 'utf8')) as { dependencies: Record<string, string>; dsh: { profile: { bundles: string[] } } }
  expect(manifest.dependencies).not.toHaveProperty(web)
  expect(manifest.dependencies['user-plugin']).toBe('1.2.3')
  expect(manifest.dsh.profile.bundles.filter(name => name === host)).toEqual([host])
  expect(manifest.dsh.profile.bundles).not.toContain(web)
  expect(readFileSync(join(f.profile, 'settings.yaml'), 'utf8')).toBe('agents: []\n')
})
