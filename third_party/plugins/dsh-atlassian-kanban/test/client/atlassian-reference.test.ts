import { describe, expect, it, vi } from 'vitest'
import type { AtlassianKanbanRemote, KanbanQuery, KanbanQueryResult, KanbanSuggestionsResult } from '../../src/shared/remote.ts'
import { createAtlassianReferenceSource } from '../../src/client/atlassian-reference.ts'
import { en, zh } from '../../src/client/locales.ts'

const settings = (refreshMentions = true) => ({
  revision: 3,
  refreshMentions,
  jira: { baseUrl: 'https://jira.test', hasToken: true, jql: [{ id: 'jql-assigned', name: 'Assigned work', query: 'assignee = currentUser()' }] },
  bitbucket: { baseUrl: 'https://bitbucket.test', hasToken: true, repositories: [{ id: 'repo-web', projectKey: 'CORE', repositorySlug: 'web' }] },
  confluence: { baseUrl: 'https://wiki.test', hasToken: true, cql: [{ id: 'cql-recent', name: 'Recent pages', query: 'type = page' }] },
})
const result = (kind: KanbanQuery['kind'], items: KanbanQueryResult['items'], nextCursor: string | null = null): KanbanQueryResult => ({ kind, items, total: items.length, nextCursor })
const cached = (value: KanbanQueryResult | null): KanbanSuggestionsResult => ({ result: value, fromCache: true })
const request = (query: string, signal = new AbortController().signal) => ({ query, signal, position: 'leading' as const, drilled: false })
const localize = (locale: typeof zh) => (key: string) => locale[key as keyof typeof locale] ?? key

describe('Atlassian @ source', () => {
  it('offers local category and configured-scope choices without querying a product', async () => {
    const suggestions = vi.fn(async () => cached(result('jira-search', [])))
    const query = vi.fn()
    const remote = { settings: vi.fn(async () => settings()), suggestions, query } as unknown as AtlassianKanbanRemote
    const source = createAtlassianReferenceSource(remote, localize(zh))

    const root = await source.candidates({ sessionId: 'session-1' } as never, request(''))
    expect(source.name).toBe('atlassian')
    expect(source.showGroupTitle).toBe(false)
    expect(root.map(item => item.name)).toEqual(['jira', 'repo', 'pr', 'confluence'])
    expect(root.map(item => item.label)).toEqual([zh.jira, zh.repo, zh.titlePr, zh.confluence])
    expect(root.map(item => item.section)).toEqual(Array(4).fill('Atlassian'))
    expect(suggestions).not.toHaveBeenCalled()

    const configured = await source.candidates({ sessionId: 'session-1' } as never, request('jira:'))
    expect(configured.map(item => item.name)).toEqual(['Assigned work'])
    expect(configured[0]?.section).toBe(zh.sectionJira)
    expect((await source.candidates({ sessionId: 'session-1' } as never, request('JIRA:'))).map(item => item.name)).toEqual(['Assigned work'])
    const drill = source.onPick({ candidate: configured[0]!, session: { sessionId: 'session-1' } as never, position: 'leading', via: 'menu', action: 'pick', span: { start: 0, end: 5, draftRev: 0 } })
    expect(drill).toEqual({ text: '@jira:jql-assigned:', continue: true })
    expect(suggestions).not.toHaveBeenCalled()
    expect(query).not.toHaveBeenCalled()
  })

  it('refreshes only the selected scope and scans later cached pages only for a keyword', async () => {
    const suggestions = vi.fn(async (input: KanbanQuery) => input.kind === 'jira-search'
      ? input.cursor === 'jira-page-2'
        ? cached(result(input.kind, [{ key: 'DSH-22', title: 'Fix board refresh' }]))
        : { ...cached(result(input.kind, [{ key: 'OPS-3', title: 'Database maintenance' }], 'jira-page-2')), fromCache: false }
      : cached(result(input.kind, [])))
    const query = vi.fn()
    const remote = { settings: async () => settings(), suggestions, query } as unknown as AtlassianKanbanRemote
    const source = createAtlassianReferenceSource(remote, localize(en))

    const initial = await source.candidates({ sessionId: 'session-1' } as never, request('jira:jql-assigned:'))
    expect(initial.map(item => item.name)).toEqual(['OPS-3'])
    expect(suggestions).toHaveBeenCalledTimes(1)
    expect(suggestions).toHaveBeenNthCalledWith(1, { kind: 'jira-search', jqlId: 'jql-assigned' }, expect.any(AbortSignal))

    const candidates = await source.candidates({ sessionId: 'session-1' } as never, request('jira:jql-assigned:DSH'))
    expect(suggestions).toHaveBeenNthCalledWith(2, { kind: 'jira-search', jqlId: 'jql-assigned' }, expect.any(AbortSignal))
    expect(suggestions).toHaveBeenNthCalledWith(3, { kind: 'jira-search', jqlId: 'jql-assigned', cursor: 'jira-page-2' }, expect.any(AbortSignal))
    expect(candidates.map(item => item.name)).toEqual(['DSH-22'])
    expect(candidates[0]?.label).toBe('Fix board refresh')
    const inserted = source.onPick({ candidate: candidates[0]!, session: { sessionId: 'session-1' } as never, position: 'leading', via: 'enter', action: 'pick', span: { start: 0, end: 32, draftRev: 1 } })
    expect(inserted).toHaveProperty('insert.source', 'atlassian')
    if (inserted === undefined || typeof inserted === 'string' || 'text' in inserted || 'claim' in inserted) throw new Error('Expected a structured reference')
    await expect(source.codec?.serialize(inserted.insert.ref, new AbortController().signal)).resolves.toBe('Jira issue DSH-22')
    expect(query).not.toHaveBeenCalled()
    expect(JSON.stringify(candidates)).not.toContain('bearerToken')
  })

  it('shows a localized cache hint when refresh is disabled and suggestions are not cached', async () => {
    const suggestions = vi.fn(async () => ({ result: null, fromCache: false }))
    const query = vi.fn()
    const remote = { settings: async () => settings(false), suggestions, query } as unknown as AtlassianKanbanRemote
    const source = createAtlassianReferenceSource(remote, localize(zh))
    const candidates = await source.candidates({ sessionId: 's' } as never, request('confluence:cql-recent:'))
    expect(candidates).toEqual([{ name: zh.noCachedSuggestions, hint: zh.hintAt, section: zh.sectionConfluence }])
    expect(suggestions).toHaveBeenCalledWith({ kind: 'confluence-search', cqlId: 'cql-recent' }, expect.any(AbortSignal))
    expect(query).not.toHaveBeenCalled()
  })

  it('uses a successful cached result while automatic refresh is disabled', async () => {
    const suggestions = vi.fn(async () => cached(result('jira-search', [{ key: 'DSH-3', title: 'Cached issue' }])))
    const query = vi.fn()
    const source = createAtlassianReferenceSource({ settings: async () => settings(false), suggestions, query } as unknown as AtlassianKanbanRemote, localize(zh))
    const candidates = await source.candidates({ sessionId: 's' } as never, request('jira:jql-assigned:'))
    expect(candidates.map(item => item.name)).toEqual(['DSH-3'])
    expect(query).not.toHaveBeenCalled()
  })

  it('does not publish a late response after the candidate request is cancelled', async () => {
    let resolveSuggestion!: (value: KanbanSuggestionsResult) => void
    const suggestions = vi.fn(() => new Promise<KanbanSuggestionsResult>(resolve => { resolveSuggestion = resolve }))
    const controller = new AbortController()
    const source = createAtlassianReferenceSource({ settings: async () => settings(true), suggestions } as unknown as AtlassianKanbanRemote, localize(en))
    const pending = source.candidates({ sessionId: 's' } as never, request('jira:jql-assigned:', controller.signal))
    await Promise.resolve()
    expect(suggestions).toHaveBeenCalledWith({ kind: 'jira-search', jqlId: 'jql-assigned' }, controller.signal)
    controller.abort()
    resolveSuggestion(cached(result('jira-search', [{ key: 'DSH-8', title: 'Late issue' }])))
    await expect(pending).resolves.toEqual([])
  })

  it('uses suggestions for configured repositories and PRs and honors cancellation', async () => {
    const controller = new AbortController()
    const suggestions = vi.fn(async (input: KanbanQuery) => {
      if (input.kind === 'bitbucket-repository') return cached(result(input.kind, [{ cloneUrl: 'ssh://git@bitbucket.test/scm/core/web.git' }]))
      if (input.kind === 'bitbucket-pull-requests') return cached(result(input.kind, [{ id: 12, title: 'Improve navigation' }, { id: 13, title: 'Docs cleanup' }]))
      return cached(result(input.kind, []))
    })
    const query = vi.fn()
    const source = createAtlassianReferenceSource({ settings: async () => settings(), suggestions, query } as unknown as AtlassianKanbanRemote, localize(en))

    const repo = await source.candidates({ sessionId: 's' } as never, request('repo:repo-web:', controller.signal))
    expect(suggestions).toHaveBeenCalledWith({ kind: 'bitbucket-repository', repositoryId: 'repo-web' }, controller.signal)
    expect(repo).toHaveLength(1)
    const repoRef = JSON.parse(repo[0]!.value!) as { kind: string; cloneUrl: string }
    expect(repoRef).toEqual({ kind: 'repo', repositoryId: 'repo-web', label: 'CORE/web', cloneUrl: 'ssh://git@bitbucket.test/scm/core/web.git' })
    await expect(source.codec?.serialize(repo[0]!.value!, new AbortController().signal)).resolves.toContain('ssh://git@bitbucket.test/scm/core/web.git')

    const prs = await source.candidates({ sessionId: 's' } as never, request('pr:repo-web:nav'))
    expect(suggestions).toHaveBeenLastCalledWith({ kind: 'bitbucket-pull-requests', repositoryId: 'repo-web', state: 'all' }, expect.any(AbortSignal))
    expect(prs.map(item => item.name)).toEqual(['#12 Improve navigation'])
    await expect(source.codec?.serialize(prs[0]!.value!, new AbortController().signal)).resolves.toBe('Bitbucket pull request CORE/web#12')
    expect(query).not.toHaveBeenCalled()

    controller.abort()
    expect(await source.candidates({ sessionId: 's' } as never, request('repo:repo-web:', controller.signal))).toEqual([])
  })
})
