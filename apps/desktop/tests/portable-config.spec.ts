import { afterEach, expect, it, vi } from 'vitest'

afterEach(() => { vi.unstubAllEnvs() })

it('configures the Windows portable package with the tray entry point and RC2 distribution version', async () => {
  vi.stubEnv('DSH_DESKTOP_TARGET_PLATFORM', 'win32')
  vi.stubEnv('DSH_DESKTOP_TARGET_ARCH', 'x64')
  vi.stubEnv('DSH_DESKTOP_DISTRIBUTION_VERSION', '0.1.7.rc.2.1')
  const configModule = '../electron-builder.portable.config.mjs' + '?win-rc2'
  const { default: config } = await import(configModule)

  expect(config.extraMetadata).toEqual({ version: '0.1.7-rc.2.1' })
  expect(config.extraResources).toContainEqual({ from: 'resources/tray-windows.ico', to: 'tray.ico' })
})

it('rejects portable distributions based on the previous DSH release candidate', async () => {
  vi.stubEnv('DSH_DESKTOP_TARGET_PLATFORM', 'darwin')
  vi.stubEnv('DSH_DESKTOP_TARGET_ARCH', 'arm64')
  vi.stubEnv('DSH_DESKTOP_DISTRIBUTION_VERSION', '0.1.7.rc.1.1')
  const configModule = '../electron-builder.portable.config.mjs' + '?old-rc1'
  await expect(import(configModule))
    .rejects.toThrow('expected distribution version 0.1.7.rc.2.<positive integer>')
})
