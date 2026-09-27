/** Persisted native configuration. Tokens stay on the host and are never part of a view. */
export type AtlassianProduct = 'jira' | 'bitbucket' | 'confluence'

export interface NamedQuery {
  readonly id: string
  readonly name: string
  readonly query: string
}

export interface BitbucketRepositoryRef {
  readonly id: string
  readonly projectKey: string
  readonly repositorySlug: string
}

export interface JiraConnectionConfig {
  readonly baseUrl: string
  readonly bearerToken: string
  readonly jql: readonly NamedQuery[]
}

export interface BitbucketConnectionConfig {
  readonly baseUrl: string
  readonly bearerToken: string
  readonly repositories: readonly BitbucketRepositoryRef[]
}

export interface ConfluenceConnectionConfig {
  readonly baseUrl: string
  readonly bearerToken: string
  readonly cql: readonly NamedQuery[]
}

export interface AtlassianKanbanConfig {
  readonly refreshMentions: boolean
  readonly jira: JiraConnectionConfig
  readonly bitbucket: BitbucketConnectionConfig
  readonly confluence: ConfluenceConnectionConfig
}

/** Redacted, renderer-safe settings. Never include bearerToken in this shape. */
export interface AtlassianSettingsView {
  readonly revision: number
  readonly refreshMentions: boolean
  readonly jira: { readonly baseUrl: string; readonly hasToken: boolean; readonly jql: readonly NamedQuery[] }
  readonly bitbucket: { readonly baseUrl: string; readonly hasToken: boolean; readonly repositories: readonly BitbucketRepositoryRef[] }
  readonly confluence: { readonly baseUrl: string; readonly hasToken: boolean; readonly cql: readonly NamedQuery[] }
}

/** Candidate repository identity sent to an exact Bitbucket validation request. */
export interface BitbucketRepositoryCandidate {
  readonly projectKey: string
  readonly repositorySlug: string
}

export interface BitbucketRepositoryValidation extends BitbucketRepositoryCandidate {
  readonly ok: boolean
  readonly name: string | null
  readonly url: string | null
  readonly cloneUrl: string | null
  readonly message: string
}

/** Empty token means retain the saved token; there is no token readback operation. */
export interface AtlassianSettingsInput {
  readonly refreshMentions?: boolean
  /** Empty bearerToken retains the saved credential, even if baseUrl changes. Set clearToken to remove it. */
  readonly jira: { readonly baseUrl: string; readonly bearerToken: string; readonly clearToken?: boolean; readonly jql: readonly NamedQuery[] }
  readonly bitbucket: { readonly baseUrl: string; readonly bearerToken: string; readonly clearToken?: boolean; readonly repositories: readonly BitbucketRepositoryRef[] }
  readonly confluence: { readonly baseUrl: string; readonly bearerToken: string; readonly clearToken?: boolean; readonly cql: readonly NamedQuery[] }
}
