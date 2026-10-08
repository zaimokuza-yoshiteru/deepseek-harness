// Validate installed plugin metadata against the exact packaged host. A working
// SRC endpoint alone does not prove that the generated client can register.
import assert from 'node:assert/strict'
import { packagedProfile } from './packaged-profile.mjs'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'

const [runtime, profile, selectedJson] = process.argv.slice(2)
assert.ok(runtime && profile, 'Expected runtime and profile directories')
assert.ok(selectedJson, 'Expected the active portable plugin list')
const pinnedPlugins = JSON.parse(selectedJson)
assert.ok(Array.isArray(pinnedPlugins) && pinnedPlugins.length > 0 && pinnedPlugins.every(name => typeof name === 'string'),
  'Expected a non-empty list of active portable plugin names')
const hostRequire = createRequire(join(runtime, 'package.json'))
const loadHost = name => import(pathToFileURL(hostRequire.resolve(name)).href)
const { evaluatePluginCompatibility, loadProfileDirectory } = await loadHost('@deepseek-ai/dsh-app-boot')
const runtimeManifest = JSON.parse(readFileSync(join(runtime, 'package.json'), 'utf8'))
const installAnchor = Array.isArray(runtimeManifest.dsh?.distribution?.bundles)
  ? join(runtime, 'package.json')
  : join(runtime, 'node_modules/@deepseek-ai/dsh/package.json')
const installedDsh = JSON.parse(readFileSync(join(runtime, 'node_modules/@deepseek-ai/dsh/package.json'), 'utf8'))
assert.equal(existsSync(join(profile, 'compatibility.json')), false, 'Fresh packaged profiles must need no exemptions')
for (const name of pinnedPlugins) {
  const path = join(runtime, 'node_modules', name, 'package.json')
  const pkg = JSON.parse(readFileSync(path, 'utf8'))
  assert.equal(evaluatePluginCompatibility(pkg), undefined, `${name} must support the packaged runtime`)
  assert.ok(loadProfileDirectory('dsh', profile, installAnchor).layers.some(layer => layer.packageName === name))
  const isolated = mkdtempSync(join(tmpdir(), 'dsh-bundle-admission-'))
  try {
    const packageDir = join(isolated, 'node_modules', ...name.split('/'))
    const dshDir = join(isolated, 'node_modules', '@deepseek-ai', 'dsh')
    mkdirSync(packageDir, { recursive: true })
    mkdirSync(dshDir, { recursive: true })
    writeFileSync(join(packageDir, 'package.json'), JSON.stringify({ ...pkg,
      peerDependencies: { ...pkg.peerDependencies, '@deepseek-ai/dsh': '0.1.7-alpha.2' } }))
    const patchPath = join(packageDir, pkg.dsh.bundle.patch)
    mkdirSync(dirname(patchPath), { recursive: true })
    writeFileSync(patchPath, '[]\n')
    writeFileSync(join(dshDir, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh', version: installedDsh.version }))
    writeFileSync(join(isolated, 'package.json'), JSON.stringify({ name: 'isolated-bundle-admission', dependencies: {
      [name]: pkg.version, '@deepseek-ai/dsh': installedDsh.version,
    } }))
    assert.equal(loadProfileDirectory('dsh', profile, join(isolated, 'package.json')).layers.some(layer => layer.packageName === name), false,
      'Native bundle admission must reject incompatible peers without an exemption')
  } finally {
    rmSync(isolated, { recursive: true, force: true })
  }
}
console.log('Packaged plugin admission: pinned bundles accepted; incompatible bundles rejected without exemptions')
const scope = await packagedProfile(runtime, profile)
const { default: Registry } = await loadHost('@deepseek-ai/dsh-typert-registry')
const { validateTypertManifest } = await loadHost('@deepseek-ai/dsh-typert-loader')
const ctx = scope.ctx
const fiber = ctx.plugin(Registry)
let hostPackages = 0
let remotePackages = 0
const registeredHostPackages = new Set()
const registeredRemotePackages = new Set()
try {
  await fiber
  for (const name of pinnedPlugins) {
    const pkg = JSON.parse(readFileSync(join(runtime, 'node_modules', name, 'package.json'), 'utf8'))
    if (pkg.exports?.['./typert'] === undefined) continue
    const { TYPERT } = await import(pathToFileURL(hostRequire.resolve(`${name}/typert`)).href)
    ctx.typert.register(validateTypertManifest(name, TYPERT))
    hostPackages++
    registeredHostPackages.add(name)
    if (pkg.exports?.['./remote'] !== undefined) {
      const { TYPERT_REMOTE } = await import(pathToFileURL(hostRequire.resolve(`${name}/remote`)).href)
      ctx.typert.remotes.register(TYPERT_REMOTE)
      remotePackages++
      registeredRemotePackages.add(name)
    }
    console.log(`Packaged plugin metadata: ${name} registered`)
  }
  const expectedHostPackages = pinnedPlugins.filter(name => {
    const pkg = JSON.parse(readFileSync(join(runtime, 'node_modules', name, 'package.json'), 'utf8'))
    return pkg.exports?.['./typert'] !== undefined
  })
  const expectedRemotePackages = expectedHostPackages.filter(name => {
    const pkg = JSON.parse(readFileSync(join(runtime, 'node_modules', name, 'package.json'), 'utf8'))
    return pkg.exports?.['./remote'] !== undefined
  })
  assert.deepEqual([...registeredHostPackages].sort(), [...expectedHostPackages].sort(), 'Every pinned plugin Host metadata export must register')
  assert.deepEqual([...registeredRemotePackages].sort(), [...expectedRemotePackages].sort(), 'Every pinned plugin Remote metadata export must register')
  assert.ok(hostPackages > 0 && remotePackages > 0, 'Expected generated Host and Remote plugin metadata')
} finally {
  await fiber.dispose()
  await scope.close()
}
