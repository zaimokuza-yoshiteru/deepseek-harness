import { access, readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const manifest = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'))

function collectTargets(value, output = []) {
  if (typeof value === 'string') output.push(value)
  else if (Array.isArray(value)) value.forEach(item => collectTargets(item, output))
  else if (value && typeof value === 'object') Object.values(value).forEach(item => collectTargets(item, output))
  return output
}

const targets = collectTargets(manifest.exports).filter(target => target.startsWith('./') && !target.includes('*'))
targets.push(manifest.icon, manifest.dsh?.bundle?.patch)
for (const target of new Set(targets.filter(Boolean))) {
  try { await access(resolve(root, target)) }
  catch { throw new Error(`Cannot pack ${manifest.name}@${manifest.version}: required package entry is missing: ${target}. Run pnpm build first.`) }
}

if (!targets.some(target => target === './lib/host.js') || !targets.some(target => target === './lib/client.js')) {
  throw new Error(`Cannot pack ${manifest.name}@${manifest.version}: expected host and client bundle exports are not declared.`)
}

console.log(`Verified package entrypoints for ${manifest.name}@${manifest.version}.`)
