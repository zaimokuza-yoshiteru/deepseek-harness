import type { AtlassianProduct, AtlassianSettingsView, NamedQuery } from '../shared/config.ts'
import type { AtlassianKanbanRemote, KanbanQuery, KanbanQueryResult } from '../shared/remote.ts'

export type KanbanView = 'jira' | 'bitbucket' | 'confluence'
export type PullRequestState = 'all' | 'open' | 'merged'
export type RequestStatus = 'idle' | 'loading' | 'ready' | 'error'

export interface KanbanSnapshot {
  readonly settings: AtlassianSettingsView | null
  readonly product: KanbanView
  readonly selection: string | null
  readonly pullRequestState: PullRequestState
  readonly status: RequestStatus
  readonly result: KanbanQueryResult | null
  readonly error: string | null
  readonly loadingMore: boolean
}

export const EMPTY_KANBAN_SNAPSHOT: KanbanSnapshot = {
  settings: null, product: 'jira', selection: null, pullRequestState: 'all',
  status: 'idle', result: null, error: null, loadingMore: false,
}

/** Owns the visible request generation so an old tab or page can never replace newer results. */
export class KanbanController {
  private snapshot: KanbanSnapshot = EMPTY_KANBAN_SNAPSHOT
  private listeners = new Set<() => void>()
  private request: AbortController | undefined
  private generation = 0
  private disposed = false

  constructor(private readonly remote: AtlassianKanbanRemote) {}

  getSnapshot = (): KanbanSnapshot => this.snapshot
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  private publish(next: KanbanSnapshot): void {
    if (this.disposed) return
    this.snapshot = next
    for (const listener of this.listeners) listener()
  }

  async loadSettings(): Promise<void> {
    const generation = ++this.generation
    this.request?.abort()
    this.publish({ ...this.snapshot, status: 'loading', error: null })
    try {
      const settings = await this.remote.settings()
      if (this.disposed || generation !== this.generation) return
      const selection = this.firstSelection(this.snapshot.product, settings)
      this.publish({ ...this.snapshot, settings, selection, status: 'idle', result: null, error: null })
      if (selection !== null) await this.refresh()
    } catch (error) {
      if (this.disposed || generation !== this.generation) return
      this.publish({ ...this.snapshot, status: 'error', error: this.message(error), result: null })
    }
  }

  async selectProduct(product: KanbanView): Promise<void> {
    this.generation += 1
    this.request?.abort()
    const selection = this.firstSelection(product, this.snapshot.settings)
    this.publish({ ...this.snapshot, product, selection, pullRequestState: 'all', status: 'idle', result: null, error: null, loadingMore: false })
    if (selection !== null) await this.refresh()
  }

  async selectQuery(selection: string): Promise<void> {
    if (selection === this.snapshot.selection) return
    this.generation += 1
    this.request?.abort()
    this.publish({ ...this.snapshot, selection, status: 'idle', result: null, error: null, loadingMore: false })
    await this.refresh()
  }

  async setPullRequestState(pullRequestState: PullRequestState): Promise<void> {
    if (pullRequestState === this.snapshot.pullRequestState) return
    this.generation += 1
    this.request?.abort()
    this.publish({ ...this.snapshot, pullRequestState, status: 'idle', result: null, error: null, loadingMore: false })
    await this.refresh()
  }

  async refresh(): Promise<void> {
    const query = this.queryFor(this.snapshot)
    if (query === null) {
      this.generation += 1
      this.request?.abort()
      this.publish({ ...this.snapshot, status: 'idle', result: null, error: null, loadingMore: false })
      return
    }
    const generation = ++this.generation
    this.request?.abort()
    const request = new AbortController()
    this.request = request
    // Keep the current page visible while refreshing the same query. Query
    // selection changes clear it before arriving here, so this is safe to
    // distinguish from a first load.
    this.publish({ ...this.snapshot, status: 'loading', error: null, loadingMore: false })
    await this.run(query, request, generation, false)
  }

  async loadMore(): Promise<void> {
    const current = this.snapshot.result
    const cursor = current?.nextCursor
    if (cursor === null || cursor === undefined || this.snapshot.status !== 'ready' || this.snapshot.loadingMore) return
    const baseQuery = this.queryFor(this.snapshot)
    if (baseQuery === null) return
    const query = { ...baseQuery, cursor } as KanbanQuery
    const generation = this.generation
    const request = new AbortController()
    this.request = request
    this.publish({ ...this.snapshot, loadingMore: true, error: null })
    await this.run(query, request, generation, true)
  }

  dispose(): void {
    this.disposed = true
    this.request?.abort()
    this.listeners.clear()
  }

  private async run(query: KanbanQuery, request: AbortController, generation: number, append: boolean): Promise<void> {
    try {
      const result = await this.remote.query(query, request.signal)
      if (this.disposed || request.signal.aborted || generation !== this.generation || !this.sameQuery(query)) return
      const previous = append ? this.snapshot.result : null
      const combined = previous === null ? result : { ...result, items: [...previous.items, ...result.items] }
      this.publish({ ...this.snapshot, status: 'ready', result: combined, error: null, loadingMore: false })
    } catch (error) {
      if (this.disposed || request.signal.aborted || generation !== this.generation || !this.sameQuery(query)) return
      this.publish({ ...this.snapshot, status: append ? 'ready' : 'error', error: this.message(error), loadingMore: false })
    }
  }

  private sameQuery(query: KanbanQuery): boolean {
    const { cursor: _cursor, ...withoutCursor } = query as KanbanQuery & { readonly cursor?: string }
    return JSON.stringify(this.queryFor(this.snapshot)) === JSON.stringify(withoutCursor)
  }

  private queryFor(snapshot: KanbanSnapshot): KanbanQuery | null {
    if (snapshot.settings === null || snapshot.selection === null) return null
    if (snapshot.product === 'jira') {
      if (!snapshot.settings.jira.hasToken || snapshot.settings.jira.baseUrl === '') return null
      return { kind: 'jira-search', jqlId: snapshot.selection }
    }
    if (snapshot.product === 'bitbucket') {
      if (!snapshot.settings.bitbucket.hasToken || snapshot.settings.bitbucket.baseUrl === '') return null
      return { kind: 'bitbucket-pull-requests', repositoryId: snapshot.selection, state: snapshot.pullRequestState }
    }
    if (!snapshot.settings.confluence.hasToken || snapshot.settings.confluence.baseUrl === '') return null
    return { kind: 'confluence-search', cqlId: snapshot.selection }
  }

  private firstSelection(product: KanbanProduct, settings: AtlassianSettingsView | null): string | null {
    if (settings === null) return null
    const selected = this.snapshot.product === product ? this.snapshot.selection : null
    if (product === 'jira') return containsId(settings.jira.jql, selected) ? selected : settings.jira.jql[0]?.id ?? null
    if (product === 'bitbucket') return containsId(settings.bitbucket.repositories, selected) ? selected : settings.bitbucket.repositories[0]?.id ?? null
    return containsId(settings.confluence.cql, selected) ? selected : settings.confluence.cql[0]?.id ?? null
  }

  private message(error: unknown): string { return error instanceof Error ? error.message : String(error) }
}

type KanbanProduct = AtlassianProduct
function containsId(values: readonly ({ readonly id: string })[], id: string | null): id is string {
  return id !== null && values.some(value => value.id === id)
}

export function namedQueries(settings: AtlassianSettingsView | null, product: 'jira' | 'confluence'): readonly NamedQuery[] {
  return settings === null ? [] : product === 'jira' ? settings.jira.jql : settings.confluence.cql
}
