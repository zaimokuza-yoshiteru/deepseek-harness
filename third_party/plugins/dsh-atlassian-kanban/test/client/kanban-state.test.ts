import { describe, expect, it, vi } from 'vitest'
import type { AtlassianKanbanRemote, KanbanQueryResult } from '../../src/shared/remote.ts'
import { KanbanController } from '../../src/client/kanban-state.ts'

const settings = {
  jira: { baseUrl: 'https://jira.test', hasToken: true, jql: [{ id: 'jql-1', name: 'Assigned', query: 'assignee = currentUser()' }, { id: 'jql-2', name: 'Open', query: 'status = Open' }] },
  bitbucket: { baseUrl: 'https://bitbucket.test', hasToken: true, repositories: [{ id: 'repo-1', projectKey: 'CORE', repositorySlug: 'web' }] },
  confluence: { baseUrl: 'https://wiki.test', hasToken: true, cql: [{ id: 'cql-1', name: 'Recent', query: 'type = page' }] },
}
const result = (items: KanbanQueryResult['items'], nextCursor: string | null = null): KanbanQueryResult => ({ kind: 'jira-search', items, total: null, nextCursor })

describe('KanbanController', () => {
  it('drops an older query response after the user switches named Jira tabs', async () => {
    let resolveOld!: (value: KanbanQueryResult) => void
    let resolveNew!: (value: KanbanQueryResult) => void
    const remote = {
      settings: vi.fn(async () => settings),
      query: vi.fn((input: import('../../src/shared/remote.ts').KanbanQuery) => input.kind === 'jira-search' && input.jqlId === 'jql-1'
        ? new Promise<KanbanQueryResult>(resolve => { resolveOld = resolve })
        : new Promise<KanbanQueryResult>(resolve => { resolveNew = resolve })),
    } as unknown as AtlassianKanbanRemote
    const controller = new KanbanController(remote)

    const loadSettings = controller.loadSettings()
    await vi.waitFor(() => expect(remote.query).toHaveBeenCalledOnce())
    const switchTab = controller.selectQuery('jql-2')
    await vi.waitFor(() => expect(remote.query).toHaveBeenCalledTimes(2))
    resolveNew(result([{ key: 'NEW-2', title: 'Newest' }]))
    await switchTab
    resolveOld(result([{ key: 'OLD-1', title: 'Stale' }]))
    await loadSettings

    expect(controller.getSnapshot().selection).toBe('jql-2')
    expect(controller.getSnapshot().result?.items).toEqual([{ key: 'NEW-2', title: 'Newest' }])
    controller.dispose()
  })

  it('requests the next opaque cursor and appends only that page', async () => {
    const remote = {
      settings: vi.fn(async () => settings),
      query: vi.fn(async (input: import('../../src/shared/remote.ts').KanbanQuery) => input.kind === 'jira-search' && input.cursor === 'cursor-2'
        ? result([{ key: 'DSH-2', title: 'Second' }])
        : result([{ key: 'DSH-1', title: 'First' }], 'cursor-2')),
    } as unknown as AtlassianKanbanRemote
    const controller = new KanbanController(remote)
    await controller.loadSettings()
    await controller.loadMore()

    expect(remote.query).toHaveBeenLastCalledWith({ kind: 'jira-search', jqlId: 'jql-1', cursor: 'cursor-2' }, expect.any(AbortSignal))
    expect(controller.getSnapshot().result?.items.map(item => item.key)).toEqual(['DSH-1', 'DSH-2'])
    expect(controller.getSnapshot().result?.nextCursor).toBeNull()
    controller.dispose()
  })

  it('keeps same-query results visible during refresh but clears rows for a different query', async () => {
    let resolveRefresh!: (value: KanbanQueryResult) => void
    const remote = {
      settings: vi.fn(async () => settings),
      query: vi.fn()
        .mockResolvedValueOnce(result([{ key: 'DSH-1', title: 'Current result' }]))
        .mockImplementationOnce(() => new Promise<KanbanQueryResult>(resolve => { resolveRefresh = resolve }))
        .mockResolvedValueOnce(result([{ key: 'DSH-2', title: 'Other query' }])),
    } as unknown as AtlassianKanbanRemote
    const controller = new KanbanController(remote)
    await controller.loadSettings()
    const refresh = controller.refresh()
    expect(controller.getSnapshot().status).toBe('loading')
    expect(controller.getSnapshot().result?.items[0]?.key).toBe('DSH-1')
    resolveRefresh(result([{ key: 'DSH-1', title: 'Updated current result' }]))
    await refresh
    expect(controller.getSnapshot().result?.items[0]?.title).toBe('Updated current result')

    const switchQuery = controller.selectQuery('jql-2')
    expect(controller.getSnapshot().result).toBeNull()
    await switchQuery
    expect(controller.getSnapshot().result?.items[0]?.key).toBe('DSH-2')
    controller.dispose()
  })

  it('invalidates an in-flight tab when switching to an unconfigured product', async () => {
    let resolveOld!: (value: KanbanQueryResult) => void
    const remote = {
      settings: vi.fn(async () => ({ ...settings, bitbucket: { baseUrl: '', hasToken: false, repositories: [] } })),
      query: vi.fn(() => new Promise<KanbanQueryResult>(resolve => { resolveOld = resolve })),
    } as unknown as AtlassianKanbanRemote
    const controller = new KanbanController(remote)
    const loading = controller.loadSettings()
    await vi.waitFor(() => expect(remote.query).toHaveBeenCalledOnce())
    await controller.selectProduct('bitbucket')
    resolveOld(result([{ key: 'STALE-1', title: 'Old tab' }]))
    await loading

    expect(controller.getSnapshot().product).toBe('bitbucket')
    expect(controller.getSnapshot().status).toBe('idle')
    expect(controller.getSnapshot().result).toBeNull()
    controller.dispose()
  })
})
