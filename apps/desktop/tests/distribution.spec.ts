import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { configureDesktopDistribution } from '../src/distribution.ts'
import { parseDesktopRelease } from '../src/release.ts'
import { DESKTOP_HOST_PROTOCOL_VERSION } from '../src/host-protocol.ts'

describe('desktop distribution', () => {
  it('isolates the profile and Electron state while honoring an explicit home', () => {
    const env: NodeJS.ProcessEnv = {}
    expect(configureDesktopDistribution(env, '/user')).toBe(join('/user', '.dsh-desktop', 'electron-user-data'))
    expect(env.DSH_HOME).toBe(join('/user', '.dsh-desktop'))
    expect(env.DSH_TELEMETRY_MODE).toBe('DISABLED')
    const custom = { DSH_HOME: '/custom', DSH_TELEMETRY_MODE: 'FEEDBACK_ONLY' }
    expect(configureDesktopDistribution(custom)).toBe(join('/custom', 'electron-user-data'))
    expect(custom.DSH_TELEMETRY_MODE).toBe('FEEDBACK_ONLY')
  })

  it.each(['0.1.5-alpha.2', '0.1.5-rc.1'])('keeps the DSH base %s separate from the desktop build counter', (base) => {
    const metadata = {
      schemaVersion: 1, version: base, distributionVersion: `${base}.1`,
      hostProtocolVersion: DESKTOP_HOST_PROTOCOL_VERSION, nodeVersion: '24.17.0', pnpmVersion: '11.7.0',
    }
    expect(parseDesktopRelease(metadata)).toEqual(metadata)
    for (const version of [`${base}.0`, `${base}.01`, '0.1.4.1', `${base}.1-extra`]) {
      expect(() => parseDesktopRelease({ ...metadata, distributionVersion: version })).toThrow(/invalid desktop release/u)
    }
  })
})
