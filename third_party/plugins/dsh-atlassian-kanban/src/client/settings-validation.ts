import type { ConfigValues } from './KanbanSettings.tsx'

export type SettingsValidationKey = 'nameRequired' | 'queryRequired' | 'duplicateIds' | 'repositoryRequired' | 'duplicateRepositories'

/** Validate saved-scope identity before configuration writes can become ambiguous. */
export function validateSettings(values: ConfigValues): SettingsValidationKey | null {
  const queries = [...values.jira.jql, ...values.confluence.cql]
  if (queries.some(row => row.name.trim() === '')) return 'nameRequired'
  if (queries.some(row => row.query.trim() === '')) return 'queryRequired'
  if (hasDuplicateIds(values.jira.jql) || hasDuplicateIds(values.confluence.cql) || hasDuplicateIds(values.bitbucket.repositories)) return 'duplicateIds'
  const repositories = values.bitbucket.repositories
  if (repositories.some(row => row.projectKey.trim() === '' || row.repositorySlug.trim() === '')) return 'repositoryRequired'
  const identities = repositories.map(row => `${row.projectKey.trim().toLowerCase()}\u0000${row.repositorySlug.trim().toLowerCase()}`)
  if (new Set(identities).size !== identities.length) return 'duplicateRepositories'
  return null
}

/** Validate only the product being saved, leaving unrelated drafts independent. */
export function validateProductSettings(product: 'jira' | 'confluence' | 'bitbucket', value: ConfigValues[typeof product]): SettingsValidationKey | null {
  if (product === 'jira') {
    const queries = (value as ConfigValues['jira']).jql
    if (queries.some(row => row.name.trim() === '')) return 'nameRequired'
    if (queries.some(row => row.query.trim() === '')) return 'queryRequired'
    if (hasDuplicateIds(queries)) return 'duplicateIds'
    return null
  }
  if (product === 'confluence') {
    const queries = (value as ConfigValues['confluence']).cql
    if (queries.some(row => row.name.trim() === '')) return 'nameRequired'
    if (queries.some(row => row.query.trim() === '')) return 'queryRequired'
    if (hasDuplicateIds(queries)) return 'duplicateIds'
    return null
  }
  const repositories = (value as ConfigValues['bitbucket']).repositories
  if (hasDuplicateIds(repositories)) return 'duplicateIds'
  if (repositories.some(row => row.projectKey.trim() === '' || row.repositorySlug.trim() === '')) return 'repositoryRequired'
  const identities = repositories.map(row => `${row.projectKey.trim().toLowerCase()}\u0000${row.repositorySlug.trim().toLowerCase()}`)
  return new Set(identities).size === identities.length ? null : 'duplicateRepositories'
}

function hasDuplicateIds(rows: readonly { readonly id: string }[]): boolean {
  return new Set(rows.map(row => row.id)).size !== rows.length
}
