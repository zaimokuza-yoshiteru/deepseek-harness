// Exercise the installed adapter with synthetic config; never read user credentials.
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { createRequire, syncBuiltinESMExports } from 'node:module'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'

const [profile] = process.argv.slice(2)
assert.ok(profile, 'Expected the isolated desktop profile')
const require = createRequire(join(profile, 'package.json'))
const installed = dirname(require.resolve('@zaimokuza/dsh-acp-adapter/package.json'))
const source = await fs.mkdtemp(join(tmpdir(), 'desktop-devin-config-'))
const originalSymlink = fs.symlink
let denied = 0
let closed = 0
let prepared
try {
  await fs.mkdir(join(source, 'devin', 'sessions'), { recursive: true })
  await fs.writeFile(join(source, 'devin', '.devin-migration-complete'), 'fixture')
  const originalConfig = JSON.stringify({ mcpServers: { existing: { url: 'http://127.0.0.1:1/existing' } } })
  await fs.writeFile(join(source, 'devin', 'mcp_config.json'), originalConfig)
  if (process.platform === 'win32') {
    fs.symlink = async (target, path, type) => {
      if (type === 'file') {
        denied++
        throw Object.assign(new Error('Simulated ordinary-user symlink denial'), { code: 'EPERM' })
      }
      return originalSymlink(target, path, type)
    }
    syncBuiltinESMExports()
  }
  const { prepareDevinTeamConfig } = await import(pathToFileURL(join(installed, 'lib/host/teams/devin-config.js')).href)
  prepared = await prepareDevinTeamConfig({ XDG_CONFIG_HOME: source, APPDATA: source }, {
    signal: new AbortController().signal,
    servers: [{ name: 'desktop-smoke', type: 'http', url: 'http://127.0.0.1:1/teams', headers: [] }],
    close: async () => { closed++ },
  })
  const overlay = join(prepared.env.XDG_CONFIG_HOME, 'devin')
  const marker = join(overlay, '.devin-migration-complete')
  assert.equal(await fs.readFile(marker, 'utf8'), 'fixture')
  await fs.writeFile(marker, 'shared update')
  assert.equal(await fs.readFile(join(source, 'devin', '.devin-migration-complete'), 'utf8'), 'shared update')
  const config = JSON.parse(await fs.readFile(join(overlay, 'mcp_config.json'), 'utf8'))
  assert.ok(config.mcpServers.existing && config.mcpServers['desktop-smoke'])
  assert.equal(await fs.readFile(join(source, 'devin', 'mcp_config.json'), 'utf8'), originalConfig)
  if (process.platform === 'win32') {
    assert.ok(denied > 0, 'The Windows hard-link fallback must actually be exercised')
    assert.equal((await fs.lstat(marker)).isSymbolicLink(), false)
  }
  await prepared.lease.close()
  assert.equal(closed, 1)
  await assert.rejects(fs.stat(prepared.env.XDG_CONFIG_HOME), { code: 'ENOENT' })
  assert.equal(await fs.readFile(join(source, 'devin', '.devin-migration-complete'), 'utf8'), 'shared update')
  console.log(`Packaged Devin config isolation and cleanup passed; denied file symlinks: ${denied}`)
} finally {
  fs.symlink = originalSymlink
  syncBuiltinESMExports()
  await prepared?.lease.close()
  await fs.rm(source, { recursive: true, force: true })
}
