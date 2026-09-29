import { defineTool, type ParameterPropertySpec, type ParameterSchemaSpec, type ToolRunContext } from '@deepseek-ai/dsh-tools'
import type { Context } from '@deepseek-ai/cordis'
import { createHash } from 'node:crypto'
import type { SettingsPathOp } from '@deepseek-ai/dsh-settings'
import type { AtlassianService } from './service.ts'
import type { AtlassianProduct, BitbucketRepositoryRef, NamedQuery } from '../shared/config.ts'
import { parseBaseUrl } from './http.ts'

type Args = Record<string, any>
type ToolFn = (args: Args, signal: AbortSignal) => Promise<unknown>
type ModelJson = null | boolean | number | string | ModelJson[] | { [key: string]: ModelJson }
const s = (description: string, required = true): ParameterPropertySpec => ({ type: 'string', description, ...(required ? { required: true } : {}) })
const n = (description: string, required = true): ParameterPropertySpec => ({ type: 'number', description, ...(required ? { required: true } : {}) })
const obj = (description: string, required = true): ParameterPropertySpec => ({ type: 'object', description, additionalProperties: true, ...(required ? { required: true } : {}) })
const bool = (description: string, required = true): ParameterPropertySpec => ({ type: 'boolean', description, ...(required ? { required: true } : {}) })
const array = (description: string, items: NonNullable<Extract<ParameterPropertySpec, { type: 'array' }>['items']>, required = true): ParameterPropertySpec => ({ type: 'array', description, items, ...(required ? { required: true } : {}) })
const queryRowSchema = { type: 'object', additionalProperties: false, properties: { id: { type: 'string', description: 'Reuse the saved id from kanban_get_settings when editing or renaming; omit for a new query' }, name: { type: 'string', description: 'Query display name', required: true }, query: { type: 'string', description: 'JQL or CQL expression', required: true } } } as const
const repoRowSchema = { type: 'object', additionalProperties: false, properties: { id: { type: 'string', description: 'Optional stable id' }, projectKey: { type: 'string', description: 'Bitbucket project key', required: true }, repositorySlug: { type: 'string', description: 'Bitbucket repository slug', required: true } } } as const

const segment = (value: string, label: string) => {
  if (!value || value.trim() !== value || /[\u0000-\u001f\u007f]/.test(value)) throw new TypeError(`${label} is invalid`)
  return encodeURIComponent(value)
}
const repository = (service: AtlassianService, projectKey: unknown, repositorySlug: unknown) => {
  const repo = service.settings().bitbucket.repositories.find(row => row.projectKey === projectKey && row.repositorySlug === repositorySlug)
  if (!repo) throw new TypeError('Unknown configured Bitbucket repository')
  return repo
}
const repoPath = (service: AtlassianService, projectKey: unknown, repositorySlug: unknown) => {
  const repo = repository(service, projectKey, repositorySlug)
  return `/rest/api/1.0/projects/${segment(repo.projectKey, 'project key')}/repos/${segment(repo.repositorySlug, 'repository slug')}`
}
const issuePath = (key: string) => `/rest/api/2/issue/${segment(key, 'issue key')}`
const pagePath = (id: string) => `/rest/api/content/${segment(id, 'content id')}`
const prPath = (service: AtlassianService, a: Args) => `${repoPath(service, a.projectKey, a.repositorySlug)}/pull-requests/${positiveInteger(a.pullRequestId, 'pull request id')}`
const positiveInteger = (value: unknown, label: string) => {
  const n = Number(value)
  if (!Number.isSafeInteger(n) || n < 1) throw new TypeError(`${label} must be a positive integer`)
  return n
}

export function registerTools(ctx: Context, service: AtlassianService): (() => void)[] {
  const disposers: (() => void)[] = []
  const add = (name: string, description: string, parameters: ParameterSchemaSpec, run: ToolFn) => {
    const execute = async (args: Args, exec: ToolRunContext): Promise<ModelJson> => {
      try { return modelJson(await run(args, exec.signal)) }
      catch (error) {
        const payload = typeof error === 'object' && error !== null ? Reflect.get(error, 'toolErrorPayload') : undefined
        if (typeof payload === 'object' && payload !== null) throw new Error(JSON.stringify(payload))
        throw error
      }
    }
    disposers.push(ctx.tools.register(defineTool({ name, description, parameters, output: { schema: { type: 'json' }, render: (_args, value) => [{ type: 'text' as const, text: JSON.stringify(value) }] }, execute })))
  }
  const api = (product: AtlassianProduct, method: string, path: string, signal: AbortSignal, query?: URLSearchParams, body?: unknown) => service.api(product, method, path, { signal, ...(query ? { query } : {}), ...(body === undefined ? {} : { body }) })
  const revision = (args: Args): number => {
    const value = Number(args.expectedRevision)
    if (!Number.isSafeInteger(value) || value < 0) throw new TypeError('expectedRevision must be a non-negative integer from kanban_get_settings')
    return value
  }
  const nonempty = (value: unknown, label: string, max = 2048): string => {
    if (typeof value !== 'string' || value.trim() !== value || value.length === 0 || value.length > max || /[\u0000-\u001f\u007f]/.test(value)) throw new TypeError(`${label} is invalid`)
    return value
  }
  const stableId = (kind: string, key: string): string => `${kind}-${createHash('sha256').update(key.toLowerCase()).digest('hex').slice(0, 20)}`
  const uniqueIds = (input: unknown): string[] => {
    if (!Array.isArray(input) || input.length < 1 || input.length > 100 || input.some(id => typeof id !== 'string' || !id || id.length > 128)) throw new TypeError('Provide 1 to 100 valid ids')
    return [...new Set(input as string[])]
  }

  add('kanban_get_settings', 'Read the DSH Atlassian Kanban board’s saved local configuration and revision; credentials are redacted. Before saving JQL/CQL, read existing IDs and revision here, then use kanban_upsert_queries. Read again after saving to verify the target ID, name and expression before reporting success.', {}, async () => service.settings())
  add('kanban_update_connections', 'Update one or more product base URLs and bearer tokens atomically. Omitted/empty tokens are retained; set clearToken=true to remove a token. The result never contains token values.', {
    expectedRevision: n('Revision from kanban_get_settings'),
    jira: { type: 'object', description: 'Optional Jira connection patch', additionalProperties: false, properties: { baseUrl: s('New base URL, or empty to disable the URL', false), bearerToken: s('New bearer token; never returned', false), clearToken: bool('Explicitly clear the saved token', false) } },
    bitbucket: { type: 'object', description: 'Optional Bitbucket connection patch', additionalProperties: false, properties: { baseUrl: s('New base URL, or empty to disable the URL', false), bearerToken: s('New bearer token; never returned', false), clearToken: bool('Explicitly clear the saved token', false) } },
    confluence: { type: 'object', description: 'Optional Confluence connection patch', additionalProperties: false, properties: { baseUrl: s('New base URL, or empty to disable the URL', false), bearerToken: s('New bearer token; never returned', false), clearToken: bool('Explicitly clear the saved token', false) } },
  }, async a => {
    const ops: SettingsPathOp[] = []
    for (const product of ['jira', 'bitbucket', 'confluence'] as const) {
      const patch = a[product]
      if (patch === undefined) continue
      if (!isRecord(patch)) throw new TypeError(`${product} connection patch must be an object`)
      if (patch.baseUrl !== undefined) {
        if (typeof patch.baseUrl !== 'string') throw new TypeError(`${product} baseUrl must be text`)
        if (patch.baseUrl !== '') parseBaseUrl(patch.baseUrl)
        ops.push({ op: 'set', path: [product, 'baseUrl'], value: patch.baseUrl })
      }
      if (patch.bearerToken !== undefined && patch.bearerToken !== '') {
        if (typeof patch.bearerToken !== 'string' || patch.bearerToken.length > 8192 || /[\u0000-\u001f\u007f]/.test(patch.bearerToken)) throw new TypeError(`${product} bearerToken is invalid`)
        ops.push({ op: 'set', path: [product, 'bearerToken'], value: patch.bearerToken })
      }
      if (patch.clearToken === true) {
        if (patch.bearerToken !== undefined && patch.bearerToken !== '') throw new TypeError('Use either bearerToken or clearToken, not both')
        ops.push({ op: 'set', path: [product, 'bearerToken'], value: '' })
      } else if (patch.clearToken !== undefined && typeof patch.clearToken !== 'boolean') throw new TypeError(`${product} clearToken must be boolean`)
    }
    if (ops.length === 0) throw new TypeError('Provide at least one connection change')
    return service.mutateSettings(revision(a), ops, true)
  })
  add('kanban_set_preferences', 'Update plugin-wide mention behavior. When refreshMentions is false, @ suggestions use only successful local query cache entries.', { expectedRevision: n('Revision from kanban_get_settings'), refreshMentions: bool('Refresh Atlassian data during @ suggestions') }, async a => service.mutateSettings(revision(a), [{ op: 'set', path: ['refreshMentions'], value: a.refreshMentions }]))

  add('kanban_upsert_queries', 'Persist named Jira JQL or Confluence CQL in the DSH Atlassian Kanban board’s local configuration; this does not run a remote search. First call kanban_get_settings, preserve existing IDs, and submit only intended changes with its latest revision. Unmentioned queries and connections are retained. Exact duplicates collapse; conflicting duplicates reject the batch. On revision conflict, re-read and reassess before retrying. After success, call kanban_get_settings again and verify the saved record before reporting it saved.', {
    expectedRevision: n('Latest revision from kanban_get_settings; a conflict requires re-reading and reassessing the change'), product: { type: 'string', enum: ['jira', 'confluence'], description: 'jira saves JQL in jira.jql; confluence saves CQL in confluence.cql', required: true }, queries: array('1 to 100 intended named query additions or updates; unmentioned saved queries are preserved', queryRowSchema),
  }, async a => {
    const product = a.product as 'jira' | 'confluence'
    if (product !== 'jira' && product !== 'confluence') throw new TypeError('product must be jira or confluence')
    if (!Array.isArray(a.queries) || a.queries.length < 1 || a.queries.length > 100) throw new TypeError('Provide 1 to 100 named queries')
    const listKey = product === 'jira' ? 'jql' : 'cql'
    const existing: readonly NamedQuery[] = product === 'jira' ? service.configSnapshot().jira.jql : service.configSnapshot().confluence.cql
    const prepared = new Map<string, NamedQuery>()
    const preparedIds = new Map<string, string>()
    for (const value of a.queries) {
      if (!isRecord(value)) throw new TypeError('Each query entry must be an object')
      const name = nonempty(value.name, 'query name', 160)
      const query = nonempty(value.query, 'query text', 8192)
      const normalizedName = name.toLocaleLowerCase('en-US')
      const duplicate = prepared.get(normalizedName)
      if (duplicate) {
        if (duplicate.query !== query || (value.id !== undefined && value.id !== duplicate.id)) throw new TypeError('Batch contains conflicting query names or ids')
        continue
      }
      const prior = existing.find(row => row.name.toLocaleLowerCase('en-US') === normalizedName)
      const id = value.id === undefined ? prior?.id ?? stableId(`${product}-query`, normalizedName) : nonempty(value.id, 'query id', 128)
      const duplicateIdName = preparedIds.get(id)
      if (duplicateIdName !== undefined && duplicateIdName !== normalizedName) throw new TypeError('Batch reuses a query id for different query names')
      preparedIds.set(id, normalizedName)
      prepared.set(normalizedName, { id, name, query })
    }
    const byId = new Map(existing.map(row => [row.id, row]))
    for (const row of prepared.values()) byId.set(row.id, row)
    const finalRows = [...byId.values()]
    const seenNames = new Set<string>()
    for (const row of finalRows) {
      const key = row.name.toLocaleLowerCase('en-US')
      if (seenNames.has(key)) throw new TypeError('Saved query names must be unique; batch was not applied')
      seenNames.add(key)
    }
    return service.mutateSettings(revision(a), [{ op: 'set', path: [product, listKey], value: finalRows }], true)
  })
  add('kanban_delete_queries', 'Delete named saved Jira JQL or Confluence CQL queries by id.', { expectedRevision: n('Revision from kanban_get_settings'), product: { type: 'string', enum: ['jira', 'confluence'], description: 'Query product', required: true }, ids: array('Saved query ids to delete', { type: 'string' }) }, async a => {
    const product = a.product as 'jira' | 'confluence'
    if (product !== 'jira' && product !== 'confluence') throw new TypeError('product must be jira or confluence')
    const ids = new Set(uniqueIds(a.ids)), key = product === 'jira' ? 'jql' : 'cql'
    const currentRows: readonly NamedQuery[] = product === 'jira' ? service.configSnapshot().jira.jql : service.configSnapshot().confluence.cql
    const rows = currentRows.filter(row => !ids.has(row.id))
    return service.mutateSettings(revision(a), [{ op: 'set', path: [product, key], value: rows }], true)
  })
  add('kanban_upsert_repositories', 'Add or update configured Bitbucket repositories after checking access with kanban_validate_repositories. Existing repositories are preserved; repeated project/slug entries are deduplicated and any invalid/conflicting entry rejects the whole batch.', { expectedRevision: n('Revision from kanban_get_settings'), repositories: array('Up to 100 Bitbucket repository identities', repoRowSchema) }, async a => {
    if (!Array.isArray(a.repositories) || a.repositories.length < 1 || a.repositories.length > 100) throw new TypeError('Provide 1 to 100 repositories')
    const existing = service.configSnapshot().bitbucket.repositories
    const byIdentity = new Map(existing.map(row => [repoIdentity(row.projectKey, row.repositorySlug), row]))
    const batch = new Map<string, BitbucketRepositoryRef>()
    const idsToIdentity = new Map(existing.map(row => [row.id, repoIdentity(row.projectKey, row.repositorySlug)]))
    for (const value of a.repositories) {
      if (!isRecord(value)) throw new TypeError('Each repository must be an object')
      const projectKey = repositoryPart(value.projectKey, 'projectKey')
      const repositorySlug = repositoryPart(value.repositorySlug, 'repositorySlug')
      const identity = repoIdentity(projectKey, repositorySlug)
      const priorBatch = batch.get(identity)
      if (priorBatch) {
        if (value.id !== undefined && value.id !== priorBatch.id) throw new TypeError('Batch contains conflicting repository ids')
        continue
      }
      const prior = byIdentity.get(identity)
      const id = value.id === undefined ? prior?.id ?? stableId('repo', identity) : nonempty(value.id, 'repository id', 128)
      if (prior !== undefined && prior.id !== id) throw new TypeError('Repository identity is already bound to a different id')
      const otherIdentity = idsToIdentity.get(id)
      const batchIdentity = [...batch.values()].find(row => row.id === id)
      if (batchIdentity && repoIdentity(batchIdentity.projectKey, batchIdentity.repositorySlug) !== identity) throw new TypeError('Batch reuses a repository id for different repositories')
      if (otherIdentity !== undefined && otherIdentity !== identity) {
        if (value.id === undefined) throw new TypeError('Repository id is already used by a different repository')
        byIdentity.delete(otherIdentity)
      }
      batch.set(identity, { id, projectKey, repositorySlug })
      idsToIdentity.set(id, identity)
    }
    for (const [identity, row] of batch) byIdentity.set(identity, row)
    return service.mutateSettings(revision(a), [{ op: 'set', path: ['bitbucket', 'repositories'], value: [...byIdentity.values()] }], true)
  })
  add('kanban_delete_repositories', 'Remove configured Bitbucket repositories by id.', { expectedRevision: n('Revision from kanban_get_settings'), ids: array('Configured repository ids to delete', { type: 'string' }) }, async a => {
    const ids = new Set(uniqueIds(a.ids)), rows = service.configSnapshot().bitbucket.repositories.filter(row => !ids.has(row.id))
    return service.mutateSettings(revision(a), [{ op: 'set', path: ['bitbucket', 'repositories'], value: rows }], true)
  })
  add('kanban_validate_repositories', 'Check repository candidates with exact GETs using the configured Bitbucket bearer token. Accepts repositories that are not configured yet; never scans or searches the server.', { repositories: array('Up to 100 {projectKey, repositorySlug} candidates', repoRowSchema) }, (a, signal) => service.validateRepositories(a.repositories as { projectKey: string; repositorySlug: string }[], signal))
  const ensureChild = async (parentId: string, childId: string, signal: AbortSignal) => {
    const child = await api('confluence', 'GET', pagePath(childId), signal, new URLSearchParams({ expand: 'ancestors' }))
    const ancestors = typeof child === 'object' && child !== null ? Reflect.get(child, 'ancestors') : undefined
    const directParent = Array.isArray(ancestors) ? ancestors.at(-1) : undefined
    if (typeof directParent !== 'object' || directParent === null || String(Reflect.get(directParent, 'id')) !== parentId) {
      throw new TypeError('The supplied child page does not belong to the supplied parent')
    }
  }

  add('kanban_jira_search_issues', 'Search remote Jira issues for DSH Atlassian Kanban using temporary jql or a saved jqlId. This never saves board configuration; use kanban_upsert_queries with product=jira and verify with kanban_get_settings to save JQL.', { jql: s('Temporary JQL expression; not saved, takes precedence over jqlId', false), jqlId: s('Existing jira.jql id from kanban_get_settings; used when jql is omitted', false), cursor: s('Optional server pagination cursor', false), maxResults: n('Maximum results, clamped to 100', false) }, async (a, signal) => {
    const jql = typeof a.jql === 'string' && a.jql.trim() ? a.jql : undefined
    const saved = !jql && typeof a.jqlId === 'string' ? service.settings().jira.jql.find(q => q.id === a.jqlId)?.query : undefined
    if (!jql && !saved) throw new TypeError('Provide JQL or a valid configured jqlId')
    return service.searchJira(jql ?? saved!, a.cursor, a.maxResults, signal)
  })
  add('kanban_jira_get_issue', 'Read a Jira issue and its fields by key.', { issueKey: s('Jira issue key, such as APP-123') }, (a, signal) => api('jira', 'GET', issuePath(String(a.issueKey)), signal, new URLSearchParams({ fields: '*all' })))
  add('kanban_jira_list_attachments', 'List at most 100 Jira attachment metadata records from the issue response. The Jira field is not paged upstream; pagingMode=local indicates a locally sliced collection. Continue with nextStart until complete=true. This returns metadata only; use kanban_jira_get_attachment or kanban_jira_read_attachment for content.', { issueKey: s('Jira issue key, such as APP-123'), start: n('Local attachment offset', false), limit: n('Attachments per page, at most 100', false) }, (a, signal) => service.jiraListAttachments(String(a.issueKey), nonNegativeInteger(a.start ?? 0, 'start'), positivePageSize(a.limit ?? 50, 100, 'limit'), signal))
  add('kanban_jira_get_attachment', 'Read metadata for one numeric Jira attachment id. Metadata does not contain the attachment body.', { attachmentId: s('Numeric Jira attachment id') }, (a, signal) => service.jiraGetAttachment(String(a.attachmentId), signal))
  add('kanban_jira_read_attachment', 'Read a supported UTF-8 text Jira attachment in segments. Each attachment is limited to 5 MiB and each response to 20,000 Unicode characters. Continue with nextOffset; PDF, Office, image, binary, invalid UTF-8, and oversized content are not returned as text.', { attachmentId: s('Numeric Jira attachment id'), offset: n('Zero-based Unicode character offset', false), maxChars: n('Characters to read, 1 to 20,000', false) }, (a, signal) => service.jiraReadAttachment(String(a.attachmentId), nonNegativeInteger(a.offset ?? 0, 'offset'), positivePageSize(a.maxChars ?? 10000, 20000, 'maxChars'), signal))
  add('kanban_jira_download_attachment', 'Store a Jira attachment of any format in DSH native attachment storage, bounded to 10 MiB. The returned provider-owned file is durable and is not removed by temporary cache cleanup. No PDF or Office parsing is performed.', { attachmentId: s('Numeric Jira attachment id') }, (a, signal) => service.jiraDownloadAttachment(String(a.attachmentId), signal))
  add('kanban_jira_clone_issue', 'Clone an issue through Jira Data Center 11.3.5 native CloneIssueDetails web action. Optional native checkbox values are read from Jira’s clone form; no synthetic copy fields are used.', { issueKey: s('Source issue key'), summary: s('Optional clone summary; defaults to Jira native form value', false), cloneSubTasks: { type: 'boolean', description: 'Override the native clone subtasks checkbox' }, cloneAttachments: { type: 'boolean', description: 'Override the native clone attachments checkbox' }, cloneLinks: { type: 'boolean', description: 'Override the native clone links checkbox' }, customField: { type: 'boolean', description: 'Override Jira native custom field option' } }, (a, signal) => jiraNativeClone(service, String(a.issueKey), a, signal))
  add('kanban_jira_get_clone_status', 'Poll a Jira 11.3.5 native CloneIssueProgress task. Call only with task details returned by kanban_jira_clone_issue; this never repeats the clone POST.', { taskId: s('Native Jira clone task id'), progressAction: { type: 'string', enum: ['CloneIssueProgress.jspa', 'CloneIssueProgress!default.jspa'], description: 'Native Jira progress action returned by kanban_jira_clone_issue' } }, (a, signal) => jiraGetCloneStatus(service, String(a.taskId), String(a.progressAction), signal))
  add('kanban_jira_create_issue', 'Create a Jira issue in the selected project using Jira field ids from create metadata.', { projectKey: s('Project key'), issueTypeId: s('Issue type id'), fields: obj('Jira create fields keyed by field id') }, (a, signal) => api('jira', 'POST', '/rest/api/2/issue', signal, undefined, { fields: { ...a.fields, project: { key: a.projectKey }, issuetype: { id: a.issueTypeId } } }))
  add('kanban_jira_edit_issue', 'Edit fields on a Jira issue.', { issueKey: s('Issue key'), fields: obj('Fields keyed by Jira field id') }, (a, signal) => api('jira', 'PUT', issuePath(String(a.issueKey)), signal, undefined, { fields: a.fields }))
  add('kanban_jira_delete_issue', 'Delete a Jira issue by key. If deleteSubtasks=true is explicitly supplied, Jira also deletes its subtasks. This option defaults to false; the tool never retries with it enabled.', { issueKey: s('Issue key'), deleteSubtasks: bool('Explicitly delete child subtasks with this issue; omitted or false preserves Jira default behavior', false) }, (a, signal) => api('jira', 'DELETE', issuePath(String(a.issueKey)), signal, a.deleteSubtasks === true ? new URLSearchParams({ deleteSubtasks: 'true' }) : undefined))
  add('kanban_jira_list_comments', 'List comments on a Jira issue with offset pagination. Continue with nextStart until complete=true; nextStart is computed as startAt + comments.length and must advance. If complete=false and nextStart is null, report an incomplete server page instead of repeating it.', { issueKey: s('Issue key'), startAt: n('Non-negative result offset', false), maxResults: n('Positive page size, at most 100', false) }, async (a, signal) => {
    const startAt = nonNegativeInteger(a.startAt ?? 0, 'startAt'), maxResults = positivePageSize(a.maxResults ?? 50, 100, 'maxResults')
    const payload = await api('jira', 'GET', `${issuePath(String(a.issueKey))}/comment`, signal, new URLSearchParams({ startAt: String(startAt), maxResults: String(maxResults) }))
    return withJiraCommentPage(payload, startAt)
  })
  add('kanban_jira_add_comment', 'Add a comment to a Jira issue.', { issueKey: s('Issue key'), body: s('Comment text') }, (a, signal) => api('jira', 'POST', `${issuePath(String(a.issueKey))}/comment`, signal, undefined, { body: a.body }))
  add('kanban_jira_edit_comment', 'Edit a Jira issue comment.', { issueKey: s('Issue key'), commentId: s('Comment id'), body: s('New comment text') }, (a, signal) => api('jira', 'PUT', `${issuePath(String(a.issueKey))}/comment/${segment(String(a.commentId), 'comment id')}`, signal, undefined, { body: a.body }))
  add('kanban_jira_delete_comment', 'Delete a Jira issue comment.', { issueKey: s('Issue key'), commentId: s('Comment id') }, (a, signal) => api('jira', 'DELETE', `${issuePath(String(a.issueKey))}/comment/${segment(String(a.commentId), 'comment id')}`, signal))
  add('kanban_jira_list_transitions', 'List available transitions and transition-screen fields including required flags and allowed values.', { issueKey: s('Issue key') }, (a, signal) => api('jira', 'GET', `${issuePath(String(a.issueKey))}/transitions`, signal, new URLSearchParams({ expand: 'transitions.fields' })))
  add('kanban_jira_apply_transition', 'Apply an available Jira issue transition by id.', { issueKey: s('Issue key'), transitionId: s('Transition id'), fields: obj('Optional transition fields', false) }, (a, signal) => api('jira', 'POST', `${issuePath(String(a.issueKey))}/transitions`, signal, undefined, { transition: { id: a.transitionId }, ...(a.fields ? { fields: a.fields } : {}) }))
  add('kanban_jira_get_create_metadata', 'Read Jira create field metadata for a project and issue type (Jira Data Center 11). Both the project issue-type list and the single issue-type detail route are paged. Compute the next startAt as returned.startAt + returned.values.length; stop when isLast is true or the cursor reaches total. An empty page before total is reached is an incomplete-page anomaly. Keep maxResults unchanged between pages.', { projectKey: s('Project key'), issueTypeId: s('Issue type id', false), startAt: n('Non-negative Jira result offset', false), maxResults: n('Positive page size, at most 100', false) }, (a, signal) => {
    const root = `/rest/api/2/issue/createmeta/${segment(String(a.projectKey), 'project key')}/issuetypes`
    const startAt = nonNegativeInteger(a.startAt ?? 0, 'startAt'), maxResults = positivePageSize(a.maxResults ?? 50, 100, 'maxResults')
    return api('jira', 'GET', a.issueTypeId ? `${root}/${segment(String(a.issueTypeId), 'issue type id')}` : root, signal, new URLSearchParams({ startAt: String(startAt), maxResults: String(maxResults) }))
  })
  add('kanban_jira_get_edit_metadata', 'Read editable field metadata for an issue.', { issueKey: s('Issue key') }, (a, signal) => api('jira', 'GET', `${issuePath(String(a.issueKey))}/editmeta`, signal))
  add('kanban_jira_list_fields', 'List Jira field definitions.', {}, (_a, signal) => api('jira', 'GET', '/rest/api/2/field', signal))
  add('kanban_jira_get_custom_field_definition', 'Read a Jira custom field definition. This metadata lookup works for fields with or without options.', { fieldId: s('Custom field id, such as customfield_10001') }, async (a, signal) => {
    const id = String(a.fieldId)
    if (!/^customfield_\d+$/.test(id)) throw new TypeError('fieldId must be a Jira custom field id')
    const fields = await api('jira', 'GET', '/rest/api/2/field', signal) as unknown
    const field = Array.isArray(fields) ? fields.find(row => typeof row === 'object' && row !== null && Reflect.get(row, 'id') === id) : undefined
    return field ?? null
  })
  add('kanban_jira_list_custom_field_options', 'List context-specific options for a Jira custom field. Custom field id may be `customfield_10001` or its numeric id; the numeric path is required by Jira 11.3. Read only. The verified response contains options and total, with no guaranteed nextPage or isLast: begin at page=1, increment page by one, and accumulate returned options until the accumulated count reaches total. An empty page before total is reached is an incomplete-page anomaly.', { fieldId: s('Custom field id'), projectId: s('Optional project id for the option context', false), issueTypeId: s('Optional issue type id for the option context', false), page: n('Option page number, starting at 1 and incrementing by one', false), maxResults: n('Positive page size, at most 100', false), query: s('Optional option label filter', false) }, (a, signal) => {
    const match = String(a.fieldId).match(/^(?:customfield_)?(\d+)$/)
    if (!match) throw new TypeError('fieldId must be a customfield id or numeric custom field id')
    const page = positivePageSize(a.page ?? 1, Number.MAX_SAFE_INTEGER, 'page'), maxResults = positivePageSize(a.maxResults ?? 50, 100, 'maxResults')
    return api('jira', 'GET', jiraCustomFieldOptionsPath(String(a.fieldId)), signal, new URLSearchParams({ ...(a.projectId ? { projectIds: String(a.projectId) } : {}), ...(a.issueTypeId ? { issueTypeIds: String(a.issueTypeId) } : {}), page: String(page), maxResults: String(maxResults), ...(a.query ? { query: String(a.query) } : {}) }))
  })
  add('kanban_jira_get_custom_field_option', 'Read one Jira custom field option by id.', { optionId: s('Jira custom field option id') }, (a, signal) => api('jira', 'GET', `/rest/api/2/customFieldOption/${segment(String(a.optionId), 'option id')}`, signal))
  add('kanban_jira_list_project_statuses', 'List statuses available for a Jira project.', { projectKey: s('Project key') }, (a, signal) => api('jira', 'GET', `/rest/api/2/project/${segment(String(a.projectKey), 'project key')}/statuses`, signal))
  add('kanban_jira_list_reference_data', 'List Jira projects, issue types, priorities, statuses or users.', { resource: { type: 'string', required: true, enum: ['projects', 'issue-types', 'priorities', 'statuses', 'users'], description: 'The reference data set' }, query: s('Optional user search text', false) }, (a, signal) => {
    const resource = String(a.resource)
    const paths: Record<string, string> = { projects: '/rest/api/2/project', 'issue-types': '/rest/api/2/issuetype', priorities: '/rest/api/2/priority', statuses: '/rest/api/2/status' }
    if (resource === 'users') return api('jira', 'GET', '/rest/api/2/user/search', signal, new URLSearchParams({ username: String(a.query ?? ''), maxResults: '100' }))
    return api('jira', 'GET', paths[resource]!, signal)
  })

  add('kanban_bitbucket_list_repositories', 'List configured Bitbucket repositories by their stable project key and slug.', {}, async () => service.settings().bitbucket.repositories.map(({ projectKey, repositorySlug }) => ({ projectKey, repositorySlug })))
  add('kanban_bitbucket_get_repository', 'Read details and server-provided clone links for a configured repository.', { projectKey: s('Configured Bitbucket project key'), repositorySlug: s('Configured repository slug') }, async (a, signal) => service.repositoryByIdentity(String(a.projectKey), String(a.repositorySlug), signal))
  add('kanban_bitbucket_list_pull_requests', 'List pull requests in a configured repository by state.', { projectKey: s('Configured Bitbucket project key'), repositorySlug: s('Configured repository slug'), state: { type: 'string', required: true, enum: ['all', 'open', 'merged'], description: 'Pull request state' }, cursor: s('Server pagination cursor', false), limit: n('Page size, clamped to 100', false) }, async (a, signal) => service.pullRequestsByIdentity(String(a.projectKey), String(a.repositorySlug), a.state, a.cursor, a.limit, signal))
  add('kanban_bitbucket_get_pull_request', 'Read a Bitbucket pull request including description, reviewers and observed version.', { projectKey: s('Configured Bitbucket project key'), repositorySlug: s('Configured repository slug'), pullRequestId: n('Pull request id') }, (a, signal) => api('bitbucket', 'GET', prPath(service, a), signal))
  add('kanban_bitbucket_get_pull_request_diff', 'Read a pull request diff with optional per-file path and 0–20 context lines. The non-paged response is capped at 256 KiB and model output at 64 KiB. Check complete, serverTruncated, and outputLimited separately. If truncated, list changes and request each file diff; supply srcPath for copied, moved, or renamed files. A per-file diff can also be truncated; then read that file at its fixed commit with kanban_bitbucket_get_review_file.', { projectKey: s('Configured Bitbucket project key'), repositorySlug: s('Configured repository slug'), pullRequestId: n('Pull request id'), path: s('Optional changed repository-relative file path for a per-file diff', false), srcPath: s('Optional old path when the file was copied, moved, or renamed; requires path', false), contextLines: n('Context lines from 0 to 20', false) }, (a, signal) => service.bitbucketPullRequestDiff(String(a.projectKey), String(a.repositorySlug), positiveInteger(a.pullRequestId, 'pull request id'), { ...(a.path === undefined ? {} : { path: String(a.path) }), ...(a.srcPath === undefined ? {} : { srcPath: String(a.srcPath) }), ...(a.contextLines === undefined ? {} : { contextLines: Number(a.contextLines) }) }, signal))
  add('kanban_bitbucket_list_pull_request_changes', 'List changed paths with Bitbucket pagination. Continue with the returned nextPageStart while complete is false; stop only when complete is true. An empty values array can still have a next page.', { projectKey: s('Configured Bitbucket project key'), repositorySlug: s('Configured repository slug'), pullRequestId: n('Pull request id'), cursor: s('Non-negative server start cursor', false), limit: n('Positive page size, at most 100', false) }, async (a, signal) => withBitbucketPage(await api('bitbucket', 'GET', `${prPath(service, a)}/changes`, signal, bitbucketPageQuery(a.cursor, a.limit))))
  add('kanban_bitbucket_list_pull_request_commits', 'List pull request commits with Bitbucket pagination. Continue with nextPageStart while complete is false; stop only when complete is true.', { projectKey: s('Configured Bitbucket project key'), repositorySlug: s('Configured repository slug'), pullRequestId: n('Pull request id'), cursor: s('Non-negative server start cursor', false), limit: n('Positive page size, at most 100', false) }, async (a, signal) => withBitbucketPage(await api('bitbucket', 'GET', `${prPath(service, a)}/commits`, signal, bitbucketPageQuery(a.cursor, a.limit))))
  add('kanban_bitbucket_list_pull_request_activities', 'List pull request activities with Bitbucket pagination. Continue with nextPageStart while complete is false; stop only when complete is true.', { projectKey: s('Configured Bitbucket project key'), repositorySlug: s('Configured repository slug'), pullRequestId: n('Pull request id'), cursor: s('Non-negative server start cursor', false), limit: n('Positive page size, at most 100', false) }, async (a, signal) => withBitbucketPage(await api('bitbucket', 'GET', `${prPath(service, a)}/activities`, signal, bitbucketPageQuery(a.cursor, a.limit))))
  add('kanban_bitbucket_get_review_file', 'Read a UTF-8 repository file at a full immutable commit SHA. Each request is capped at 5 MiB and 20,000 Unicode characters; long lines are returned in lossless fragments. Continue with nextStart and nextCharOffset, keeping the same at commit. Oversize or binary files are unsupported.', { projectKey: s('Configured Bitbucket project key'), repositorySlug: s('Configured repository slug'), path: s('Repository-relative file path'), at: s('Full immutable commit SHA, not a branch or tag'), start: n('Zero-based line offset', false), charOffset: n('Unicode character offset within the line at start', false), limit: n('Positive lines per page, at most 200', false), maxChars: n('Maximum characters in page, at most 20,000', false) }, (a, signal) => service.bitbucketReviewFile(String(a.projectKey), String(a.repositorySlug), String(a.path), String(a.at), nonNegativeInteger(a.start ?? 0, 'start'), positivePageSize(a.limit ?? 100, 200, 'limit'), signal, nonNegativeInteger(a.charOffset ?? 0, 'charOffset'), positivePageSize(a.maxChars ?? 20000, 20000, 'maxChars')))
  add('kanban_bitbucket_list_pull_request_comments', 'List pull request comments with Bitbucket pagination. Supply path for inline comments in that file. Without path, reads comment-created activities (including replies) and preserves server cursor even when a filtered page has no comments. Continue with nextPageStart while complete is false; stop only when complete is true.', { projectKey: s('Configured Bitbucket project key'), repositorySlug: s('Configured repository slug'), pullRequestId: n('Pull request id'), path: s('Optional repository-relative path for inline comments; omitted for general discussion', false), cursor: s('Non-negative Bitbucket start cursor from nextPageStart', false), limit: n('Positive page size, at most 100', false) }, async (a, signal) => {
    const query = bitbucketPageQuery(a.cursor, a.limit)
    if (a.path !== undefined && a.path !== null && String(a.path) !== '') {
      query.set('path', String(a.path))
      return withBitbucketPage(await api('bitbucket', 'GET', `${prPath(service, a)}/comments`, signal, query))
    }
    return withBitbucketPage(filterCommentActivities(await api('bitbucket', 'GET', `${prPath(service, a)}/activities`, signal, query)))
  })
  add('kanban_bitbucket_get_pull_request_comment', 'Read the current state and version of one pull request comment before editing or deleting it.', { projectKey: s('Configured Bitbucket project key'), repositorySlug: s('Configured repository slug'), pullRequestId: n('Pull request id'), commentId: n('Comment id') }, (a, signal) => api('bitbucket', 'GET', `${prPath(service, a)}/comments/${positiveInteger(a.commentId, 'comment id')}`, signal))
  add('kanban_bitbucket_add_pull_request_comment', 'Add a pull request comment.', { projectKey: s('Configured Bitbucket project key'), repositorySlug: s('Configured repository slug'), pullRequestId: n('Pull request id'), text: s('Comment text') }, (a, signal) => api('bitbucket', 'POST', `${prPath(service, a)}/comments`, signal, undefined, { text: a.text }))
  add('kanban_bitbucket_edit_pull_request_comment', 'Edit a pull request comment using its observed version.', { projectKey: s('Configured Bitbucket project key'), repositorySlug: s('Configured repository slug'), pullRequestId: n('Pull request id'), commentId: s('Comment id'), text: s('Updated text'), version: n('Observed comment version') }, (a, signal) => api('bitbucket', 'PUT', `${prPath(service, a)}/comments/${segment(String(a.commentId), 'comment id')}`, signal, undefined, { text: a.text, version: Number(a.version) }))
  add('kanban_bitbucket_delete_pull_request_comment', 'Delete a pull request comment using its observed version.', { projectKey: s('Configured Bitbucket project key'), repositorySlug: s('Configured repository slug'), pullRequestId: n('Pull request id'), commentId: s('Comment id'), version: n('Observed comment version') }, (a, signal) => api('bitbucket', 'DELETE', `${prPath(service, a)}/comments/${segment(String(a.commentId), 'comment id')}`, signal, new URLSearchParams({ version: String(a.version) })))
  add('kanban_bitbucket_approve_pull_request', 'Approve a pull request at the supplied version.', { projectKey: s('Configured Bitbucket project key'), repositorySlug: s('Configured repository slug'), pullRequestId: n('Pull request id'), version: n('Observed pull request version') }, (a, signal) => api('bitbucket', 'POST', `${prPath(service, a)}/approve`, signal, new URLSearchParams({ version: String(a.version) })))
  add('kanban_bitbucket_unapprove_pull_request', 'Remove your approval at the supplied version.', { projectKey: s('Configured Bitbucket project key'), repositorySlug: s('Configured repository slug'), pullRequestId: n('Pull request id'), version: n('Observed pull request version') }, (a, signal) => api('bitbucket', 'DELETE', `${prPath(service, a)}/approve`, signal, new URLSearchParams({ version: String(a.version) })))
  add('kanban_bitbucket_needs_work_pull_request', 'Mark your pull request review as needing work at the supplied version.', { projectKey: s('Configured Bitbucket project key'), repositorySlug: s('Configured repository slug'), pullRequestId: n('Pull request id'), userSlug: s('Current Bitbucket user slug'), version: n('Observed pull request version') }, (a, signal) => api('bitbucket', 'PUT', `${prPath(service, a)}/participants/${segment(String(a.userSlug), 'user slug')}`, signal, new URLSearchParams({ version: String(a.version) }), { status: 'NEEDS_WORK' }))
  add('kanban_bitbucket_decline_pull_request', 'Decline a pull request at the supplied version.', { projectKey: s('Configured Bitbucket project key'), repositorySlug: s('Configured repository slug'), pullRequestId: n('Pull request id'), version: n('Observed pull request version'), comment: s('Optional comment', false) }, (a, signal) => api('bitbucket', 'POST', `${prPath(service, a)}/decline`, signal, new URLSearchParams({ version: String(a.version) }), a.comment ? { comment: String(a.comment) } : {}))

  add('kanban_confluence_search', 'Search remote Confluence content for DSH Atlassian Kanban using temporary cql or a saved cqlId. This never saves board configuration; use kanban_upsert_queries with product=confluence and verify with kanban_get_settings to save CQL.', { cql: s('Temporary CQL expression; not saved, takes precedence over cqlId', false), cqlId: s('Existing confluence.cql id from kanban_get_settings; used when cql is omitted', false), cursor: s('Optional server pagination cursor', false), limit: n('Page size, clamped to 100', false) }, async (a, signal) => {
    const cql = typeof a.cql === 'string' && a.cql.trim() ? a.cql : undefined
    const saved = !cql && typeof a.cqlId === 'string' ? service.settings().confluence.cql.find(q => q.id === a.cqlId)?.query : undefined
    if (!cql && !saved) throw new TypeError('Provide CQL or a valid configured cqlId')
    return service.searchConfluence(cql ?? saved!, a.cursor, a.limit, signal)
  })
  add('kanban_confluence_get_page', 'Read a Confluence page with body, version, parent and metadata.', { pageId: s('Page id') }, (a, signal) => api('confluence', 'GET', pagePath(String(a.pageId)), signal, new URLSearchParams({ expand: 'body.storage,space,version,ancestors' })))
  add('kanban_confluence_create_page', 'Create a Confluence page under a space or parent page.', { spaceKey: s('Space key'), title: s('Page title'), body: s('Storage-format content'), parentId: s('Optional parent page id', false) }, (a, signal) => api('confluence', 'POST', '/rest/api/content', signal, undefined, { type: 'page', title: a.title, space: { key: a.spaceKey }, ...(a.parentId ? { ancestors: [{ id: a.parentId }] } : {}), body: { storage: { value: a.body, representation: 'storage' } } }))
  add('kanban_confluence_update_page', 'Update a Confluence page using its observed version.', { pageId: s('Page id'), title: s('Page title'), body: s('Storage-format content'), version: n('Observed page version'), spaceKey: s('Space key'), parentId: s('Parent page id', false) }, (a, signal) => api('confluence', 'PUT', pagePath(String(a.pageId)), signal, undefined, { id: a.pageId, type: 'page', title: a.title, space: { key: a.spaceKey }, ...(a.parentId ? { ancestors: [{ id: a.parentId }] } : {}), version: { number: Number(a.version) + 1 }, body: { storage: { value: a.body, representation: 'storage' } } }))
  add('kanban_confluence_delete_page', 'Delete a Confluence page by id.', { pageId: s('Page id') }, (a, signal) => api('confluence', 'DELETE', pagePath(String(a.pageId)), signal))
  add('kanban_confluence_list_children', 'List direct child pages. `limit` is a positive page size (maximum 100), not a total cap; continue while complete=false using nextStart, and stop only when complete=true. If incomplete has no nextStart, report the pagination anomaly.', { pageId: s('Parent page id'), start: n('Non-negative result offset', false), limit: n('Positive page size, at most 100', false) }, async (a, signal) => {
    const start = nonNegativeInteger(a.start ?? 0, 'start'), limit = positivePageSize(a.limit ?? 25, 100, 'limit')
    return withConfluencePage(await api('confluence', 'GET', `${pagePath(String(a.pageId))}/child/page`, signal, new URLSearchParams({ start: String(start), limit: String(limit), expand: 'space,version' })), start)
  })
  add('kanban_confluence_list_descendants', 'List all descendant pages across every depth using Confluence Data Center CQL `ancestor`. This is paginated and separate from direct children. Continue while complete=false using nextStart; stop only when complete=true. If incomplete has no nextStart, report the pagination anomaly.', { pageId: s('Numeric parent page id'), start: n('Non-negative result offset', false), limit: n('Positive page size, at most 100', false) }, async (a, signal) => {
    const id = numericContentId(a.pageId, 'page id'), start = nonNegativeInteger(a.start ?? 0, 'start'), limit = positivePageSize(a.limit ?? 25, 100, 'limit')
    const cql = `ancestor = ${id} AND type = page`
    const payload = await api('confluence', 'GET', '/rest/api/content/search', signal, new URLSearchParams({ cql, start: String(start), limit: String(limit), expand: 'space,version,ancestors' }))
    return withConfluencePage(payload, start)
  })
  add('kanban_confluence_create_child', 'Create a page as a child of the supplied parent page.', { parentId: s('Parent page id'), spaceKey: s('Space key'), title: s('Page title'), body: s('Storage-format content') }, (a, signal) => api('confluence', 'POST', '/rest/api/content', signal, undefined, { type: 'page', title: a.title, space: { key: a.spaceKey }, ancestors: [{ id: a.parentId }], body: { storage: { value: a.body, representation: 'storage' } } }))
  add('kanban_confluence_update_child', 'Update a child page under the supplied parent using the child’s observed version. The stored ancestor remains the supplied parent.', { parentId: s('Parent page id'), childId: s('Child page id'), spaceKey: s('Space key'), title: s('New page title'), body: s('New storage-format content'), version: n('Observed child page version') }, async (a, signal) => {
    await ensureChild(String(a.parentId), String(a.childId), signal)
    return api('confluence', 'PUT', pagePath(String(a.childId)), signal, undefined, { id: a.childId, type: 'page', title: a.title, space: { key: a.spaceKey }, ancestors: [{ id: a.parentId }], version: { number: Number(a.version) + 1 }, body: { storage: { value: a.body, representation: 'storage' } } })
  })
  add('kanban_confluence_delete_child', 'Delete a child page with Confluence’s content delete endpoint after verifying it belongs to the supplied parent.', { parentId: s('Parent page id'), childId: s('Child page id') }, async (a, signal) => {
    await ensureChild(String(a.parentId), String(a.childId), signal)
    return api('confluence', 'DELETE', pagePath(String(a.childId)), signal)
  })
  add('kanban_confluence_list_comments', 'List comments and nested replies associated with a Confluence page using depth=all. Continue while complete=false using nextStart; stop only when complete=true. An empty page with a next link is not terminal; if incomplete has no cursor, report the anomaly.', { pageId: s('Page id'), start: n('Non-negative result offset', false), limit: n('Positive page size, at most 100', false) }, async (a, signal) => {
    const start = nonNegativeInteger(a.start ?? 0, 'start'), limit = positivePageSize(a.limit ?? 25, 100, 'limit')
    return withConfluencePage(await api('confluence', 'GET', `${pagePath(String(a.pageId))}/child/comment`, signal, new URLSearchParams({ start: String(start), limit: String(limit), depth: 'all', expand: 'body.storage,version' })), start)
  })
  add('kanban_confluence_list_attachments', 'List attachment metadata for a page with server pagination. Continue while complete=false using nextStart; stop only when complete=true. An empty page with a next link is not terminal; if incomplete has no cursor, report the anomaly.', { pageId: s('Page id'), start: n('Non-negative result offset', false), limit: n('Positive page size, at most 100', false) }, async (a, signal) => {
    const pageId = numericContentId(a.pageId, 'page id'), start = nonNegativeInteger(a.start ?? 0, 'start'), limit = positivePageSize(a.limit ?? 25, 100, 'limit')
    return withConfluencePage(await api('confluence', 'GET', `${pagePath(pageId)}/child/attachment`, signal, new URLSearchParams({ start: String(start), limit: String(limit), expand: 'version,container,metadata' })), start)
  })
  add('kanban_confluence_get_attachment', 'Read one Confluence attachment metadata record. This does not claim to read the attachment body.', { attachmentId: s('Numeric attachment id') }, (a, signal) => service.confluenceGetAttachment(String(a.attachmentId), signal))
  add('kanban_confluence_download_attachment', 'Download a Confluence attachment of any format through its same-origin server-provided download link and store it in the native DSH attachment provider. The download is bounded to 10 MiB. Returns the immutable file reference and, when available, the provider-owned local host path for a local agent file reader. The path is machine-local and may not work in remote deployments. No PDF or Office parsing is performed.', { attachmentId: s('Numeric attachment id') }, (a, signal) => service.confluenceDownloadAttachment(String(a.attachmentId), signal))
  add('kanban_confluence_read_attachment', 'Read a bounded UTF-8 text attachment segment. JSON, CSV, Markdown, text, YAML and XML are supported up to 5 MiB per attachment and 20,000 characters per call. Continue with nextOffset and expectedVersion; a version change requires restarting at offset=0. PDF, Office, images and other binary formats return supported=false with a reason; this tool does not parse them.', { attachmentId: s('Numeric attachment id'), offset: n('Zero-based Unicode character offset', false), maxChars: n('Characters to read, from 1 to 20,000', false), expectedVersion: n('Version returned by the previous segment; omit on the first call', false) }, (a, signal) => service.confluenceReadAttachment(String(a.attachmentId), nonNegativeInteger(a.offset ?? 0, 'offset'), positivePageSize(a.maxChars ?? 10000, 20000, 'maxChars'), a.expectedVersion === undefined ? undefined : positiveInteger(a.expectedVersion, 'expectedVersion'), signal))
  add('kanban_confluence_add_comment', 'Add a comment to a Confluence page.', { pageId: s('Page id'), body: s('Comment storage-format content') }, (a, signal) => api('confluence', 'POST', '/rest/api/content', signal, undefined, { type: 'comment', container: { id: a.pageId, type: 'page' }, body: { storage: { value: a.body, representation: 'storage' } } }))
  add('kanban_confluence_update_comment', 'Update a Confluence comment using its observed version.', { commentId: s('Comment id'), pageId: s('Page id'), body: s('Comment storage-format content'), version: n('Observed comment version') }, (a, signal) => api('confluence', 'PUT', pagePath(String(a.commentId)), signal, undefined, { id: a.commentId, type: 'comment', container: { id: a.pageId }, version: { number: Number(a.version) + 1 }, body: { storage: { value: a.body, representation: 'storage' } } }))
  add('kanban_confluence_delete_comment', 'Delete a Confluence comment by id.', { commentId: s('Comment id') }, (a, signal) => api('confluence', 'DELETE', pagePath(String(a.commentId)), signal))

  return disposers
}

function bitbucketCursor(value: unknown): string {
  const cursor = String(value ?? '0')
  if (!/^\d{1,12}$/.test(cursor) || !Number.isSafeInteger(Number(cursor))) throw new TypeError('Bitbucket cursor must be a non-negative integer')
  return cursor
}

function nonNegativeInteger(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new TypeError(`${label} must be a non-negative integer`)
  return value
}
function positivePageSize(value: unknown, max: number, label = 'limit'): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > max) throw new TypeError(`${label} must be an integer from 1 to ${max}`)
  return value
}
function numericContentId(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^\d+$/.test(value)) throw new TypeError(`${label} must be numeric`)
  return value
}
function bitbucketPageQuery(cursor: unknown, limit: unknown): URLSearchParams {
  const start = bitbucketCursor(cursor)
  const pageSize = positivePageSize(limit ?? 100, 100)
  return new URLSearchParams({ start, limit: String(pageSize) })
}
function withJiraCommentPage(value: unknown, startAt: number): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {
    complete: false, nextStart: null,
    nextAction: 'Jira did not return a comments page envelope; the result is incomplete.', response: value,
  }
  const payload = value as Record<string, unknown>
  const comments = Array.isArray(payload.comments) ? payload.comments : []
  const total = typeof payload.total === 'number' && Number.isSafeInteger(payload.total) && payload.total >= 0 ? payload.total : null
  const actualStart = typeof payload.startAt === 'number' && Number.isSafeInteger(payload.startAt) && payload.startAt >= 0 ? payload.startAt : startAt
  const nextStart = actualStart + comments.length
  const complete = total !== null && nextStart >= total
  const canAdvance = comments.length > 0 && nextStart > startAt
  return {
    ...payload,
    complete,
    nextStart: complete || !canAdvance ? null : nextStart,
    nextAction: complete ? null : canAdvance
      ? `Continue with startAt=${nextStart}; stop when complete=true.`
      : 'The Jira comments page is incomplete but has no advancing cursor; report the pagination anomaly instead of repeating this request.',
  }
}

function withBitbucketPage(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {
    complete: false, nextPageStart: null,
    nextAction: 'The server did not return a paginated Bitbucket response envelope; do not assume the result is complete.',
    response: value,
  }
  const payload = value as Record<string, unknown>
  const isLastPage = payload.isLastPage === true
  const rawNext = payload.nextPageStart
  const next = typeof rawNext === 'number' && Number.isSafeInteger(rawNext) && rawNext >= 0
    ? rawNext
    : typeof rawNext === 'string' && /^\d+$/.test(rawNext) && Number.isSafeInteger(Number(rawNext)) ? Number(rawNext) : null
  const { nextPageStart: _rawNext, ...rest } = payload
  return {
    complete: isLastPage,
    nextPageStart: isLastPage ? null : next,
    nextAction: isLastPage ? null : next === null
      ? 'Bitbucket marked this page non-final but did not provide nextPageStart. Do not treat an empty filtered values array as end-of-list.'
      : `Continue from nextPageStart=${next}; stop only when a response has isLastPage=true.`,
    ...rest,
  }
}
function confluenceNextStart(value: unknown): number | null {
  if (typeof value !== 'string' || !value) return null
  try {
    const parsed = new URL(value, 'http://confluence-pagination.invalid')
    const start = parsed.searchParams.get('start')
    return start && /^\d+$/.test(start) && Number.isSafeInteger(Number(start)) ? Number(start) : null
  } catch { return null }
}
function withConfluencePage(value: unknown, currentStart: number): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {
    nextStart: null, nextAction: 'Confluence did not return a paginated envelope; do not assume all results were returned.', response: value,
  }
  const payload = value as Record<string, unknown>
  const links = payload._links
  const rawNext = typeof links === 'object' && links !== null ? Reflect.get(links, 'next') : undefined
  const hasNextLink = typeof rawNext === 'string' && rawNext.length > 0
  const nextStart = hasNextLink ? confluenceNextStart(rawNext) : null
  if (hasNextLink && (nextStart === null || nextStart <= currentStart)) throw new TypeError('Confluence returned a next link without a forward pagination cursor')
  const { nextStart: _serverCursor, nextAction: _serverAction, complete: _serverComplete, ...rest } = payload
  return {
    complete: !hasNextLink,
    nextStart,
    nextAction: !hasNextLink ? null : `Continue with start=${nextStart}; stop only when complete=true (the server no longer supplies _links.next).`,
    ...rest,
  }
}

function filterCommentActivities(payload: unknown): unknown {
  if (typeof payload !== 'object' || payload === null || !Array.isArray(Reflect.get(payload, 'values'))) return payload
  const values = Reflect.get(payload, 'values') as unknown[]
  const selected = new Map<string, { activity: Record<string, unknown>; comment: Record<string, unknown> }>()
  const unkeyed: unknown[] = []
  for (const value of values) {
    if (typeof value !== 'object' || value === null) continue
    const action = Reflect.get(value, 'action')
    if (action !== 'COMMENTED' && action !== 'REVIEW_COMMENTED') continue
    const comment = Reflect.get(value, 'comment')
    if (typeof comment !== 'object' || comment === null) continue
    const id = Reflect.get(comment, 'id')
    if (id === undefined || id === null) {
      unkeyed.push(value)
      continue
    }
    const key = String(id)
    const prior = selected.get(key)
    if (!prior || Number(Reflect.get(value, 'createdDate') ?? 0) > Number(Reflect.get(prior.activity, 'createdDate') ?? 0)) {
      selected.set(key, { activity: value as Record<string, unknown>, comment: comment as Record<string, unknown> })
    }
  }
  // Retain the activity envelope and full comment value, including parent/reply details.
  // Restricting the actions excludes update/delete events that would repeat stale comments.
  const result: unknown[] = [...[...selected.values()].map(({ activity, comment }) => ({ ...activity, comment })), ...unkeyed]
  return { ...payload, values: result }
}

function modelJson(value: unknown): ModelJson {
  const text = JSON.stringify(value)
  if (text === undefined) return null
  return JSON.parse(text) as ModelJson
}

function isRecord(value: unknown): value is Record<string, any> { return typeof value === 'object' && value !== null && !Array.isArray(value) }
function repoIdentity(projectKey: string, repositorySlug: string): string { return `${projectKey.toLocaleUpperCase('en-US')}\u0000${repositorySlug.toLocaleLowerCase('en-US')}` }
function repositoryPart(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0 || value !== value.trim() || value.length > 128 || /[\\/\u0000-\u001f\u007f]/.test(value)) throw new TypeError(`${label} is invalid`)
  return value
}

export async function jiraNativeClone(service: AtlassianService, issueKey: string, args: Args, signal: AbortSignal): Promise<unknown> {
  if (!/^[A-Z][A-Z0-9_]*-\d+$/.test(issueKey)) throw new TypeError('Issue key is invalid')
  const issue = await service.api<Record<string, unknown>>('jira', 'GET', issuePath(issueKey), { signal, query: new URLSearchParams({ fields: 'summary' }) })
  const numericId = String(issue.id ?? '')
  if (!/^\d+$/.test(numericId)) throw new Error('Jira did not return a numeric source issue id')
  const formPage = await service.nativeRequest('jira', 'GET', '/secure/CloneIssueDetails!default.jspa', { signal, accept: 'text/html', query: new URLSearchParams({ id: numericId }) })
  if (formPage.status !== 200 || typeof formPage.data !== 'string') throw new Error(`Jira native clone form was unavailable (HTTP ${formPage.status})`)
  const html = formPage.data
  const nativeSummary = extractInputValue(html, 'summary')
  const summary = typeof args.summary === 'string' ? args.summary : nativeSummary
  if (!summary || summary.length > 255 || /[\u0000-\u001f\u007f]/.test(summary)) throw new TypeError('Clone summary must be 1–255 printable characters')
  const optionNames = ['cloneSubTasks', 'cloneAttachments', 'cloneLinks', 'customField'] as const
  const available = new Map<string, { value: string; checked: boolean }>()
  for (const input of html.matchAll(/<input\b[^>]*>/gi)) {
    const tag = input[0]
    const name = attribute(tag, 'name')
    if (!name || !optionNames.includes(name as typeof optionNames[number])) continue
    const type = attribute(tag, 'type')
    if (type?.toLowerCase() !== 'checkbox') continue
    available.set(name, { value: decodeHtml(attribute(tag, 'value') ?? 'true'), checked: /\bchecked(?:\s|=|>)/i.test(tag) })
  }
  const form = new URLSearchParams({ id: numericId, summary, Create: 'Create' })
  for (const name of optionNames) {
    const native = available.get(name)
    const requested = args[name]
    if (requested !== undefined && typeof requested !== 'boolean') throw new TypeError(`${name} must be a boolean`)
    if (requested === true && !native) throw new TypeError(`Jira clone form does not expose ${name}`)
    if (native && (requested ?? native.checked)) form.set(name, native.value)
  }
  const result = await service.nativeRequest('jira', 'POST', '/secure/CloneIssueDetails.jspa', {
    signal, form, accept: 'application/json, text/html', acceptedStatuses: [200, 302],
    headers: { 'x-atlassian-token': 'no-check', 'x-requested-with': 'XMLHttpRequest' },
  })
  if (result.status === 302) {
    const resultFromLocation = cloneResultFromLocation(service, result.headers.location, issueKey)
    if (resultFromLocation) return resultFromLocation
    throw new Error('Jira native clone returned an unexpected redirect; clone result is unconfirmed')
  }
  if (result.status === 200 && typeof result.data === 'object' && result.data !== null) {
    const descriptor = result.data as Record<string, unknown>
    const progressUrl = typeof descriptor.progressURL === 'string' ? descriptor.progressURL : typeof descriptor.progressUrl === 'string' ? descriptor.progressUrl : undefined
    if (progressUrl) {
      const baseUrl = new URL(service.settings().jira.baseUrl)
      const parsed = new URL(progressUrl, baseUrl)
      const taskId = descriptor.taskId ?? parsed.searchParams.get('taskId')
      const action = cloneProgressAction(parsed.pathname)
      if (parsed.origin === baseUrl.origin && action && typeof taskId === 'string') {
        return { sourceIssueKey: issueKey, pending: true, taskId, progressAction: action, message: 'Jira accepted the native clone task. Use kanban_jira_get_clone_status to poll without repeating the clone POST.' }
      }
    }
  }
  throw new Error('Jira native clone response did not confirm a created issue')
}

export async function jiraGetCloneStatus(service: AtlassianService, taskId: string, requestedAction: string, signal: AbortSignal): Promise<unknown> {
  if (!/^[A-Za-z0-9_-]{1,200}$/.test(taskId)) throw new TypeError('Clone task id is invalid')
  const action = requestedAction === 'CloneIssueProgress!default.jspa' ? requestedAction : 'CloneIssueProgress.jspa'
  const response = await service.nativeRequest('jira', 'GET', `/secure/${action}`, { signal, accept: 'text/html, application/json', query: new URLSearchParams({ taskId }), acceptedStatuses: [200, 302] })
  if (response.status === 302) {
    const confirmed = cloneResultFromLocation(service, response.headers.location, null)
    if (confirmed) return confirmed
    throw new Error('Jira clone progress returned an unexpected redirect; clone result is unconfirmed')
  }
  return { taskId, progressAction: action, pending: true, message: 'Jira clone is still processing or its page does not confirm a final redirect. Poll this task again; the clone POST will not be repeated.' }
}

function extractInputValue(html: string, name: string): string | undefined {
  for (const input of html.matchAll(/<input\b[^>]*>/gi)) {
    const tag = input[0]
    if (attribute(tag, 'name') === name) {
      return decodeHtml(attribute(tag, 'value') ?? '')
    }
  }
  return undefined
}
function decodeHtml(value: string): string {
  return value.replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'").replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&amp;/gi, '&').replace(/&#(\d+);/g, (_m, value: string) => String.fromCodePoint(Number(value))).replace(/&#x([0-9a-f]+);/gi, (_m, value: string) => String.fromCodePoint(parseInt(value, 16)))
}
function attribute(tag: string, name: string): string | undefined {
  const match = tag.match(new RegExp(`\\b${name}\\s*=\\s*(["'])(.*?)\\1`, 'i'))
  return match?.[2]
}
function cloneProgressAction(path: string): 'CloneIssueProgress.jspa' | 'CloneIssueProgress!default.jspa' | undefined {
  if (/\/secure\/CloneIssueProgress\.jspa\/?$/.test(path)) return 'CloneIssueProgress.jspa'
  if (/\/secure\/CloneIssueProgress!default\.jspa\/?$/.test(path)) return 'CloneIssueProgress!default.jspa'
  return undefined
}
function jiraBrowseUrl(baseUrl: string, key: string): string {
  const base = new URL(baseUrl)
  return new URL(`${base.pathname.replace(/\/+$/, '')}/browse/${encodeURIComponent(key)}`, base.origin).toString()
}
function cloneResultFromLocation(service: AtlassianService, location: string | undefined, sourceIssueKey: string | null): unknown | undefined {
  if (!location) return undefined
  const baseUrl = service.settings().jira.baseUrl
  const base = new URL(baseUrl)
  const target = new URL(location, `${base.origin}${base.pathname.replace(/\/+$/, '')}/`)
  if (target.origin !== base.origin) return undefined
  const key = target.pathname.match(/\/browse\/([A-Z][A-Z0-9_]*-\d+)\/?$/)?.[1]
  if (key) return { ...(sourceIssueKey ? { sourceIssueKey } : {}), issueKey: key, url: jiraBrowseUrl(baseUrl, key), pending: false, usedNativeAction: 'CloneIssueDetails.jspa (Jira Data Center 11.3.5)' }
  const action = cloneProgressAction(target.pathname)
  const taskId = target.searchParams.get('taskId')
  if (action && taskId) return { ...(sourceIssueKey ? { sourceIssueKey } : {}), pending: true, taskId, progressAction: action, message: 'Jira accepted the native clone task. Use kanban_jira_get_clone_status to poll without repeating the clone POST.' }
  return undefined
}

export function jiraCustomFieldOptionsPath(fieldId: string): string {
  const match = fieldId.match(/^(?:customfield_)?(\d+)$/)
  if (!match) throw new TypeError('fieldId must be a customfield id or numeric custom field id')
  return `/rest/api/2/customFields/${match[1]}/options`
}
