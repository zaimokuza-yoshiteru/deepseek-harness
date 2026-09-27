/** Build the writable plugin template once; application startup never installs its dependencies. */
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cpSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { delimiter, dirname, join, resolve } from 'node:path'
import { parse } from 'yaml'
import { t as listTar } from 'tar'
import { DESKTOP_PORTABLE_PLUGINS } from '../src/portable-plugins.ts'
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
  const inputs: unknown = JSON.parse(process.env.DSH_DESKTOP_LOCAL_PLUGINS ?? '[]')
  if (!Array.isArray(inputs) || !inputs.every((value): value is string => typeof value === 'string')) {
    throw new Error('DSH_DESKTOP_LOCAL_PLUGINS must be a JSON array of package directories or archives')
  }
  const names = new Set<string>(DESKTOP_PORTABLE_PLUGINS.map(plugin => plugin.name))
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
  const plugins = [
    ...DESKTOP_PORTABLE_PLUGINS.map(plugin => ({ name: plugin.name, spec: plugin.version })),
    ...localPlugins,
  ]
  writeFileSync(join(root, 'package.json'), `${JSON.stringify({
    name: '@deepseek-ai/dsh-desktop-runtime', private: true, version: '0.0.0',
    dependencies: Object.fromEntries(plugins.map(plugin => [plugin.name, plugin.spec])),
    dsh: { profile: {
      bundles: [...desktopProfileBundles(version), ...plugins.map(plugin => plugin.name)],
    } },
  }, null, 2)}\n`)
  writeFileSync(join(root, 'pnpm-workspace.yaml'), 'packages:\n  - .\nnodeLinker: hoisted\nautoInstallPeers: false\nstrictDepBuilds: true\n')
  await new Promise<void>((accept, reject) => {
    const child = spawn(node, ['--expose-internals', pnpm, '--config.registry=https://registry.npmjs.org/', `--config.userconfig=${config}`, 'install', '--prod', '--ignore-scripts'], {
      cwd: root, stdio: 'inherit', env: environment,
    })
    child.once('error', reject)
    child.once('close', (code, signal) => code === 0 ? accept() : reject(new Error(`plugin seed installation failed: ${String(code ?? signal)}`)))
  })
  const lock = parse(readFileSync(join(root, 'pnpm-lock.yaml'), 'utf8')) as { packages: Record<string, { resolution: { integrity?: string } }> }
  mkdirSync(join(root, 'notices'))
  for (const plugin of DESKTOP_PORTABLE_PLUGINS) {
    if (lock.packages[`${plugin.name}@${plugin.version}`]?.resolution.integrity !== plugin.integrity) throw new Error(`plugin seed: integrity mismatch for ${plugin.name}`)
    const installed = join(root, 'node_modules', plugin.name)
    cpSync(join(installed, 'LICENSE'), join(root, 'notices', plugin.notice))
  }
  for (const name of ['.modules.yaml', '.pnpm-workspace-state-v1.json', '.pnpm']) {
    rmSync(join(root, 'node_modules', name), { recursive: true, force: true })
  }
  rmSync(config)
  const id = createHash('sha256').update(readFileSync(join(root, 'pnpm-lock.yaml'))).digest('hex')
  writeFileSync(join(root, 'desktop-plugin-seed.json'), `${JSON.stringify({ schemaVersion: 1, id, plugins: plugins.map(plugin => plugin.name) })}\n`)
}
