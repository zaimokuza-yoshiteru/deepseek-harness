/** Build and verify the portable application from a non-administrator CI account. */
import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const target = process.argv[2]
const mode = process.argv[3] ?? 'build'
if (!['build', 'startup'].includes(mode)) throw new Error('Expected build or startup mode')
if (!['mac-arm64', 'win-x64'].includes(target)) throw new Error('Expected a portable desktop target')
if (process.platform === 'win32') {
  const elevated = execFileSync('powershell.exe', ['-NoProfile', '-Command',
    '([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)'], { encoding: 'utf8' }).trim()
  if (elevated !== 'False') throw new Error('Desktop CI must run without administrator membership or elevation')
} else {
  if (process.getuid() === 0) throw new Error('Desktop CI must not run as root')
  if (execFileSync('id', ['-Gn'], { encoding: 'utf8' }).trim().split(/\s+/u).includes('admin')) {
    throw new Error('Desktop CI build account must not belong to admin')
  }
}
console.log('Desktop CI: verified standard-user build identity', process.platform)
const run = args => {
  const child = spawnSync(process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm', args, {
    stdio: 'inherit', shell: process.platform === 'win32', env: process.env,
  })
  if (child.error) throw child.error
  if (child.status !== 0 || child.signal !== null) throw new Error(`Desktop CI command failed: ${args.join(' ')}`)
}
run(['install', '--frozen-lockfile', ...(mode === 'startup' ? ['--ignore-scripts'] : [])])
if (mode === 'startup') {
  const child = spawnSync(process.execPath, ['apps/desktop/scripts/startup-timing.mjs', target], {
    stdio: 'inherit', env: { ...process.env, DSH_STANDARD_USER_VERIFIED: '1' },
  })
  if (child.error) throw child.error
  if (child.status !== 0 || child.signal !== null) throw new Error('Packaged GUI startup timing failed')
  process.exit(0)
}
run(['--dir', 'native/system/packages/entry', 'run', 'build:js'])
run(['exec', 'vitest', 'run', ...[
  'npm-environment', 'project-manager', 'distribution', 'shell-environment', 'plugin-seed', 'package-target',
  'host-process', 'main-startup', 'prepare-package-set', 'locale', 'icons', 'profile-core-cleanup', 'preload-app', 'node-environment',
  'desktop-build-paths', 'development-project', 'installed-update-package-content', 'welcome-startup', 'windows-asar-unpack',
  'portable-config', 'smoke-portable', 'tray-icon', 'quit-confirmation', 'background-notice', 'tray',
].map(name => `apps/desktop/tests/${name}.spec.ts`),
...['plugin-compatibility', 'profile-compatibility', 'compatibility-preflight']
  .map(name => `packages/boot/app-boot/tests/${name}.spec.ts`),
'packages/boot/plugin-manager/tests/operations.spec.ts'])
run(['--dir', 'apps/desktop', 'run', target === 'mac-arm64' ? 'package:portable:mac:arm64' : 'package:portable:win:x64'])
const directory = join('apps/desktop/.desktop-build/targets', target, 'artifacts')
const archives = readdirSync(directory).filter(name => name.endsWith('.zip'))
const archive = `dsh-desktop-${process.env.DSH_DESKTOP_DISTRIBUTION_VERSION}-${target}.zip`
if (archives.length !== 1 || archives[0] !== archive) throw new Error('Expected exactly the release ZIP for this target')
// Exercise the recipient's complete ZIP at an independent extraction path. The native Windows
// Office engine cannot bootstrap from the deeply nested CI build output directory.
run(['exec', 'tsx', 'apps/desktop/scripts/smoke-portable.ts', target, join(directory, archive)])
const hash = createHash('sha256')
for await (const bytes of createReadStream(join(directory, archive))) hash.update(bytes)
const sha256 = hash.digest('hex')
if (target === 'mac-arm64') {
  const executable = join(directory, 'mac-arm64', 'DSH Desktop.app', 'Contents', 'MacOS', 'DSH Desktop')
  const gui = spawnSync(process.execPath, ['apps/desktop/scripts/startup-timing.mjs', target, executable], {
    stdio: 'inherit', env: { ...process.env, DSH_STANDARD_USER_VERIFIED: '1' },
  })
  if (gui.error) throw gui.error
  if (gui.status !== 0 || gui.signal !== null) throw new Error('Packaged macOS GUI startup failed')
}
mkdirSync(directory, { recursive: true })
writeFileSync(join(directory, `standard-user-${target}.json`), JSON.stringify({
  target, standardUser: true, build: 'passed', packagedSmoke: 'passed', version: process.env.DSH_DESKTOP_DISTRIBUTION_VERSION,
  archive, sha256,
}, null, 2) + '\n')
