/** Launcher-owned profile locations and composition inputs. */
import { join } from 'node:path'
import { composeEntries, loadProfileDirectory, PROFILE_PATCH_FILENAME, type Profile } from './profile.ts'
import { loadOptionalPatches } from './index.ts'
import type { PatchOptions } from '@deepseek-ai/cordis-plugin-include'

/** Application-owned package manager executable; environment applies only to package operations. */
export interface ProfilePnpmInvocation {
  readonly command: string
  readonly args: readonly string[]
  readonly env: Readonly<Record<string, string>>
}

/** Current profile facts; scheduling and mutation belong to their callers. */
export interface ProfileContext {
  readonly name: string
  /** Packaged applications supply their bundled runtime instead of a PATH executable. */
  readonly packageManager?: ProfilePnpmInvocation
  readonly dir: string
  readonly patchPath: string
  readonly installAnchor: string
  readonly cwd: string
  readonly home: string
  /** Bundle packages used to start this process, before any persisted edits. */
  readonly startedBundles: readonly string[]
  /** Parsed command-line overlays, applied above profile and home patches. */
  readonly overlays: readonly PatchOptions[]
  /** Launch-time DSH_TELEMETRY_DISABLED value; any non-empty value opts out. */
  readonly telemetryDisabledEnv: string | undefined
  /** Whether this process launched the desktop profile with intranet policy enabled. */
  readonly desktopIntranet?: boolean
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Present only in a profile launched by dsh. */
    profileContext: ProfileContext
  }
}

const TELEMETRY_ROW_ID = 'session-telemetry-otel'
const DESKTOP_INTRANET_DISABLED_ROWS = [
  'desktop-product-telemetry',
  'product-analytics',
  'deepseek-account',
  'llm-deepseek',
  'llm-deepseek-account',
  'ui-settings-account',
  'account-controller',
  'ui-settings-session-log',
  'session-telemetry-otel',
  'session-log-deepseek',
  'plugin-package-inventory-deepseek',
  'web-search-deepseek',
] as const

/**
 * Resolve the telemetry opt-out switch into its boot patch. ANY non-empty
 * value (including `'0'`/`'false'`) disables: a privacy switch prefers
 * off-by-mistake over on-by-mistake. A composition without the telemetry row
 * exports nothing, so the switch is then trivially satisfied and no patch is
 * generated — custom profiles need not mount telemetry to run with the
 * switch set.
 * @param disabledEnv - the raw `DSH_TELEMETRY_DISABLED` value (`undefined` when unset).
 * @param hasRow - whether the composition carries the telemetry row.
 * @returns the disable patch, or `undefined` when no hard-disable patch is required.
 */
export function resolveTelemetryPatch(disabledEnv: string | undefined, hasRow: boolean): PatchOptions | undefined {
  if ((disabledEnv ?? '') === '' || !hasRow) return undefined
  return { id: TELEMETRY_ROW_ID, disabled: true }
}

/** Read current bundle and user layers with launch-time enforcement patches.
 * @param binName Diagnostic prefix for malformed or missing configuration.
 * @param context Data supplied by the profile launcher.
 * @param initialProfile Already loaded startup profile; omitted reads the current files.
 * @returns Detached ordered patches, with telemetry opt-out and desktop intranet policy last; this function does not update the Loader.
 */
export function readProfilePatches(binName: string, context: ProfileContext, initialProfile?: Profile): PatchOptions[] {
  const profile = initialProfile ?? loadProfileDirectory(binName, context.dir, context.installAnchor, { userLayer: false })
  const patches = structuredClone([
    ...profile.layers.flatMap(layer => layer.patches),
    ...(initialProfile?.patches ?? loadOptionalPatches(binName, context.patchPath) ?? []),
    ...(loadOptionalPatches(binName, join(context.home, PROFILE_PATCH_FILENAME)) ?? []),
    ...context.overlays,
  ])
  const rows = composeEntries([patches])
  const telemetryPatch = resolveTelemetryPatch(context.telemetryDisabledEnv,
    rows.some(row => row.id === TELEMETRY_ROW_ID))
  if (telemetryPatch !== undefined) patches.push(telemetryPatch)
  if (context.name === 'desktop' && context.desktopIntranet === true) {
    const presentIds = new Set(rows.map(row => row.id))
    for (const id of DESKTOP_INTRANET_DISABLED_ROWS) {
      if (presentIds.has(id)) patches.push({ id, disabled: true })
    }
    const models = rows.find(row => row.id === 'ui-settings-models')
    if (models !== undefined) {
      const config = models.config as Record<string, unknown> | undefined
      patches.push({
        id: 'ui-settings-models',
        config: { ...config, credentialOnboarding: false },
      })
    }
  }
  return patches
}
