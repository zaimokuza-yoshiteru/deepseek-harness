/** Prepare validated local plugin archives for the unified Desktop runtime install. */
import { createHash } from 'node:crypto'
import { cpSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { basename, delimiter, dirname, join, resolve } from 'node:path'
import { t as listTar } from 'tar'
import releasePlugins from '../src/release-plugins.json' with { type: 'json' }
import { sourceDigest } from '../../../scripts/build-plugins.mjs'

export interface PreparedDesktopPlugin {
  readonly name: string
  readonly version: string
  readonly file: string
  readonly spec: string
  readonly source: string
  readonly sourceSha256: string
  readonly sha256: string
}

/**
 * Pack or stage the release plugin archives without installing their dependencies.
 * @param root - Temporary package-manager project that receives local archives.
 * @param node - Bundled Node executable.
 * @param pnpm - Bundled package manager entry used only to pack source directories.
 * @returns Exact plugin names, versions, and local specs for the unified runtime install.
 */
export async function preparePluginArchives(root: string, node: string, pnpm: string): Promise<PreparedDesktopPlugin[]> {
  mkdirSync(root, { recursive: true })
  const config = join(root, '.build-npmrc')
  writeFileSync(config, '')
  const environment = {
    ...Object.fromEntries(Object.entries(process.env).filter(([name]) =>
      !/^(?:npm|pnpm|corepack|DSH_DESKTOP)_/iu.test(name)
      && !/KEY|SECRET|TOKEN|PASSWORD/iu.test(name) && !['NODE_OPTIONS', 'NODE_PATH'].includes(name))),
    ELECTRON_RUN_AS_NODE: '1',
    PATH: `${dirname(node)}${delimiter}${process.env.PATH ?? ''}`,
  }
  const buildRoot = resolve(import.meta.dirname, '../../../.artifacts/desktop-release-plugins')
  const built = process.env.DSH_DESKTOP_LOCAL_PLUGINS === undefined
    ? JSON.parse(readFileSync(join(buildRoot, 'manifest.json'), 'utf8')) as { plugins: { name: string; version: string; asset: string; sha256: string; sourceSha256: string }[] }
    : undefined
  const inputs: unknown = JSON.parse(process.env.DSH_DESKTOP_LOCAL_PLUGINS ?? readFileSync(join(buildRoot, 'inputs.json'), 'utf8'))
  if (!Array.isArray(inputs) || !inputs.every((value): value is string => typeof value === 'string')) {
    throw new Error('DSH_DESKTOP_LOCAL_PLUGINS must be a JSON array of package directories or archives')
  }
  const expectedNames = releasePlugins.plugins.map(plugin => plugin.name)
  if (inputs.length !== expectedNames.length || (built !== undefined
    && (!Array.isArray(built.plugins) || built.plugins.length !== expectedNames.length
      || built.plugins.some(plugin => !expectedNames.includes(plugin.name))))) {
    throw new Error('Incomplete source plugin build')
  }
  const packages = join(root, 'desktop-local-plugins')
  mkdirSync(packages, { recursive: true })
  const names = new Set<string>()
  const localPlugins: PreparedDesktopPlugin[] = []
  for (let index = 0; index < inputs.length; index++) {
    const input = inputs[index]!
    const path = resolve(input)
    const archived = statSync(path).isFile()
    let manifestText: string
    if (archived) {
      const chunks: Buffer[] = []
      await listTar({ file: path, onReadEntry(entry) {
        if (entry.path === 'package/package.json' && entry.type === 'File') {
          entry.on('data', (chunk: Buffer) => { chunks.push(chunk) })
        }
      } })
      manifestText = Buffer.concat(chunks).toString('utf8')
    } else manifestText = readFileSync(join(path, 'package.json'), 'utf8')
    const manifest = JSON.parse(manifestText) as {
      name?: string
      version?: string
      files?: string[]
      dsh?: { bundle?: { patch?: string } }
    }
    if (typeof manifest.name !== 'string' || !/^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/iu.test(manifest.name)
      || typeof manifest.version !== 'string' || !/^[a-zA-Z0-9.+-]+$/u.test(manifest.version)
      || !Array.isArray(manifest.files) || manifest.files.length === 0 || !manifest.dsh?.bundle?.patch) {
      throw new Error(`local desktop plugin requires a name, version, explicit files and bundle patch: ${path}`)
    }
    if (manifest.name !== expectedNames[index]) throw new Error(`Unexpected release plugin at position ${index}: ${manifest.name}`)
    if (names.has(manifest.name)) throw new Error(`duplicate desktop plugin: ${manifest.name}`)
    names.add(manifest.name)
    const source = releasePlugins.plugins[index]!
    const sourceRoot = resolve(import.meta.dirname, '../../../', source.source)
    const sourceManifest = JSON.parse(readFileSync(join(sourceRoot, 'package.json'), 'utf8')) as { name?: string; version?: string }
    if (sourceManifest.name !== manifest.name || sourceManifest.version !== manifest.version) {
      throw new Error(`Plugin differs from its source manifest: ${manifest.name}`)
    }
    const sourceSha256 = sourceDigest(sourceRoot)
    const record = built?.plugins.find(plugin => plugin.name === manifest.name)
    if (built !== undefined && (!archived || record?.version !== manifest.version || record.asset !== basename(path)
      || record.sourceSha256 !== sourceSha256
      || record.sha256 !== createHash('sha256').update(readFileSync(path)).digest('hex'))) {
      throw new Error(`Plugin differs from this source build: ${manifest.name}`)
    }
    const file = `${manifest.name.replace(/^@/u, '').replace('/', '-')}-${manifest.version}.tgz`
    if (archived) cpSync(path, join(packages, file))
    else {
      await new Promise<void>((accept, reject) => {
        const child = spawn(node, ['--expose-internals', pnpm, `--config.userconfig=${config}`, '--config.ignore-scripts=true', 'pack', '--pack-destination', packages], {
          cwd: path, stdio: 'inherit', env: environment,
        })
        child.once('error', reject)
        child.once('close', (code, signal) => code === 0 ? accept() : reject(new Error(`local plugin pack failed: ${String(code ?? signal)}`)))
      })
    }
    if (sourceDigest(sourceRoot) !== sourceSha256) throw new Error(`Plugin source changed while it was packed: ${manifest.name}`)
    localPlugins.push({ name: manifest.name, version: manifest.version, file, spec: `file:./desktop-local-plugins/${file}`,
      source: source.source, sourceSha256,
      sha256: createHash('sha256').update(readFileSync(join(packages, file))).digest('hex') })
  }
  return localPlugins
}
