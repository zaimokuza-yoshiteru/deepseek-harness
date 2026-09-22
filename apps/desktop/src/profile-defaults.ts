/** Official profile layers and adapter pins for the desktop distribution. */

/** Official Agent Teams layers, ordered after the base and Web layers. */
export const DESKTOP_AGENT_TEAM_BUNDLES = [
  '@deepseek-ai/dsh-experimental-agent-team-profile',
] as const

const BASE_BUNDLES = ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'] as const

/**
 * Read a released profile using its original built-in layer prefix.
 * @param version - DSH version recorded in the profile's release metadata.
 * @param agentTeams - Persisted opt-in state; omitted preserves the release default.
 * @returns Ordered built-in layers; the alpha.2 and rc.1 releases predate Teams defaults.
 */
export function desktopProfileBundles(version: string, agentTeams = true): readonly string[] {
  return !agentTeams || version === '0.1.5-alpha.2' || version === '0.1.5-rc.1'
    ? BASE_BUNDLES
    : [...BASE_BUNDLES, ...DESKTOP_AGENT_TEAM_BUNDLES]
}
