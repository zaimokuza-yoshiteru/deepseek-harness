import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { configureDesktopDistribution } from '../src/distribution.ts'

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

})
