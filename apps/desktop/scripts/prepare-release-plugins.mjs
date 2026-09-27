/** Verify versioned plugin inputs; CI needs no credential to prepare them. */
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const manifest = JSON.parse(readFileSync(new URL('../release-plugins.json', import.meta.url), 'utf8'))
const root = resolve('.artifacts/desktop-release-plugins')
const archives = new URL('../release-plugins/', import.meta.url)
const inputs = []
for (const plugin of manifest.plugins) {
  const archive = fileURLToPath(new URL(plugin.asset, archives))
  const actual = createHash('sha256').update(readFileSync(archive)).digest('hex')
  if (actual !== plugin.sha256) throw new Error(`Release plugin checksum mismatch: ${plugin.name}`)
  inputs.push(archive)
}
mkdirSync(root, { recursive: true })
writeFileSync(resolve(root, 'inputs.json'), JSON.stringify(inputs) + '\n')
