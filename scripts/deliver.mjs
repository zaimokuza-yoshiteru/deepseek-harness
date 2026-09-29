import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFileSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { resolveDesktopDistributionVersion } from './desktop-distribution-version.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const config = JSON.parse(readFileSync(join(root, 'delivery.json'), 'utf8'))
const { values } = parseArgs({ options: { target: { type: 'string' }, version: { type: 'string' } } })
const target = values.target ?? (process.platform === 'darwin' && process.arch === 'arm64' ? 'mac-arm64' : process.platform === 'win32' ? 'win-x64' : undefined)
if (!config.targets.includes(target)) throw new Error(`Specify --target ${config.targets.join(' or ')} on the corresponding build machine.`)
const { tag: version } = resolveDesktopDistributionVersion(config,
  values.version ?? process.env.DSH_DESKTOP_DISTRIBUTION_VERSION)
const environment = { ...process.env, DSH_DESKTOP_DISTRIBUTION_VERSION: version }
function run(command, args) {
  const child = spawnSync(command, args, { cwd: root, env: environment, stdio: 'inherit', shell: process.platform === 'win32' && command.endsWith('.cmd') })
  if (child.error) throw child.error
  if (child.status !== 0) throw new Error(`Delivery step failed: ${command} ${args.join(' ')}`)
}
run(process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm', ['--dir', 'apps/desktop', 'run', `package:portable:${target.replace('-', ':')}`])
run(process.execPath, ['scripts/package-source.mjs'])
const output = join(root, '.artifacts/delivery', version)
mkdirSync(output, { recursive: true })
const desktop = `dsh-desktop-${version}-${target}.zip`
copyFileSync(join(root, 'apps/desktop/.desktop-build/targets', target, 'artifacts', desktop), join(output, desktop))
const pluginBuild = JSON.parse(readFileSync(join(root, '.artifacts/desktop-release-plugins/manifest.json'), 'utf8'))
writeFileSync(join(output, `desktop-build-${target}.json`), JSON.stringify({ version, target, plugins: pluginBuild.plugins }, null, 2) + '\n')
const checksums = readdirSync(output).filter(name => name !== 'SHA256SUMS.txt').sort().map(name => `${createHash('sha256').update(readFileSync(join(output, name))).digest('hex')}  ${name}`)
writeFileSync(join(output, 'SHA256SUMS.txt'), checksums.join('\n') + '\n')
console.log(`Delivery ready: ${output}`)
