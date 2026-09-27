import type { AtlassianProduct, AtlassianSettingsView } from './config.ts'
export type { AtlassianProduct, AtlassianSettingsInput, AtlassianSettingsView, NamedQuery, BitbucketRepositoryRef } from './config.ts'

export interface ConnectionTestResult {
  readonly product: AtlassianProduct
  readonly ok: boolean
  readonly displayName: string | null
  readonly message: string
}

/** Optional unsaved connection values for testing. Tokens are never returned. */
export interface ConnectionDraft {
  readonly baseUrl: string
  /** Empty or omitted retains the saved host token. */
  readonly bearerToken?: string
  /** Explicitly test with no bearer token. */
  readonly clearToken?: boolean
}

export type KanbanQuery =
  | { readonly kind: 'jira-search'; readonly jqlId: string; readonly cursor?: string; readonly maxResults?: number }
  | { readonly kind: 'bitbucket-pull-requests'; readonly repositoryId: string; readonly state: 'all' | 'open' | 'merged'; readonly cursor?: string; readonly limit?: number }
  | { readonly kind: 'confluence-search'; readonly cqlId: string; readonly cursor?: string; readonly limit?: number }
  | { readonly kind: 'bitbucket-repository'; readonly repositoryId: string }
  | { readonly kind: 'jira-issue'; readonly issueKey: string }
  | { readonly kind: 'bitbucket-pull-request'; readonly repositoryId: string; readonly pullRequestId: number }
  | { readonly kind: 'confluence-page'; readonly pageId: string }

export interface KanbanQueryResult {
  readonly kind: KanbanQuery['kind']
  readonly items: readonly Record<string, string | number | boolean | null>[]
  readonly total: number | null
  /** Opaque, server-provided continuation token. Null means the list is complete. */
  readonly nextCursor: string | null
}

/** Mention lookup may be satisfied from this instance's successful result cache. */
export interface KanbanSuggestionsResult {
  readonly result: KanbanQueryResult | null
  /** True only when no Atlassian request was made and a cached value was returned. */
  readonly fromCache: boolean
}

/** Public Remote namespace contract. Mutating product operations are deliberately absent. */
export interface AtlassianKanbanRemote {
  settings(): Promise<AtlassianSettingsView>
  testConnection(product: AtlassianProduct, draft?: ConnectionDraft): Promise<ConnectionTestResult>
  query(input: KanbanQuery, signal?: AbortSignal): Promise<KanbanQueryResult>
  suggestions(input: KanbanQuery, signal?: AbortSignal): Promise<KanbanSuggestionsResult>
}
