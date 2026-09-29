import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import type { AtlassianSettingsView } from '../../src/shared/config.ts'
import { bootProfile, run } from '../helpers/profile.ts'

const batch = Array.from({ length: 10 }, (_, index) => ({ projectKey: 'TEAM', repositorySlug: `repo-${index}` }))

describe('native configuration tools and real profile persistence', () => {
  it('atomically adds a ten-repository batch without replacing existing rows and deduplicates stable identities', async () => {
    const fixture = await bootProfile()
    const firstView = await run(fixture.ctx, 'kanban_get_settings', {}) as AtlassianSettingsView
    expect(firstView.revision).toBe(0)
    expect(firstView.bitbucket.repositories).toEqual([{ id: 'legacy', projectKey: 'OLD', repositorySlug: 'old-repo' }])
    expect(JSON.stringify(firstView)).not.toContain('jira-private-token')

    const updated = await run(fixture.ctx, 'kanban_upsert_repositories', { expectedRevision: firstView.revision, repositories: batch }) as AtlassianSettingsView
    expect(updated.bitbucket.repositories).toHaveLength(11)
    expect(updated.bitbucket.repositories[0]).toEqual({ id: 'legacy', projectKey: 'OLD', repositorySlug: 'old-repo' })
    expect(new Set(updated.bitbucket.repositories.map(row => row.id)).size).toBe(11)
    const repeated = await run(fixture.ctx, 'kanban_upsert_repositories', { expectedRevision: updated.revision, repositories: batch }) as AtlassianSettingsView
    expect(repeated.bitbucket.repositories).toHaveLength(11)
    expect(repeated.bitbucket.repositories.slice(1).map(row => row.id)).toEqual(updated.bitbucket.repositories.slice(1).map(row => row.id))

    const beforeConflict = await readFile(fixture.profile.patchPath, 'utf8')
    await expect(run(fixture.ctx, 'kanban_upsert_repositories', { expectedRevision: repeated.revision, repositories: [
      { id: 'replacement-id', projectKey: 'OLD', repositorySlug: 'old-repo' },
      { projectKey: 'TEAM', repositorySlug: 'another-valid-repo' },
    ] })).rejects.toThrow('Repository identity is already bound to a different id')
    expect(await readFile(fixture.profile.patchPath, 'utf8')).toBe(beforeConflict)
    await expect(run(fixture.ctx, 'kanban_upsert_repositories', { expectedRevision: repeated.revision, repositories: [
      { id: 'legacy', projectKey: 'TEAM', repositorySlug: 'repo-0' },
    ] })).rejects.toThrow('Repository identity is already bound to a different id')
    expect(await readFile(fixture.profile.patchPath, 'utf8')).toBe(beforeConflict)

    const moved = await run(fixture.ctx, 'kanban_upsert_repositories', { expectedRevision: repeated.revision, repositories: [{ id: 'legacy', projectKey: 'NEW', repositorySlug: 'moved' }] }) as AtlassianSettingsView
    expect(moved.bitbucket.repositories).toHaveLength(11)
    expect(moved.bitbucket.repositories.filter(row => row.id === 'legacy')).toEqual([{ id: 'legacy', projectKey: 'NEW', repositorySlug: 'moved' }])
    expect(moved.bitbucket.repositories.some(row => row.projectKey === 'OLD' && row.repositorySlug === 'old-repo')).toBe(false)

    const queries = await run(fixture.ctx, 'kanban_upsert_queries', { expectedRevision: moved.revision, product: 'jira', queries: [
      { name: 'Open work', query: 'statusCategory != Done' }, { name: 'Open work', query: 'statusCategory != Done' },
    ] }) as AtlassianSettingsView
    expect(queries.jira.jql).toHaveLength(2)
    expect(queries.jira.jql[0]).toMatchObject({ id: 'assigned', name: 'Assigned' })
    expect(new Set(queries.jira.jql.map(row => row.id)).size).toBe(2)
  })

  it('rejects malformed batches without profile changes and refuses concurrent stale revisions', async () => {
    const fixture = await bootProfile()
    const patchBefore = await readFile(fixture.profile.patchPath, 'utf8')
    const view = await run(fixture.ctx, 'kanban_get_settings', {}) as AtlassianSettingsView
    await expect(run(fixture.ctx, 'kanban_upsert_repositories', { expectedRevision: view.revision, repositories: [{ projectKey: 'TEAM', repositorySlug: 'good' }, { projectKey: 'BAD/KEY', repositorySlug: 'bad' }] })).rejects.toThrow('projectKey is invalid')
    expect(await readFile(fixture.profile.patchPath, 'utf8')).toBe(patchBefore)
    await expect(run(fixture.ctx, 'kanban_upsert_repositories', { expectedRevision: view.revision, repositories: [{ id: 'shared', projectKey: 'TEAM', repositorySlug: 'one' }, { id: 'shared', projectKey: 'TEAM', repositorySlug: 'two' }] })).rejects.toThrow('Batch reuses a repository id')
    expect(await readFile(fixture.profile.patchPath, 'utf8')).toBe(patchBefore)
    await expect(run(fixture.ctx, 'kanban_upsert_queries', { expectedRevision: view.revision, product: 'jira', queries: [{ id: 'shared', name: 'First', query: 'project = APP' }, { id: 'shared', name: 'Second', query: 'project = OPS' }] })).rejects.toThrow('Batch reuses a query id')
    expect(await readFile(fixture.profile.patchPath, 'utf8')).toBe(patchBefore)

    const race = await Promise.allSettled([
      run(fixture.ctx, 'kanban_set_preferences', { expectedRevision: view.revision, refreshMentions: false }),
      run(fixture.ctx, 'kanban_set_preferences', { expectedRevision: view.revision, refreshMentions: false }),
    ])
    expect(race.filter(row => row.status === 'fulfilled')).toHaveLength(1)
    expect(race.filter(row => row.status === 'rejected')).toHaveLength(1)
    const rejected = race.find(row => row.status === 'rejected') as PromiseRejectedResult
    expect(String(rejected.reason)).toContain('Configuration revision conflict')
  })

  it('persists token retention, replacement, and explicit clearing while never echoing the secret', async () => {
    const fixture = await bootProfile()
    const current = await run(fixture.ctx, 'kanban_get_settings', {}) as AtlassianSettingsView
    const baseChanged = await run(fixture.ctx, 'kanban_update_connections', { expectedRevision: current.revision, jira: { baseUrl: 'https://jira.example/jira' } }) as AtlassianSettingsView
    expect(baseChanged.jira).toMatchObject({ baseUrl: 'https://jira.example/jira', hasToken: true })
    const token = 'new-private-token-never-return-this'
    const tokenChanged = await run(fixture.ctx, 'kanban_update_connections', { expectedRevision: baseChanged.revision, jira: { bearerToken: token } }) as AtlassianSettingsView
    expect(JSON.stringify(tokenChanged)).not.toContain(token)
    expect(JSON.stringify(fixture.ctx.settings.describe({ redactSecrets: true }))).not.toContain(token)
    const storedToken = await readFile(fixture.profile.patchPath, 'utf8')
    expect(storedToken.includes(token)).toBe(true)

    const cleared = await run(fixture.ctx, 'kanban_update_connections', { expectedRevision: tokenChanged.revision, jira: { clearToken: true } }) as AtlassianSettingsView
    expect(cleared.jira.hasToken).toBe(false)

    const contents = await readFile(fixture.profile.patchPath, 'utf8')
    expect(contents.includes(token)).toBe(false)
    await fixture.dispose(fixture.ctx)
    const restarted = await fixture.start()
    const afterRestart = await run(restarted, 'kanban_get_settings', {}) as AtlassianSettingsView
    expect(afterRestart.jira).toMatchObject({ baseUrl: 'https://jira.example/jira', hasToken: false })
    expect(afterRestart.bitbucket.repositories).toHaveLength(1)
  })
})
