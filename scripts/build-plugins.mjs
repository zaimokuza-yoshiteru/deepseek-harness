import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { createRequire } from 'node:module'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { t as listTar } from 'tar'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
export const PLUGIN_OUTPUT = join(ROOT, '.artifacts', 'desktop-release-plugins')
const excluded = new Set(['node_modules', 'lib', 'dist', '.local', '.git', '.cache', '.typert', '.DS_Store'])

export function sourceDigest(directory) {
  const hash = createHash('sha256')
  const files = []
  function visit(path, prefix = '') {
    for (const entry of readdirSync(path, { withFileTypes: true }).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
      if (excluded.has(entry.name) || entry.name.endsWith('.tsbuildinfo')) continue
      const name = prefix + entry.name
      if (entry.isSymbolicLink()) throw new Error(`Plugin source must not contain symlinks: ${name}`)
      if (entry.isDirectory()) visit(join(path, entry.name), `${name}/`)
      else if (entry.isFile()) files.push(name)
    }
  }
  visit(directory)
  for (const name of files.sort()) {
    const bytes = readFileSync(join(directory, name))
    hash.update(`${Buffer.byteLength(name)}:${name}${bytes.length}:`).update(bytes)
  }
  return hash.digest('hex')
}

function run(command, args, cwd, environment, capture = false) {
  let executable = command
  let arguments_ = args
  if (command === 'pnpm') {
    const require = createRequire(join(ROOT, 'apps/desktop/package.json'))
    const entry = join(dirname(require.resolve('pnpm')), 'bin/pnpm.cjs')
    executable = process.execPath
    arguments_ = [entry, '--ignore-workspace', ...args]
  } else if (command === 'npm') {
    const candidates = [join(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js'),
      resolve(dirname(process.execPath), '../lib/node_modules/npm/bin/npm-cli.js')]
    const entry = candidates.find(path => existsSync(path))
    if (entry) { executable = process.execPath; arguments_ = [entry, ...args] }
    else if (process.platform === 'win32') throw new Error('Install Node.js with its npm CLI before building plugins.')
  }
  const child = spawnSync(executable, arguments_, {
    cwd, env: environment,
    ...(capture ? { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] } : { stdio: 'inherit' }),
  })
  if (child.error) throw child.error
  if (child.status !== 0) throw new Error(`${command} ${args.join(' ')} failed in ${cwd} (${child.status})`)
  return child.stdout
}

export async function verifyPluginArchive(archive, expected) {
  const members = new Map()
  await listTar({ file: archive, onReadEntry(entry) {
    const name = entry.path
    if (!name.startsWith('package/') || name.split('/').includes('..') || !['File', 'Directory'].includes(entry.type)) {
      throw new Error(`Unsafe plugin archive member: ${name}`)
    }
    if (/(?:^|\/)(?:\.env(?:\.[^/]*)?|\.npmrc|\.git|\.local|node_modules)(?:\/|$)|\.(?:pem|key|p12|pfx)$/iu.test(name)) {
      throw new Error(`Private material is not a plugin artifact: ${name}`)
    }
    if (entry.type !== 'File') return
    const chunks = []
    entry.on('data', chunk => chunks.push(chunk))
    entry.on('end', () => members.set(name.slice(8), Buffer.concat(chunks)))
  } })
  const manifest = JSON.parse(members.get('package.json')?.toString('utf8') ?? '{}')
  if (manifest.name !== expected.name || manifest.version !== expected.version) throw new Error(`Plugin identity mismatch: ${archive}`)
  const targets = [manifest.main, manifest.icon, manifest.dsh?.bundle?.patch]
  function exports(value) {
    if (typeof value === 'string') targets.push(value)
    else if (value && typeof value === 'object') Object.values(value).forEach(exports)
  }
  exports(manifest.exports)
  for (const target of targets.filter(value => typeof value === 'string' && value.startsWith('./') && !value.includes('*'))) {
    if (!members.has(target.slice(2))) throw new Error(`Plugin ${manifest.name} is missing ${target}`)
  }
  if (!manifest.dsh?.bundle?.patch) throw new Error(`Missing plugin bundle patch: ${manifest.name}`)
  for (const [name, bytes] of members) {
    if (!/\.(?:[cm]?js|json|css|yml|yaml|map|md|txt)$/u.test(name)) continue
    const text = bytes.toString('utf8')
    if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|(?:ghp_|github_pat_)[A-Za-z0-9_]{30,}/u.test(text)
      || /(?<![A-Za-z]:)(?:\/Users\/[^/\s]+\/(?:work|projects|Documents)\/|\/home\/[^/\s]+\/(?:work|projects)\/)/u.test(text)) {
      throw new Error(`Private content or build path in ${manifest.name}/${name}`)
    }
  }
  return manifest
}

export async function buildPlugins({ install = true, test = false } = {}) {
  const config = JSON.parse(readFileSync(join(ROOT, 'apps/desktop/release-plugins.json'), 'utf8'))
  mkdirSync(PLUGIN_OUTPUT, { recursive: true })
  // Invalidate the previous result before starting any work.
  for (const file of ['inputs.json', 'manifest.json']) rmSync(join(PLUGIN_OUTPUT, file), { force: true })
  const environment = { ...process.env, DSH_DESKTOP_REPO: ROOT, DSH_UPSTREAM_CHECKOUT: ROOT, DSH_HARNESS_ROOT: ROOT,
    pnpm_config_verify_deps_before_run: 'false' }
  const registry = process.env.DSH_DESKTOP_NPM_REGISTRY
  if (registry) environment.npm_config_registry = registry
  const records = []
  for (const plugin of config.plugins) {
    const directory = resolve(ROOT, plugin.source)
    if (!directory.startsWith(join(ROOT, 'third_party/plugins') + sep)) throw new Error(`Invalid plugin source: ${plugin.source}`)
    const pkg = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'))
    if (pkg.name !== plugin.name) throw new Error(`Unexpected plugin package in ${plugin.source}`)
    const manager = existsSync(join(directory, 'pnpm-lock.yaml')) ? 'pnpm' : 'npm'
    if (!existsSync(join(directory, manager === 'pnpm' ? 'pnpm-lock.yaml' : 'package-lock.json'))) throw new Error(`Missing dependency lock: ${plugin.name}`)
    if (install) run(manager, manager === 'pnpm'
      ? ['install', '--ignore-workspace', '--frozen-lockfile'] : ['ci', '--no-audit', '--no-fund'], directory, environment)
    run(manager, ['run', 'build'], directory, environment)
    if (test) run(manager, ['run', 'test'], directory, environment)
    const staging = mkdtempSync(join(tmpdir(), 'dsh-plugin-pack-'))
    try {
      // Isolate npm packing from ancestor README and LICENSE files.
      const isolated = join(staging, 'package')
      cpSync(directory, isolated, { recursive: true, filter: path => {
        const parts = path.slice(directory.length).split(/[\\/]/u)
        return !parts.some(part => part !== 'lib' && excluded.has(part)) && !path.endsWith('.tsbuildinfo')
      } })
      const [packed] = JSON.parse(run('npm', ['pack', '--ignore-scripts', '--json', '--cache', join(PLUGIN_OUTPUT, 'npm-cache'), '--pack-destination', staging], isolated, environment, true))
      const archive = join(staging, packed.filename)
      await verifyPluginArchive(archive, pkg)
      cpSync(archive, join(PLUGIN_OUTPUT, packed.filename))
      records.push({ name: pkg.name, version: pkg.version, source: plugin.source,
        sourceSha256: sourceDigest(directory), asset: packed.filename,
        sha256: createHash('sha256').update(readFileSync(archive)).digest('hex') })
    } finally { rmSync(staging, { recursive: true, force: true }) }
  }
  const keep = new Set(records.map(record => record.asset))
  for (const file of readdirSync(PLUGIN_OUTPUT)) if (file.endsWith('.tgz') && !keep.has(file)) rmSync(join(PLUGIN_OUTPUT, file))
  writeFileSync(join(PLUGIN_OUTPUT, 'manifest.json'), JSON.stringify({ schemaVersion: 1, plugins: records }, null, 2) + '\n')
  writeFileSync(join(PLUGIN_OUTPUT, 'inputs.json'), JSON.stringify(records.map(record => join(PLUGIN_OUTPUT, record.asset))) + '\n')
  console.log(`Built ${records.length} plugins from repository sources.`)
  return records
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: { 'skip-install': { type: 'boolean', default: false }, test: { type: 'boolean', default: false } } })
  await buildPlugins({ install: !values['skip-install'], test: values.test })
}
