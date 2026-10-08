/** Reconcile the writable profile with plugins shipped in the application runtime. */
import { randomUUID } from 'node:crypto'
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync } from 'node:fs'
import { basename, join } from 'node:path'
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import type { DesktopRuntimeDescriptor } from './runtime-tree.ts'
import { DESKTOP_MANAGED_PLUGINS } from './portable-plugins.ts'
import { desktopProfileBundles, DESKTOP_AGENT_TEAM_BUNDLES } from './profile-defaults.ts'

const MARKER = 'desktop-bundled-plugins.json'
const LEGACY_MARKER = 'desktop-plugin-seed.json'
const JOURNAL = 'journal.json'
const BASE_BUNDLES = ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app']
const RETIRED_MANAGED = ['@zaimokuza/dsh-plugin-hub', '@deepseek-ai/dsh-experimental-agent-team-web-profile']
const PACKAGE_NAME = /^(?:@[a-z0-9][a-z0-9._~-]*\/[a-z0-9][a-z0-9._~-]*|[a-z0-9][a-z0-9._~-]*)$/u

interface Manifest {
  dependencies?: Record<string, string>
  dsh?: { desktop?: { agentTeams?: boolean }; profile?: { bundles?: string[] } }
}
interface Distribution {
  readonly bundles: readonly string[]
  readonly versions: Readonly<Record<string, string>>
}
interface Journal {
  readonly transactionId?: string
  readonly committed?: boolean
  readonly files: readonly { readonly path: string; readonly backup: string }[]
  readonly created: readonly string[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function validNames(value: unknown, label: string): string[] {
  if (!Array.isArray(value)) {
    throw new Error(`desktop profile: invalid ${label} package list`)
  }
  const names: string[] = []
  for (const name of value as unknown[]) {
    if (typeof name !== 'string' || !PACKAGE_NAME.test(name)) throw new Error(`desktop profile: invalid ${label} package list`)
    names.push(name)
  }
  return names
}

function distribution(root: string): Distribution | undefined {
  const path = join(root, 'package.json')
  if (!existsSync(path)) return undefined
  const packageJson = JSON.parse(readFileSync(path, 'utf8')) as {
    dsh?: { distribution?: { bundles?: unknown } }
    dependencies?: Record<string, string>
  }
  const value = packageJson.dsh?.distribution?.bundles
  if (value === undefined) return undefined
  const bundles = validNames(value, 'runtime distribution')
  const versions: Record<string, string> = {}
  for (const name of bundles) {
    const version = packageJson.dependencies?.[name]
    if (typeof version !== 'string') throw new Error(`desktop profile: runtime has no pinned version for ${name}`)
    versions[name] = version
  }
  return { bundles, versions }
}

function entryExists(path: string): boolean {
  try { lstatSync(path); return true } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

function remove(path: string): void {
  try {
    const entry = lstatSync(path)
    rmSync(path, { recursive: entry.isDirectory() && !entry.isSymbolicLink(), force: true })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
}

function checkManagedParents(profile: string, names: Iterable<string>): void {
  const root = join(profile, 'node_modules')
  for (const name of names) {
    const parts = name.split('/')
    const scope = parts.at(0)
    const parents = parts.length === 2 && scope !== undefined ? [root, join(root, scope)] : [root]
    for (const parent of parents) {
      if (!entryExists(parent)) continue
      const stat = lstatSync(parent)
      if (!stat.isDirectory() || stat.isSymbolicLink()) {
        throw new Error(`desktop profile: refusing redirected managed package parent ${parent}`)
      }
    }
  }
}

function readNameList(path: string, field: 'bundles' | 'plugins'): string[] {
  const record = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>
  return validNames(record[field] ?? [], field)
}

function cleanupCommittedBackup(backup: string, journal: Journal): void {
  for (const file of journal.files) {
    if (file.path.startsWith('node_modules/') || file.path.startsWith('desktop-local-plugins/')) {
      remove(join(backup, file.backup))
    }
  }
}

async function recoverInterrupted(profile: string): Promise<void> {
  for (const name of readdirSync(profile).filter(entry => entry.startsWith('.desktop-builtin-migration-'))) {
    if (!/^\.desktop-builtin-migration-[0-9a-f-]{36}$/u.test(name)) continue
    const backup = join(profile, name)
    let backupStat
    try { backupStat = lstatSync(backup) } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue
      throw error
    }
    if (!backupStat.isDirectory() || backupStat.isSymbolicLink()) continue
    const journalPath = join(backup, JOURNAL)
    if (!existsSync(journalPath)) {
      const leftovers = readdirSync(backup)
      if (leftovers.length === 0) {
        remove(backup)
      } else if (leftovers.length === 1 && /^journal\.json\.[0-9a-f]{12}\.tmp$/u.test(leftovers[0] ?? '')) {
        const tempName = leftovers[0]
        if (tempName === undefined) throw new Error(`desktop profile: incomplete migration journal ${journalPath}`)
        const tempPath = join(backup, tempName)
        const tempStat = lstatSync(tempPath)
        if (!tempStat.isFile() || tempStat.isSymbolicLink()) {
          throw new Error(`desktop profile: incomplete migration journal ${journalPath}`)
        }
        remove(tempPath)
        remove(backup)
      } else {
        throw new Error(`desktop profile: incomplete migration journal ${journalPath}`)
      }
      continue
    }
    const value: unknown = JSON.parse(readFileSync(journalPath, 'utf8'))
    const safeRelative = (path: unknown): path is string => typeof path === 'string' && !path.startsWith('/')
      && !path.includes('\\') && !path.split('/').some(part => part === '' || part === '.' || part === '..')
    const files: { path: string; backup: string }[] = []
    const created: string[] = []
    if (!isRecord(value) || !Array.isArray(value.files) || !Array.isArray(value.created)) {
      throw new Error(`desktop profile: invalid migration journal ${journalPath}`)
    }
    for (const entry of value.files) {
      const managedPackagePath = isRecord(entry) && typeof entry.path === 'string'
        && entry.path.startsWith('node_modules/')
        && PACKAGE_NAME.test(entry.path.slice('node_modules/'.length))
      const ownedArchivePath = isRecord(entry) && typeof entry.path === 'string'
        && /^desktop-local-plugins\/[^/]+\.tgz$/u.test(entry.path)
      if (!isRecord(entry) || !safeRelative(entry.path) || typeof entry.backup !== 'string'
        || !/^[0-9]+-[A-Za-z0-9@._-]+$/u.test(entry.backup)
        || !(entry.path === 'package.json' || entry.path === MARKER || entry.path === LEGACY_MARKER
          || managedPackagePath || ownedArchivePath)) {
        throw new Error(`desktop profile: invalid migration journal ${journalPath}`)
      }
      files.push({ path: entry.path, backup: entry.backup })
    }
    for (const path of value.created) {
      if (typeof path !== 'string' || (path !== 'package.json' && path !== MARKER)) {
        throw new Error(`desktop profile: invalid migration journal ${journalPath}`)
      }
      created.push(path)
    }
    checkManagedParents(profile, files.flatMap(file => file.path.startsWith('node_modules/')
      ? [file.path.slice('node_modules/'.length)] : []))
    const transactionId = typeof value.transactionId === 'string' ? value.transactionId : undefined
    const journal: Journal = { transactionId, committed: value.committed === true, files, created }
    if (journal.committed) {
      try { cleanupCommittedBackup(backup, journal) } catch { /* Retry cleanup next startup. */ }
      continue
    }
    if (transactionId !== undefined && existsSync(join(profile, MARKER))) {
      const marker = JSON.parse(readFileSync(join(profile, MARKER), 'utf8')) as Record<string, unknown>
      if (marker.migrationId === transactionId) {
        await writeFileAtomic(journalPath, `${JSON.stringify({ ...journal, committed: true }, null, 2)}\n`, { mode: 0o600 })
        try { cleanupCommittedBackup(backup, journal) } catch { /* Retry cleanup next startup. */ }
        continue
      }
    }
    for (const path of journal.created) remove(join(profile, path))
    for (const file of [...journal.files].reverse()) {
      const saved = join(backup, file.backup)
      if (!entryExists(saved)) continue
      const original = join(profile, file.path)
      remove(original)
      mkdirSync(join(original, '..'), { recursive: true, mode: 0o700 })
      renameSync(saved, original)
    }
    remove(backup)
  }
}

/** Apply runtime-owned built-ins transactionally; the caller holds the profile lock. */
export async function reconcileBundledPlugins(profile: string, runtimeRoot: string, runtime: DesktopRuntimeDescriptor): Promise<boolean> {
  const bundled = distribution(runtimeRoot)
  if (bundled === undefined) return false
  await recoverInterrupted(profile)
  const manifestPath = join(profile, 'package.json')
  const markerPath = join(profile, MARKER)
  const legacyMarkerPath = join(profile, LEGACY_MARKER)
  const old = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) as Manifest : undefined
  const prior = existsSync(markerPath) ? JSON.parse(readFileSync(markerPath, 'utf8')) as Record<string, unknown> : undefined
  const oldSeed = existsSync(legacyMarkerPath) ? readNameList(legacyMarkerPath, 'plugins') : []
  const priorBundles = prior === undefined ? [] : validNames(prior.bundles ?? [], 'marker')
  const managed = new Set([...DESKTOP_MANAGED_PLUGINS.map(plugin => plugin.name), ...RETIRED_MANAGED, ...oldSeed, ...priorBundles])
  const markerMatches = prior?.release === runtime.release.version
    && JSON.stringify(priorBundles) === JSON.stringify(bundled.bundles)
    && JSON.stringify(prior.versions) === JSON.stringify(bundled.versions)
  const staleManagedState = existsSync(legacyMarkerPath)
    || [...managed].some(name => Object.hasOwn(old?.dependencies ?? {}, name)
      || entryExists(join(profile, 'node_modules', ...name.split('/'))))
  if (markerMatches && !staleManagedState) return false

  checkManagedParents(profile, managed)
  const previousBundles = old?.dsh?.profile?.bundles ?? []
  const fresh = old === undefined
  const keep = new Set(previousBundles)
  const teams = fresh
    ? [...DESKTOP_AGENT_TEAM_BUNDLES]
    : old.dsh?.desktop?.agentTeams === false ? [] : previousBundles.filter(name => DESKTOP_AGENT_TEAM_BUNDLES.includes(name as never))
  const nextBundles = [
    ...desktopProfileBundles(runtime.release.version, false), ...teams,
    ...bundled.bundles.filter(name => fresh || keep.has(name)),
    ...previousBundles.filter(name => !managed.has(name) && !BASE_BUNDLES.includes(name)),
  ]
  const dependencies = Object.fromEntries(Object.entries(old?.dependencies ?? {}).filter(([name]) => !managed.has(name)))
  const next: Manifest = {
    ...old, dependencies,
    dsh: { ...old?.dsh, desktop: { ...old?.dsh?.desktop }, profile: { ...old?.dsh?.profile, bundles: [...new Set(nextBundles)] } },
  }
  if (next.dsh?.desktop !== undefined) delete next.dsh.desktop.agentTeams
  const marker = { schemaVersion: 1, release: runtime.release.version, bundles: [...bundled.bundles],
    versions: bundled.versions, migrationId: '' }

  const archivePaths = Object.entries(old?.dependencies ?? {}).flatMap(([name, spec]) => {
    if (!managed.has(name) || !spec.startsWith('file:./desktop-local-plugins/')) return []
    const archiveRoot = join(profile, 'desktop-local-plugins')
    if (entryExists(archiveRoot)) {
      const stat = lstatSync(archiveRoot)
      if (!stat.isDirectory() || stat.isSymbolicLink()) return []
    }
    const relative = spec.slice('file:./'.length)
    if (relative.includes('..') || relative.includes('\\') || !relative.endsWith('.tgz')) return []
    const dependencies = old?.dependencies ?? {}
    const referencedByExtra = Object.entries(dependencies)
      .some(([other, otherSpec]) => !managed.has(other) && otherSpec === spec)
    if (referencedByExtra) return []
    return [relative]
  })
  const items = [manifestPath, markerPath, legacyMarkerPath,
    ...[...managed].map(name => join(profile, 'node_modules', ...name.split('/'))),
    ...archivePaths.map(path => join(profile, path))].filter(entryExists)
  const transactionId = randomUUID()
  const backup = join(profile, `.desktop-builtin-migration-${transactionId}`)
  mkdirSync(backup, { mode: 0o700 })
  const files = items.map((path, index) => ({
    path: path.slice(profile.length + 1).replaceAll('\\', '/'), backup: `${String(index)}-${basename(path)}`,
  }))
  const created = [MARKER, ...(old === undefined ? ['package.json'] : [])]
  const journal: Journal = { transactionId, files, created }
  marker.migrationId = transactionId
  await writeFileAtomic(join(backup, JOURNAL), `${JSON.stringify(journal, null, 2)}\n`, { mode: 0o600 })
  try {
    for (const file of files) renameSync(join(profile, file.path), join(backup, file.backup))
    await writeFileAtomic(manifestPath, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 })
    await writeFileAtomic(markerPath, `${JSON.stringify(marker, null, 2)}\n`, { mode: 0o600 })
    await writeFileAtomic(join(backup, JOURNAL), `${JSON.stringify({ ...journal, committed: true }, null, 2)}\n`, { mode: 0o600 })
    try { cleanupCommittedBackup(backup, { ...journal, committed: true }) } catch { /* Retry cleanup next startup. */ }
    return true // Retain the readable journal and backup as the committed migration receipt.
  } catch (error) {
    try {
      const published = JSON.parse(readFileSync(markerPath, 'utf8')) as Record<string, unknown>
      if (published.migrationId === transactionId) {
        try { await writeFileAtomic(join(backup, JOURNAL), `${JSON.stringify({ ...journal, committed: true }, null, 2)}\n`, { mode: 0o600 }) }
        catch { /* Startup recognizes the published marker and finalizes this receipt. */ }
        try { cleanupCommittedBackup(backup, { ...journal, committed: true }) } catch { /* Retry cleanup next startup. */ }
        return true
      }
    } catch { /* No committed marker was published; restore the transaction below. */ }
    for (const path of created) remove(join(profile, path))
    for (const file of [...files].reverse()) {
      const saved = join(backup, file.backup)
      if (!entryExists(saved)) continue
      const original = join(profile, file.path)
      remove(original)
      mkdirSync(join(original, '..'), { recursive: true, mode: 0o700 })
      renameSync(saved, original)
    }
    remove(backup)
    throw error
  }
}
