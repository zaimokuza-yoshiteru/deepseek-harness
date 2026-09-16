/** Internal ZIP distribution; no npm publication, installer, or automatic updater. */
import { resolveDesktopTargetBuildPaths } from './scripts/desktop-build-paths.mjs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const tag = process.env.DSH_DESKTOP_DISTRIBUTION_VERSION ?? '0.1.6.alpha.1.3'
const version = tag.replace('0.1.6.alpha.', '0.1.6-alpha.')
if (!/^0\.1\.6-alpha\.1\.[1-9][0-9]*$/u.test(version)) {
  throw new Error('desktop portable: expected distribution version 0.1.6.alpha.1.<positive integer>')
}
const paths = resolveDesktopTargetBuildPaths()

export default {
  appId: 'io.github.zaimokuza-yoshiteru.dsh-desktop',
  productName: 'DSH Desktop',
  artifactName: `dsh-desktop-${tag}-\${os}-\${arch}.\${ext}`,
  extraMetadata: { version },
  directories: { output: paths.artifacts },
  asar: true,
  npmRebuild: false,
  files: ['lib/*.js', 'lib/*.cjs', 'renderer/**/*', 'package.json',
    { from: paths.dsh, to: 'dsh', filter: ['**/*'] },
    { from: join(paths.dsh, 'node_modules'), to: 'dsh/node_modules', filter: ['**/*'] },
  ],
  asarUnpack: ['**/*.{node,dylib,dll,so,exe}', '**/*.so.*', '**/spawn-helper', '**/@vscode/ripgrep/bin/rg'],
  extraResources: [
    { from: paths.runtime, to: 'runtime' },
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
