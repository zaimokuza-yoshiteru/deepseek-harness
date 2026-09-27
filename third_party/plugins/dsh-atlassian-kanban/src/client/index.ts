import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import type {} from '@deepseek-ai/dsh-client-connection/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type { Context } from '@deepseek-ai/cordis'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import type { InputTriggerServiceContract } from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { AtlassianKanbanRemote, ConnectionDraft } from '../shared/remote.ts'
import contribution from '../../lib/typert.remote-client.js'
import { KanbanPage } from './KanbanPage.tsx'
import { KanbanSettings, type ConfigValues } from './KanbanSettings.tsx'
import { createAtlassianReferenceSource } from './atlassian-reference.ts'
import { KanbanIcon } from './KanbanIcon.tsx'
import { KanbanController } from './kanban-state.ts'
import { en, NS, zh, type KanbanLocaleKey } from './locales.ts'

export type * from '../shared/remote.ts'
export type * from '../shared/config.ts'

export const PANEL_ID = 'atlassian-kanban' as MainPanelId
export const PACKAGE_NAME = 'dsh-atlassian-kanban'
export const SETTINGS_NAMESPACE = 'dsh-atlassian-kanban'

export const inject = ['slots', 'locale', 'remote', 'inputTriggers', 'configForms', 'pluginNavigation', 'layout']

/** Install the shared dashboard panel, native config view, and bounded @ sources. */
function registerUi(ctx: Context): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'atlassian-kanban: dictionaries')
  const t = ctx.locale.bind(NS)
  const namespace = ctx.remote.atlassianKanban
  const remote: AtlassianKanbanRemote = {
    settings: async () => unwrapRemote(await namespace.settings()),
    testConnection: async (product, draft?: ConnectionDraft) => unwrapRemote(await namespace.testConnection(product, draft)),
    query: async (input, signal) => unwrapRemote(await namespace.query(input, signal)),
    suggestions: async (input, signal) => unwrapRemote(await namespace.suggestions(input, signal)),
  }
  const controller = new KanbanController(remote)
  ctx.effect(() => () => controller.dispose(), 'atlassian-kanban: dashboard controller')
  const inputTriggers = ctx.get('inputTriggers') as InputTriggerServiceContract
  ctx.effect(() => inputTriggers.registerSource(createAtlassianReferenceSource(remote, key => t(key as KanbanLocaleKey))), 'atlassian-kanban: @ source')

  ctx.slots.inject('main', () => ctx.slots.register({
    name: 'main', key: PANEL_ID, locale: NS,
    inject: () => ({ controller, remote, openConfig: () => ctx.pluginNavigation.openBundle(PACKAGE_NAME) }),
  }, KanbanPage))
  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
    name: 'sidebar.panellist', id: PANEL_ID, order: -10, locale: NS,
    label: () => t('panel'),
  }, KanbanIcon))

  const form = ctx.configForms.get<ConfigValues>(SETTINGS_NAMESPACE)
  ctx.effect(() => {
    const stopForm = form.subscribe(() => { void controller.loadSettings() })
    const stopConnection = ctx.on('connection/reset', () => { void controller.loadSettings() })
    return () => { stopForm(); stopConnection() }
  }, 'atlassian-kanban: settings refresh')
  ctx.slots.inject('plugins.bundle.config', () => ctx.slots.register({
    name: 'plugins.bundle.config', key: PACKAGE_NAME, locale: NS,
    inject: () => ({ form, remote }),
  }, KanbanSettings))
}

/** Mount generated Remote methods before registering UI consumers that need them. */
export async function apply(ctx: Context): Promise<() => Promise<void>> {
  const disposeRemote = await ctx.remote.$mount(contribution)
  const ui = ctx.inject([...inject, 'remote.atlassianKanban'], registerUi)
  try {
    await ui
  } catch (error) {
    await ui.dispose()
    await disposeRemote()
    throw error
  }
  return async () => {
    await ui.dispose()
    await disposeRemote()
  }
}

function unwrapRemote<T>(result: RemoteResult<T>): T {
  if (!result.ok) throw result.error
  return result.value
}
