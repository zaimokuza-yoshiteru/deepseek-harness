// Validate installed plugin metadata against the exact packaged host. A working
// SRC endpoint alone does not prove that the generated client can register.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const [runtime, profile] = process.argv.slice(2)
assert.ok(runtime && profile, 'Expected runtime and profile directories')
const hostRequire = createRequire(join(runtime, 'package.json'))
const pluginRequire = createRequire(join(profile, 'package.json'))
const loadHost = name => import(pathToFileURL(hostRequire.resolve(name)).href)
const { Context } = await loadHost('@deepseek-ai/cordis')
const { default: Registry } = await loadHost('@deepseek-ai/dsh-typert-registry')
const { validateTypertManifest } = await loadHost('@deepseek-ai/dsh-typert-loader')
const manifest = JSON.parse(readFileSync(join(profile, 'package.json'), 'utf8'))
const ctx = new Context()
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
}
