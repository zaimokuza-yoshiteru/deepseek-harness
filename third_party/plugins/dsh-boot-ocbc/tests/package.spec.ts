import { execFileSync, spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, expect, it } from 'vitest'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

it('rejects added or removed source files after a verified build, while allowing a source-free package', () => {
  const root = mkdtempSync(join(tmpdir(), 'ocbc-package-check-'))
  roots.push(root)
  for (const folder of ['src', 'scripts', 'lib', 'assets']) mkdirSync(join(root, folder))
  for (const name of ['update-release.mjs', 'source-files.mjs', 'verify-package.mjs']) {
    const source = fileURLToPath(new URL(`../scripts/${name}`, import.meta.url))
    copyFileSync(source, join(root, 'scripts', name))
    if (name !== 'update-release.mjs') copyFileSync(source, join(root, 'lib', name))
  }
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'dsh-boot-ocbc', version: '1.0.0' }))
  for (const name of ['tsconfig.json', 'package-lock.json', 'asset-manifest.json', 'dsh.plugin.json']) writeFileSync(join(root, name), '{}')
  writeFileSync(join(root, 'cordis.patch.yml'), '[]')
  writeFileSync(join(root, 'src', 'index.ts'), 'export const value = 1')
  execFileSync(process.execPath, ['scripts/update-release.mjs'], { cwd: root })
  const verify = () => spawnSync(process.execPath, ['lib/verify-package.mjs'], { cwd: root, encoding: 'utf8' })
  expect(verify().status).toBe(0)
  writeFileSync(join(root, 'src', 'new.ts'), 'export const added = true')
  expect(verify().stderr).toContain('Source file set changed since build')
  rmSync(join(root, 'src', 'new.ts'))
  expect(verify().status).toBe(0)
  rmSync(join(root, 'src', 'index.ts'))
  expect(verify().stderr).toContain('Source file set changed since build')
  rmSync(join(root, 'src'), { recursive: true })
  expect(verify().status).toBe(0)
})
