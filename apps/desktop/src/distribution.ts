/** Defaults for the fork's isolated desktop application. */
import { homedir } from 'node:os'
import { join } from 'node:path'

/**
 * Set defaults before the host or any profile is opened; explicit user settings win.
 * @param env - Desktop launch environment.
 * @param home - Operating-system user home.
 * @returns Separate Electron user-data directory under the selected DSH home.
 */
export function configureDesktopDistribution(env: NodeJS.ProcessEnv = process.env, home = homedir()): string {
  env.DSH_HOME ||= join(home, '.dsh-desktop')
  env.DSH_TELEMETRY_MODE ??= 'DISABLED'
  return join(env.DSH_HOME, 'electron-user-data')
}
