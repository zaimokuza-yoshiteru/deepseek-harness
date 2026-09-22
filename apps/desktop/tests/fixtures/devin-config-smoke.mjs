/** Exercise packaged Devin registration and real MCP stdio routing without user credentials. */
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { packagedProfile } from './packaged-profile.mjs'

const [runtime, profile] = process.argv.slice(2)
assert.ok(runtime && profile)
assert.ok(process.versions.electron, 'The packaged RunAsNode fuse must be enabled')
const scope = await packagedProfile(runtime, profile)
const require = createRequire(join(profile, 'package.json'))
const installed = dirname(require.resolve('@zaimokuza/dsh-acp-adapter/package.json'))
const home = await fs.mkdtemp(join(tmpdir(), 'desktop devin mcp '))
const cleanup = []
const configPath = join(home, 'fixture-mcp.json')
const launcher = join(home, '.dsh/acp/mcp/dsh-mcp-launcher.mjs')
const config = () => fs.readFile(configPath, 'utf8').then(JSON.parse)
const env = { ...Object.fromEntries(Object.entries(process.env).filter(([name]) => /^(?:systemroot|windir|comspec)$/iu.test(name))),
  HOME: home, USERPROFILE: home, APPDATA: join(home, 'appdata'), XDG_CONFIG_HOME: join(home, 'xdg'),
  PATH: '', ELECTRON_RUN_AS_NODE: '1' }
const subprocess = { spawn(spec) {
  const child = spawn(spec.argv[0], spec.argv.slice(1), { cwd: spec.cwd, env: spec.env, stdio: 'pipe', windowsHide: true })
  const done = once(child, 'close').then(([exitCode, signal]) => ({ exitCode, signal }))
  const abort = () => child.kill()
  spec.signal.addEventListener('abort', abort, { once: true })
  void done.finally(() => spec.signal.removeEventListener('abort', abort))
  cleanup.push(async () => { if (child.exitCode === null && child.signalCode === null) child.kill(); await done })
  return { stdin: child.stdin, stdout: child.stdout, stderr: child.stderr, done,
    waitForExit: async () => { await done; return true }, terminate: () => child.kill() }
} }
try {
  const { prepareDevinMcp } = await import(pathToFileURL(join(installed, 'lib/host/teams/devin-config.js')).href)
  const { Client } = await scope.load('@modelcontextprotocol/sdk/client/index.js')
  const { StdioClientTransport } = await scope.load('@modelcontextprotocol/sdk/client/stdio.js')
  const { Server } = await scope.load('@modelcontextprotocol/sdk/server/index.js')
  const { StreamableHTTPServerTransport } = await scope.load('@modelcontextprotocol/sdk/server/streamableHttp.js')
  const { ListToolsRequestSchema, CallToolRequestSchema } = await scope.load('@modelcontextprotocol/sdk/types.js')
  async function endpoint(name) {
    let calls = 0, active = true
    const http = createServer((req, res) => { void (async () => {
      if (!active) { res.writeHead(410).end(); return }
      const server = new Server({ name, version: '1' }, { capabilities: { tools: {} } })
      server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [{ name, inputSchema: { type: 'object' } }] }))
      server.setRequestHandler(CallToolRequestSchema, async request => {
        if (request.params.name !== name) return { isError: true, content: [] }
        calls++; return { content: [{ type: 'text', text: name }] }
      })
      const transport = new StreamableHTTPServerTransport({ enableJsonResponse: true })
      res.once('close', () => { void server.close() })
      await server.connect(transport)
      await transport.handleRequest(req, res)
    })().catch(() => { res.writeHead(500).end() }) })
    await new Promise(resolve => http.listen(0, '127.0.0.1', resolve))
    const url = `http://127.0.0.1:${http.address().port}/private-${name}`
    cleanup.push(async () => { http.closeAllConnections(); await new Promise(resolve => http.close(resolve)) })
    let closed = 0
    return { url, calls: () => calls, closed: () => closed, lease: {
      signal: new AbortController().signal,
      servers: [{ name: 'dsh', type: 'http', url, headers: [] }],
      close: async () => { active = false; closed++ },
    } }
  }
  const prepare = bridge => prepareDevinMcp({ subprocess, command: process.execPath,
    args: [fileURLToPath(new URL('./devin-cli.mjs', import.meta.url)), 'acp'], cwd: home, env, lease: bridge.lease })
  const [lead, teammate] = await Promise.all([endpoint('lead_tool'), endpoint('teammate_tool')])
  await fs.writeFile(configPath, JSON.stringify({ unrelated: { marker: 'preserved' }, registrations: 0,
    dsh: { command: '/previous installation/node', args: [launcher], env: {} } }))
  const prepared = await Promise.all([prepare(lead), prepare(teammate)])
  for (const item of prepared) cleanup.push(() => item.lease.close())
  let registered = await config()
  assert.deepEqual(registered.unrelated, { marker: 'preserved' })
  assert.equal(registered.dsh.command, process.execPath)
  assert.deepEqual(registered.dsh.args, [launcher])
  assert.deepEqual(registered.dsh.env, { ELECTRON_RUN_AS_NODE: '1' })
  assert.ok(!JSON.stringify(registered).includes('127.0.0.1'), 'Shared entry must not retain session capabilities')
  for (const oldEnv of [{}, { ELECTRON_RUN_AS_NODE: '0' }]) {
    registered.dsh.env = oldEnv
    await fs.writeFile(configPath, JSON.stringify(registered))
    const repair = await prepare(lead)
    registered = await config()
    assert.deepEqual(registered.dsh.env, { ELECTRON_RUN_AS_NODE: '1' }, 'Matching command must repair missing or wrong Node-mode environment')
    // This registration shares the lead lease; its capability is closed with the original below.
    assert.equal(repair.env.DSH_ACP_TEAM_MCP_URL, lead.url)
  }
  async function connect(url) {
    const childEnv = { ...env, ...registered.dsh.env, ...(url ? { DSH_ACP_TEAM_MCP_URL: url } : {}) }
    const transport = new StdioClientTransport({ command: registered.dsh.command, args: registered.dsh.args, env: childEnv, stderr: 'pipe' })
    const client = new Client({ name: 'packaged-desktop-test', version: '1' })
    cleanup.push(async () => { await client.close(); await transport.close() })
    await client.connect(transport)
    return client
  }
  const clients = await Promise.all(prepared.map(item => connect(item.env.DSH_ACP_TEAM_MCP_URL)))
  for (const [index, tool] of ['lead_tool', 'teammate_tool'].entries()) {
    assert.deepEqual((await clients[index].listTools()).tools.map(t => t.name), [tool])
    assert.deepEqual((await clients[index].callTool({ name: tool })).content, [{ type: 'text', text: tool }])
    assert.equal((await clients[index].callTool({ name: index === 0 ? 'teammate_tool' : 'lead_tool' })).isError, true)
  }
  assert.equal(lead.calls(), 1); assert.equal(teammate.calls(), 1)
  await prepared[0].lease.close(); await prepared[0].lease.close()
  assert.equal(lead.closed(), 1)
  assert.equal((await fetch(lead.url)).status, 410)
  assert.deepEqual((await clients[1].listTools()).tools.map(t => t.name), ['teammate_tool'])
  const standalone = await connect()
  assert.deepEqual((await standalone.listTools()).tools, [])
  assert.equal((await standalone.callTool({ name: 'lead_tool' })).isError, true)
  assert.ok(await fs.stat(launcher))
  assert.equal(await fs.readFile(launcher, 'utf8'), await fs.readFile(join(installed, 'lib/runtime/session/dsh-mcp-launcher.mjs'), 'utf8'))
  console.log('Packaged Electron MCP: fixed entry, old path and env repair, concurrent routing, revocation and inert standalone passed')
} finally {
  for (const close of cleanup.reverse()) await close()
  await scope.close()
  await fs.rm(home, { recursive: true, force: true, maxRetries: 20, retryDelay: 50 })
}
