import { afterEach, beforeEach, expect, it, vi } from 'vitest'

beforeEach(() => { vi.resetModules() })
afterEach(() => { vi.unstubAllEnvs() })

it('configures the Windows portable package with the tray entry point and RC2 distribution version', async () => {
  vi.stubEnv('DSH_DESKTOP_TARGET_PLATFORM', 'win32')
  vi.stubEnv('DSH_DESKTOP_TARGET_ARCH', 'x64')
  vi.stubEnv('DSH_DESKTOP_DISTRIBUTION_VERSION', '0.1.7.rc.2.1')
  const { default: config } = await import('../electron-builder.portable.config.mjs')

  expect(config.extraMetadata).toEqual({ version: '0.1.7-rc.2.1' })
  expect(config.extraResources).toContainEqual({ from: 'resources/tray-windows.ico', to: 'tray.ico' })
})

it('rejects portable distributions based on the previous DSH release candidate', async () => {
  vi.stubEnv('DSH_DESKTOP_TARGET_PLATFORM', 'darwin')
  vi.stubEnv('DSH_DESKTOP_TARGET_ARCH', 'arm64')
  vi.stubEnv('DSH_DESKTOP_DISTRIBUTION_VERSION', '0.1.7.rc.1.1')
  await expect(import('../electron-builder.portable.config.mjs'))
    .rejects.toThrow('expected distribution version 0.1.7.rc.2.<positive integer>')
})
