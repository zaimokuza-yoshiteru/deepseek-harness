import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { c as createTar } from 'tar'
import { sourceDigest, verifyPluginArchive } from '../../scripts/build-plugins.mjs'

const manifest = { name: 'fixture-plugin', version: '1.0.0', exports: './lib/host.js', dsh: { bundle: { patch: './bundle.yml' } } }
test('artifact verification rejects missing entry points even when npm would pack them', async () => {
  const root = mkdtempSync(join(tmpdir(), 'plugin-entry-test-'))
  try {
    mkdirSync(join(root, 'package'))
    writeFileSync(join(root, 'package/package.json'), JSON.stringify(manifest))
    writeFileSync(join(root, 'package/bundle.yml'), '[]\n')
    const archive = join(root, 'plugin.tgz')
    await createTar({ cwd: root, file: archive, gzip: true }, ['package'])
    await assert.rejects(verifyPluginArchive(archive, manifest), /missing .\/lib\/host.js/)
    mkdirSync(join(root, 'package/lib'))
    writeFileSync(join(root, 'package/lib/host.js'), 'export const inject = []')
    await createTar({ cwd: root, file: archive, gzip: true }, ['package'])
    assert.equal((await verifyPluginArchive(archive, manifest)).name, manifest.name)
    writeFileSync(join(root, 'package/lib/host.js'), '// /Users/builder/work/project/file.ts')
    await createTar({ cwd: root, file: archive, gzip: true }, ['package'])
    await assert.rejects(verifyPluginArchive(archive, manifest), /build path/)
  } finally { rmSync(root, { recursive: true, force: true }) }
})
test('source identity ignores installed dependencies and generated outputs, but includes source edits', () => {
  const root = mkdtempSync(join(tmpdir(), 'plugin-digest-test-'))
  try {
    writeFileSync(join(root, 'source.ts'), 'export const version = 1')
    const before = sourceDigest(root)
    mkdirSync(join(root, 'node_modules'))
    writeFileSync(join(root, 'node_modules/private.txt'), 'local cache')
    assert.equal(sourceDigest(root), before)
    writeFileSync(join(root, 'source.ts'), 'export const version = 2')
    assert.notEqual(sourceDigest(root), before)
  } finally { rmSync(root, { recursive: true, force: true }) }
})
