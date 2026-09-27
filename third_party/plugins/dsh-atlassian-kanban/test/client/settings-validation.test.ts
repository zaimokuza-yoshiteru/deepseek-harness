import { describe, expect, it } from 'vitest'
import type { ConfigValues } from '../../src/client/KanbanSettings.tsx'
import { validateSettings } from '../../src/client/settings-validation.ts'

const valid: ConfigValues = {
  refreshMentions: true,
  jira: { baseUrl: 'https://jira.example', jql: [{ id: 'assigned', name: 'Assigned to me', query: 'assignee = currentUser()' }] },
  bitbucket: { baseUrl: 'https://bitbucket.example', repositories: [{ id: 'web', projectKey: 'CORE', repositorySlug: 'web' }] },
  confluence: { baseUrl: 'https://wiki.example', cql: [{ id: 'docs', name: 'Product docs', query: 'type = page' }] },
}

describe('Atlassian saved-scope validation', () => {
  it('rejects incomplete named queries before saving but permits unconfigured products', () => {
    expect(validateSettings({ ...valid, jira: { ...valid.jira, jql: [{ id: 'x', name: '   ', query: 'project = CORE' }] } })).toBe('nameRequired')
    expect(validateSettings({ ...valid, confluence: { ...valid.confluence, cql: [{ id: 'x', name: 'Pages', query: '  ' }] } })).toBe('queryRequired')
    expect(validateSettings({ ...valid, bitbucket: { ...valid.bitbucket, baseUrl: '', repositories: [] } })).toBeNull()
  })

  it('rejects ambiguous duplicate IDs and duplicate repository identities', () => {
    expect(validateSettings({ ...valid, jira: { ...valid.jira, jql: [...valid.jira.jql, { id: 'assigned', name: 'Other', query: 'status = Open' }] } })).toBe('duplicateIds')
    expect(validateSettings({ ...valid, bitbucket: { ...valid.bitbucket, repositories: [{ id: 'web', projectKey: 'CORE', repositorySlug: 'web' }, { id: 'web-copy', projectKey: 'core', repositorySlug: 'WEB' }] } })).toBe('duplicateRepositories')
    expect(validateSettings({ ...valid, bitbucket: { ...valid.bitbucket, repositories: [{ id: 'web', projectKey: '', repositorySlug: 'web' }] } })).toBe('repositoryRequired')
    expect(validateSettings(valid)).toBeNull()
  })

  it('validates just the product being saved', async () => {
    const { validateProductSettings } = await import('../../src/client/settings-validation.ts')
    expect(validateProductSettings('jira', { ...valid.jira, jql: [{ id: 'x', name: '', query: '' }] })).toBe('nameRequired')
    expect(validateProductSettings('bitbucket', { ...valid.bitbucket, repositories: [] })).toBeNull()
    expect(validateProductSettings('confluence', { ...valid.confluence, cql: [{ id: 'x', name: 'Pages', query: '' }] })).toBe('queryRequired')
  })
})
