/** Credential-free native CLI fixture; records only synthetic MCP configuration. */
import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
assert.ok(process.versions.electron, 'Use the shipped Electron, not external Node')
const file = join(process.env.HOME, 'fixture-mcp.json')
const data = JSON.parse(await readFile(file, 'utf8'))
const args = process.argv.slice(2)
assert.equal(args[0], 'mcp')
if (args[1] === 'get') {
  if (!data.dsh) { console.error("Server 'dsh' not found"); process.exitCode = 1 }
  else console.log(`Server: dsh\n    Command: ${[data.dsh.command, ...data.dsh.args].join(' ')}\n    Env: ${Object.keys(data.dsh.env).map(key => `${key}=<redacted>`).join(', ')}`)
} else {
  assert.deepEqual(args.slice(0, 8), ['mcp', 'add', '--scope', 'user', '-e', 'ELECTRON_RUN_AS_NODE=1', 'dsh', '--'])
  assert.equal(args.length, 10)
  data.dsh = { command: args[8], args: [args[9]], env: { ELECTRON_RUN_AS_NODE: '1' } }
  data.registrations++
  await writeFile(file, JSON.stringify(data))
}
