/** Minimal, credential-free ACP peer for packaged Windows command-launch smoke. */
import assert from 'node:assert/strict'
import { appendFileSync } from 'node:fs'
import { basename } from 'node:path'
import readline from 'node:readline'

// Direct Node CLI launch consumes `acp` as the script filename; the .cmd
// wrapper passes it as an ordinary argument. Reconstruct the argv Devin sees
// while still checking Node's actual parsed arguments in both cases.
const isNodeEntrypoint = basename(process.argv[1] ?? '').toLowerCase() === 'acp'
const commandArgs = isNodeEntrypoint ? ['acp', ...process.argv.slice(2)] : process.argv.slice(2)
assert.deepEqual(commandArgs, ['acp', '--marker', process.env.ACP_SMOKE_MARKER])

const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity })
function send(value) { process.stdout.write(`${JSON.stringify(value)}\n`) }
for await (const line of input) {
  const request = JSON.parse(line)
  appendFileSync(process.env.ACP_SMOKE_TRACE, `${JSON.stringify({ method: request.method, argv: commandArgs })}\n`)
  if (request.method === 'initialize') {
    send({ jsonrpc: '2.0', id: request.id, result: {
      protocolVersion: 1,
      agentInfo: { name: 'packaged-windows-path-fixture', version: '1' },
      agentCapabilities: {},
      authMethods: [],
    } })
  } else if (request.method === 'session/new') {
    send({ jsonrpc: '2.0', id: request.id, result: { sessionId: 'windows-path-smoke' } })
  } else if (request.id !== undefined) {
    send({ jsonrpc: '2.0', id: request.id, error: { code: -32601, message: 'method not found' } })
  }
}
