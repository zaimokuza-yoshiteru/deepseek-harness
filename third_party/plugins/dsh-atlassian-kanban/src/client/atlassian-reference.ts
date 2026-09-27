import type { AtlassianKanbanRemote, KanbanQueryResult } from '../shared/remote.ts'
import type { BitbucketRepositoryRef, NamedQuery } from '../shared/config.ts'
import type { InputTriggerSource } from '@deepseek-ai/dsh-client-ui-input-trigger/client'

type RefValue =
  | { readonly kind: 'jira'; readonly key: string }
  | { readonly kind: 'repo'; readonly repositoryId: string; readonly label: string; readonly cloneUrl: string }
  | { readonly kind: 'pr'; readonly repositoryId: string; readonly projectKey: string; readonly repositorySlug: string; readonly id: number }
  | { readonly kind: 'confluence'; readonly id: string }
type ScopeValue = { readonly kind: 'scope'; readonly product: 'jira' | 'repo' | 'pr' | 'confluence'; readonly id?: string }

/** The shared @ menu starts locally with four scopes; network reads wait for one explicit configured scope. */
export function createAtlassianReferenceSource(remote: AtlassianKanbanRemote, t: (key: string) => string): InputTriggerSource {
  const source: InputTriggerSource = {
    trigger: '@', name: 'atlassian', order: 30, showGroupTitle: false,
    async candidates(_session, request) {
      const query = request.query.trim()
      if (request.signal.aborted) return []
      const settings = await remote.settings()
      if (request.signal.aborted) return []
      const parsed = /^\s*(jira|repo|pr|confluence)(?::([^:]*))?(?::(.*))?$/i.exec(query)
      if (parsed === null) return scopeCandidates(query, t)
      const product = parsed[1]?.toLowerCase() as 'jira' | 'repo' | 'pr' | 'confluence'
      const id = parsed[2]
      const keyword = parsed[3] ?? ''
      if ((product === 'jira' && (id === undefined || id === ''))) return settings.jira.jql.map(item => scopeCandidate(item.name, { kind: 'scope', product: 'jira', id: item.id }, t))
      if ((product === 'confluence' && (id === undefined || id === ''))) return settings.confluence.cql.map(item => scopeCandidate(item.name, { kind: 'scope', product: 'confluence', id: item.id }, t))
      if ((product === 'repo' || product === 'pr') && (id === undefined || id === '')) return settings.bitbucket.repositories.map(repo => scopeCandidate(repoName(repo), { kind: 'scope', product, id: repo.id }, t))
      if (id === undefined || id === '') return []
      if (product === 'repo') {
        const repo = settings.bitbucket.repositories.find(item => item.id === id)
        if (repo === undefined) return []
        const suggestion = await remote.suggestions({ kind: 'bitbucket-repository', repositoryId: id }, request.signal)
        if (request.signal.aborted) return []
        if (suggestion.result === null) return [cacheMissCandidate(t('sectionRepo'), t)]
        const item = suggestion.result.items[0]
        const cloneUrl = string(item?.cloneUrl ?? item?.clone_url)
        return cloneUrl === '' ? [] : [referenceCandidate(repoName(repo), JSON.stringify({ kind: 'repo', repositoryId: repo.id, label: repoName(repo), cloneUrl } satisfies RefValue), t('sectionRepo'))]
      }
      if (product === 'jira') {
        if (!configuredQuery(settings.jira, id)) return []
        const suggestion = await queryConfiguredPages(remote, { kind: 'jira-search', jqlId: id }, request.signal, keyword)
        if (request.signal.aborted) return []
        const candidates = suggestion.result === null ? [] : jiraCandidates(suggestion.result, keyword, t)
        return candidates.length > 0 || !suggestion.missingCache ? candidates : [cacheMissCandidate(t('sectionJira'), t)]
      }
      if (product === 'confluence') {
        if (!configuredQuery(settings.confluence, id)) return []
        const suggestion = await queryConfiguredPages(remote, { kind: 'confluence-search', cqlId: id }, request.signal, keyword)
        if (request.signal.aborted) return []
        const candidates = suggestion.result === null ? [] : confluenceCandidates(suggestion.result, keyword, t)
        return candidates.length > 0 || !suggestion.missingCache ? candidates : [cacheMissCandidate(t('sectionConfluence'), t)]
      }
      const repo = settings.bitbucket.repositories.find(item => item.id === id)
      if (repo === undefined) return []
      const suggestion = await queryConfiguredPages(remote, { kind: 'bitbucket-pull-requests', repositoryId: id, state: 'all' }, request.signal, keyword)
      if (request.signal.aborted) return []
      const candidates = suggestion.result === null ? [] : pullRequestCandidates(suggestion.result, repo, keyword, t)
      return candidates.length > 0 || !suggestion.missingCache ? candidates : [cacheMissCandidate(t('sectionPr'), t)]
    },
    onPick({ candidate }) {
      if (candidate.value === undefined) return undefined
      let value: RefValue | ScopeValue
      try { value = JSON.parse(candidate.value) as RefValue | ScopeValue } catch { return undefined }
      if (value.kind === 'scope') {
        return { text: value.id === undefined ? `@${value.product}:` : `@${value.product}:${value.id}:`, continue: true }
      }
      return {
        insert: {
          source: 'atlassian', ref: JSON.stringify(value), label: candidate.name, clipboardText: source.codec!.clipboardText(JSON.stringify(value)),
        },
      }
    },
    codec: {
      clipboardText: ref => {
        const parsed = parseRef(ref)
        return parsed === null ? ref : locator(parsed)
      },
      async serialize(ref) {
        const parsed = parseRef(ref)
        return parsed === null ? ref : locator(parsed)
      },
    },
  }
  return source
}

function scopeCandidates(query: string, t: (key: string) => string) {
  const choices = [
    { name: 'jira', label: t('jira'), hint: t('hintAt'), product: 'jira' as const },
    { name: 'repo', label: t('repo'), hint: t('hintAt'), product: 'repo' as const },
    { name: 'pr', label: t('titlePr'), hint: t('hintAt'), product: 'pr' as const },
    { name: 'confluence', label: t('confluence'), hint: t('hintAt'), product: 'confluence' as const },
  ]
  const needle = query.toLowerCase()
  return choices.filter(item => item.name.includes(needle) || item.label.toLowerCase().includes(needle))
    .map(item => ({ name: item.name, label: item.label, hint: item.hint, section: t('atlassianGroup'), drill: true, value: JSON.stringify({ kind: 'scope', product: item.product } satisfies ScopeValue) }))
}

function scopeCandidate(name: string, value: ScopeValue, t: (key: string) => string) {
  return { name, section: sectionForProduct(value.product, t), drill: true, value: JSON.stringify(value) }
}
function referenceCandidate(name: string, value: string, section: string) { return { name, section, value } }
type PagedQuery = Extract<import('../shared/remote.ts').KanbanQuery, { readonly cursor?: string }>
async function queryConfiguredPages(remote: AtlassianKanbanRemote, query: PagedQuery, signal: AbortSignal, keyword: string): Promise<{ result: KanbanQueryResult | null; missingCache: boolean }> {
  const items: KanbanQueryResult['items'][number][] = []
  const seen = new Set<string>()
  let cursor: string | undefined
  let first: KanbanQueryResult | undefined
  let missingCache = false
  // The requested JQL, CQL, or repository is itself the boundary. Show its first
  // page immediately; only scan later pages when the user narrows with a keyword.
  // Bound a malformed/repeating continuation chain and honor cancellation.
  const pageLimit = keyword.trim() === '' ? 1 : 100
  for (let page = 0; page < pageLimit && !signal.aborted; page += 1) {
    const suggestion = await remote.suggestions(cursor === undefined ? query : { ...query, cursor }, signal)
    const result = suggestion.result
    if (result === null) { missingCache = true; break }
    first ??= result
    items.push(...result.items)
    const next = result.nextCursor
    if (next === null || seen.has(next)) break
    seen.add(next)
    cursor = next
  }
  if (first === undefined) return { result: null, missingCache }
  return { result: { ...first, items, nextCursor: null }, missingCache }
}
function repoName(repo: BitbucketRepositoryRef): string { return `${repo.projectKey}/${repo.repositorySlug}` }
function configuredQuery(service: { readonly jql: readonly NamedQuery[] } | { readonly cql: readonly NamedQuery[] }, id: string): boolean {
  return 'jql' in service ? service.jql.some(item => item.id === id) : service.cql.some(item => item.id === id)
}
function jiraCandidates(result: KanbanQueryResult, keyword: string, t: (key: string) => string) {
  const needle = keyword.toLowerCase()
  return result.items.flatMap(item => {
    const key = string(item.key)
    const title = string(item.title ?? item.summary)
    return key === '' || !`${key} ${title}`.toLowerCase().includes(needle) ? [] : [{ ...referenceCandidate(key, JSON.stringify({ kind: 'jira', key } satisfies RefValue), t('sectionJira')), ...(title === '' ? {} : { label: title }), ...(item.type == null ? {} : { description: string(item.type) }) }]
  })
}
function pullRequestCandidates(result: KanbanQueryResult, repo: BitbucketRepositoryRef, keyword: string, t: (key: string) => string) {
  const needle = keyword.toLowerCase()
  return result.items.flatMap(item => {
    const id = Number(item.id)
    const title = string(item.title)
    if (!Number.isSafeInteger(id) || id < 1 || !`${id} ${title}`.toLowerCase().includes(needle)) return []
    const value: RefValue = { kind: 'pr', repositoryId: repo.id, projectKey: repo.projectKey, repositorySlug: repo.repositorySlug, id }
    return [referenceCandidate(`#${id} ${title}`.trim(), JSON.stringify(value), t('sectionPr'))]
  })
}
function confluenceCandidates(result: KanbanQueryResult, keyword: string, t: (key: string) => string) {
  const needle = keyword.toLowerCase()
  return result.items.flatMap(item => {
    const id = string(item.id)
    const title = string(item.title) || id
    return id === '' || !`${id} ${title}`.toLowerCase().includes(needle) ? [] : [referenceCandidate(title, JSON.stringify({ kind: 'confluence', id } satisfies RefValue), t('sectionConfluence'))]
  })
}
function cacheMissCandidate(section: string, t: (key: string) => string) {
  return { name: t('noCachedSuggestions'), hint: t('hintAt'), section }
}
function sectionForProduct(product: ScopeValue['product'], t: (key: string) => string): string {
  switch (product) {
    case 'jira': return t('sectionJira')
    case 'repo': return t('sectionRepo')
    case 'pr': return t('sectionPr')
    case 'confluence': return t('sectionConfluence')
  }
}
function parseRef(ref: string): RefValue | null {
  try { const parsed = JSON.parse(ref) as RefValue; return ['jira', 'repo', 'pr', 'confluence'].includes(parsed.kind) ? parsed : null } catch { return null }
}
function locator(value: RefValue): string {
  switch (value.kind) {
    case 'jira': return `Jira issue ${value.key}`
    case 'repo': return `Bitbucket repository ${value.label} (clone URL: ${value.cloneUrl})`
    case 'pr': return `Bitbucket pull request ${value.projectKey}/${value.repositorySlug}#${value.id}`
    case 'confluence': return `Confluence content ID ${value.id}`
  }
}
function string(value: unknown): string { return typeof value === 'string' || typeof value === 'number' ? String(value) : '' }
