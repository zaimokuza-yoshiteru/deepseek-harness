import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { assertPackagedWindowsTrayIcon } from '../scripts/verify-packaged-tray-icon.ts'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })
function resources(): string {
  const path = mkdtempSync(join(tmpdir(), 'desktop-packaged-tray-'))
  roots.push(path)
  return path
}

it('rejects missing and empty Windows tray resources and accepts a nonempty packaged icon', () => {
  const missing = resources()
  expect(() => assertPackagedWindowsTrayIcon(missing)).toThrow('missing its tray icon')

  const empty = resources()
  writeFileSync(join(empty, 'tray.ico'), Buffer.alloc(0))
  expect(() => assertPackagedWindowsTrayIcon(empty)).toThrow('missing its tray icon')

  const packaged = resources()
  writeFileSync(join(packaged, 'tray.ico'), Buffer.from([0, 1, 2]))
  expect(() => assertPackagedWindowsTrayIcon(packaged)).not.toThrow()
})
