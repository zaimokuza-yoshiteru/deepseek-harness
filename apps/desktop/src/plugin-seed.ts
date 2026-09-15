/** Transactional migration from released desktop profiles to prebuilt plugin dependencies. */
import { randomUUID } from 'node:crypto'
import { cpSync, existsSync, lstatSync, unlinkSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { DESKTOP_PORTABLE_PLUGINS } from './portable-plugins.ts'
import { desktopProfileBundles, DESKTOP_AGENT_TEAM_BUNDLES } from './profile-defaults.ts'
import type { DesktopRuntimeDescriptor } from './runtime-tree.ts'
import { removeOwnedDirectory } from './owned-directory.ts'

const MARKER = 'desktop-plugin-seed.json'
interface ProfileManifest {
  dependencies?: Record<string, string>
  dsh?: { desktop?: { agentTeams?: boolean }; profile?: { bundles?: string[] } }
}

/** Whether this profile has received the application's pinned plugin template.
 * @param profile - Writable desktop profile.
 * @param seed - Read-only prepared plugins.
 * @returns True when an initialization or upgrade is required.
 */
export function needsPluginSeed(profile: string, seed: string): boolean {
  return !existsSync(join(profile, MARKER)) || readFileSync(join(profile, MARKER), 'utf8') !== readFileSync(join(seed, MARKER), 'utf8')
}

/** Keep the previous profile intact until the new dependency graph has been prepared.
 * @param profile - Locked writable profile.
 * @param seed - Prebuilt plugin template.
 * @param backupRoot - Desktop-owned durable migration backups.
 * @param runtime - Current core package identity.
 * @param prepare - Validate the migrated profile, installing only additional user plugins when necessary.
 */
export async function applyPluginSeed(
  profile: string, seed: string, backupRoot: string, runtime: DesktopRuntimeDescriptor,
  prepare: (install: boolean) => Promise<void>,
): Promise<void> {
  const manifestPath = join(profile, 'package.json')
  const old = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) as ProfileManifest : undefined
  const bundled = new Set<string>(DESKTOP_PORTABLE_PLUGINS.map(plugin => plugin.name))
  const core = new Set(runtime.sharedPackages.map(entry => entry.name))
  const extras = Object.fromEntries(Object.entries(old?.dependencies ?? {}).filter(([name]) => !core.has(name) && !bundled.has(name)))
  const previousBundles = old?.dsh?.profile?.bundles ?? []
  const teams = old === undefined ? true : old.dsh?.desktop?.agentTeams ?? previousBundles.includes(DESKTOP_AGENT_TEAM_BUNDLES[0])
  const backup = join(backupRoot, randomUUID())
  mkdirSync(backup, { recursive: true, mode: 0o700 })
  const entries = readdirSync(profile).filter(name => name !== 'lock')
  const moved: string[] = []
  let copiedSeed = false
  try {
    for (const name of entries) {
      renameSync(join(profile, name), join(backup, name))
      moved.push(name)
    }
    copiedSeed = true
    cpSync(seed, profile, { recursive: true, dereference: true,
      filter: source => !['.modules.yaml', '.pnpm-workspace-state-v1.json', '.pnpm'].includes(source.split(/[\\/]/u).at(-1) ?? ''),
    })
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as ProfileManifest
    manifest.dependencies = { ...manifest.dependencies, ...extras }
    manifest.dsh = {
      ...old?.dsh,
      desktop: { ...old?.dsh?.desktop, agentTeams: teams },
      profile: { ...old?.dsh?.profile, bundles: [
        ...desktopProfileBundles(runtime.release.version, teams),
        ...DESKTOP_PORTABLE_PLUGINS.filter(plugin => old === undefined
          || !Object.hasOwn(old.dependencies ?? {}, plugin.name) || previousBundles.includes(plugin.name)).map(plugin => plugin.name),
        ...previousBundles.filter(name => Object.hasOwn(extras, name)),
      ] },
    }
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 })
    // Preserve user configuration; dependency state belongs to the new runtime.
    for (const name of entries) {
      if (name === 'node_modules' || name.startsWith('desktop-') || name.startsWith('pnpm-') || name === 'package.json') continue
      cpSync(join(backup, name), join(profile, name), { recursive: true, dereference: false })
    }
    await prepare(Object.keys(extras).length > 0)
  } catch (error) {
    for (const name of copiedSeed ? readdirSync(profile) : []) {
      if (name === 'lock') continue
      const path = join(profile, name)
      if (lstatSync(path).isDirectory()) removeOwnedDirectory(path)
      else unlinkSync(path)
    }
    for (const name of moved) renameSync(join(backup, name), join(profile, name))
    throw error
  } finally {
    if (readdirSync(backup).length === 0) rmSync(backup, { recursive: true })
  }
}
