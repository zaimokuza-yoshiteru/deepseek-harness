// Validate installed plugin metadata against the exact packaged host. A working
// SRC endpoint alone does not prove that the generated client can register.
import assert from 'node:assert/strict'
import { packagedProfile } from './packaged-profile.mjs'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const [runtime, profile] = process.argv.slice(2)
assert.ok(runtime && profile, 'Expected runtime and profile directories')
const hostRequire = createRequire(join(runtime, 'package.json'))
const pluginRequire = createRequire(join(profile, 'package.json'))
const loadHost = name => import(pathToFileURL(hostRequire.resolve(name)).href)
const { evaluatePluginCompatibility, loadProfileDirectory } = await loadHost('@deepseek-ai/dsh-app-boot')
const installAnchor = join(runtime, 'node_modules/@deepseek-ai/dsh/package.json')
assert.equal(existsSync(join(profile, 'compatibility.json')), false, 'Fresh packaged profiles must need no exemptions')
const pinnedPlugins = ['@zaimokuza/dsh-acp-adapter', '@zaimokuza/dsh-agent-teams-office']
for (const name of pinnedPlugins) {
  const path = join(profile, 'node_modules', name, 'package.json')
  const original = readFileSync(path, 'utf8')
  const pkg = JSON.parse(original)
  assert.equal(evaluatePluginCompatibility(pkg), undefined, `${name} must support the packaged runtime`)
  assert.ok(loadProfileDirectory('dsh', profile, installAnchor).layers.some(layer => layer.packageName === name))
  try {
    writeFileSync(path, JSON.stringify({ ...pkg, peerDependencies: { ...pkg.peerDependencies, '@deepseek-ai/dsh': '0.1.7-alpha.2' } }))
    assert.equal(loadProfileDirectory('dsh', profile, installAnchor).layers.some(layer => layer.packageName === name), false,
      'Native bundle admission must reject incompatible peers without an exemption')
  } finally {
    writeFileSync(path, original)
  }
}
console.log('Packaged plugin admission: pinned bundles accepted; incompatible bundles rejected without exemptions')
const scope = await packagedProfile(runtime, profile)
const { default: Registry } = await loadHost('@deepseek-ai/dsh-typert-registry')
const { validateTypertManifest } = await loadHost('@deepseek-ai/dsh-typert-loader')
const manifest = JSON.parse(readFileSync(join(profile, 'package.json'), 'utf8'))
const ctx = scope.ctx
const fiber = ctx.plugin(Registry)
let hostPackages = 0
let remotePackages = 0
try {
  await fiber
  for (const name of Object.keys(manifest.dependencies)) {
    const pkg = JSON.parse(readFileSync(join(profile, 'node_modules', name, 'package.json'), 'utf8'))
    if (pkg.exports?.['./typert'] === undefined) continue
    const { TYPERT } = await import(pathToFileURL(pluginRequire.resolve(`${name}/typert`)).href)
    ctx.typert.register(validateTypertManifest(name, TYPERT))
    hostPackages++
    if (pkg.exports?.['./remote'] !== undefined) {
      const { TYPERT_REMOTE } = await import(pathToFileURL(pluginRequire.resolve(`${name}/remote`)).href)
      ctx.typert.remotes.register(TYPERT_REMOTE)
      remotePackages++
    }
    console.log(`Packaged plugin metadata: ${name} registered`)
  }
  assert.ok(hostPackages > 0 && remotePackages > 0, 'Expected generated Host and Remote plugin metadata')
} finally {
  await fiber.dispose()
  await scope.close()
}
