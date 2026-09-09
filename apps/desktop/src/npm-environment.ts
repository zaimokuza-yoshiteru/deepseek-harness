/** npm configuration for the bundled pnpm, without requiring a system npm executable. */

import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

/**
 * Retain npm configuration (including TLS and authentication) and select the user's npmrc.
 * pnpm owns parsing, scoped registries, variable expansion, and configuration precedence.
 * @param environment - Environment inherited by the desktop process.
 * @param home - User home used when no npm userconfig override exists.
 * @returns Subprocess environment and the npmrc path; neither is copied into release resources.
 */
export function desktopNpmEnvironment(
  environment: NodeJS.ProcessEnv = process.env,
  home: string = homedir(),
): { env: NodeJS.ProcessEnv; userconfig: string } {
  const env: NodeJS.ProcessEnv = {}
  for (const [name, value] of Object.entries(environment)) {
    if (/^DSH_DESKTOP_/u.test(name) || /^(?:npm|pnpm|corepack)_/iu.test(name)) continue
    env[name] = value
  }
  // Lowercase wins when both spellings exist, as in npm lifecycle environments.
  for (const [name, value] of Object.entries(environment).sort(([a], [b]) => a.localeCompare(b))) {
    if (!/^npm_config_/iu.test(name)) continue
    const normalized = name.toLowerCase()
    if (env[normalized] === undefined || name === normalized) env[normalized] = value
  }
  const configured = env.npm_config_userconfig
  const userconfig = configured === undefined || configured === ''
    ? join(home, '.npmrc')
    : resolve(configured)
  env.npm_config_userconfig = userconfig
  // pnpm 11 reads general network settings from PNPM_CONFIG_*; npm's spelling
  // remains the public desktop input so existing npm configuration still works.
  for (const key of ['registry', 'strict_ssl', 'cafile', 'ca', 'cert', 'key', 'proxy', 'https_proxy', 'no_proxy']) {
    const value = env[`npm_config_${key}`]
    if (value !== undefined) env[`pnpm_config_${key}`] = value
  }
  return { env, userconfig }
}
