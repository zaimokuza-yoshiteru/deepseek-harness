/** Materialize dependencies for plugins built from the repository's source copies. */
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { delimiter, dirname, join, resolve } from 'node:path'
import { t as listTar } from 'tar'
import { resolveNpmRegistry } from './desktop-release-environment.mjs'
import { desktopProfileBundles } from '../src/profile-defaults.ts'

/** Materialize pinned plugins without host peer copies or personal npm configuration.
 * DSH_DESKTOP_LOCAL_PLUGINS names prebuilt package directories or .tgz archives; archives retain their original bytes.
 * @param root - Target-owned output directory.
 * @param node - Bundled Node executable.
 * @param pnpm - Bundled package manager entry.
 * @param version - DSH core version.
 */
export async function preparePluginSeed(root: string, node: string, pnpm: string, version: string): Promise<void> {
  rmSync(root, { recursive: true, force: true })
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
  const localPlugins: { name: string; spec: string }[] = []
  const buildRoot = resolve(import.meta.dirname, '../../../.artifacts/desktop-release-plugins')
  const built = process.env.DSH_DESKTOP_LOCAL_PLUGINS === undefined
    ? JSON.parse(readFileSync(join(buildRoot, 'manifest.json'), 'utf8')) as { plugins: { name: string; version: string; asset: string; sha256: string; sourceSha256: string }[] }
    : undefined
  const inputs: unknown = JSON.parse(process.env.DSH_DESKTOP_LOCAL_PLUGINS ?? readFileSync(join(buildRoot, 'inputs.json'), 'utf8'))
  if (!Array.isArray(inputs) || !inputs.every((value): value is string => typeof value === 'string')) {
    throw new Error('DSH_DESKTOP_LOCAL_PLUGINS must be a JSON array of package directories or archives')
  }
  const names = new Set<string>()
  for (const input of inputs) {
    const directory = resolve(input)
    const archived = statSync(directory).isFile()
    let manifestText = ''
    if (archived) {
      const chunks: Buffer[] = []
      await listTar({ file: directory, onReadEntry(entry) {
        if (entry.path === 'package/package.json' && entry.type === 'File') {
          entry.on('data', (chunk: Buffer) => { chunks.push(chunk) })
        }
      } })
      manifestText = Buffer.concat(chunks).toString('utf8')
    } else manifestText = readFileSync(join(directory, 'package.json'), 'utf8')
    const manifest = JSON.parse(manifestText) as {
      name?: string
      version?: string
      files?: string[]
      dsh?: { bundle?: { patch?: string } }
    }
    if (typeof manifest.name !== 'string' || !/^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/u.test(manifest.name)
      || typeof manifest.version !== 'string' || !/^[a-zA-Z0-9.+-]+$/u.test(manifest.version)
      || !Array.isArray(manifest.files) || manifest.files.length === 0 || !manifest.dsh?.bundle?.patch) {
      throw new Error(`local desktop plugin requires a name, version, explicit files and bundle patch: ${directory}`)
    }
    if (names.has(manifest.name)) throw new Error(`duplicate desktop plugin: ${manifest.name}`)
    names.add(manifest.name)
    if (built) {
      const record = built.plugins.find(plugin => plugin.name === manifest.name)
      if (!archived || record?.version !== manifest.version
        || record.sha256 !== createHash('sha256').update(readFileSync(directory)).digest('hex')) {
        throw new Error(`Plugin differs from this source build: ${manifest.name}`)
      }
    }
    const packages = join(root, 'desktop-local-plugins')
    mkdirSync(packages, { recursive: true })
    const file = `${manifest.name.replace(/^@/u, '').replace('/', '-')}-${manifest.version}.tgz`
    if (archived) cpSync(directory, join(packages, file))
    else {
      await new Promise<void>((accept, reject) => {
        const child = spawn(node, ['--expose-internals', pnpm, `--config.userconfig=${config}`, '--config.ignore-scripts=true', 'pack', '--pack-destination', packages], {
          cwd: directory, stdio: 'inherit', env: environment,
        })
        child.once('error', reject)
        child.once('close', (code, signal) => code === 0 ? accept() : reject(new Error(`local plugin pack failed: ${String(code ?? signal)}`)))
      })
    }
    localPlugins.push({ name: manifest.name, spec: `file:./desktop-local-plugins/${file}` })
  }
  const plugins = localPlugins
  if (built && (plugins.length !== built.plugins.length || built.plugins.some(plugin => !names.has(plugin.name)))) {
    throw new Error('Incomplete source plugin build')
  }
  writeFileSync(join(root, 'package.json'), `${JSON.stringify({
    name: '@deepseek-ai/dsh-desktop-runtime', private: true, version: '0.0.0',
    dependencies: Object.fromEntries(plugins.map(plugin => [plugin.name, plugin.spec])),
    dsh: { profile: {
      bundles: [...desktopProfileBundles(version), ...plugins.map(plugin => plugin.name)],
    } },
  }, null, 2)}\n`)
  writeFileSync(join(root, 'pnpm-workspace.yaml'), 'packages:\n  - .\nnodeLinker: hoisted\nautoInstallPeers: false\nstrictDepBuilds: true\n')
  await new Promise<void>((accept, reject) => {
    const child = spawn(node, ['--expose-internals', pnpm, `--config.registry=${resolveNpmRegistry(process.env)}`, `--config.userconfig=${config}`, 'install', '--prod', '--ignore-scripts'], {
      cwd: root, stdio: 'inherit', env: environment,
    })
    child.once('error', reject)
    child.once('close', (code, signal) => code === 0 ? accept() : reject(new Error(`plugin seed installation failed: ${String(code ?? signal)}`)))
  })
  mkdirSync(join(root, 'notices'))
  for (const plugin of plugins) {
    const license = join(root, 'node_modules', plugin.name, 'LICENSE')
    if (existsSync(license)) cpSync(license, join(root, 'notices', plugin.name.replaceAll('/', '-').replace('@', '') + '-LICENSE'))
  }
  if (built) writeFileSync(join(root, 'desktop-plugin-build.json'), JSON.stringify(built, null, 2) + '\n')
  for (const name of ['.modules.yaml', '.pnpm-workspace-state-v1.json', '.pnpm']) {
    rmSync(join(root, 'node_modules', name), { recursive: true, force: true })
  }
  rmSync(config)
  const id = createHash('sha256').update(readFileSync(join(root, 'pnpm-lock.yaml'))).digest('hex')
  writeFileSync(join(root, 'desktop-plugin-seed.json'), `${JSON.stringify({ schemaVersion: 1, id, plugins: plugins.map(plugin => plugin.name) })}\n`)
}
