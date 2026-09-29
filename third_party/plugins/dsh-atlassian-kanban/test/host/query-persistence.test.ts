import { readFile } from 'node:fs/promises'
import { describe, expect, it, vi } from 'vitest'
import { renderPrompt } from '@deepseek-ai/dsh-system-prompt'
import type { AtlassianKanbanConfig, AtlassianSettingsView } from '../../src/shared/config.ts'
import { bootProfile, run } from '../helpers/profile.ts'

describe('board query save/readback workflow with native persistence', () => {
  it.each(['jira', 'confluence'] as const)('persists %s additions and renames with stable IDs, retains unrelated config and survives restart', async product => {
    const fixture = await bootProfile()
    const read = () => run(fixture.ctx, 'kanban_get_settings', {}) as Promise<AtlassianSettingsView>
    const rows = (view: AtlassianSettingsView) => product === 'jira' ? view.jira.jql : view.confluence.cql
    const before = await read()
    const rawBefore = fixture.ctx.settings.describe().find(row => row.ns === 'dsh-atlassian-kanban')!.value as AtlassianKanbanConfig
    const promptBefore = renderPrompt(await fixture.ctx.systemPrompt.assemble())
    const query = product === 'jira' ? 'project = APP' : 'space = DOC AND type = page'
    await run(fixture.ctx, 'kanban_upsert_queries', { expectedRevision: before.revision, product, queries: [{ name: 'Board query', query }] })
    const saved = await read()
    const target = rows(saved).find(row => row.name === 'Board query')!
    expect(target).toEqual({ id: expect.any(String), name: 'Board query', query })
    expect(rows(saved)).toEqual([...rows(before), target])
    expect(saved.revision).toBeGreaterThan(before.revision)
    expect(saved.bitbucket).toEqual(before.bitbucket)
    const renamed = { ...target, name: 'Renamed query', query: query + (product === 'jira' ? ' ORDER BY updated DESC' : ' ORDER BY lastmodified DESC') }
    await run(fixture.ctx, 'kanban_upsert_queries', { expectedRevision: saved.revision, product, queries: [renamed] })
    const confirmed = await read()
    expect(rows(confirmed)).toEqual([...rows(before), renamed])
    // Updating the same name without an explicit ID also retains its established ID.
    await run(fixture.ctx, 'kanban_upsert_queries', { expectedRevision: confirmed.revision, product, queries: [{ name: renamed.name, query: renamed.query }] })
    const repeated = await read()
    expect(rows(repeated)).toEqual(rows(confirmed))
    expect(repeated.bitbucket).toEqual(before.bitbucket)
    expect(product === 'jira' ? repeated.confluence : repeated.jira).toEqual(product === 'jira' ? before.confluence : before.jira)
    expect(repeated.refreshMentions).toBe(before.refreshMentions)
    expect(JSON.stringify(repeated)).not.toContain('private-token')
    expect(renderPrompt(await fixture.ctx.systemPrompt.assemble())).toBe(promptBefore)
    const patch = await readFile(fixture.profile.patchPath, 'utf8')
    expect(patch).toContain(renamed.id)
    await fixture.dispose(fixture.ctx)
    const restarted = await fixture.start()
    const persisted = await run(restarted, 'kanban_get_settings', {}) as AtlassianSettingsView
    expect(rows(persisted)).toEqual(rows(repeated))
    const rawAfter = restarted.settings.describe().find(row => row.ns === 'dsh-atlassian-kanban')!.value
    expect(rawAfter).toEqual({ ...rawBefore, [product]: { ...rawBefore[product], [product === 'jira' ? 'jql' : 'cql']: rows(repeated) } })
    expect(persisted.jira.hasToken).toBe(true)
    expect(persisted.bitbucket.hasToken).toBe(true)
    expect(persisted.bitbucket).toEqual(before.bitbucket)
    expect(renderPrompt(await restarted.systemPrompt.assemble())).toBe(promptBefore)
  })

  it('rejects stale or failed CQL saves without pretending persistence succeeded', async () => {
    const fixture = await bootProfile()
    const read = () => run(fixture.ctx, 'kanban_get_settings', {}) as Promise<AtlassianSettingsView>
    const original = await read()
    await run(fixture.ctx, 'kanban_upsert_queries', { expectedRevision: original.revision, product: 'confluence', queries: [{ name: 'Concurrent query', query: 'space = KEEP' }] })
    const concurrent = await read()
    const patch = await readFile(fixture.profile.patchPath, 'utf8')
    const intended = { product: 'confluence', queries: [{ name: 'Requested query', query: 'space = DOC' }] }
    await expect(run(fixture.ctx, 'kanban_upsert_queries', { ...intended, expectedRevision: original.revision })).rejects.toThrow('Configuration revision conflict')
    expect(await read()).toEqual(concurrent)
    expect(await readFile(fixture.profile.patchPath, 'utf8')).toBe(patch)
    const failSave = vi.spyOn(fixture.ctx.settings, 'mutate').mockRejectedValueOnce(new Error('backend failure with private-token'))
    try {
      await expect(run(fixture.ctx, 'kanban_upsert_queries', { ...intended, expectedRevision: concurrent.revision })).rejects.toThrow(/^Could not save Atlassian settings\.$/)
      expect(await read()).toEqual(concurrent)
      expect(await readFile(fixture.profile.patchPath, 'utf8')).toBe(patch)
    } finally { failSave.mockRestore() }
    // A fresh read and reassessed, additive retry keeps the concurrent record.
    const fresh = await read()
    await run(fixture.ctx, 'kanban_upsert_queries', { ...intended, expectedRevision: fresh.revision })
    const confirmed = await read()
    expect(confirmed.confluence.cql).toEqual([...concurrent.confluence.cql, expect.objectContaining(intended.queries[0]!)])
  })
})
