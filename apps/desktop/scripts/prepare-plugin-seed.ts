/** Build the writable plugin template once; application startup never installs its dependencies. */
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { delimiter, dirname, join } from 'node:path'
import { parse } from 'yaml'
import { DESKTOP_PORTABLE_PLUGINS } from '../src/portable-plugins.ts'
import { desktopProfileBundles } from '../src/profile-defaults.ts'

/** Materialize pinned plugins without host peer copies or personal npm configuration.
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
  writeFileSync(join(root, 'package.json'), `${JSON.stringify({
    name: '@deepseek-ai/dsh-desktop-runtime', private: true, version: '0.0.0',
    dependencies: Object.fromEntries(DESKTOP_PORTABLE_PLUGINS.map(plugin => [plugin.name, plugin.version])),
    dsh: { profile: {
      bundles: [...desktopProfileBundles(version), ...DESKTOP_PORTABLE_PLUGINS.map(plugin => plugin.name)],
    } },
  }, null, 2)}\n`)
  writeFileSync(join(root, 'pnpm-workspace.yaml'), 'packages:\n  - .\nnodeLinker: hoisted\nautoInstallPeers: false\nstrictDepBuilds: true\n')
  await new Promise<void>((accept, reject) => {
    const child = spawn(node, ['--expose-internals', pnpm, '--config.registry=https://registry.npmjs.org/', `--config.userconfig=${config}`, 'install', '--prod', '--ignore-scripts'], {
      cwd: root, stdio: 'inherit', env: {
        ...Object.fromEntries(Object.entries(process.env).filter(([name]) => !/^(?:npm|pnpm|corepack|DSH_DESKTOP)_/iu.test(name) && !['NODE_OPTIONS', 'NODE_PATH'].includes(name))),
        ELECTRON_RUN_AS_NODE: '1',
        PATH: `${dirname(node)}${delimiter}${process.env.PATH ?? ''}`,
      },
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
  writeFileSync(join(root, 'desktop-plugin-seed.json'), `${JSON.stringify({ schemaVersion: 1, id })}\n`)
}
