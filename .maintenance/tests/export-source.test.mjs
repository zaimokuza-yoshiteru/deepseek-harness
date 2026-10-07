import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, symlinkSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { collectBuildToolingFiles, collectSourceFiles, collectSourceInventory, exportSource, includeSource } from '../../scripts/export-source.mjs'
import { packageSource } from '../../scripts/package-source.mjs'
import { sourceDigest } from '../../scripts/build-plugins.mjs'

test('source policy restricts origins and rejects local state, credentials, builds and docs', () => {
  assert.equal(includeSource('native/system/packages/darwin-arm64/bin/system.node', true), false)
  assert.equal(includeSource('python/sdk-runtime/src/deepseek_harness_runtime/runtime/node', true), false)
  for (const path of ['.local/profile/token.json', '.artifacts/bundle.zip', '.desktop-build/app', '.git/config', 'packages/a/node_modules/x', 'packages/a/dist/x.js', 'packages/a/.cache/x', 'packages/a/.caches/x', 'packages/a/credentials.json', 'apps/a/src/tls.key', 'apps/a/src/tls.pem', 'apps/a/profilesauth.json', 'AGENTS.md', 'docs/guide.md', 'apps/desktop/tests/boot.spec.ts']) assert.equal(includeSource(path), false, path)
  for (const path of ['LICENSE', 'THIRD_PARTY_NOTICES.md', 'packages/skill/office/SKILL.md', 'vendor/cordis/LICENSE', 'scripts/build.ts', 'third_party/plugins/example/src/index.ts', 'packages/a/src/tls.pem.example']) assert.equal(includeSource(path), true, path)
  assert.equal(includeSource('README.md'), false)
  assert.equal(includeSource('README.md', true), true)
  assert.equal(includeSource('packages/test-support/agent/src/index.ts'), true)
  for (const path of ['packages/test-support/agent/tests/fixture.test.ts', 'packages/a/src/testing/restore.ts', 'packages/a/benchmarks/run.ts', 'native/system/scripts/build-test-oracle.mjs']) assert.equal(includeSource(path), false, path)
  for (const path of ['packages/credentials/foo/src/index.ts', 'packages/a/cache/index.ts']) assert.equal(includeSource(path), true, path)
  assert.equal(includeSource('apps/desktop/tests/fixture.pem', true), false)
  assert.equal(includeSource('apps/desktop/tests/fixtures/fixture.pem', true), true)
  assert.equal(includeSource('apps/desktop/tests/boot.spec.ts', true), true)
  assert.equal(includeSource('.maintenance/tests/export-source.test.mjs', true), true)
  assert.equal(includeSource('.github/workflows/desktop-portable.yml', true), true)
})

test('collects production source and only build-script closure without git', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'dsh-source-collect-'))
  try {
    mkdirSync(join(tmp, 'apps/a/src'), { recursive: true })
    mkdirSync(join(tmp, 'scripts'), { recursive: true })
    mkdirSync(join(tmp, 'docs'), { recursive: true })
    mkdirSync(join(tmp, 'random'), { recursive: true })
    writeFileSync(join(tmp, 'apps/a/src/main.ts'), 'main')
    writeFileSync(join(tmp, 'scripts/build.ts'), 'build')
    writeFileSync(join(tmp, 'scripts/benchmark-npm-resolution.ts'), 'process.env.npm_config_verify_deps_before_run')
    writeFileSync(join(tmp, 'scripts/benchmark-npm-resolution.spec.ts'), 'const option = "skip-install"')
    writeFileSync(join(tmp, 'docs/guide.md'), 'guide')
    writeFileSync(join(tmp, 'random/secret.txt'), 'secret')
    writeFileSync(join(tmp, 'package.json'), JSON.stringify({ scripts: { build: 'tsx scripts/build.ts' } }))
    writeFileSync(join(tmp, '.editorconfig'), 'root = true\n')
    writeFileSync(join(tmp, '.gitattributes'), '* text=auto\n')
    writeFileSync(join(tmp, '.gitignore'), 'node_modules\n')
    mkdirSync(join(tmp, 'packages/credentials/foo/src'), { recursive: true })
    writeFileSync(join(tmp, 'packages/credentials/foo/src/index.ts'), 'credential module')
    mkdirSync(join(tmp, 'packages/a/.cache'), { recursive: true })
    writeFileSync(join(tmp, 'packages/a/.cache/runtime.json'), 'runtime cache')
    mkdirSync(join(tmp, 'packages/a/tests/fixtures'), { recursive: true })
    writeFileSync(join(tmp, 'packages/a/tests/fixtures/fake-token.test.ts'), 'const fixture = "' + 'ghp_' + '123456789012345678901234567890' + '"')
    writeFileSync(join(tmp, 'packages/a/credentials.json'), '{"token":"omitted"}')
    mkdirSync(join(tmp, '.github/workflows'), { recursive: true })
    writeFileSync(join(tmp, '.github/workflows/ci.yml'), 'workflow')
    mkdirSync(join(tmp, 'benchmarks'), { recursive: true })
    writeFileSync(join(tmp, 'benchmarks/run.ts'), 'benchmark')
    mkdirSync(join(tmp, '.maintenance/tests'), { recursive: true })
    writeFileSync(join(tmp, '.maintenance/tests/ci.test.mjs'), 'test')
    assert.deepEqual(collectSourceFiles(tmp), ['apps/a/src/main.ts', 'package.json', 'packages/credentials/foo/src/index.ts', 'scripts/build.ts'])
    assert.ok(!collectBuildToolingFiles(tmp).has('scripts/benchmark-npm-resolution.ts'))
    const withTests = collectSourceFiles(tmp, true)
    assert.ok(!collectSourceFiles(tmp).includes('.editorconfig'))
    assert.ok(!collectSourceFiles(tmp).includes('.gitattributes'))
    assert.ok(!collectSourceFiles(tmp).includes('.gitignore'))
    assert.ok(withTests.includes('.editorconfig'))
    assert.ok(withTests.includes('.gitattributes'))
    assert.ok(withTests.includes('.gitignore'))
    assert.ok(withTests.includes('.github/workflows/ci.yml'))
    assert.ok(withTests.includes('.maintenance/tests/ci.test.mjs'))
    assert.ok(withTests.includes('benchmarks/run.ts'))
    assert.ok(withTests.includes('packages/credentials/foo/src/index.ts'))
    assert.ok(withTests.includes('packages/a/tests/fixtures/fake-token.test.ts'))
    assert.ok(withTests.includes('scripts/benchmark-npm-resolution.spec.ts'))
    assert.ok(withTests.includes('scripts/benchmark-npm-resolution.ts'))
    assert.ok(!withTests.includes('packages/a/.cache/runtime.json'))
    const inventory = collectSourceInventory(tmp)
    assert.deepEqual(inventory.excludedSensitiveFiles, [{ path: 'packages/a/credentials.json', reason: 'sensitive filename or file type' }])
    writeFileSync(join(tmp, 'apps/a/src/leaked.ts'), 'const token = "' + 'ghp_' + '123456789012345678901234567890' + '"')
    assert.throws(() => collectSourceFiles(tmp), /Sensitive content found in source files; inspect and remove or move test fixtures: apps\/a\/src\/leaked\.ts/)
  } finally { rmSync(tmp, { recursive: true, force: true }) }
})

test('buildable desktop payload keeps only portable packaging smoke fixtures and signing closure', () => {
  const root = process.cwd()
  const inventory = new Set(collectSourceFiles(root))
  const smokeFixtures = [
    'apps/desktop/tests/fixtures/runtime-payload-smoke.mjs',
    'apps/desktop/tests/fixtures/office-conversion-inputs.py',
    'apps/desktop/tests/fixtures/plugin-metadata-smoke.mjs',
    'apps/desktop/tests/fixtures/devin-config-smoke.mjs',
    'apps/desktop/tests/fixtures/devin-cli.mjs',
    'apps/desktop/tests/fixtures/packaged-profile.mjs',
  ]
  for (const path of smokeFixtures) assert.ok(inventory.has(path), `portable packaging smoke requires ${path}`)
  assert.ok(!inventory.has('apps/desktop/tests/fixtures/unrelated-ui-fixture.json'))

  const tooling = collectBuildToolingFiles(root)
  for (const path of [
    'scripts/release/pack.ts',
    'apps/desktop/scripts/package-target.ts',
    'apps/desktop/scripts/sign-primary-runtime.ts',
    'apps/desktop/scripts/smoke-prepared-runtime.ts',
    'apps/desktop/scripts/smoke-runtime.ts',
    'apps/desktop/scripts/smoke-portable.ts',
    ...smokeFixtures,
  ]) assert.ok(tooling.has(path), `packaging command closure requires ${path}`)
  assert.ok(tooling.has('apps/desktop/scripts/windows-sign.cmd'))
  assert.ok(tooling.has('apps/desktop/scripts/verify-macos-signature.mjs'))
})

test('packages an independently rebuildable source archive with an adjacent manifest and checksum', () => {
  const tmp = mkdtempSync(join(process.cwd(), '.artifacts', 'dsh-source-tar-'))
  try {
    const root = join(tmp, 'checkout')
    mkdirSync(join(root, 'scripts'), { recursive: true })
    mkdirSync(join(root, 'packages/a/src'), { recursive: true })
    mkdirSync(join(root, 'packages/a/tests/fixtures'), { recursive: true })
    writeFileSync(join(root, 'scripts/export-source.mjs'), 'tooling')
    writeFileSync(join(root, 'packages/a/src/index.ts'), 'export const ok = true')
    writeFileSync(join(root, 'packages/a/tests/fixtures/cert.pem'), '-----BEGIN ' + 'PRIVATE KEY-----\nTEST FIXTURE MATERIAL\n-----END ' + 'PRIVATE KEY-----\n')
    writeFileSync(join(root, 'packages/a/credentials.json'), '{"token":"never exported"}')
    writeFileSync(join(root, 'package.json'), JSON.stringify({ scripts: { build: 'sh scripts/build.sh' } }))
    writeFileSync(join(root, 'scripts/build.sh'), '#!/bin/sh\nexit 0\n', { mode: 0o755 })
    symlinkSync('build.sh', join(root, 'scripts/build-link.sh'))
    writeFileSync(join(root, 'delivery.json'), JSON.stringify({ version: '1.2.3' }))
    writeFileSync(join(root, 'source-revision.json'), JSON.stringify({ commit: 'source-checkout-revision' }))
    const output = join(tmp, 'out/dsh-source-1.2.3.tar.gz')
    const result = packageSource({ root, output, withTests: true })
    const entries = execFileSync('tar', ['-tzf', result.archive], { encoding: 'utf8' })
    assert.ok(entries.trim().split('\n').every(path => path.startsWith('dsh-source-1.2.3/')))
    assert.ok(!entries.includes('/._'), 'source archives must not contain macOS resource metadata')
    assert.match(entries, /dsh-source-1\.2\.3\/packages\/a\/src\/index\.ts/)
    assert.match(entries, /dsh-source-1\.2\.3\/packages\/a\/tests\/fixtures\/cert\.pem/)
    assert.match(entries, /dsh-source-1\.2\.3\/scripts\/build\.sh/)
    assert.match(entries, /dsh-source-1\.2\.3\/scripts\/build-link\.sh/)
    const archiveListing = execFileSync('tar', ['-tvzf', result.archive], { encoding: 'utf8' })
    assert.match(archiveListing, /^-rwxr-xr-x .*dsh-source-1\.2\.3\/scripts\/build\.sh$/m)
    assert.match(archiveListing, /^lrwxr-xr-x .*dsh-source-1\.2\.3\/scripts\/build-link\.sh -> build\.sh$/m)
    const manifest = JSON.parse(readFileSync(result.manifest, 'utf8'))
    assert.equal(manifest.testsIncluded, true)
    assert.equal(manifest.payloadKind, 'with-tests')
    assert.match(manifest.filteredPayloadSha256, /^[a-f0-9]{64}$/)
    assert.equal(manifest.commit, 'source-checkout-revision')
    assert.deepEqual(manifest.excludedSensitiveFiles, [{ path: 'packages/a/credentials.json', reason: 'sensitive filename or file type' }])
    assert.ok(manifest.files.some(file => file.path === 'packages/a/src/index.ts' && /^[a-f0-9]{64}$/.test(file.sha256) && file.mode === 0o644))
    assert.ok(manifest.files.some(file => file.path === 'scripts/build.sh' && file.mode === 0o755))
    assert.ok(manifest.files.some(file => file.path === 'scripts/build-link.sh' && file.mode === 0o755))
    assert.match(readFileSync(result.checksum, 'utf8'), /^[a-f0-9]{64}  dsh-source-1\.2\.3\.tar\.gz\n$/)
  } finally { rmSync(tmp, { recursive: true, force: true }) }
})

test('version override survives source extraction and a Gitless repack without changing the checkout', () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-source-version-'))
  try {
    const original = JSON.stringify({ version: '1.2.3', dshVersion: '1.2.0', targets: ['mac-arm64'] })
    writeFileSync(join(root, 'delivery.json'), original)
    const packed = packageSource({ root, version: '1.2.4' })
    const extract = join(root, '.artifacts', 'extracted')
    mkdirSync(extract)
    execFileSync('tar', ['-xzf', packed.archive, '-C', extract])
    const source = join(extract, 'dsh-source-1.2.4')
    const config = readFileSync(join(source, 'delivery.json'))
    assert.deepEqual(JSON.parse(config), { version: '1.2.4', dshVersion: '1.2.0', targets: ['mac-arm64'] })
    assert.equal(readFileSync(join(root, 'delivery.json'), 'utf8'), original)
    const manifest = JSON.parse(readFileSync(packed.manifest, 'utf8'))
    assert.equal(manifest.files.find(file => file.path === 'delivery.json').sha256, createHash('sha256').update(config).digest('hex'))
    assert.equal(manifest.distributionVersion, '1.2.4')
    const repacked = packageSource({ root: source })
    assert.ok(repacked.archive.endsWith('dsh-source-1.2.4.tar.gz'))
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('with-tests export preserves plugin source digest inputs and omits plugin build caches', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'dsh-plugin-source-digest-'))
  try {
    const root = join(tmp, 'checkout')
    const plugin = join(root, 'third_party/plugins/fixture')
    mkdirSync(join(plugin, 'src'), { recursive: true })
    mkdirSync(join(plugin, 'tests'), { recursive: true })
    mkdirSync(join(plugin, '.cache'), { recursive: true })
    mkdirSync(join(plugin, 'lib'), { recursive: true })
    writeFileSync(join(plugin, 'package.json'), '{"name":"fixture"}\n')
    writeFileSync(join(plugin, 'src/index.ts'), 'export const plugin = true\n')
    writeFileSync(join(plugin, 'README.md'), 'plugin build notes\n')
    writeFileSync(join(plugin, 'tests/index.test.ts'), 'test\n')
    writeFileSync(join(plugin, '.cache/state.json'), 'cache\n')
    writeFileSync(join(plugin, 'lib/index.js'), 'generated\n')
    writeFileSync(join(plugin, 'index.tsbuildinfo'), 'generated\n')
    const originalDigest = sourceDigest(plugin)
    const output = join(tmp, 'export')
    exportSource(root, output, collectSourceFiles(root, true), true)
    assert.equal(sourceDigest(join(output, 'third_party/plugins/fixture')), originalDigest)
    assert.equal(existsSync(join(output, 'third_party/plugins/fixture/.cache/state.json')), false)
    assert.equal(existsSync(join(output, 'third_party/plugins/fixture/lib/index.js')), false)
  } finally { rmSync(tmp, { recursive: true, force: true }) }
})

test('reviewed ACP secret-redaction fixtures are exact synthetic examples', () => {
  const root = process.cwd()
  const redaction = readFileSync(join(root, 'third_party/plugins/dsh-acp-adapter/test/unit/domain/observability/redaction.spec.ts'), 'utf8')
  const stderr = readFileSync(join(root, 'third_party/plugins/dsh-acp-adapter/test/unit/runtime/stderr.spec.ts'), 'utf8')
  assert.equal(createHash('sha256').update(redaction).digest('hex'), 'e142edc80da46e597d60d73c21aa75314aa98441008969355501b8a2956c6d0d')
  assert.equal(createHash('sha256').update(stderr).digest('hex'), 'bf9433ad9a7e0af430e7aa2cf6c4a922eaec20d3bf98a907de8a8c1ac4a62cf5')
  assert.match(redaction, new RegExp('AKIA' + 'IOSFODNN7EXAMPLE', 'u'))
  assert.match(redaction, /private-key-body/u)
  assert.match(stderr, /private-key-body/u)
  assert.match(stderr, /password=hunter2/u)
  const agentStderr = readFileSync(join(root, 'third_party/plugins/dsh-acp-adapter/test/unit/runtime/agent-process-stderr.spec.ts'), 'utf8')
  assert.equal(createHash('sha256').update(agentStderr).digest('hex'), 'ebed9640bdaef6b75d409bc17d21ecebc6a547a822801c070def9c8e758a19ba')
  assert.match(agentStderr, /private-body-SYNTHETIC/u)
  assert.match(agentStderr, /visible after key/u)
})

test('filters missing tests and their scripts while preserving production build commands', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'dsh-source-export-'))
  try {
    const source = join(tmp, 'source')
    mkdirSync(join(source, 'scripts'), { recursive: true })
    mkdirSync(join(source, 'packages/a/src'), { recursive: true })
    mkdirSync(join(source, 'packages/a/tests'), { recursive: true })
    mkdirSync(join(source, 'packages/a/tests/fixtures'), { recursive: true })
    writeFileSync(join(source, 'package.json'), JSON.stringify({ scripts: { build: 'tsx scripts/build.ts', test: 'vitest run', 'test:maintenance': 'node .maintenance/test.mjs', 'test:legacy': 'node tests/run.mjs', postinstall: 'node scripts/install.mjs', publish: 'node scripts/publish.mjs' } }))
    writeFileSync(join(source, 'scripts/build.ts'), 'build')
    writeFileSync(join(source, 'scripts/install.mjs'), 'install')
    writeFileSync(join(source, 'packages/a/src/main.ts'), 'main')
    writeFileSync(join(source, 'packages/a/tests/only.test.ts'), 'fixture cert')
    writeFileSync(join(source, 'packages/a/tests/fixtures/test.pem'), 'public test certificate')
    const output = join(tmp, 'output')
    exportSource(source, output, collectSourceFiles(source))
    const scripts = JSON.parse(readFileSync(join(output, 'package.json'))).scripts
    assert.deepEqual(scripts, { build: 'tsx scripts/build.ts' })
    assert.equal(existsSync(join(output, 'packages/a/tests/only.test.ts')), false)
    assert.equal(existsSync(join(output, 'packages/a/tests/fixtures/test.pem')), false)
    assert.equal(existsSync(join(output, 'scripts/build.ts')), true)
    const testOutput = join(tmp, 'with-tests')
    exportSource(source, testOutput, collectSourceFiles(source, true), true)
    assert.equal(existsSync(join(testOutput, 'packages/a/tests/only.test.ts')), true)
    assert.equal(existsSync(join(testOutput, 'packages/a/tests/fixtures/test.pem')), true)
    assert.ok(JSON.parse(readFileSync(join(testOutput, 'package.json'))).scripts.test)

    const workspaceRoot = join(tmp, 'workspace')
    mkdirSync(join(workspaceRoot, 'packages/subprocess/subprocess-local/scripts'), { recursive: true })
    mkdirSync(join(workspaceRoot, 'packages/subprocess/subprocess-local/src'), { recursive: true })
    writeFileSync(join(workspaceRoot, 'package.json'), '{}')
    writeFileSync(join(workspaceRoot, 'packages/subprocess/subprocess-local/package.json'), JSON.stringify({ scripts: { build: 'tsc', postinstall: 'node scripts/ensure-spawn-helper.mjs' } }))
    writeFileSync(join(workspaceRoot, 'packages/subprocess/subprocess-local/scripts/ensure-spawn-helper.mjs'), 'install helper')
    writeFileSync(join(workspaceRoot, 'packages/subprocess/subprocess-local/src/index.ts'), 'runtime')
    exportSource(workspaceRoot, join(tmp, 'workspace-output'), collectSourceFiles(workspaceRoot))
    assert.equal(JSON.parse(readFileSync(join(tmp, 'workspace-output/packages/subprocess/subprocess-local/package.json'))).scripts.postinstall, 'node scripts/ensure-spawn-helper.mjs')
    assert.ok(existsSync(join(tmp, 'workspace-output/packages/subprocess/subprocess-local/scripts/ensure-spawn-helper.mjs')))
  } finally { rmSync(tmp, { recursive: true, force: true }) }
})

test('default source package is buildable payload and records distinct full plugin provenance', () => {
  const root = mkdtempSync(join(process.cwd(), '.artifacts', 'dsh-source-minimal-'))
  try {
    mkdirSync(join(root, 'scripts'), { recursive: true })
    mkdirSync(join(root, 'packages/a/src'), { recursive: true })
    mkdirSync(join(root, 'packages/a/tests'), { recursive: true })
    mkdirSync(join(root, 'third_party/plugins/example/src'), { recursive: true })
    writeFileSync(join(root, 'package.json'), JSON.stringify({ scripts: { build: 'tsx scripts/build.ts', test: 'vitest run' } }))
    writeFileSync(join(root, 'scripts/build.ts'), 'import { helper } from "./helper.ts"; void helper')
    writeFileSync(join(root, 'scripts/helper.ts'), 'export const helper = true')
    writeFileSync(join(root, 'scripts/config.d.ts'), 'declare const config: string')
    writeFileSync(join(root, 'scripts/build.ts'), 'import { helper } from "./helper.ts"; void helper; const config = "scripts/config.d.ts"')
    writeFileSync(join(root, 'scripts/release.ts'), 'release')
    writeFileSync(join(root, 'packages/a/package.json'), JSON.stringify({ scripts: { build: 'tsc', test: 'vitest run' } }))
    writeFileSync(join(root, 'packages/a/src/index.ts'), 'export const ok = true')
    writeFileSync(join(root, 'packages/a/tests/example.test.ts'), 'test')
    writeFileSync(join(root, 'packages/a/SKILL.md'), 'runtime instructions')
    writeFileSync(join(root, 'third_party/plugins/sources.json'), JSON.stringify({ plugins: [{ name: 'fixture', source: 'third_party/plugins/example', version: '1.0.0', sourceSha256: 'a'.repeat(64) }] }))
    writeFileSync(join(root, 'third_party/plugins/example/package.json'), '{}')
    writeFileSync(join(root, 'third_party/plugins/example/src/index.ts'), 'plugin')
    const minimal = packageSource({ root, version: '1.0.0' })
    const testBuild = packageSource({ root, version: '1.0.1', withTests: true })
    const manifest = JSON.parse(readFileSync(minimal.manifest, 'utf8'))
    const fullManifest = JSON.parse(readFileSync(testBuild.manifest, 'utf8'))
    assert.equal(manifest.payloadKind, 'buildable')
    assert.equal(manifest.testsIncluded, false)
    assert.deepEqual(manifest.sourcesJsonFullPluginSha256, [{ name: 'fixture', source: 'third_party/plugins/example', version: '1.0.0', sourceSha256: 'a'.repeat(64) }])
    assert.notEqual(manifest.filteredPayloadSha256, fullManifest.filteredPayloadSha256)
    const entries = execFileSync('tar', ['-tzf', minimal.archive], { encoding: 'utf8' })
    assert.match(entries, /scripts\/helper\.ts/)
    assert.match(entries, /scripts\/config\.d\.ts/)
    assert.doesNotMatch(entries, /scripts\/release\.ts/)
    assert.doesNotMatch(entries, /packages\/a\/tests/)
    assert.match(entries, /packages\/a\/SKILL\.md/)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('filters tsconfig entries and refuses overwrite or symlink escape before output creation', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'dsh-source-config-'))
  try {
    const source = join(tmp, 'source')
    mkdirSync(join(source, 'scripts'), { recursive: true })
    writeFileSync(join(source, 'tsconfig.json'), '{ // delivery config\n "files": ["scripts/build.ts", "tests/example.spec.ts"], "include": ["scripts/**/*.ts", "tests/**"], "references": [{"path":"./scripts"},{"path":"./tests"}] }')
    writeFileSync(join(source, 'scripts/build.ts'), 'build')
    exportSource(source, join(tmp, 'output'), ['tsconfig.json', 'scripts/build.ts'])
    const config = JSON.parse(readFileSync(join(tmp, 'output/tsconfig.json')))
    assert.deepEqual(config.files, ['scripts/build.ts'])
    assert.deepEqual(config.include, ['scripts/**/*.ts'])
    assert.deepEqual(config.references, [{ path: './scripts' }])
    assert.throws(() => exportSource(source, join(tmp, 'output'), ['scripts/build.ts']), /new directory/)
    symlinkSync('../../outside', join(source, 'scripts/escape.ts'))
    writeFileSync(join(tmp, 'outside'), 'private')
    assert.throws(() => exportSource(source, join(tmp, 'bad'), ['scripts/escape.ts']), /Symlink escapes/)
    assert.equal(existsSync(join(tmp, 'bad')), false)
  } finally { rmSync(tmp, { recursive: true, force: true }) }
})
