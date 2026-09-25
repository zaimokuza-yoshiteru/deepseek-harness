/** Internal ZIP distribution; no npm publication, installer, or automatic updater. */
import { desktopTargetPlatform, resolveDesktopBuildTarget, resolveDesktopTargetBuildPaths } from './scripts/desktop-build-paths.mjs'
import { join, relative, sep } from 'node:path'
import { officePackageDirectories } from '../../scripts/libreoffice-packages.mjs'
import { prepareWindowsAsarUnpack, verifyWindowsAsarUnpack } from './scripts/windows-asar-unpack.mjs'
import { fileURLToPath } from 'node:url'

const tag = process.env.DSH_DESKTOP_DISTRIBUTION_VERSION ?? '0.1.7.rc.2.1'
const version = tag.replace('0.1.7.rc.', '0.1.7-rc.')
if (!/^0\.1\.7-rc\.2\.[1-9][0-9]*$/u.test(version)) {
  throw new Error('desktop portable: expected distribution version 0.1.7.rc.2.<positive integer>')
}
const target = resolveDesktopBuildTarget()
const paths = resolveDesktopTargetBuildPaths()

let windowsCode = []

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
  beforePack: async context => {
    const office = await officePackageDirectories(paths.dsh, desktopTargetPlatform(target))
    const patterns = office.map(directory => `**/${relative(paths.dsh, directory).split(sep).join('/')}/**/*`)
    const existing = context.packager.config.asarUnpack ?? []
    context.packager.config.asarUnpack = [...(typeof existing === 'string' ? [existing] : existing), ...patterns]
    if (context.electronPlatformName === 'win32') windowsCode = await prepareWindowsAsarUnpack(context, paths.dsh)
  },
  afterPack: async context => {
    if (context.electronPlatformName === 'win32') {
      await verifyWindowsAsarUnpack(paths.dsh, context.packager.getResourcesDir(context.appOutDir), windowsCode)
    }
  },
  files: ['lib/*.js', 'lib/*.cjs', 'lib/welcome/**/*', 'renderer/**/*', 'package.json',
    { from: paths.dsh, to: 'dsh', filter: ['**/*'] },
    { from: join(paths.dsh, 'node_modules'), to: 'dsh/node_modules', filter: ['**/*'] },
  ],
  asarUnpack: ['**/*.{node,dylib,dll,so,exe}', '**/*.so.*', '**/spawn-helper', '**/@vscode/ripgrep/bin/rg'],
  extraResources: [
    { from: paths.runtime, to: 'runtime' },
    { from: 'resources/icon.png', to: 'icon.png' },
    ...(target === 'win-x64' ? [{ from: 'resources/tray-windows.ico', to: 'tray.ico' }] : []),
    { from: join(paths.root, 'plugin-seed'), to: 'plugin-seed' },
    // Electron Builder excludes nested node_modules from a parent FileSet.
    { from: join(paths.root, 'plugin-seed', 'node_modules'), to: 'plugin-seed/node_modules', filter: ['**/*'] },
    { from: '../../LICENSE', to: 'notices/DSH-LICENSE' },
    { from: '../../THIRD_PARTY_NOTICES.md', to: 'notices/DSH-THIRD-PARTY-NOTICES.md' },
  ],
  mac: {
    icon: fileURLToPath(new URL('./assets/icon.icns', import.meta.url)),
    category: 'public.app-category.developer-tools',
    identity: '-',
    // Preserve bundled runtime signatures; ASAR contains the rest of nested application bundles.
    signIgnore: ['/Contents/Resources/app\\.asar\\.unpacked/dsh(?:/|$)', '/Contents/Resources/runtime/primary-runtime(?:/|$)', '\\.pak$'],
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
