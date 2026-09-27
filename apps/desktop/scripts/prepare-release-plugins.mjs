/** Verify and extract versioned plugin inputs; CI needs no credential to prepare them. */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const manifest = JSON.parse(readFileSync(new URL('../release-plugins.json', import.meta.url), 'utf8'))
const root = resolve('.artifacts/desktop-release-plugins')
const archives = new URL('../release-plugins/', import.meta.url)
const directories = []
for (const plugin of manifest.plugins) {
  const directory = resolve(root, plugin.asset.replace(/\.tgz$/u, ''))
  const archive = fileURLToPath(new URL(plugin.asset, archives))
  const actual = createHash('sha256').update(readFileSync(archive)).digest('hex')
  if (actual !== plugin.sha256) throw new Error(`Release plugin checksum mismatch: ${plugin.name}`)
  mkdirSync(directory, { recursive: true })
  execFileSync('tar', ['-xzf', archive, '-C', directory], { stdio: 'inherit' })
  const extracted = resolve(directory, 'package')
  const packed = JSON.parse(readFileSync(resolve(extracted, 'package.json'), 'utf8'))
  if (packed.name !== plugin.name || packed.version !== plugin.version) throw new Error(`Release plugin identity mismatch: ${plugin.name}`)
  directories.push(extracted)
}
writeFileSync(resolve(root, 'inputs.json'), JSON.stringify(directories) + '\n')
