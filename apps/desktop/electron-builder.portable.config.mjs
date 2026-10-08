/** Internal ZIP distribution; no npm publication, installer, or automatic updater. */
import { desktopTargetPlatform, resolveDesktopBuildTarget, resolveDesktopTargetBuildPaths } from './scripts/desktop-build-paths.mjs'
import { join } from 'node:path'
import { verifyDesktopRuntime } from './lib/types/runtime-tree.js'
import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'
import { resolveDesktopDistributionVersion } from '../../scripts/desktop-distribution-version.mjs'

const delivery = JSON.parse(readFileSync(new URL('../../delivery.json', import.meta.url), 'utf8'))
const { tag, appVersion: version } = resolveDesktopDistributionVersion(delivery, process.env.DSH_DESKTOP_DISTRIBUTION_VERSION)
const target = resolveDesktopBuildTarget()
const paths = resolveDesktopTargetBuildPaths()

export default {
  appId: 'io.github.zaimokuza-yoshiteru.dsh-desktop',
  productName: 'DSH Desktop',
  artifactName: `dsh-desktop-${tag}-\${os}-\${arch}.\${ext}`,
  extraMetadata: { version },
  directories: { output: paths.artifacts },
  asar: true,
  electronDist: paths.electron,
  electronFuses: { runAsNode: true },
  npmRebuild: false,
  afterPack: async context => {
    await verifyDesktopRuntime(join(context.packager.getResourcesDir(context.appOutDir), 'dsh'),
      JSON.parse(readFileSync(join(paths.dsh, 'package.json'), 'utf8')).version,
      desktopTargetPlatform(target))
  },
  files: ['lib/*.js', 'lib/*.cjs', 'lib/welcome/**/*', 'renderer/**/*', 'package.json'],
  asarUnpack: ['**/*.{node,dylib,dll,so,exe}', '**/*.so.*', '**/spawn-helper', '**/@vscode/ripgrep/bin/rg'],
  extraResources: [
    { from: paths.runtime, to: 'runtime' },
    { from: paths.dsh, to: 'dsh' },
    { from: join(paths.dsh, 'node_modules'), to: 'dsh/node_modules', filter: ['**/*'] },
    { from: 'resources/icon.png', to: 'icon.png' },
    ...(target === 'win-x64' ? [{ from: 'resources/tray-windows.ico', to: 'tray.ico' }] : []),
    { from: '../../LICENSE', to: 'notices/DSH-LICENSE' },
    { from: '../../THIRD_PARTY_NOTICES.md', to: 'notices/DSH-THIRD-PARTY-NOTICES.md' },
  ],
  mac: {
    icon: fileURLToPath(new URL('./assets/icon.icns', import.meta.url)),
    category: 'public.app-category.developer-tools',
    identity: '-',
    // Preserve bundled runtime signatures; ASAR contains the rest of nested application bundles.
    signIgnore: ['/Contents/Resources/dsh(?:/|$)', '/Contents/Resources/runtime/primary-runtime(?:/|$)', '\\.pak$'],
    hardenedRuntime: false,
    notarize: false,
    target: [{ target: 'zip', arch: ['arm64'] }],
  },
  win: {
    icon: fileURLToPath(new URL('./assets/icon.ico', import.meta.url)),
    signExecutable: false,
    target: [{ target: 'zip', arch: ['x64'] }],
  },
  publish: null,
}
