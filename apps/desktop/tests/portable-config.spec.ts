import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { deriveDesktopDistributionVersion, resolveDesktopDistributionVersion, validateDesktopDistributionVersion } from '../../../scripts/desktop-distribution-version.mjs'

beforeEach(() => { vi.resetModules() })
afterEach(() => { vi.unstubAllEnvs() })

it('configures the Windows portable package with the tray entry point and RC2 distribution version', async () => {
  vi.stubEnv('DSH_DESKTOP_TARGET_PLATFORM', 'win32')
  vi.stubEnv('DSH_DESKTOP_TARGET_ARCH', 'x64')
  vi.stubEnv('DSH_DESKTOP_DISTRIBUTION_VERSION', '0.2.0.rc.2.1')
  const { default: config } = await import('../electron-builder.portable.config.mjs')

  expect(config.extraMetadata).toEqual({ version: '0.2.0-rc.2.1' })
  expect(config.extraResources).toContainEqual({ from: 'resources/tray-windows.ico', to: 'tray.ico' })
  expect(config.extraResources.some(resource => resource.to === 'dsh')).toBe(true)
  expect(config.files.some(file => typeof file !== 'string' && file.to === 'dsh')).toBe(false)
  expect(config.extraResources.some(resource => resource.to === 'plugin-seed')).toBe(false)
})

it('rejects a portable version whose DSH base differs from delivery.json', async () => {
  vi.stubEnv('DSH_DESKTOP_TARGET_PLATFORM', 'darwin')
  vi.stubEnv('DSH_DESKTOP_TARGET_ARCH', 'arm64')
  vi.stubEnv('DSH_DESKTOP_DISTRIBUTION_VERSION', '0.2.0.rc.1.1')
  await expect(import('../electron-builder.portable.config.mjs'))
    .rejects.toThrow('expected 0.2.0.rc.2.<positive integer>')
})

it('derives the ZIP tag and app version from delivery.dshVersion', () => {
  expect(deriveDesktopDistributionVersion('0.2.0-rc.2', 7)).toEqual({
    tag: '0.2.0.rc.2.7', appVersion: '0.2.0-rc.2.7', sequence: 7,
  })
  expect(resolveDesktopDistributionVersion({ dshVersion: '0.2.0-rc.2', version: '0.2.0.rc.2.1' })).toEqual({
    tag: '0.2.0.rc.2.1', appVersion: '0.2.0-rc.2.1', sequence: 1,
  })
  expect(validateDesktopDistributionVersion('0.2.0.rc.2.12', '0.2.0-rc.2')).toBe(12)
})

it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])('rejects an invalid distribution sequence: %s', (sequence) => {
  expect(() => deriveDesktopDistributionVersion('0.2.0-rc.2', sequence)).toThrow('positive safe integer')
})

it.each(['0.2.0.rc.2.0', '0.2.0.rc.2.01', '0.2.0.rc.1.1', '0.2.0.rc.2.1.extra'])
('rejects malformed or mismatched distribution tags: %s', (version) => {
  expect(() => validateDesktopDistributionVersion(version, '0.2.0-rc.2')).toThrow('Invalid desktop distribution version')
})
