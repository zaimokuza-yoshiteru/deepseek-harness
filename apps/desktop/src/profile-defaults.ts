/** Official profile layers and adapter pins for the desktop distribution. */

/** Official Agent Teams layers, ordered after the base and Web layers. */
export const DESKTOP_AGENT_TEAM_BUNDLES = [
  '@deepseek-ai/dsh-experimental-agent-team-profile',
  '@deepseek-ai/dsh-experimental-agent-team-web-profile',
] as const

const BASE_BUNDLES = ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'] as const

/**
 * Read a released profile using its original built-in layer prefix.
 * @param version - DSH version recorded in the profile's release metadata.
 * @returns Ordered built-in layers; the alpha.2 and rc.1 releases predate Teams defaults.
 */
export function desktopProfileBundles(version: string): readonly string[] {
  return version === '0.1.5-alpha.2' || version === '0.1.5-rc.1'
    ? BASE_BUNDLES
    : [...BASE_BUNDLES, ...DESKTOP_AGENT_TEAM_BUNDLES]
}

/**
 * Preserve each released profile's exact adapter exception in the pnpm policy.
 * @param version - DSH version recorded in the profile's release metadata.
 * @returns Adapter version pinned by that desktop release line.
 */
export function desktopAdapterVersion(version: string): string {
  return version === '0.1.5-rc.2' ? '0.1.5-rc.2.1' : version
}
