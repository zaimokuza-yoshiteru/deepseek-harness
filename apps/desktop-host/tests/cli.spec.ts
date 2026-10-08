import { expect, it, vi } from 'vitest'
import { join } from 'node:path'

const { runCli } = vi.hoisted(() => ({ runCli: vi.fn(async () => {}) }))
vi.mock('@deepseek-ai/dsh/lib/bin.js', () => ({ runCli }))
vi.mock('../src/office-engine.ts', () => ({ installOfficeEngineResolution: vi.fn(), runtimeArchivePath: vi.fn() }))

import { runDesktopCli } from '../src/cli.ts'

it('supplies the physical runtime manifest as the Desktop CLI package graph anchor', async () => {
  const runtime = '/Applications/DSH.app/Contents/Resources/dsh'
  const support = '/Applications/DSH.app/Contents/Resources/runtime'
  await runDesktopCli(runtime, support)
  expect(runCli).toHaveBeenCalledWith(expect.objectContaining({
    manageDesktopProfile: true,
    installAnchor: join(runtime, 'package.json'),
    packageManager: expect.objectContaining({ command: process.execPath }),
  }))
})
