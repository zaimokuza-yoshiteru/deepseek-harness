import { createHash } from 'node:crypto'
import { cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, readlinkSync, symlinkSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import ts from 'typescript'

const SOURCE_DIRS = ['packages', 'apps', 'vendor', 'native', 'python', 'scripts', 'patches', 'third_party']
const ROOT_FILES = new Set([
  'LICENSE', 'THIRD_PARTY_NOTICES.md',
  'delivery.json', 'package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml',
  'tsconfig.base.client.json', 'tsconfig.base.json', 'tsconfig.client.json', 'tsconfig.host.json', 'tsconfig.json', 'tsdown.config.ts',
])
const OPTIONAL_TEST_ROOT_FILES = new Set([
  '.editorconfig', '.gitattributes', '.gitignore',
  '.jscpd.json', '.oxlintrc.json', '.oxlintrc.staged.json', '.rgignore', 'README.md', 'architecture.svg',
  'Makefile', 'lefthook.yml', 'pytest.ini', 'tsconfig.desktop-keyboard-tests.json', 'vitest.config.ts',
  'vitest.bench.config.ts', 'vitest.e2e.config.ts', 'vitest.expected.config.ts', 'vitest.snapshot.config.ts',
  'vitest.shared.ts', 'vitest.web.config.ts', 'vitest.web.perf.config.ts', 'vitest.web-stress.config.ts',
])
const EXCLUDED_DIRS = new Set(['.local', '.artifacts', '.desktop-build', '.git', 'node_modules', 'lib', 'dist', '.cache', '.caches', '__cache__', '__pycache__', '.pytest_cache', 'coverage', '.dsh-build', '.credentials', '.profilesauth', '.typert'])
const SENSITIVE = /(?:^|\/)(?:\.env(?:\.[^/]*)?|\.npmrc|[^/]+\.(?:key|pem|p12|pfx|crt|cer|jks|keystore)|profilesauth(?:\.[^/]*)?|credentials\.(?:json|ya?ml)|(?:access|refresh)[-_]?token(?:\.[^/]*)?)$/i
const SECRET_CONTENT = /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|(?<![A-Za-z0-9])(?:gh[pousr]_|github_pat_|glpat-|xox[baprs]-)[A-Za-z0-9_-]{28,}|(?<![A-Za-z0-9])AKIA[0-9A-Z]{16}(?![A-Za-z0-9])/u
// These exact test files exercise secret redaction with synthetic values. Any byte change is scanned normally.
const REVIEWED_SECRET_TEST_FIXTURES = new Map([
  ['third_party/plugins/dsh-acp-adapter/test/unit/domain/observability/redaction.spec.ts', 'e142edc80da46e597d60d73c21aa75314aa98441008969355501b8a2956c6d0d'],
  ['third_party/plugins/dsh-acp-adapter/test/unit/runtime/stderr.spec.ts', 'bf9433ad9a7e0af430e7aa2cf6c4a922eaec20d3bf98a907de8a8c1ac4a62cf5'],
  ['third_party/plugins/dsh-acp-adapter/test/unit/runtime/agent-process-stderr.spec.ts', 'ebed9640bdaef6b75d409bc17d21ecebc6a547a822801c070def9c8e758a19ba'],
])

const TOOLING_EXTENSIONS = ['.ts', '.tsx', '.js', '.mjs', '.cjs', '.mts', '.cts', '.sh', '.ps1', '.py']
const BUILD_SCRIPT_NAMES = /^(?:build(?::.*)?|bundle|gen(?::.*)?|clean|prepack|postinstall|prepare:primary-runtime|prepare:runtime|prepare:packages|prepare:dsh|sign:primary-runtime|verify:mac-signature|package(?::.*)?|pack|export:source|dev|start)$/u
const ROOT_BUILD_SCRIPT_NAMES = /^(?:build|build:(?:lib(?::.*)?|web|desktop|native-system|plugins|official))$/u
const DESKTOP_BUILD_SCRIPT_NAMES = /^(?:build|bundle)$/u
const CONFIG_FILE = /(?:^|\/)(?:tsconfig(?:\.[^/]+)?|tsdown\.config|vite\.config|rollup\.config|postcss\.config|tailwind\.config|webpack\.config)[^/]*\.(?:json|[cm]?[jt]s)$/u
const DESKTOP_INSTALLER_CONFIG = /^apps\/desktop\/electron-builder(?:\.portable)?\.config(?:\.d)?\.(?:mjs|mts|js|ts)$/u
const IS_SUBPROCESS_LOCAL = path => path.split(sep).join('/').replace(/\\/g, '/').replace(/^\.\//, '') === 'packages/subprocess/subprocess-local'
function keepBuildScript(name, rootManifest = false, packagePath = '') {
  if (rootManifest) return ROOT_BUILD_SCRIPT_NAMES.test(name)
  if (packagePath === 'apps/desktop') return DESKTOP_BUILD_SCRIPT_NAMES.test(name)
  return BUILD_SCRIPT_NAMES.test(name)
}
const BUILD_ASSET_EXTENSIONS = ['nsh', 'plist', 'cmd', 'ps1', 'ico', 'icns', 'png', 'svg', 'py', 'json', 'yml', 'yaml', 'txt']

function resolveLocalImport(root, importer, specifier) {
  if (!specifier.startsWith('.')) return null
  const base = resolve(dirname(resolve(root, importer)), specifier)
  for (const candidate of [base, ...TOOLING_EXTENSIONS.map(ext => `${base}${ext}`), ...TOOLING_EXTENSIONS.map(ext => resolve(base, `index${ext}`))]) {
    try { if (lstatSync(candidate).isFile()) return relative(root, candidate).split(sep).join('/') } catch {}
  }
  return null
}

function nearestPackageRoot(root, importer) {
  let candidate = dirname(resolve(root, importer))
  while (candidate.startsWith(root + sep)) {
    if (existsSync(resolve(candidate, 'package.json'))) return candidate
    const parent = dirname(candidate)
    if (parent === candidate) break
    candidate = parent
  }
  return root
}

// Build tooling is the closure of actual workspace build/lifecycle script entries,
// package-manager script calls, and their local imports. This avoids exporting
// unrelated maintainer, upload, release, test, and benchmark programs.
export function collectBuildToolingFiles(root) {
  root = resolve(root)
  const manifests = [...ROOT_FILES].includes('package.json') && existsSync(resolve(root, 'package.json')) ? ['package.json'] : []
  for (const dir of SOURCE_DIRS) manifests.push(...walk(root, dir).filter(path => path.endsWith('/package.json')))
  const entries = []
  const manifestScripts = new Map()
  for (const path of manifests) {
    let manifest
    try { manifest = JSON.parse(readFileSync(resolve(root, path), 'utf8')) } catch { continue }
    const base = dirname(path) === '.' ? '' : dirname(path)
    const selected = Object.entries(manifest.scripts ?? {}).filter(([name]) => keepBuildScript(name, base === '', base))
    manifestScripts.set(base, new Map(selected))
    for (const [name, command] of selected) {
      if (name === 'postinstall' && !IS_SUBPROCESS_LOCAL(base)) continue
      for (const match of String(command).matchAll(/(?:^|\s)(\.\.?\/[^\s;&|]+|(?:[\w./@-]+\/)+[\w.@-]+\.(?:ts|tsx|js|mjs|cjs|mts|cts|sh|ps1|py))(?:\s|$)/gu)) {
        const raw = match[1].replace(/["']/g, '')
        const entry = resolve(root, base, raw)
        if (entry.startsWith(root + sep)) entries.push(relative(root, entry).split(sep).join('/'))
      }
    }
  }
  const included = new Set()
  // tsconfig.base.client.json resolves this ambient declaration through its
  // configured typeRoots, so it is not reachable from a source import.
  const buildSupport = 'scripts/types/client-build-environment/index.d.ts'
  if (existsSync(resolve(root, buildSupport))) included.add(buildSupport)
  const pending = [...entries]
  const importPattern = /(?:import|export)\s+(?:[^'";]*?\s+from\s*)?['"](\.[^'"]+)['"]|import\(\s*['"](\.[^'"]+)['"]\s*\)|require\(\s*['"](\.[^'"]+)['"]\s*\)/gu
  const enqueuePackageScript = (base, name) => {
    const command = manifestScripts.get(base)?.get(name)
    if (!command) return
    for (const entry of String(command).matchAll(/(?:^|\s)(\.\.?\/[^\s;&|]+|(?:[\w./@-]+\/)+[\w.@-]+\.(?:ts|tsx|js|mjs|cjs|mts|cts|sh|ps1|py))(?:\s|$)/gu)) {
      const target = resolve(root, base, entry[1].replace(/[\[\]]/g, ''))
      if (target.startsWith(root + sep)) pending.push(relative(root, target).split(sep).join('/'))
    }
  }
  while (pending.length) {
    const path = pending.pop()
    if (included.has(path) || !existsSync(resolve(root, path))) continue
    included.add(path)
    let content
    try { content = readFileSync(resolve(root, path), 'utf8') } catch { continue }
    for (const match of content.matchAll(importPattern)) {
      const dependency = resolveLocalImport(root, path, match[1] ?? match[2] ?? match[3])
      if (dependency) pending.push(dependency)
    }
    for (const match of content.matchAll(new RegExp(`['"]((?:\\.\\.?/)?(?:[\\w.-]+/)*[\\w.@-]+\\.(?:${[...TOOLING_EXTENSIONS.map(ext => ext.slice(1)), ...BUILD_ASSET_EXTENSIONS].join('|')}))['"]`, 'gu'))) {
      const bases = [resolve(root, dirname(path)), root, nearestPackageRoot(root, path)]
      const candidate = bases.map(base => resolve(base, match[1])).find(value => value.startsWith(root + sep) && existsSync(value))
      if (candidate) pending.push(relative(root, candidate).split(sep).join('/'))
    }
    // Resolve script calls against the containing package manifest. Desktop
    // packaging invokes these through runScript/execute arrays rather than text commands.
    const packageRoot = relative(root, nearestPackageRoot(root, path)).split(sep).join('/')
    const base = packageRoot === '.' ? '' : packageRoot
    for (const match of content.matchAll(/(?:pnpm|npm)\s+(?:--[^\s]+\s+)*run\s+([\w:-]+)/gu)) enqueuePackageScript(base, match[1])
    for (const match of content.matchAll(/runScript\(\s*['"]([\w:-]+)['"]\s*|execute\(\[\s*['"]run['"]\s*,\s*['"]([\w:-]+)['"]/gu)) {
      enqueuePackageScript(base, match[1] ?? match[2])
    }
  }
  // Workspace compiler projects include some scripts by tsconfig glob rather
  // than by a build command. Keep only script files that product source imports.
  const productionFiles = SOURCE_DIRS.flatMap(dir => walk(root, dir)).filter(path => sourceAllowed(path, false)
    && /\.(?:ts|tsx|js|mjs|cjs|mts|cts)$/u.test(path)
    && !path.split('/').some(part => part === 'scripts' || part === 'tools'))
  for (const path of productionFiles) {
    let content
    try { content = readFileSync(resolve(root, path), 'utf8') } catch { continue }
    for (const match of content.matchAll(importPattern)) {
      const dependency = resolveLocalImport(root, path, match[1] ?? match[2] ?? match[3])
      if (dependency && /(?:^|\/)scripts\//u.test(dependency)) included.add(dependency)
    }
  }
  // TypeScript resolves ESM declaration companions alongside JavaScript imports.
  for (const path of [...included]) {
    if (!/\.(?:mjs|js)$/u.test(path)) continue
    for (const declaration of [`${path.slice(0, path.lastIndexOf('.'))}.d.mts`, `${path.slice(0, path.lastIndexOf('.'))}.d.ts`]) {
      if (existsSync(resolve(root, declaration))) included.add(declaration)
    }
  }
  return included
}

function sourceAllowed(path, withTests, buildTooling = null) {
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
  // Keep the build and packaging closure, but never ship standalone CI,
  // upload, test, fixture, or portable-smoke entry points in the default archive.
  if (!withTests && parts[0] === 'scripts' && /^(?:test-|coverage-|session-snapshot-corpus)/u.test(parts.at(-1) ?? '')) return false
  if (!withTests && DESKTOP_INSTALLER_CONFIG.test(normalized)) return false
  if (!withTests && parts[0] === 'apps' && parts[1] === 'desktop' && parts[2] === 'scripts'
    && /^(?:ci-|upload-|smoke-|replay-portable-smoke\.)/u.test(parts.at(-1) ?? '')) return false
  if (/\.(?:log|tsbuildinfo)$/i.test(normalized) || parts.at(-1) === '.DS_Store') return false
  if (parts[0] === '.maintenance' && !(withTests && parts[1] === 'tests')) return false
  if ((parts[0] === '.github' || parts[0] === '.maintenance') && !withTests) return false
  if (parts[0] === 'docs' || (parts[0] === 'snapshots' && !withTests)) return false
  if (!withTests && (parts[0] === '.github' || (parts[0] === 'benchmarks' && normalized !== 'benchmarks/package.json'))) return false
  if (!withTests && /(?:^|\/)(?:README|AGENTS|CONTRIBUTING|CHANGELOG|architecture)(?:\.[^/]*)?$/i.test(normalized)) return false
  if (!withTests && (parts.includes('testing') || parts.includes('benchmarks') && normalized !== 'benchmarks/package.json' || parts.includes('fixtures') || parts.includes('__snapshots__')
    || /(?:^|[-_.])(?:benchmark|benchmarks)(?:[-_.]|$)/i.test(parts.at(-1) ?? '')
    || normalized === 'native/system/scripts/build-test-oracle.mjs')) return false
  if (!withTests && parts[0] === 'scripts' && buildTooling && !buildTooling.has(normalized)) return false
  if (!withTests && /(?:^|\/)(?:scripts|tools)\//.test(normalized) && buildTooling && !buildTooling.has(normalized) && parts.some(part => ['native', 'apps', 'third_party'].includes(part))) return false
  if (!withTests && parts.at(-1)?.toLowerCase().startsWith('readme.')) return false
  if (!withTests && CONFIG_FILE.test(normalized) && /(?:test|bench|e2e|snapshot|stress|perf)/i.test(parts.at(-1) ?? '')) return false
  if (!withTests && (/^vitest\.(?:bench|e2e|expected|snapshot|web-stress|web-perf)\.config\.ts$/.test(normalized) || normalized === 'tsconfig.desktop-keyboard-tests.json')) return false
  if (!withTests && (parts.some(part => ['tests', 'test', 'stress-tests', 'fixtures', '__tests__'].includes(part)) || /\.(?:spec|test|e2e)\.[cm]?[jt]sx?$/i.test(normalized))) return false
  if (parts.length === 1) return ROOT_FILES.has(normalized) || (withTests && OPTIONAL_TEST_ROOT_FILES.has(normalized)) || SOURCE_DIRS.includes(normalized)
  if (!withTests && normalized === 'benchmarks/package.json') return true
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
  const buildTooling = withTests ? null : collectBuildToolingFiles(root)
  const candidates = [...ROOT_FILES, ...(withTests ? OPTIONAL_TEST_ROOT_FILES : [])].filter(path => pathExistsWithoutFollowing(root, path))
  for (const dir of SOURCE_DIRS) candidates.push(...walk(root, dir, withTests))
  if (!withTests && pathExistsWithoutFollowing(root, 'benchmarks/package.json')) candidates.push('benchmarks/package.json')
  if (withTests) {
    candidates.push(...walk(root, 'benchmarks', withTests))
    candidates.push(...walk(root, '.maintenance/tests', withTests))
    candidates.push(...walk(root, '.github', withTests))
    candidates.push(...walk(root, 'snapshots', withTests))
  }
  const allCandidates = [...new Set(candidates.map(path => path.split(sep).join('/')))].filter(path => pathExistsWithoutFollowing(root, path)).sort()
  const files = allCandidates.filter(path => sourceAllowed(path, withTests, buildTooling))
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

function cleanPackageManifest(target, relativePath, withTests, rootManifest = false) {
  const manifest = JSON.parse(readFileSync(target, 'utf8'))
  let changed = false
  if (!withTests && manifest.scripts) {
    for (const [name, command] of Object.entries(manifest.scripts)) {
      const packageBase = dirname(relativePath) === '.' ? '' : dirname(relativePath)
      const keep = keepBuildScript(name, rootManifest, packageBase)
        && !(name === 'postinstall' && !IS_SUBPROCESS_LOCAL(packageBase))
      if (testOnlyScript(name, String(command)) || !keep) {
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

function fullPluginSourceRecords(root) {
  const path = resolve(root, 'third_party/plugins/sources.json')
  if (!existsSync(path)) return []
  const registry = JSON.parse(readFileSync(path, 'utf8'))
  return (registry.plugins ?? []).map(plugin => ({ name: plugin.name, source: plugin.source, version: plugin.version, sourceSha256: plugin.sourceSha256 }))
}

function filteredPayloadSha256(output, paths) {
  const hash = createHash('sha256')
  for (const path of [...new Set(paths)].filter(path => path !== 'source-files.json' && path !== 'source-revision.json').sort()) {
    const bytes = readFileSync(resolve(output, path))
    const name = Buffer.from(path, 'utf8')
    hash.update(String(name.length)).update(':').update(name).update(String(bytes.length)).update(':').update(bytes)
  }
  return hash.digest('hex')
}

export function writeSourceMetadata(root, output, files, withTests = false, commit = getRevision(root), excludedSensitiveFiles = [], distributionVersion = null) {
  const revisionInfo = { commit, sourceRevisionKnown: Boolean(commit) }
  writeFileSync(resolve(output, 'source-revision.json'), JSON.stringify(revisionInfo, null, 2) + '\n')
  const delivered = [...files, 'source-revision.json'].sort()
  const hashes = delivered.map(path => {
    const target = resolve(output, path)
    const stat = lstatSync(target)
    return {
      path,
      sha256: createHash('sha256').update(readFileSync(target)).digest('hex'),
      // portable tar normalizes symlink entries to 0755; record the archive's mode.
      mode: stat.isSymbolicLink() ? 0o755 : stat.mode & 0o777,
    }
  })
  const payloadKind = withTests ? 'with-tests' : 'buildable'
  writeFileSync(resolve(output, 'source-files.json'), JSON.stringify({
    commit,
    distributionVersion,
    exportedWorkingTree: true,
    exportedAt: new Date().toISOString(),
    testsIncluded: withTests,
    payloadKind,
    filteredPayloadSha256: filteredPayloadSha256(output, delivered),
    filteredPayloadSha256Algorithm: 'SHA-256 over sorted POSIX paths, each framed as UTF-8 path byte length + colon + path bytes + file byte length + colon + file bytes; excludes source-files.json and source-revision.json.',
    sourcesJsonFullPluginSha256: fullPluginSourceRecords(root),
    excludedSensitiveFiles,
    files: hashes,
  }, null, 2) + '\n')
}

export function exportSource(root, destination, files = collectSourceFiles(root), withTests = false) {
  root = resolve(root)
  destination = resolve(destination)
  if (existsSync(destination)) throw new Error('Output must be a new directory; existing files are never overwritten.')
  if (destination === root || root.startsWith(destination + sep)) throw new Error('Output must not contain the source checkout.')
  if (destination.startsWith(root + sep) && !destination.startsWith(resolve(root, '.artifacts') + sep)) throw new Error('Output inside the checkout must be under .artifacts/.')
  const buildTooling = withTests ? null : collectBuildToolingFiles(root)
  const requested = [...new Set(files)].filter(path => pathExistsWithoutFollowing(root, path))
  validateMembers(root, requested)
  const candidates = requested.filter(path => sourceAllowed(path, withTests, buildTooling))
  const selected = candidates.filter(path => !containsSensitiveContent(root, path, withTests))
  mkdirSync(destination, { recursive: true })
  for (const path of selected) {
    const source = resolve(root, path)
    const target = resolve(destination, path)
    mkdirSync(dirname(target), { recursive: true })
    if (lstatSync(source).isSymbolicLink()) symlinkSync(readlinkSync(source), target)
    else cpSync(source, target, { recursive: true })
    rewriteTypeScriptConfig(root, destination, path, withTests)
    if (path.endsWith('/package.json') || path === 'package.json') cleanPackageManifest(target, path.split(sep).join('/'), withTests, path === 'package.json')
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
