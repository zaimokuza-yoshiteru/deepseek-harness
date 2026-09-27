import { readdir } from 'node:fs/promises'
import { join } from 'node:path'

export async function sourceFiles(root) {
  async function walk(directory, prefix) {
    const entries = await readdir(directory, { withFileTypes: true })
    return (await Promise.all(entries.map(entry => {
      if (entry.isSymbolicLink()) throw new Error(`Source file must not be a symlink: ${prefix}${entry.name}`)
      return entry.isDirectory()
        ? walk(join(directory, entry.name), `${prefix}${entry.name}/`)
        : [`${prefix}${entry.name}`]
    }))).flat()
  }
  return ['tsconfig.json', 'package-lock.json', ...await walk(join(root, 'src'), 'src/'),
    ...await walk(join(root, 'scripts'), 'scripts/')].sort()
}
