/** Inspect the shipped files and observe a registry trap while Windows blocks application egress. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { lookup } from 'node:dns/promises'
import { createServer } from 'node:http'
import { readFile, readdir, rename, writeFile } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

const names = ['@agentclientprotocol/sdk', '@modelcontextprotocol/client', '@modelcontextprotocol/server',
  '@modelcontextprotocol/node', '@modelcontextprotocol/core', 'zod', 'yaml', '@deepseek-ai/schemastery']

export function auditDependencyManifests(manifests, requiredNames = names) {
  return requiredNames.map(name => {
    const manifest = manifests[name]
    assert.ok(manifest, `Missing startup dependency manifest: ${name}`)
    assert.equal(manifest.name, name, `Unexpected package identity for startup dependency: ${name}`)
    assert.equal(typeof manifest.version, 'string')
    assert.ok(manifest.version.length > 0, `Missing package version for startup dependency: ${name}`)
    return { name, version: manifest.version }
  })
}

async function fingerprint(root) {
  const hash = createHash('sha256')
  let files = 0, bytes = 0
  async function walk(directory) {
    for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) await walk(path)
      else {
        assert.ok(entry.isFile(), `Unexpected dependency symlink: ${path}`)
        const content = await readFile(path)
        const name = relative(root, path).replaceAll('\\', '/')
        hash.update(`${Buffer.byteLength(name)}:${name}${content.length}:`).update(content)
        files++; bytes += content.length
      }
    }
  }
  await walk(root)
  return { sha256: hash.digest('hex'), files, bytes }
}

export async function startDependencyAudit(application, output, home, env) {
  const runtime = join(application, 'resources', 'dsh')
  const report = { bundled: [], runs: [], registryRequests: [], cacheIsolated: true }
  const save = () => writeFile(join(output, 'dependency-audit.json'), JSON.stringify(report, null, 2) + '\n')
  const manifests = Object.fromEntries(await Promise.all(names.map(async name => [name,
    JSON.parse(await readFile(join(runtime, 'node_modules', name, 'package.json'), 'utf8'))])))
  for (const { name, version } of auditDependencyManifests(manifests)) {
    const root = join(runtime, 'node_modules', name)
    report.bundled.push({ name, version, path: relative(application, root), ...await fingerprint(root) })
  }
  await save()
  const { address } = await lookup('registry.npmjs.org', { family: 4 })
  const probe = () => {
    const code = `const s=require('node:net').connect({host:${JSON.stringify(address)},port:443}); s.setTimeout(5000); s.once('connect',()=>{s.destroy();process.exit(0)}); s.once('timeout',()=>{s.destroy();process.exit(2)}); s.once('error',()=>process.exit(3));`
    const child = spawnSync(join(application, 'DSH Desktop.exe'), ['-e', code], {
      env: { ...env, ELECTRON_RUN_AS_NODE: '1' }, timeout: 10000, encoding: 'utf8',
    })
    if (child.error) throw child.error
    return child.status
  }
  report.connectivityControl = { destination: `${address}:443`, beforeGuardExit: probe() }
  assert.equal(report.connectivityControl.beforeGuardExit, 0, 'The control endpoint was not reachable before blocking')
  // Publish atomically: the elevated runner adds rules, but the application remains non-administrator.
  const request = join(output, 'network-guard-request.json')
  await writeFile(`${request}.tmp`, JSON.stringify({ application }))
  await rename(`${request}.tmp`, request)
  let guard
  for (let attempt = 0; attempt < 120; attempt++) {
    try { guard = JSON.parse((await readFile(join(output, 'network-guard.json'), 'utf8')).replace(/^\uFEFF/u, '')); break }
    catch (error) { if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error }
    await delay(1000)
  }
  assert.equal(guard?.active, true, 'Application firewall guard was not acknowledged')
  report.connectivityControl.afterGuardExit = probe()
  assert.ok([2, 3].includes(report.connectivityControl.afterGuardExit), 'The firewall did not block the same application and destination')
  report.firewall = guard
  const server = createServer((request, response) => {
    report.registryRequests.push({ method: request.method, path: request.url })
    response.writeHead(503); response.end('CI dependency downloads are disabled')
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  server.unref()
  const registry = `http://127.0.0.1:${server.address().port}/`
  await writeFile(join(home, 'audit.npmrc'), `registry=${registry}\nstore-dir=${join(home, 'empty-pnpm-store').replaceAll('\\', '/')}\n`)
  Object.assign(env, { npm_config_registry: registry, pnpm_config_registry: registry,
    npm_config_userconfig: join(home, 'audit.npmrc'), npm_config_cache: join(home, 'empty-npm-cache'),
    PNPM_HOME: join(home, 'empty-pnpm-home'), LOCALAPPDATA: join(home, 'AppData', 'Local'), APPDATA: join(home, 'AppData', 'Roaming') })
  await save()
  return {
    async verify(app, profile, kind) {
      const run = { kind, dependencies: [] }
      report.runs.push(run)
      for (const packaged of report.bundled) {
        const installed = await app.evaluate(({ app }, { profile, name }) => {
          const fs = process.getBuiltinModule('node:fs'), path = process.getBuiltinModule('node:path')
          const roots = [path.join(profile, 'node_modules', name), path.join(process.resourcesPath, 'dsh', 'node_modules', name)]
          const root = roots.find(root => fs.existsSync(path.join(root, 'package.json')))
          if (!root) throw new Error(`Dependency missing from profile and shipped runtime: ${name}`)
          const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
          return { root, name: manifest.name, version: manifest.version, source: root === roots[0] ? 'profile' : 'application-runtime' }
        }, { profile, name: packaged.name })
        assert.equal(installed.name, packaged.name)
        assert.equal(installed.version, packaged.version)
        assert.equal(installed.source, 'application-runtime', `${packaged.name} must load from the application runtime`)
        Object.assign(installed, await fingerprint(installed.root))
        assert.equal(installed.sha256, packaged.sha256, `${packaged.name} differs from the shipped dependency`)
        run.dependencies.push(installed)
        await save()
      }
      assert.deepEqual(report.registryRequests, [], 'The application attempted a dependency registry request')
      run.passed = true
      await save()
    },
    async finish() {
      assert.deepEqual(report.registryRequests, [])
      await save()
      await new Promise(resolve => server.close(resolve))
    },
  }
}
