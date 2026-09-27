import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { c as createTar } from 'tar'
import { preparePluginSeed } from '../scripts/prepare-plugin-seed.ts'

const roots: string[] = []
afterEach(() => {
  vi.unstubAllEnvs()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})
function directories() {
  const root = mkdtempSync(join(tmpdir(), 'local-plugin-seed-'))
  roots.push(root)
  const plugin = join(root, 'plugin')
  mkdirSync(plugin)
  return { root, plugin, seed: join(root, 'seed') }
}

it.each(['{}', '[1]'])('rejects invalid local package directory input %s before package operations', async (value) => {
  const f = directories()
  vi.stubEnv('DSH_DESKTOP_LOCAL_PLUGINS', value)
  await expect(preparePluginSeed(f.seed, process.execPath, 'unused', '0.1.7-rc.2'))
    .rejects.toThrow('must be a JSON array')
})

it('requires an explicit package file list before packing a local directory', async () => {
  const f = directories()
  writeFileSync(join(f.plugin, 'package.json'), JSON.stringify({ name: 'local', version: '1.0.0', dsh: { bundle: { patch: 'bundle.yml' } } }))
  vi.stubEnv('DSH_DESKTOP_LOCAL_PLUGINS', JSON.stringify([f.plugin]))
  await expect(preparePluginSeed(f.seed, process.execPath, 'unused', '0.1.7-rc.2'))
    .rejects.toThrow('explicit files')
})

it('refuses a local bundle that would replace a pinned registry plugin', async () => {
  const f = directories()
  writeFileSync(join(f.plugin, 'package.json'), JSON.stringify({ name: '@zaimokuza/dsh-acp-adapter', version: '1.0.0', files: ['lib'], dsh: { bundle: { patch: 'bundle.yml' } } }))
  vi.stubEnv('DSH_DESKTOP_LOCAL_PLUGINS', JSON.stringify([f.plugin]))
  await expect(preparePluginSeed(f.seed, process.execPath, 'unused', '0.1.7-rc.2'))
    .rejects.toThrow('duplicate desktop plugin')
})

it('retains archive bytes without packing or inheriting an ancestor license', async () => {
  const f = directories()
  const packageRoot = join(f.plugin, 'package')
  mkdirSync(packageRoot)
  writeFileSync(join(packageRoot, 'package.json'), JSON.stringify({ name: 'local', version: '1.0.0', files: ['lib'], dsh: { bundle: { patch: 'bundle.yml' } } }))
  const archive = join(f.root, 'input.tgz')
  await createTar({ file: archive, cwd: f.plugin, gzip: true }, ['package'])
  writeFileSync(join(f.root, 'LICENSE'), 'unrelated ancestor license')
  const manager = join(f.root, 'manager.cjs')
  // Stop at installation after observing the prepared archive; no registry access is needed.
  writeFileSync(manager, "process.exit(process.argv.includes('pack') ? 99 : 7)\n")
  vi.stubEnv('DSH_DESKTOP_LOCAL_PLUGINS', JSON.stringify([archive]))
  await expect(preparePluginSeed(f.seed, process.execPath, manager, '0.1.7-rc.2'))
    .rejects.toThrow('plugin seed installation failed: 7')
  expect(readFileSync(join(f.seed, 'desktop-local-plugins/local-1.0.0.tgz'))).toEqual(readFileSync(archive))
})
