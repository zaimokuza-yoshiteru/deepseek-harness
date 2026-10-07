import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { auditDependencyManifests } from '../../apps/desktop/scripts/startup-dependency-audit.mjs'

const requiredNames = [
  '@agentclientprotocol/sdk', '@modelcontextprotocol/client', '@modelcontextprotocol/server',
  '@modelcontextprotocol/node', '@modelcontextprotocol/core', 'zod', 'yaml', '@deepseek-ai/schemastery',
]

function seedManifests(root, omit) {
  const manifests = {}
  for (const [index, name] of requiredNames.entries()) {
    if (name === omit) continue
    const path = join(root, 'node_modules', name, 'package.json')
    mkdirSync(join(path, '..'), { recursive: true })
    writeFileSync(path, JSON.stringify({ name, version: `1.0.${index}` }))
    manifests[name] = JSON.parse(readFileSync(path, 'utf8'))
  }
  return manifests
}

test('audits the packaged MCP SDK v2 seed without requiring the removed SDK v1 package', () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-startup-dependency-audit-'))
  try {
    const manifests = seedManifests(root)
    assert.equal(manifests['@modelcontextprotocol/sdk'], undefined)
    assert.deepEqual(auditDependencyManifests(manifests).map(({ name }) => name), requiredNames)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('rejects a missing SDK v2 dependency and a package manifest with the wrong identity', () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-startup-dependency-audit-'))
  try {
    const missing = seedManifests(root, '@modelcontextprotocol/core')
    assert.throws(() => auditDependencyManifests(missing), /Missing startup dependency manifest: @modelcontextprotocol\/core/u)

    const mismatched = seedManifests(root)
    mismatched['@modelcontextprotocol/client'] = { name: '@modelcontextprotocol/sdk', version: '1.0.0' }
    assert.throws(() => auditDependencyManifests(mismatched), /Unexpected package identity for startup dependency: @modelcontextprotocol\/client/u)
  } finally { rmSync(root, { recursive: true, force: true }) }
})
