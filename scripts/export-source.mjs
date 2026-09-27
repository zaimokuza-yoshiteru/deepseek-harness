import { createHash } from 'node:crypto'
import { cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, readlinkSync, symlinkSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import ts from 'typescript'

const SOURCE_DIRS = ['packages', 'apps', 'vendor', 'native', 'python', 'scripts', 'patches', 'third_party']
const ROOT_FILES = new Set([
  '.editorconfig', '.gitattributes', '.gitignore', '.jscpd.json', '.oxlintrc.json', '.oxlintrc.staged.json', '.rgignore',
  // README.md and its diagram describe the architecture and local changes.
  'LICENSE', 'THIRD_PARTY_NOTICES.md', 'README.md', 'architecture.svg',
  'Makefile', 'lefthook.yml', 'delivery.json', 'package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'pytest.ini', 'tsconfig.base.client.json',
  'tsconfig.base.json', 'tsconfig.client.json', 'tsconfig.host.json', 'tsconfig.json', 'tsconfig.desktop-keyboard-tests.json', 'tsdown.config.ts', 'vitest.config.ts',
  'vitest.bench.config.ts', 'vitest.e2e.config.ts', 'vitest.expected.config.ts', 'vitest.snapshot.config.ts',
  'vitest.shared.ts', 'vitest.web.config.ts', 'vitest.web.perf.config.ts', 'vitest.web-stress.config.ts',
])
const EXCLUDED_DIRS = new Set(['.local', '.artifacts', '.desktop-build', '.git', 'node_modules', 'lib', 'dist', '.cache', '.caches', '__cache__', '__pycache__', '.pytest_cache', 'coverage', '.dsh-build', '.credentials', '.profilesauth', '.typert'])
const SENSITIVE = /(?:^|\/)(?:\.env(?:\.[^/]*)?|\.npmrc|[^/]+\.(?:key|pem|p12|pfx|crt|cer|jks|keystore)|profilesauth(?:\.[^/]*)?|credentials\.(?:json|ya?ml)|(?:access|refresh)[-_]?token(?:\.[^/]*)?)$/i
const SECRET_CONTENT = /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|(?<![A-Za-z0-9])(?:gh[pousr]_|github_pat_|glpat-|xox[baprs]-)[A-Za-z0-9_-]{28,}|(?<![A-Za-z0-9])AKIA[0-9A-Z]{16}(?![A-Za-z0-9])/u
// These exact test files exercise secret redaction with synthetic values. Any byte change is scanned normally.
const REVIEWED_SECRET_TEST_FIXTURES = new Map([
  ['third_party/plugins/dsh-acp-adapter/test/unit/domain/observability/redaction.spec.ts', 'd8cbf34820fa5d01eb1e18ebc09248334602c5c606705d8778f651bbe44b9fef'],
  ['third_party/plugins/dsh-acp-adapter/test/unit/runtime/stderr.spec.ts', '697c20502ca138041bcb69c3a4968e9a9eb4d6ae549257051aafde30566c8704'],
])

function sourceAllowed(path, withTests) {
  const normalized = path.split(sep).join('/')
  const parts = normalized.split('/')
  if (!normalized || normalized === 'source-files.json' || normalized === 'source-revision.json') return false
  if (parts.some(part => EXCLUDED_DIRS.has(part))) return false
  if (/^native\/system\/packages\/[^/]+\/bin(?:\/|$)/u.test(normalized)
    || normalized.startsWith('python/sdk-runtime/src/deepseek_harness_runtime/runtime/')) return false
  if (SENSITIVE.test(normalized) && !normalized.endsWith('.example')) {
    const testFixtureCertificate = withTests && parts.includes('fixtures') && /\.(?:key|pem|p12|pfx|crt|cer)$/i.test(normalized)
    if (!testFixtureCertificate) return false
  }
  if (/\.(?:log|tsbuildinfo)$/i.test(normalized) || parts.at(-1) === '.DS_Store') return false
  if (parts[0] === '.maintenance' && !(withTests && parts[1] === 'tests')) return false
  if ((parts[0] === '.github' || parts[0] === '.maintenance') && !withTests) return false
  if (parts[0] === 'docs' || (parts[0] === 'snapshots' && !withTests)) return false
  if (parts[0] === 'benchmarks' && !withTests) return false
  if (!withTests && (/^vitest\.(?:bench|e2e|expected|snapshot|web-stress|web-perf)\.config\.ts$/.test(normalized) || normalized === 'tsconfig.desktop-keyboard-tests.json')) return false
  if (!withTests && (parts.some(part => ['tests', 'test', 'stress-tests', 'fixtures', '__tests__'].includes(part)) || /\.(?:spec|test|e2e)\.[cm]?[jt]sx?$/i.test(normalized))) return false
  if (parts.length === 1) return ROOT_FILES.has(normalized) || SOURCE_DIRS.includes(normalized)
  const testRoots = withTests && (parts[0] === '.github' || parts[0] === 'benchmarks' || parts[0] === 'snapshots' || (parts[0] === '.maintenance' && parts[1] === 'tests'))
  if (!SOURCE_DIRS.includes(parts[0]) && !testRoots) return false
  // Skill instructions and legal notices/licenses are runtime/tooling or legal source material.
  const base = parts.at(-1)
  if (/^(?:SKILL\.md|LICENSE(?:\..*)?|COPYING(?:\..*)?|NOTICE(?:\..*)?)$/i.test(base)) return true
  return true
}

export const includeSource = sourceAllowed

function containsSensitiveContent(root, path, withTests) {
  const parts = path.split('/')
  const bytes = readFileSync(resolve(root, path))
  const reviewedHash = REVIEWED_SECRET_TEST_FIXTURES.get(path)
  if (reviewedHash && createHash('sha256').update(bytes).digest('hex') === reviewedHash) return false
  if (withTests && parts.includes('tests') && parts.includes('fixtures')) return false
  if (bytes.includes(0)) return false
  return SECRET_CONTENT.test(bytes.toString('utf8'))
}

function validateMembers(root, members) {
  const memberSet = new Set(members)
  for (const path of members) {
    const source = resolve(root, path)
    if (isAbsolute(path) || !source.startsWith(root + sep)) throw new Error(`Invalid source member: ${path}`)
    if (lstatSync(source).isSymbolicLink()) {
      const target = readlinkSync(source)
      const resolvedTarget = resolve(dirname(source), target)
      const relativeTarget = relative(root, resolvedTarget).split(sep).join('/')
      if (isAbsolute(target) || !resolvedTarget.startsWith(root + sep) || !memberSet.has(relativeTarget)) throw new Error(`Symlink escapes the exported source: ${path}`)
    }
  }
}

function walk(root, relativeDir = '', withTests = false) {
  const absolute = resolve(root, relativeDir)
  if (!existsSync(absolute)) return []
  const result = []
  for (const entry of readdirSync(absolute, { withFileTypes: true })) {
    const path = relativeDir ? `${relativeDir}/${entry.name}` : entry.name
    if (entry.isDirectory()) {
      if (!EXCLUDED_DIRS.has(entry.name) && (path !== '.github' || withTests) && (path !== '.maintenance' || withTests)) result.push(...walk(root, path, withTests))
    } else result.push(path)
  }
  return result
}

function pathExistsWithoutFollowing(root, path) {
  try { lstatSync(resolve(root, path)); return true } catch { return false }
}

export function collectSourceInventory(root, withTests = false) {
  root = resolve(root)
  const candidates = [...ROOT_FILES].filter(path => pathExistsWithoutFollowing(root, path))
  for (const dir of SOURCE_DIRS) candidates.push(...walk(root, dir, withTests))
  if (withTests) {
    candidates.push(...walk(root, 'benchmarks', withTests))
    candidates.push(...walk(root, '.maintenance/tests', withTests))
    candidates.push(...walk(root, '.github', withTests))
    candidates.push(...walk(root, 'snapshots', withTests))
  }
  const allCandidates = [...new Set(candidates.map(path => path.split(sep).join('/')))].filter(path => pathExistsWithoutFollowing(root, path)).sort()
  const files = allCandidates.filter(path => sourceAllowed(path, withTests))
  validateMembers(root, files)
  const unsafeContent = files.filter(path => containsSensitiveContent(root, path, withTests))
  if (unsafeContent.length) throw new Error(`Sensitive content found in source files; inspect and remove or move test fixtures: ${unsafeContent.join(', ')}`)
  const excludedSensitiveFiles = allCandidates.filter(path => !sourceAllowed(path, withTests) && SENSITIVE.test(path)).map(path => ({ path, reason: 'sensitive filename or file type' }))
  return { files, excludedSensitiveFiles }
}

export function collectSourceFiles(root, withTests = false) {
  return collectSourceInventory(root, withTests).files
}

function testOnlyScript(name, command) {
  return /^(?:test|tests|test:|test-|test\.)/i.test(name) || /(?:^|[\s/])(?:\.maintenance\/|[^\s]*\/(?:tests?|__tests__)\/)/.test(command)
}

function cleanPackageManifest(target, withTests) {
  const manifest = JSON.parse(readFileSync(target, 'utf8'))
  let changed = false
  if (!withTests && manifest.scripts) {
    for (const [name, command] of Object.entries(manifest.scripts)) {
      if (testOnlyScript(name, String(command))) {
        delete manifest.scripts[name]
        changed = true
      }
    }
  }
  if (changed) writeFileSync(target, JSON.stringify(manifest, null, 2) + '\n')
}

function rewriteTypeScriptConfig(root, destination, path, withTests) {
  if (withTests || !/^tsconfig(?:\..*)?\.json$/.test(path.split('/').at(-1))) return
  const source = resolve(root, path)
  const target = resolve(destination, path)
  const parsed = ts.parseConfigFileTextToJson(source, readFileSync(source, 'utf8'))
  if (parsed.error) throw new Error(`Cannot parse TypeScript config: ${path}`)
  const config = parsed.config
  const keep = value => {
    const candidate = relative(root, resolve(dirname(source), value)).split(sep).join('/')
    return sourceAllowed(candidate, false)
  }
  for (const key of ['files', 'include']) if (Array.isArray(config[key])) config[key] = config[key].filter(keep)
  if (Array.isArray(config.references)) config.references = config.references.filter(ref => keep(ref.path))
  writeFileSync(target, JSON.stringify(config, null, 2) + '\n')
}

function getRevision(root) {
  if (existsSync(resolve(root, '.git'))) {
    try { return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() } catch {}
  }
  const revisionFile = resolve(root, 'source-revision.json')
  if (existsSync(revisionFile)) {
    try { return JSON.parse(readFileSync(revisionFile, 'utf8')).commit ?? null } catch {}
  }
  return process.env.DSH_SOURCE_REVISION || null
}

export function writeSourceMetadata(root, output, files, withTests = false, commit = getRevision(root), excludedSensitiveFiles = [], distributionVersion = null) {
  const revisionInfo = { commit, sourceRevisionKnown: Boolean(commit) }
  writeFileSync(resolve(output, 'source-revision.json'), JSON.stringify(revisionInfo, null, 2) + '\n')
  const delivered = [...files, 'source-revision.json'].sort()
  const hashes = delivered.map(path => ({ path, sha256: createHash('sha256').update(readFileSync(resolve(output, path))).digest('hex') }))
  writeFileSync(resolve(output, 'source-files.json'), JSON.stringify({ commit, distributionVersion, exportedWorkingTree: true, exportedAt: new Date().toISOString(), testsIncluded: withTests, excludedSensitiveFiles, files: hashes }, null, 2) + '\n')
}

export function exportSource(root, destination, files = collectSourceFiles(root), withTests = false) {
  root = resolve(root)
  destination = resolve(destination)
  if (existsSync(destination)) throw new Error('Output must be a new directory; existing files are never overwritten.')
  if (destination === root || root.startsWith(destination + sep)) throw new Error('Output must not contain the source checkout.')
  if (destination.startsWith(root + sep) && !destination.startsWith(resolve(root, '.artifacts') + sep)) throw new Error('Output inside the checkout must be under .artifacts/.')
  const candidates = [...new Set(files)].filter(path => sourceAllowed(path, withTests) && pathExistsWithoutFollowing(root, path))
  validateMembers(root, candidates)
  const selected = candidates.filter(path => !containsSensitiveContent(root, path, withTests))
  mkdirSync(destination, { recursive: true })
  for (const path of selected) {
    const source = resolve(root, path)
    const target = resolve(destination, path)
    mkdirSync(dirname(target), { recursive: true })
    if (lstatSync(source).isSymbolicLink()) symlinkSync(readlinkSync(source), target)
    else cpSync(source, target, { recursive: true })
    rewriteTypeScriptConfig(root, destination, path, withTests)
    if (path.endsWith('/package.json') || path === 'package.json') cleanPackageManifest(target, withTests)
  }
  return selected.length
}

export function runCli() {
  const { values } = parseArgs({ options: { output: { type: 'string' }, 'with-tests': { type: 'boolean', default: false } } })
  if (!values.output) throw new Error('Usage: node scripts/export-source.mjs --output <new directory> [--with-tests]')
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  const inventory = collectSourceInventory(root, values['with-tests'])
  const { files } = inventory
  const revision = getRevision(root)
  exportSource(root, values.output, files, values['with-tests'])
  const output = resolve(values.output)
  writeSourceMetadata(root, output, files, values['with-tests'], revision, inventory.excludedSensitiveFiles)
  console.log(`Exported ${files.length} files to ${output}; tests ${values['with-tests'] ? 'included' : 'omitted'}.`)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) runCli()
