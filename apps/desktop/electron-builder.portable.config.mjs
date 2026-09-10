/** Internal ZIP distribution; no npm publication, installer, or automatic updater. */
import { resolveDesktopTargetBuildPaths } from './scripts/desktop-build-paths.mjs'
import { fileURLToPath } from 'node:url'

const version = process.env.DSH_DESKTOP_DISTRIBUTION_VERSION ?? '0.1.5-rc.1.1'
if (!/^0\.1\.5-rc\.1\.[1-9][0-9]*$/u.test(version)) {
  throw new Error('desktop portable: expected distribution version 0.1.5-rc.1.<positive integer>')
}
const paths = resolveDesktopTargetBuildPaths()
const icon = fileURLToPath(new URL('./assets/icon.svg', import.meta.url))

export default {
  appId: 'io.github.zaimokuza-yoshiteru.dsh-desktop',
  productName: 'DSH Desktop',
  artifactName: 'dsh-desktop-${version}-${os}-${arch}.${ext}',
  extraMetadata: { version },
  directories: { output: paths.artifacts },
  asar: true,
  npmRebuild: false,
  files: ['lib/*.js', 'lib/*.cjs', 'renderer/**/*', 'package.json'],
  extraResources: [
    { from: paths.runtime, to: 'runtime' },
    { from: paths.seed, to: 'seed' },
    { from: '../../LICENSE', to: 'notices/DSH-LICENSE' },
    { from: '../../THIRD_PARTY_NOTICES.md', to: 'notices/DSH-THIRD-PARTY-NOTICES.md' },
  ],
  mac: {
    icon,
    category: 'public.app-category.developer-tools',
    identity: '-',
    hardenedRuntime: false,
    notarize: false,
    target: [{ target: 'zip', arch: ['arm64'] }],
  },
  win: {
    icon,
    signExecutable: false,
    target: [{ target: 'zip', arch: ['x64'] }],
  },
  publish: null,
}
