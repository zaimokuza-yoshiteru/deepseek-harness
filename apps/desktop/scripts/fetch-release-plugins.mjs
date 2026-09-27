/** Fetch the audited plugin archives pinned for CI; the build account needs no GitHub credential. */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const manifest = JSON.parse(readFileSync(new URL('../release-plugins.json', import.meta.url), 'utf8'))
const root = resolve('.artifacts/desktop-release-plugins')
mkdirSync(root, { recursive: true })
const directories = []
for (const plugin of manifest.plugins) {
  const directory = resolve(root, plugin.asset.replace(/\.tgz$/u, ''))
  mkdirSync(directory, { recursive: true })
  execFileSync('gh', ['release', 'download', manifest.tag, '--pattern', plugin.asset, '--dir', directory, '--clobber'], { stdio: 'inherit' })
  const archive = resolve(directory, plugin.asset)
  const actual = createHash('sha256').update(readFileSync(archive)).digest('hex')
  if (actual !== plugin.sha256) throw new Error(`Release plugin checksum mismatch: ${plugin.name}`)
  execFileSync('tar', ['-xzf', archive, '-C', directory], { stdio: 'inherit' })
  const extracted = resolve(directory, 'package')
  const packed = JSON.parse(readFileSync(resolve(extracted, 'package.json'), 'utf8'))
  if (packed.name !== plugin.name || packed.version !== plugin.version) throw new Error(`Release plugin identity mismatch: ${plugin.name}`)
  directories.push(extracted)
}
writeFileSync(resolve(root, 'inputs.json'), JSON.stringify(directories) + '\n')
