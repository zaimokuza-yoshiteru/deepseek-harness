import type { SettingsPathOpView } from '@deepseek-ai/dsh-api-remotes/client'
import type { ConfigForm } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { AtlassianProduct, NamedQuery, BitbucketRepositoryRef } from '../shared/config.ts'
import type { ConnectionDraft } from '../shared/remote.ts'
import type { ConfigValues } from './KanbanSettings.tsx'

export interface SecretDraft {
  readonly values: Readonly<Record<AtlassianProduct, string>>
  readonly clear: Readonly<Record<AtlassianProduct, boolean>>
}

/** Build only one product's operations so its save cannot rewrite other drafts. */
export function buildProductSettingsOps(product: AtlassianProduct, source: ConfigValues, secrets: SecretDraft): SettingsPathOpView[] {
  const ops: SettingsPathOpView[] = [
    { op: 'set', path: [product, 'baseUrl'], value: source[product].baseUrl },
  ]
  if (product === 'jira') ops.push({ op: 'set', path: ['jira', 'jql'], value: source.jira.jql as readonly NamedQuery[] as never })
  else if (product === 'bitbucket') ops.push({ op: 'set', path: ['bitbucket', 'repositories'], value: source.bitbucket.repositories as readonly BitbucketRepositoryRef[] as never })
  else ops.push({ op: 'set', path: ['confluence', 'cql'], value: source.confluence.cql as readonly NamedQuery[] as never })
  if (secrets.values[product] !== '') ops.push({ op: 'set', path: [product, 'bearerToken'], value: secrets.values[product] })
  else if (secrets.clear[product]) ops.push({ op: 'set', path: [product, 'bearerToken'], value: '' })
  return ops
}

export function buildRefreshMentionsOp(enabled: boolean): SettingsPathOpView[] {
  return [{ op: 'set', path: ['refreshMentions'], value: enabled }]
}

/** A sibling draft may advance only when this exact revision was our sole write. */
export function canRebaseUnchangedDraft(baseRevision: number, latestRevision: number, baseValue: string, latestValue: unknown): boolean {
  return latestRevision === baseRevision + 1 && JSON.stringify(latestValue) === baseValue
}

/** Build the unsaved connection test input without writing any form operations. */
export function connectionDraftFor(baseUrl: string, token: string, clearToken: boolean): ConnectionDraft {
  return {
    baseUrl,
    ...(token === '' ? {} : { bearerToken: token }),
    ...(clearToken && token === '' ? { clearToken: true } : {}),
  }
}

/** Fence a draft at the revision where its first edit was made. */
export async function saveSettingsDraft(
  form: Pick<ConfigForm<ConfigValues>, 'mutate'>,
  ops: readonly SettingsPathOpView[],
  draftRevision: number | null,
  currentRevision: number | undefined,
): Promise<'saved' | 'conflict'> {
  if (currentRevision === undefined || (draftRevision !== null && draftRevision !== currentRevision)) return 'conflict'
  return await form.mutate(ops, draftRevision ?? currentRevision) ? 'saved' : 'conflict'
}
