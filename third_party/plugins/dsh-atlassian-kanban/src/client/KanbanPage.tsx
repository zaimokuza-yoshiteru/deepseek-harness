import { useEffect, useMemo, useSyncExternalStore } from 'react'
import { Button, IconChevronDownOutlineRegular, IconLoadingOutlineRegular, Pill, SegmentedTabs, StateDot, Tag, Tooltip, type SegmentedTab, type TagTone } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { AtlassianKanbanRemote } from '../shared/remote.ts'
import type { KanbanController, KanbanSnapshot, KanbanView, PullRequestState } from './kanban-state.ts'
import type { KanbanLocaleKey } from './locales.ts'
import css from './KanbanPage.module.css'

export interface KanbanPageInjected {
  readonly controller: KanbanController
  readonly remote: AtlassianKanbanRemote
  readonly openConfig: () => void
}

export type KanbanPageProps = PropsRuntime<'main'> & PropsLocale<'atlassianKanban'> & KanbanPageInjected
type Translate = (key: KanbanLocaleKey, params?: Record<string, unknown>) => string

export function KanbanPage(props: KanbanPageProps) {
  const { controller, openConfig, t } = props
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot)
  useEffect(() => { void controller.loadSettings() }, [controller])
  const settings = state.settings
  const options = useMemo(() => {
    if (settings === null) return [] as { id: string; label: string }[]
    if (state.product === 'jira') return settings.jira.jql.map(item => ({ id: item.id, label: item.name }))
    if (state.product === 'bitbucket') return settings.bitbucket.repositories.map(item => ({ id: item.id, label: `${item.projectKey}/${item.repositorySlug}` }))
    return settings.confluence.cql.map(item => ({ id: item.id, label: item.name }))
  }, [settings, state.product])
  const connected = settings !== null && (
    state.product === 'jira' ? settings.jira.hasToken && settings.jira.baseUrl !== ''
      : state.product === 'bitbucket' ? settings.bitbucket.hasToken && settings.bitbucket.baseUrl !== ''
        : settings.confluence.hasToken && settings.confluence.baseUrl !== ''
  )
  const configured = connected && options.length > 0
  const panelId = 'atlassian-kanban-results'
  const productTabs = tabs((['jira', 'bitbucket', 'confluence'] as const).map(product => ({
    value: product, label: t(product), id: `atlassian-kanban-${product}`, panelId,
  })))

  return (
    <section className={css.page}>
      <header className={css.head}>
        <h1 className={css.heading}>{t('panel')}</h1>
        <div className={css.tools}>
          <Button size="sm" variant="outline" disabled={!configured || state.status === 'loading'} onClick={() => { void controller.refresh() }}>{t('refresh')}</Button>
          <Button size="sm" variant="ghost" onClick={openConfig}>{t('configure')}</Button>
        </div>
      </header>
      <SegmentedTabs items={productTabs} value={state.product} onChange={product => { void controller.selectProduct(product) }} label={t('panel')} className={css.segmented} />
      {options.length > 0 && <nav className={css.scopes} aria-label={state.product === 'jira' ? t('titleJira') : state.product === 'bitbucket' ? t('sectionRepo') : t('titleConfluence')}>
        {options.map(option => <Tooltip key={option.id} label={option.label} side="bottom" maxWidth={360}>
          <Pill active={option.id === state.selection} aria-pressed={option.id === state.selection} onClick={() => { void controller.selectQuery(option.id) }} className={css.scope}>{option.label}</Pill>
        </Tooltip>)}
      </nav>}
      {state.product === 'bitbucket' && options.length > 0 && <div className={css.filters} role="group" aria-label={t('state')}>
        {(['all', 'open', 'merged'] as const).map(value => <Button key={value} size="sm" variant={state.pullRequestState === value ? 'outline' : 'ghost'} aria-pressed={state.pullRequestState === value} onClick={() => { void controller.setPullRequestState(value) }}>{t(value)}</Button>)}
      </div>}
      <div id={panelId} role="tabpanel" aria-labelledby={`atlassian-kanban-${state.product}`} tabIndex={0} className={css.body}>
        {settings === null && state.status === 'loading' && <Loading label={t('loading')} />}
        {settings === null && state.status === 'error' && <div className={css.errorArea} role="alert"><ErrorNotice error={state.error} label={t('error')} /><Button size="sm" variant="ghost" onClick={() => { void controller.loadSettings() }}>{t('retry')}</Button></div>}
        {settings !== null && !connected && <div className={css.status}>{t('notConfigured')} <Button size="sm" variant="ghost" className={css.link} onClick={openConfig}>{t('configure')}</Button></div>}
        {settings !== null && connected && options.length === 0 && <div className={css.status}>{t('notConfigured')} <Button size="sm" variant="ghost" className={css.link} onClick={openConfig}>{t('configure')}</Button></div>}
        {configured && state.status === 'loading' && state.result === null && <Loading label={t('loading')} />}
        {configured && state.status === 'loading' && state.result !== null && <div className={css.refreshing} role="status"><IconLoadingOutlineRegular size={14} /><span>{t('refreshing')}</span></div>}
        {configured && state.result !== null && <ResultList state={state} controller={controller} t={t} />}
        {configured && state.status === 'error' && <div className={css.errorArea} role="alert"><ErrorNotice error={state.error} label={t('error')} /><Button size="sm" variant="ghost" onClick={() => { void controller.refresh() }}>{t('retry')}</Button></div>}
      </div>
    </section>
  )
}

function Loading({ label }: { readonly label: string }) {
  return <div className={css.loadingBlock} role="status" aria-label={label}>
    <div className={css.loadingLabel}><IconLoadingOutlineRegular size={15} /><span>{label}</span></div>
    <div className={css.skeleton} aria-hidden="true"><i /><i /><i /></div>
  </div>
}

function ErrorNotice({ error, label }: { readonly error: string | null; readonly label: string }) {
  return <details className={css.error}>
    <summary><StateDot state="error" size={8} /><span>{label}</span><span className={css.errorChevron} aria-hidden="true"><IconChevronDownOutlineRegular size={14} /></span></summary>
    {error !== null && <pre>{error}</pre>}
  </details>
}

function ResultList({ state, controller, t }: { readonly state: KanbanSnapshot; readonly controller: KanbanController; readonly t: Translate }) {
  const items = state.result?.items ?? []
  if (items.length === 0 && state.status === 'ready') return <p className={css.status}>{t('empty')}</p>
  const rows = items.map((item, index) => ({ item, id: scalar(item.id ?? item.key ?? index) }))
  return <>
    {state.product === 'jira' && <table className={`${css.table} ${css.jiraTable}`}>
      <thead><tr><th>{t('type')}</th><th>{t('key')}</th><th>{t('title')}</th><th>{t('state')}</th><th>{t('priority')}</th></tr></thead>
      <tbody>{rows.map(({ item, id }) => <tr key={id}>
        <td><JiraCell url={item.typeIcon} label={scalar(item.type ?? item.issueType)} /></td>
        <td><External url={item.url} label={scalar(item.key)} /></td>
        <td><LongExternal url={item.url} label={scalar(item.title ?? item.summary)} multiline={false} /></td>
        <td><StatusTag value={scalar(item.status)} category={scalar(item.statusCategory)} /></td>
        <td><JiraCell url={item.priorityIcon} label={scalar(item.priority)} /></td>
      </tr>)}</tbody>
    </table>}
    {state.product === 'bitbucket' && <table className={`${css.table} ${css.prTable}`}>
      <thead><tr><th>{t('key')}</th><th>{t('title')}</th><th>{t('state')}</th></tr></thead>
      <tbody>{rows.map(({ item, id }) => <tr key={id}>
        <td><External url={item.url} label={`#${scalar(item.id)}`} /></td>
        <td><LongExternal url={item.url} label={scalar(item.title ?? item.name)} multiline={false} /></td>
        <td><StatusTag value={pullRequestStateLabel(scalar(item.state ?? item.status), t)} category={scalar(item.state ?? item.status)} /></td>
      </tr>)}</tbody>
    </table>}
    {state.product === 'confluence' && <div className={css.cards}>
      {rows.map(({ item, id }) => <article className={css.card} key={id}>
        <h2 className={css.cardTitle}><LongExternal url={item.url} label={scalar(item.title ?? item.name)} multiline /></h2>
        <div className={css.metadata}>
          {item.spaceKey != null && <span><b>{t('spaceKey')}</b> {scalar(item.spaceKey)}</span>}
          {item.spaceName != null && <span><b>{t('spaceName')}</b> {scalar(item.spaceName)}</span>}
          {item.type != null && <span><b>{t('contentType')}</b> {confluenceTypeLabel(scalar(item.type), t)}</span>}
          {item.status != null && <span><b>{t('contentStatus')}</b> {confluenceStatusLabel(scalar(item.status), t)}</span>}
          {item.id != null && <span><b>{t('contentId')}</b> {scalar(item.id)}</span>}
        </div>
      </article>)}
    </div>}
    {state.loadingMore && <div className={css.loadingMore} role="status"><StateDot state="ongoing" size={13} /><span>{t('loading')}</span></div>}
    {state.error !== null && state.status !== 'error' && <ErrorNotice error={state.error} label={t('error')} />}
    {state.result?.nextCursor !== null && <div className={css.more}><Button size="sm" variant="outline" disabled={state.loadingMore} onClick={() => { void controller.loadMore() }}>{t('loadMore')}</Button></div>}
  </>
}

function JiraCell({ url, label }: { readonly url: unknown; readonly label: string }) {
  const src = dataImage(url)
  return <Tooltip label={label} side="bottom" maxWidth={520}>
    <span className={css.jiraCell} aria-label={label}>
      {src === null ? null : <img className={css.jiraIcon} src={src} alt="" />}
      <span className={css.compactText}>{label}</span>
    </span>
  </Tooltip>
}

function StatusTag({ value, category }: { readonly value: string; readonly category?: string }) {
  const normalized = (category ?? value).toLowerCase()
  const tone: TagTone = /done|closed|merged|complete|resolved/.test(normalized) ? 'success'
    : /declin|reject|error/.test(normalized) ? 'danger'
      : /open|progress|review|new|indeterminate/.test(normalized) ? 'info' : 'neutral'
  return <Tooltip label={value} side="bottom"><span className={css.statusTooltipAnchor}><Tag tone={tone} className={css.statusTag}>{value}</Tag></span></Tooltip>
}

function LongExternal({ url, label, multiline }: { readonly url: unknown; readonly label: string; readonly multiline: boolean }) {
  const href = safeHttpUrl(url)
  const content = <span className={multiline ? css.longText : `${css.longText} ${css.singleLine}`}>{label}</span>
  return <Tooltip label={label} side="bottom" maxWidth={520}>
    {href === undefined ? <span className={`${css.longText} ${multiline ? '' : css.singleLine}`} aria-label={label}>{label}</span>
      : <a className={`${css.link} ${css.longLink}`} href={href} target="_blank" rel="noopener noreferrer" aria-label={label}>{content}</a>}
  </Tooltip>
}

function External({ url, label }: { readonly url: unknown; readonly label: string }) {
  const href = safeHttpUrl(url)
  return href === undefined ? label : <a className={css.link} href={href} target="_blank" rel="noopener noreferrer">{label}</a>
}

function safeHttpUrl(value: unknown): string | undefined {
  return typeof value === 'string' && /^https?:\/\//i.test(value) ? value : undefined
}

function dataImage(value: unknown): string | null {
  return typeof value === 'string' && /^data:image\/(?:png|gif|jpeg|webp|svg\+xml);base64,[a-z\d+/]+=*$/i.test(value) ? value : null
}

function pullRequestStateLabel(value: string, t: Translate): string {
  switch (value.toLowerCase()) {
    case 'open': return t('prOpen')
    case 'merged': return t('prMerged')
    case 'declined': return t('prDeclined')
    default: return value
  }
}

function confluenceTypeLabel(value: string, t: Translate): string {
  switch (value.toLowerCase()) {
    case 'page': return t('contentTypePage')
    case 'blogpost': return t('contentTypeBlogPost')
    default: return value
  }
}

function confluenceStatusLabel(value: string, t: Translate): string {
  switch (value.toLowerCase()) {
    case 'current': return t('contentStatusCurrent')
    case 'draft': return t('contentStatusDraft')
    case 'archived': return t('contentStatusArchived')
    case 'deleted': return t('contentStatusDeleted')
    case 'trashed': return t('contentStatusTrashed')
    default: return value
  }
}

function scalar(value: unknown): string {
  return value === null || value === undefined || value === '' ? '—' : String(value)
}

function tabs<Value extends string>(items: readonly SegmentedTab<Value>[]): readonly [SegmentedTab<Value>, ...SegmentedTab<Value>[]] {
  const [first, ...rest] = items
  if (first === undefined) throw new Error('Segmented tabs must not be empty.')
  return [first, ...rest]
}
