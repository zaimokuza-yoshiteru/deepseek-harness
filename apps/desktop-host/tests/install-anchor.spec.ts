import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { desktopInstallAnchor } from '../src/index.ts'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

function runtime(): string {
  const root = mkdtempSync(join(tmpdir(), 'desktop-install-anchor-'))
  roots.push(root)
  return root
}

it('anchors a bundled distribution at its root manifest', () => {
  const root = runtime()
  writeFileSync(join(root, 'package.json'), JSON.stringify({
    dependencies: { '@deepseek-ai/dsh': '0.2.0-rc.2', 'dsh-boot-ocbc': '1.2.3' },
    dsh: { distribution: { bundles: ['dsh-boot-ocbc'] } },
  }))
  expect(desktopInstallAnchor(root)).toBe(join(root, 'package.json'))
})

it('keeps the core package anchor for a development manifest without distribution metadata', () => {
  const root = runtime()
  writeFileSync(join(root, 'package.json'), JSON.stringify({ dependencies: { '@deepseek-ai/dsh': '0.2.0-rc.2' } }))
  mkdirSync(join(root, 'node_modules', '@deepseek-ai', 'dsh'), { recursive: true })
  expect(desktopInstallAnchor(root)).toBe(join(root, 'node_modules', '@deepseek-ai', 'dsh', 'package.json'))
})
