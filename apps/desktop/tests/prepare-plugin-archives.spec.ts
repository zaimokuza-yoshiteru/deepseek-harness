import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { c as createTar } from 'tar'
import { preparePluginArchives } from '../scripts/prepare-plugin-archives.ts'
import releasePlugins from '../src/release-plugins.json' with { type: 'json' }

const roots: string[] = []
afterEach(() => {
  vi.unstubAllEnvs()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})
function temporaryRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'desktop-plugin-archives-'))
  roots.push(root)
  return root
}
async function archive(root: string, name: string, version?: string): Promise<string> {
  const plugin = releasePlugins.plugins.find(entry => entry.name === name)
  const sourceVersion = plugin === undefined ? '1.0.0'
    : (JSON.parse(readFileSync(resolve(import.meta.dirname, '../../../', plugin.source, 'package.json'), 'utf8')) as { version: string }).version
  const packageVersion = version ?? sourceVersion
  const packageRoot = join(root, `${name.replaceAll('/', '-')}-source`, 'package')
  mkdirSync(packageRoot, { recursive: true })
  writeFileSync(join(packageRoot, 'package.json'), JSON.stringify({
    name, version: packageVersion, files: ['lib'], dsh: { bundle: { patch: 'bundle.yml' } },
  }))
  writeFileSync(join(packageRoot, 'bundle.yml'), '[]\n')
  const file = join(root, `${name.replaceAll('/', '-')}-${packageVersion}.tgz`)
  await createTar({ file, cwd: join(packageRoot, '..'), gzip: true }, ['package'])
  return file
}

it.each(['{}', '[1]'])('rejects malformed local archive input %s before package operations', async (value) => {
  const root = temporaryRoot()
  vi.stubEnv('DSH_DESKTOP_LOCAL_PLUGINS', value)
  await expect(preparePluginArchives(root, process.execPath, 'unused')).rejects.toThrow('must be a JSON array')
})

it('rejects an incomplete archive set before preparing runtime dependencies', async () => {
  const root = temporaryRoot()
  vi.stubEnv('DSH_DESKTOP_LOCAL_PLUGINS', JSON.stringify(['/does/not/matter.tgz']))
  await expect(preparePluginArchives(root, process.execPath, 'unused')).rejects.toThrow('Incomplete source plugin build')
  expect(existsSync(join(root, 'node_modules'))).toBe(false)
})

it('stages the four release archives without installing a separate dependency tree', async () => {
  const root = temporaryRoot()
  const inputs = await Promise.all(releasePlugins.plugins.map(plugin => archive(root, plugin.name)))
  vi.stubEnv('DSH_DESKTOP_LOCAL_PLUGINS', JSON.stringify(inputs))
  const plugins = await preparePluginArchives(root, process.execPath, 'unused')
  expect(plugins.map(plugin => plugin.name)).toEqual(releasePlugins.plugins.map(plugin => plugin.name))
  for (const plugin of plugins) {
    const source = releasePlugins.plugins.find(entry => entry.name === plugin.name)!
    const version = (JSON.parse(readFileSync(resolve(import.meta.dirname, '../../../', source.source, 'package.json'), 'utf8')) as { version: string }).version
    expect(plugin.version).toBe(version)
    expect(readFileSync(join(root, 'desktop-local-plugins', plugin.file))).toEqual(readFileSync(inputs[plugins.indexOf(plugin)]!))
  }
  expect(existsSync(join(root, 'node_modules'))).toBe(false)
  expect(existsSync(join(root, 'package.json'))).toBe(false)
})

it('rejects an artifact whose package identity does not match release-plugins.json', async () => {
  const root = temporaryRoot()
  const wrong = await archive(root, 'wrong-plugin')
  const inputs = [wrong, ...releasePlugins.plugins.slice(1).map(plugin => join(root, `${plugin.name}.tgz`))]
  vi.stubEnv('DSH_DESKTOP_LOCAL_PLUGINS', JSON.stringify(inputs))
  await expect(preparePluginArchives(root, process.execPath, 'unused')).rejects.toThrow('Unexpected release plugin at position 0')
})
