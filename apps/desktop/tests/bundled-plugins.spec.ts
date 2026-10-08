import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { reconcileBundledPlugins } from '../src/bundled-plugins.ts'
import { runtimeFixture } from './runtime-fixture.ts'

const roots: string[] = []
const names = ['@zaimokuza/dsh-acp-adapter', '@zaimokuza/dsh-agent-teams-office', 'dsh-boot-ocbc', 'dsh-atlassian-kanban'] as const
const writeFault = vi.hoisted(() => ({ suffix: undefined as string | undefined }))
vi.mock('@deepseek-ai/dsh-atomic-write', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@deepseek-ai/dsh-atomic-write')>()
  return {
    ...actual,
    writeFileAtomic: (...args: Parameters<typeof actual.writeFileAtomic>) => {
      if (writeFault.suffix !== undefined && args[0].endsWith(writeFault.suffix)) {
        writeFault.suffix = undefined
        return Promise.reject(new Error('injected atomic write failure'))
      }
      return actual.writeFileAtomic(...args)
    },
  }
})
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'desktop-bundled-')); roots.push(root)
  const profile = join(root, 'profile'); const runtimeRoot = join(root, 'runtime')
  mkdirSync(profile); const runtime = runtimeFixture(runtimeRoot, '1.2.3')
  configure(runtimeRoot)
  return { root, profile, runtimeRoot, runtime }
}

function configure(runtimeRoot: string): void {
  writeFileSync(join(runtimeRoot, 'package.json'), JSON.stringify({
    dependencies: Object.fromEntries(names.map(name => [name, '2.3.4'])),
    dsh: { distribution: { bundles: names } },
  }))
  for (const name of names) {
    const dir = join(runtimeRoot, 'node_modules', ...name.split('/'))
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name, version: '2.3.4' }))
  }
}

it('enables four runtime bundles and official Teams defaults for a fresh profile', async () => {
  const f = fixture()
  await expect(reconcileBundledPlugins(f.profile, f.runtimeRoot, f.runtime)).resolves.toBe(true)
  const manifest = JSON.parse(readFileSync(join(f.profile, 'package.json'), 'utf8')) as {
    dependencies: Record<string, string>
    dsh: { profile: { bundles: string[] } }
  }
  expect(manifest.dependencies).toEqual({})
  expect(manifest.dsh.profile.bundles).toEqual(expect.arrayContaining([...names, '@deepseek-ai/dsh-experimental-agent-team-profile']))
  expect(JSON.parse(readFileSync(join(f.profile, 'desktop-bundled-plugins.json'), 'utf8'))).toMatchObject({
    schemaVersion: 1, release: '1.2.3', versions: Object.fromEntries(names.map(name => [name, '2.3.4'])),
  })
  await expect(reconcileBundledPlugins(f.profile, f.runtimeRoot, f.runtime)).resolves.toBe(false)
})

it('keeps disabled built-ins, user dependencies and profile configuration across runtime upgrades', async () => {
  const f = fixture()
  writeFileSync(join(f.profile, 'package.json'), JSON.stringify({ dependencies: { [names[0]]: '1.0.0', 'user-plugin': '4.0.0' },
    dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', names[1], 'user-plugin'] } } }))
  writeFileSync(join(f.profile, 'cordis.patch.yml'), 'disabled: true\n')
  mkdirSync(join(f.profile, 'node_modules', ...names[0].split('/')), { recursive: true })
  mkdirSync(join(f.profile, 'node_modules/user-plugin'), { recursive: true })
  writeFileSync(join(f.profile, 'node_modules/user-plugin/index.js'), 'keep')
  await reconcileBundledPlugins(f.profile, f.runtimeRoot, f.runtime)
  const nextRuntimeRoot = join(f.root, 'runtime-next')
  const nextRuntime = runtimeFixture(nextRuntimeRoot, '1.2.4')
  configure(nextRuntimeRoot)
  await reconcileBundledPlugins(f.profile, nextRuntimeRoot, nextRuntime)
  const manifest = JSON.parse(readFileSync(join(f.profile, 'package.json'), 'utf8')) as {
    dependencies: Record<string, string>
    dsh: { profile: { bundles: string[] } }
  }
  expect(manifest.dependencies).toEqual({ 'user-plugin': '4.0.0' })
  expect(manifest.dsh.profile.bundles).toContain(names[1])
  expect(manifest.dsh.profile.bundles).not.toContain(names[0])
  expect(existsSync(join(f.profile, 'node_modules', ...names[0].split('/')))).toBe(false)
  expect(readFileSync(join(f.profile, 'node_modules/user-plugin/index.js'), 'utf8')).toBe('keep')
  expect(readFileSync(join(f.profile, 'cordis.patch.yml'), 'utf8')).toBe('disabled: true\n')
})

it('leaves profile state untouched when managed metadata is invalid', async () => {
  const f = fixture()
  writeFileSync(join(f.profile, 'desktop-bundled-plugins.json'), '{broken')
  writeFileSync(join(f.profile, 'package.json'), '{"dependencies":{"user-plugin":"1"}}')
  await expect(reconcileBundledPlugins(f.profile, f.runtimeRoot, f.runtime)).rejects.toThrow()
  expect(readFileSync(join(f.profile, 'package.json'), 'utf8')).toBe('{"dependencies":{"user-plugin":"1"}}')
})

it('preserves an old local archive when an extra user dependency still references it', async () => {
  const f = fixture()
  const managed = names[0]
  const spec = 'file:./desktop-local-plugins/plugin.tgz'
  writeFileSync(join(f.profile, 'package.json'), JSON.stringify({ dependencies: { [managed]: spec, 'user-extra': spec },
    dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', 'user-extra'] } } }))
  writeFileSync(join(f.profile, 'desktop-plugin-seed.json'), JSON.stringify({ plugins: [managed] }))
  mkdirSync(join(f.profile, 'desktop-local-plugins'), { recursive: true })
  writeFileSync(join(f.profile, 'desktop-local-plugins/plugin.tgz'), 'user archive')
  await reconcileBundledPlugins(f.profile, f.runtimeRoot, f.runtime)
  expect(readFileSync(join(f.profile, 'desktop-local-plugins/plugin.tgz'), 'utf8')).toBe('user archive')
  const manifest = JSON.parse(readFileSync(join(f.profile, 'package.json'), 'utf8')) as {
    dependencies: Record<string, string>
  }
  expect(manifest.dependencies['user-extra']).toBe(spec)
})

it('recovers an interrupted migration before reconciling the profile again', async () => {
  const f = fixture()
  const original = JSON.stringify({ dependencies: { 'user-extra': '1.0.0' },
    dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', 'user-extra'] } } })
  writeFileSync(join(f.profile, 'package.json'), original)
  const backup = join(f.profile, '.desktop-builtin-migration-00000000-0000-4000-8000-000000000001')
  mkdirSync(backup)
  writeFileSync(join(backup, 'journal.json'), JSON.stringify({ files: [{ path: 'package.json', backup: '0-package.json' }], created: [
    'desktop-bundled-plugins.json',
  ] }))
  renameSync(join(f.profile, 'package.json'), join(backup, '0-package.json'))
  writeFileSync(join(f.profile, 'package.json'), '{"dsh":{"profile":{"bundles":[]}}}')
  await reconcileBundledPlugins(f.profile, f.runtimeRoot, f.runtime)
  const migrated = JSON.parse(readFileSync(join(f.profile, 'package.json'), 'utf8')) as {
    dependencies: Record<string, string>
    dsh: { profile: { bundles: string[] } }
  }
  expect(migrated.dependencies['user-extra']).toBe('1.0.0')
  expect(migrated.dsh.profile.bundles).toContain('user-extra')
  expect(existsSync(backup)).toBe(false)
})

it('cleans only the atomic journal temp left before any profile entry was moved', async () => {
  const f = fixture()
  const backup = join(f.profile, '.desktop-builtin-migration-00000000-0000-4000-8000-000000000002')
  mkdirSync(backup)
  writeFileSync(join(backup, 'journal.json.abcdef123456.tmp'), '{partial')
  await expect(reconcileBundledPlugins(f.profile, f.runtimeRoot, f.runtime)).resolves.toBe(true)
  expect(existsSync(backup)).toBe(false)
  const unknown = join(f.profile, '.desktop-builtin-migration-00000000-0000-4000-8000-000000000003')
  mkdirSync(unknown)
  writeFileSync(join(unknown, 'user-file'), 'retain')
  await expect(reconcileBundledPlugins(f.profile, f.runtimeRoot, f.runtime))
    .rejects.toThrow('incomplete migration journal')
  expect(readFileSync(join(unknown, 'user-file'), 'utf8')).toBe('retain')
})

it('restores moved packages after marker write failure, then removes bulky committed backups', async () => {
  const f = fixture()
  const managedPath = join(f.profile, 'node_modules', ...names[0].split('/'))
  mkdirSync(managedPath, { recursive: true })
  writeFileSync(join(managedPath, 'package.json'), JSON.stringify({ name: names[0], version: '1.0.0' }))
  mkdirSync(join(f.profile, 'node_modules/user-plugin'), { recursive: true })
  writeFileSync(join(f.profile, 'node_modules/user-plugin/index.js'), 'keep')
  const original = JSON.stringify({ dependencies: { [names[0]]: '1.0.0', 'user-extra': '2.0.0' },
    dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', names[0], 'user-extra'] } } })
  writeFileSync(join(f.profile, 'package.json'), original)

  writeFault.suffix = 'desktop-bundled-plugins.json'
  await expect(reconcileBundledPlugins(f.profile, f.runtimeRoot, f.runtime)).rejects.toThrow('injected atomic write failure')
  expect(readFileSync(join(f.profile, 'package.json'), 'utf8')).toBe(original)
  expect(readFileSync(join(managedPath, 'package.json'), 'utf8')).toContain(names[0])

  await reconcileBundledPlugins(f.profile, f.runtimeRoot, f.runtime)
  expect(existsSync(managedPath)).toBe(false)
  expect(readFileSync(join(f.profile, 'node_modules/user-plugin/index.js'), 'utf8')).toBe('keep')
  const receipts = readdirSync(f.profile).filter(name => name.startsWith('.desktop-builtin-migration-'))
  expect(receipts.length).toBeGreaterThan(0)
  for (const receipt of receipts) {
    const journal = JSON.parse(readFileSync(join(f.profile, receipt, 'journal.json'), 'utf8')) as {
      files: { path: string; backup: string }[]
      committed: boolean
    }
    expect(journal.committed).toBe(true)
    for (const file of journal.files.filter(entry => entry.path.startsWith('node_modules/'))) {
      expect(existsSync(join(f.profile, receipt, file.backup))).toBe(false)
    }
  }
  expect(readFileSync(join(f.profile, 'package.json'), 'utf8')).toContain('user-extra')
})
