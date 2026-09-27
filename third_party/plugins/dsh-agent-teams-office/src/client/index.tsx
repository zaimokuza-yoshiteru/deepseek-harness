import type { ClientContext } from './context.ts';
import type { LoadSnapshot, OfficeSnapshot } from '../types.ts';
import React from 'react';
import { Button } from '@deepseek-ai/dsh-client-ui-primitives';
import { createOfficeScene } from './scene-factory.ts';
import { createSceneCache } from './scene-cache.ts';
import { Office } from './Office.tsx';
import { words } from './locales.ts';
import { officeSessionId } from '../shared.ts';
import { createOfficeAvailability } from './availability.ts';
import { pollSnapshot } from './poll.ts';
import css from './office.css';

export const name = '@zaimokuza/dsh-agent-teams-office';
export const inject = ['slots', 'locale', 'connection', 'sessions', 'sidebarRightTabs', 'sidebarRight'];

/** Register Office through the same native Sidebar tab API as Files and Terminal. */
export function apply(ctx: ClientContext) {
  ctx.effect(() => ctx.locale.register(name, words), 'dsh-agent-teams-office: locale');
  ctx.effect(() => {
    const style = document.createElement('style'); style.textContent = css; document.head.appendChild(style);
    return () => style.remove();
  }, 'dsh-agent-teams-office: styles');
  const t = ctx.locale.bind(name);
  const scenes = createSceneCache(createOfficeScene);
  ctx.effect(() => () => scenes.dispose(), 'dsh-agent-teams-office: scenes');
  const load: LoadSnapshot = async (sessionId, signal, cursor) => {
    const result = await ctx.connection.rpc.call('/api', 'dshOffice/snapshot', { sessionId: officeSessionId(ctx.sessions, sessionId), cursor },
      AbortSignal.any([signal, AbortSignal.timeout(12000)]));
    if (!result.ok) throw new Error(result.error.message);
    // This logical RPC route is implemented by this package's readOfficeSnapshot.
    return result.value as OfficeSnapshot;
  };
  ctx.effect(() => {
    const gate = createOfficeAvailability(() => ctx.sidebarRightTabs.register({
      id: name, kind: 'dsh-agent-teams-office', title: () => t('title'), keepMounted: true,
      guide: [{ id: 'office', order: 30, title: () => t('title'), description: () => t('description'), icon: OfficeIcon }],
    }), () => scenes.dispose());
    const stop = pollSnapshot(signal => load(null, signal), gate.update,
      () => { /* A temporary connection loss must not discard an existing office. */ });
    return () => { stop(); gate.dispose(); };
  }, 'dsh-agent-teams-office: show only while host Agent Teams is enabled');
  ctx.effect(() => ctx.slots.inject('sidebar.right.tab.menu.item', () => ctx.slots.register({
    name: 'sidebar.right.tab.menu.item', id: name + '/float', locale: name,
  }, function OfficeMenu({ tab, dismiss }) {
    if (tab.kind !== 'dsh-agent-teams-office') return null;
    return <Button role="menuitem" variant="ghost" size="sm" className="office-float-menu" onClick={() => {
      dismiss(); ctx.sidebarRight.float(tab.id);
    }}>{t('floatOffice')}</Button>;
  })), 'dsh-agent-teams-office: native floating panel action');
  ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
    name: 'sidebar.right.pane.tab', key: name, locale: name,
  }, function OfficeTab({ sessionId, useTabInfo }) {
    const { tab } = useTabInfo();
    const sceneKey = sessionId + '/' + tab.id;
    const office = scenes.get(sceneKey);
    return <Office key={sceneKey} t={t} load={load} sessionId={sessionId}
      visible={tab.visible} signal={tab.signal} office={office}/>;
  })), 'dsh-agent-teams-office: sidebar body');
}

function OfficeIcon({ size = 26, className }: { size?: number; className?: string }) {
  return <svg width={size} height={size} viewBox="0 0 26 26" className={className} aria-hidden="true">
    <rect x="4" y="2" width="18" height="22" rx="3" fill="#91ac78"/>
    <path d="M8 7h2m6 0h2M8 11h2m6 0h2M8 15h2m6 0h2M12 24v-5h2v5" stroke="#edf3e4" strokeWidth="2"/>
  </svg>;
}
