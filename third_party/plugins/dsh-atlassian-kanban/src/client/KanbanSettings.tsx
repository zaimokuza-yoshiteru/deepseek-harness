import { useEffect, useState, useSyncExternalStore } from 'react'
import type { ConfigForm } from '@deepseek-ai/dsh-client-ui-settings/client'
import { Button, SettingsSecretField, SettingsValueField, StateDot, Switch, Toast } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { AtlassianProduct, AtlassianSettingsView, NamedQuery, BitbucketRepositoryRef } from '../shared/config.ts'
import type { AtlassianKanbanRemote } from '../shared/remote.ts'
import type { KanbanLocaleKey } from './locales.ts'
import { validateProductSettings } from './settings-validation.ts'
import { buildProductSettingsOps, buildRefreshMentionsOp, canRebaseUnchangedDraft, connectionDraftFor, saveSettingsDraft } from './settings-write.ts'
import styles from './KanbanSettings.module.css'

export interface ConfigValues {
  readonly refreshMentions: boolean
  readonly jira: { readonly baseUrl: string; readonly jql: readonly NamedQuery[] }
  readonly bitbucket: { readonly baseUrl: string; readonly repositories: readonly BitbucketRepositoryRef[] }
  readonly confluence: { readonly baseUrl: string; readonly cql: readonly NamedQuery[] }
}
export interface KanbanConfigInjected {
  readonly form: ConfigForm<ConfigValues>
  readonly remote: AtlassianKanbanRemote
}
export type KanbanSettingsProps = PropsRuntime<'plugins.bundle.config'> & PropsLocale<'atlassianKanban'> & KanbanConfigInjected
type Translate = (key: KanbanLocaleKey, params?: Record<string, unknown>) => string
type Notice = { readonly key: KanbanLocaleKey; readonly detail?: string } | null
type ProductValue = ConfigValues['jira'] | ConfigValues['bitbucket'] | ConfigValues['confluence']
interface ProductDraft {
  readonly value: ProductValue
  readonly token: string
  readonly clearToken: boolean
  readonly revision: number
  readonly baseValue: string
  readonly secretDirty: boolean
}
type Drafts = Partial<Record<AtlassianProduct, ProductDraft>>
type ProductNotices = Record<AtlassianProduct, Notice>
const PRODUCTS = ['jira', 'bitbucket', 'confluence'] as const

export function KanbanSettings(props: KanbanSettingsProps) {
  const { form, remote, t } = props
  const snapshot = useSyncExternalStore(form.subscribe.bind(form), form.getSnapshot.bind(form))
  const [safeSettings, setSafeSettings] = useState<AtlassianSettingsView | null>(null)
  const [drafts, setDrafts] = useState<Drafts>({})
  const [notices, setNotices] = useState<ProductNotices>({ jira: null, bitbucket: null, confluence: null })
  const [mentionBusy, setMentionBusy] = useState(false)
  const [busyProduct, setBusyProduct] = useState<AtlassianProduct | null>(null)
  const [toast, setToast] = useState<{ readonly id: number; readonly message: KanbanLocaleKey } | null>(null)
  const [mentionNotice, setMentionNotice] = useState<Notice>(null)
  useEffect(() => {
    let live = true
    void remote.settings().then(value => { if (live) setSafeSettings(value) }).catch(() => {})
    return () => { live = false }
  }, [remote, snapshot.revision])
  const current = snapshot.value

  useEffect(() => {
    const revision = snapshot.revision
    const values = snapshot.value
    if (revision === undefined || values === undefined) return
    setDrafts(previous => {
      const next = { ...previous }
      for (const product of PRODUCTS) {
        const draft = previous[product]
        // Public product values can be compared safely. Token drafts stay
        // fenced because the saved token itself is intentionally redacted.
        if (draft === undefined || draft.secretDirty || draft.revision === revision) continue
        if (JSON.stringify(values[product]) === draft.baseValue) next[product] = { ...draft, revision }
      }
      return next
    })
  }, [snapshot.revision, snapshot.value])

  if (current === undefined) return <p className={styles.loading} role="status">{t('loading')}</p>

  const setProductNotice = (product: AtlassianProduct, notice: Notice): void => setNotices(previous => ({ ...previous, [product]: notice }))
  const showToast = (message: KanbanLocaleKey): void => setToast(previous => ({ id: (previous?.id ?? 0) + 1, message }))
  const getDraft = (product: AtlassianProduct): ProductDraft => {
    const existing = drafts[product]
    if (existing !== undefined) return existing
    return {
      value: current[product] as ProductValue, token: '', clearToken: false,
      revision: snapshot.revision ?? -1, baseValue: JSON.stringify(current[product]), secretDirty: false,
    }
  }
  const updateDraft = (product: AtlassianProduct, edit: (draft: ProductDraft) => ProductDraft): void => {
    setDrafts(previous => {
      const existing = previous[product] ?? getDraft(product)
      return { ...previous, [product]: edit(existing) }
    })
    setProductNotice(product, null)
  }
  const rebaseUnaffectedDrafts = (savedProduct: AtlassianProduct | null, fromRevision: number): void => {
    const latest = form.getSnapshot()
    const latestRevision = latest.revision
    const latestValue = latest.value
    // ConfigForm revisions advance once for our own accepted mutation. A
    // second revision change means another writer also changed the document.
    if (latestRevision === undefined || latestValue === undefined || latestRevision !== fromRevision + 1) return
    setDrafts(previous => {
      const next = { ...previous }
      for (const product of PRODUCTS) {
        const draft = previous[product]
        if (draft === undefined || product === savedProduct || draft.revision !== fromRevision) continue
        if (canRebaseUnchangedDraft(fromRevision, latestRevision, draft.baseValue, latestValue[product])) next[product] = { ...draft, revision: latestRevision }
      }
      return next
    })
  }

  const updateMentions = async (enabled: boolean): Promise<void> => {
    const startRevision = snapshot.revision
    if (startRevision === undefined || !snapshot.writable) return
    setMentionBusy(true); setMentionNotice(null)
    try {
      const accepted = await form.mutate(buildRefreshMentionsOp(enabled), snapshot.revision)
      if (!accepted) { setMentionNotice({ key: 'settingsConflict' }); return }
      rebaseUnaffectedDrafts(null, startRevision)
      showToast('saved')
    } catch { setMentionNotice({ key: 'saveFailed' }) }
    finally { setMentionBusy(false) }
  }

  const saveProduct = async (product: AtlassianProduct): Promise<void> => {
    const draft = drafts[product]
    const value = (draft?.value ?? current[product]) as ProductValue
    const validation = validateProductSettings(product, value)
    if (validation !== null) { setProductNotice(product, { key: validation }); return }
    if (draft !== undefined && (draft.revision < 0 || draft.revision !== snapshot.revision)) {
      setProductNotice(product, { key: 'settingsConflict' }); return
    }
    if (!snapshot.writable || snapshot.revision === undefined) { setProductNotice(product, { key: 'saveFailed' }); return }
    const startRevision = draft?.revision ?? snapshot.revision
    const values = { jira: '', bitbucket: '', confluence: '', ...(draft === undefined ? {} : { [product]: draft.token }) }
    const clear = { jira: false, bitbucket: false, confluence: false, ...(draft === undefined ? {} : { [product]: draft.clearToken }) }
    setBusyProduct(product); setProductNotice(product, null)
    try {
      const fullValues: ConfigValues = { ...current, [product]: value } as ConfigValues
      const ops = buildProductSettingsOps(product, fullValues, { values, clear })
      const outcome = await saveSettingsDraft(form, ops, startRevision, snapshot.revision)
      if (outcome === 'saved') {
        setDrafts(previous => { const next = { ...previous }; delete next[product]; return next })
        rebaseUnaffectedDrafts(product, startRevision)
        showToast('saved')
      } else setProductNotice(product, { key: 'settingsConflict' })
    } catch { setProductNotice(product, { key: 'saveFailed' }) }
    finally { setBusyProduct(null) }
  }

  const test = async (product: AtlassianProduct): Promise<void> => {
    const draft = getDraft(product)
    const value = draft.value
    setBusyProduct(product); setProductNotice(product, null)
    try {
      const result = await remote.testConnection(product, connectionDraftFor(value.baseUrl, draft.token, draft.clearToken))
      setProductNotice(product, result.ok ? { key: 'connected', ...(result.displayName ? { detail: result.displayName } : {}) } : { key: 'failedConnection', detail: result.message })
    } catch { setProductNotice(product, { key: 'failedConnection' }) }
    finally { setBusyProduct(null) }
  }

  const discardProduct = (product: AtlassianProduct): void => {
    setDrafts(previous => { const next = { ...previous }; delete next[product]; return next })
    setProductNotice(product, null)
  }

  return <section aria-label={t('panel')} className={styles.settings}>
    <section aria-labelledby="atlassian-mention-refresh-title" className={styles.product}>
      <h3 id="atlassian-mention-refresh-title" className={styles.sectionTitle}>{t('mentions')}</h3>
      <div className={styles.toggleRow}>
        <div><strong>{t('refreshMentions')}</strong><p className={styles.hint}>{t('refreshMentionsHint')}</p></div>
        <Switch checked={current.refreshMentions} onChange={checked => { void updateMentions(checked) }} label={t('refreshMentions')} disabled={mentionBusy || busyProduct !== null || !snapshot.writable} />
      </div>
      {mentionNotice !== null && <Feedback notice={mentionNotice} t={t} />}
    </section>
    {PRODUCTS.map(product => {
      const draft = drafts[product]
      const value = (draft?.value ?? current[product]) as ProductValue
      const busy = busyProduct === product
      const productConflict = draft !== undefined && (draft.revision < 0 || draft.revision !== snapshot.revision)
      const hasDraft = draft !== undefined && (JSON.stringify(draft.value) !== draft.baseValue || draft.token !== '' || draft.clearToken)
      const setBaseUrl = (baseUrl: string): void => updateDraft(product, old => ({ ...old, value: { ...old.value, baseUrl } }))
      const setToken = (token: string): void => updateDraft(product, old => ({ ...old, token, secretDirty: true }))
      const setClearToken = (clearToken: boolean): void => updateDraft(product, old => ({ ...old, clearToken, secretDirty: true }))
      const editNamedQueries = (rows: readonly NamedQuery[]): void => updateDraft(product, old => ({ ...old, value: { ...old.value, ...(product === 'jira' ? { jql: rows } : { cql: rows }) } as ProductValue }))
      const editRepos = (rows: readonly BitbucketRepositoryRef[]): void => updateDraft(product, old => ({ ...old, value: { ...old.value, repositories: rows } as ProductValue }))
      return <section key={product} aria-labelledby={`atlassian-${product}`} className={styles.product}>
        <h3 id={`atlassian-${product}`} className={styles.sectionTitle}>{t(product)}</h3>
        <ValueField id={`${product}-base-url`} label={t('baseUrl')} text={value.baseUrl} placeholder="https://" disabled={busyProduct !== null} onEdit={setBaseUrl} />
        <SettingsSecretField id={`${product}-bearer-token`} label={t('token')} text={draft?.token ?? ''} disabled={busyProduct !== null}
          configured={safeSettings?.[product].hasToken ?? false} stateLabel={safeSettings?.[product].hasToken ? t('tokenSaved') : t('tokenNotSaved')}
          hint={t('tokenHint')} onEdit={setToken} />
        <div className={styles.toggleRow}>
          <span>{t('clearToken')}</span>
          <Switch checked={draft?.clearToken ?? false} onChange={setClearToken} label={t('clearToken')} disabled={busyProduct !== null || !safeSettings?.[product].hasToken} />
        </div>
        {product === 'jira' && <QueryEditor product="jira" rows={(value as ConfigValues['jira']).jql} t={t} disabled={busyProduct !== null} onChange={editNamedQueries} />}
        {product === 'confluence' && <QueryEditor product="confluence" rows={(value as ConfigValues['confluence']).cql} t={t} disabled={busyProduct !== null} onChange={editNamedQueries} />}
        {product === 'bitbucket' && <RepoEditor rows={(value as ConfigValues['bitbucket']).repositories} t={t} disabled={busyProduct !== null} onChange={editRepos} />}
        {productConflict && <p className={styles.conflict} role="alert">{t('settingsConflict')}</p>}
        <div className={styles.productActions}>
          <Button size="sm" variant="outline" disabled={busyProduct !== null} onClick={() => { void test(product) }}>{t('testConnection')}</Button>
          <Button size="sm" variant="primary" disabled={busyProduct !== null || mentionBusy || !snapshot.writable || !hasDraft} onClick={() => { void saveProduct(product) }}>{t('save')}</Button>
          {hasDraft && <Button size="sm" variant="ghost" disabled={busyProduct !== null} onClick={() => discardProduct(product)}>{t('discardChanges')}</Button>}
        </div>
        {notices[product] !== null && <Feedback notice={notices[product]!} t={t} />}
      </section>
    })}
    {toast !== null && <Toast key={toast.id} tone="success" text={t(toast.message)} onDone={() => setToast(null)} />}
  </section>
}

function Feedback({ notice, t }: { readonly notice: Exclude<Notice, null>; readonly t: Translate }) {
  const success = notice.key === 'connected'
  return <div className={`${styles.feedback} ${success ? styles.feedbackSuccess : styles.feedbackError}`} role={success ? 'status' : 'alert'} aria-live={success ? 'polite' : 'assertive'}>
    <StateDot state={success ? 'done' : 'error'} size={10} />
    <div className={styles.feedbackContent}>
      <div className={styles.feedbackMessage}>{t(notice.key)}{success && notice.detail ? ` · ${notice.detail}` : ''}</div>
      {!success && notice.detail !== undefined && notice.detail !== '' && <details className={styles.feedbackDetails}>
        <summary>{t('technicalDetails')}</summary>
        <pre>{notice.detail}</pre>
      </details>}
    </div>
  </div>
}

function ValueField({ id, label, text, placeholder, disabled, onEdit }: { readonly id: string; readonly label: string; readonly text: string; readonly placeholder?: string; readonly disabled: boolean; readonly onEdit: (text: string) => void }) {
  return <SettingsValueField id={id} label={label} text={text} {...(placeholder === undefined ? {} : { placeholder })} disabled={disabled} overridden={false} invalid={false}
    overriddenLabel="" resetLabel="" invalidLabel="" onEdit={onEdit} onReset={() => {}} />
}

function QueryEditor({ product, rows, t, disabled, onChange }: { readonly product: 'jira' | 'confluence'; readonly rows: readonly NamedQuery[]; readonly t: Translate; readonly disabled: boolean; readonly onChange: (rows: readonly NamedQuery[]) => void }) {
  return <fieldset className={styles.editor}><legend>{t(product === 'jira' ? 'sectionJira' : 'sectionConfluence')}</legend>
    {rows.map((row, index) => <div key={row.id} className={styles.grid}>
      <SettingsValueField id={`${product}-query-name-${index}`} label={`${t('queryName')} ${index + 1}`} text={row.name} placeholder={t('queryName')} disabled={disabled}
        overridden={false} invalid={false} overriddenLabel="" resetLabel="" invalidLabel="" onEdit={name => onChange(rows.map(item => item.id === row.id ? { ...item, name } : item))} onReset={() => {}} />
      <SettingsValueField id={`${product}-query-text-${index}`} label={`${t('queryText')} ${index + 1}`} text={row.query} placeholder={t('queryText')} disabled={disabled}
        overridden={false} invalid={false} overriddenLabel="" resetLabel="" invalidLabel="" onEdit={query => onChange(rows.map(item => item.id === row.id ? { ...item, query } : item))} onReset={() => {}} />
      <Button size="sm" variant="ghost" disabled={disabled} aria-label={`${t('remove')} ${row.name}`} onClick={() => onChange(rows.filter(item => item.id !== row.id))}>{t('remove')}</Button>
    </div>)}
    <Button size="sm" variant="outline" disabled={disabled} onClick={() => onChange([...rows, { id: crypto.randomUUID(), name: '', query: '' }])}>{t('newQuery')}</Button>
  </fieldset>
}

function RepoEditor({ rows, t, disabled, onChange }: { readonly rows: readonly BitbucketRepositoryRef[]; readonly t: Translate; readonly disabled: boolean; readonly onChange: (rows: readonly BitbucketRepositoryRef[]) => void }) {
  return <fieldset className={styles.editor}><legend>{t('repo')}</legend>
    {rows.map((row, index) => <div key={row.id} className={`${styles.grid} ${styles.repoGrid}`}>
      <SettingsValueField id={`repo-project-key-${index}`} label={`${t('projectKey')} ${index + 1}`} text={row.projectKey} placeholder={t('projectKey')} disabled={disabled}
        overridden={false} invalid={false} overriddenLabel="" resetLabel="" invalidLabel="" onEdit={projectKey => onChange(rows.map(item => item.id === row.id ? { ...item, projectKey } : item))} onReset={() => {}} />
      <SettingsValueField id={`repo-slug-${index}`} label={`${t('repositorySlug')} ${index + 1}`} text={row.repositorySlug} placeholder={t('repositorySlug')} disabled={disabled}
        overridden={false} invalid={false} overriddenLabel="" resetLabel="" invalidLabel="" onEdit={repositorySlug => onChange(rows.map(item => item.id === row.id ? { ...item, repositorySlug } : item))} onReset={() => {}} />
      <Button size="sm" variant="ghost" disabled={disabled} aria-label={`${t('remove')} ${row.projectKey}/${row.repositorySlug}`} onClick={() => onChange(rows.filter(item => item.id !== row.id))}>{t('remove')}</Button>
    </div>)}
    <Button size="sm" variant="outline" disabled={disabled} onClick={() => onChange([...rows, { id: crypto.randomUUID(), projectKey: '', repositorySlug: '' }])}>{t('newRepo')}</Button>
  </fieldset>
}
