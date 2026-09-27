import { describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

const registry = JSON.parse(readFileSync('assets/registry/registry.json', 'utf8'))
const sidecar = JSON.parse(readFileSync('assets/registry/executables.json', 'utf8'))

// Fault injection must not depend on particular agents remaining in the live
// catalog: removing a valid upstream entry is not a release validation failure.
const fixtureRegistry = { version: '1', agents: [
  { id: 'example', name: 'Example', description: 'Fixture', version: '1.0.0', distribution: { npx: { package: 'example@1.0.0', args: ['acp'], env: { EXAMPLE: '1' } } } },
  { id: 'binary-agent', name: 'Binary', description: 'Fixture', version: '1.0.0', distribution: { binary: { 'linux-x86_64': { cmd: 'binary-agent', archive: 'https://example.com/agent.tar.gz' } } } },
] }
const fixtureSidecar = { entries: {
  example: { version: '1.0.0', kind: 'npx', command: 'example', args: ['acp'], env: { EXAMPLE: '1' } },
  'binary-agent': { version: '1.0.0', kind: 'binary', command: '', args: [], env: {}, manualReason: 'host-platform-required' },
} }

function fixture(run: (dir: string) => void) {
  const dir = mkdtempSync(join(tmpdir(), 'acp-registry-test-'))
  try { run(dir) } finally { rmSync(dir, { recursive: true, force: true }) }
}
function verify(dir: string) {
  return spawnSync(process.execPath, ['scripts/verify-registry-snapshot.ts', '--file', join(dir, 'registry.json')], { encoding: 'utf8' })
}
function json(dir: string, name: string, value: unknown) { writeFileSync(join(dir, name), JSON.stringify(value)) }

describe('registry snapshot gates', () => {
  it('accepts the complete checked-in catalog, including explicit manual binary entries', () => fixture(dir => {
    json(dir, 'registry.json', registry); json(dir, 'executables.json', sidecar)
    expect(verify(dir).status).toBe(0)
  }))
  it.each(['missing', 'corrupt', 'omitted-entry', 'wrong-version', 'wrong-args', 'wrong-env', 'wrong-distribution', 'duplicate-id', 'universal-mac-command'])('rejects %s snapshots', fault => fixture(dir => {
    const r = structuredClone(fixtureRegistry), e = JSON.parse(JSON.stringify(fixtureSidecar))
    if (fault === 'omitted-entry') delete e.entries.example
    if (fault === 'wrong-version') e.entries.example.version = 'bogus'
    if (fault === 'wrong-args') e.entries.example.args = []
    if (fault === 'wrong-env') e.entries.example.env = {}
    if (fault === 'wrong-distribution') e.entries.example.kind = 'uvx'
    if (fault === 'duplicate-id') r.agents.push(r.agents[0]!)
    if (fault === 'universal-mac-command') e.entries['binary-agent'].command = 'binary-darwin-arm64'
    json(dir, 'registry.json', r)
    if (fault !== 'missing') json(dir, 'executables.json', e)
    if (fault === 'corrupt') writeFileSync(join(dir, 'executables.json'), '{')
    expect(verify(dir).status).toBe(1)
  }))

})
