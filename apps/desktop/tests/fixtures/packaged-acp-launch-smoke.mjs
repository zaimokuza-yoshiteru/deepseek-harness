/** Verify the shipped ACP adapter and managed subprocess service on Windows. */
import assert from 'node:assert/strict'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { packagedProfile } from './packaged-profile.mjs'

const [primaryNode, runtime, profile, evidencePath] = process.argv.slice(2)
assert.ok(primaryNode && runtime && profile && evidencePath)
assert.equal(process.platform, 'win32')
assert.ok(existsSync(primaryNode), 'Packaged primary-runtime Node binary must be present for the Devin executable fixture')

const scope = await packagedProfile(runtime, profile)
const { default: LocalSubprocessRuntime } = await scope.load('@deepseek-ai/dsh-subprocess-local')
const { Context } = await scope.load('@deepseek-ai/cordis')
const context = new Context()
const subprocessFiber = await context.plugin(LocalSubprocessRuntime)
const adapterInstall = dirname(createRequire(join(profile, 'package.json')).resolve('@zaimokuza/dsh-acp-adapter/package.json'))
const adapterRequire = createRequire(join(adapterInstall, 'package.json'))
const adapterModule = (name) => import(pathToFileURL(adapterRequire.resolve(name)).href)
const [{ AcpClientConnection }, { buildAcpSpawnPlan }, { prepareAcpCommandLaunch }] = await Promise.all([
  adapterModule('./lib/protocol/v1/connection.js'),
  adapterModule('./lib/domain/policy/sandbox.js'),
  adapterModule('./lib/runtime/process/command-launch.js'),
])
const scratch = mkdtempSync(join(tmpdir(), 'dsh ACP launch smoke '))
const fixture = join(dirname(fileURLToPath(import.meta.url)), 'devin-acp-handshake.mjs')
// Node consumes the first CLI argument as its script filename. A minimal
// extensionless entrypoint reconstructs the Devin command's `acp` subcommand,
// then imports the same handshake peer used by the .cmd wrapper below.
writeFileSync(join(scratch, 'acp'), "import('./devin-acp-handshake.mjs').catch(error => { console.error(error); process.exitCode = 1 })\n")
copyFileSync(fixture, join(scratch, 'devin-acp-handshake.mjs'))
const marker = 'value with spaces & percent% caret^ quotes "double" and (parens)'
const trace = (id) => join(scratch, `${id}.jsonl`)
const outcomes = []

function installExe(directory, name = 'devin.exe') {
  mkdirSync(directory, { recursive: true })
  const path = join(directory, name)
  copyFileSync(primaryNode, path)
  return path
}

function installCmd(directory) {
  mkdirSync(directory, { recursive: true })
  const path = join(directory, 'devin.cmd')
  writeFileSync(path, [
    '@echo off',
    '"%ACP_SMOKE_NODE%" "%ACP_SMOKE_FIXTURE%" %*',
    '',
  ].join('\r\n'))
  return path
}

async function run(id, command, searchPath) {
  const output = trace(id)
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => key.toUpperCase() !== 'PATH'))
  Object.assign(env, {
    PATH: searchPath,
    ACP_SMOKE_NODE: primaryNode,
    ACP_SMOKE_FIXTURE: fixture,
    ACP_SMOKE_MARKER: marker,
    ACP_SMOKE_TRACE: output,
  })
  const args = [command, 'acp', '--marker', marker]
  const launch = await prepareAcpCommandLaunch(context.subprocess, args, scratch, env)
  const plan = buildAcpSpawnPlan({
    mode: 'danger-full-access', workspaceRoot: scratch, argv: launch.argv, env,
    windowsVerbatimArguments: launch.windowsVerbatimArguments,
  })
  await AcpClientConnection.probe({
    argv: [...plan.argv], cwd: scratch, env: plan.env, spawnPlan: plan, subprocess: context.subprocess,
  }, { timeoutMs: 10_000 })
  const records = readFileSync(output, 'utf8').trim().split(/\r?\n/u).map((line) => JSON.parse(line))
  assert.deepEqual(records.map((record) => record.method), ['initialize', 'session/new'])
  assert.ok(records.every((record) => record.argv.join('\0') === ['acp', '--marker', marker].join('\0')))
  outcomes.push({ id, configuredCommand: command, resolvedCommand: launch.argv[0], methods: records.map((record) => record.method), argvPreserved: true })
}

try {
  const exePath = installExe(join(scratch, 'bare exe PATH with spaces'))
  await run('bare-exe', 'devin', dirname(exePath))

  const cmdPath = installCmd(join(scratch, 'bare cmd PATH & tools with spaces'))
  await run('bare-cmd', 'devin', dirname(cmdPath))

  const relativePath = installExe(join(scratch, 'Agent Tools'))
  await run('relative-spaces', '.\\Agent Tools\\devin.exe', dirname(relativePath))

  const absoluteDirectory = join(scratch, 'absolute Agent path with spaces & parens')
  mkdirSync(absoluteDirectory, { recursive: true })
  const absolute = join(absoluteDirectory, 'devin.exe')
  copyFileSync(exePath, absolute)
  await run('absolute-spaces', absolute, dirname(absolute))

  const evidence = { schemaVersion: 1, adapter: 'packaged', desktopRuntime: 'packaged', subprocess: 'managed-local', cases: outcomes }
  mkdirSync(dirname(evidencePath), { recursive: true })
  writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`)
  process.stdout.write(`${JSON.stringify(evidence)}\n`)
} finally {
  await subprocessFiber.dispose()
  await scope.close()
  rmSync(scratch, { recursive: true, force: true })
}
