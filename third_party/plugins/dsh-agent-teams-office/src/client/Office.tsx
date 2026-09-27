import type { LoadSnapshot, MemberStatus } from '../types.ts';
import type { OfficeRecord, SceneMount } from './scene-cache.ts';
import type { Translate } from './locales.ts';
interface OfficeProps { t: Translate; load: LoadSnapshot; sessionId: string; visible: boolean; signal: AbortSignal; office: OfficeRecord }
import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Button } from '@deepseek-ai/dsh-client-ui-primitives';
import { pollSnapshot } from './poll.ts';
import { TEAMMATE_CAPACITY } from './team-office/layout.ts';

/** Native sidebar tab content; the scene survives docking and floating through its tab-owned cache. */
export function Office({ t, load, sessionId, visible, signal, office }: OfficeProps) {
  const { snapshot, selected, focused, sceneError, ready, view } = useSyncExternalStore(office.subscribe, office.getSnapshot);
  const [error, setError] = useState<Error | null>(null);
  const [retry, setRetry] = useState(0);
  const canvas = useRef<HTMLDivElement>(null), seat = useRef<SceneMount | null>(null);
  const stateText = (status: MemberStatus) => t(status === 'inactive' ? 'inactiveStatus' : status);
  useEffect(() => {
    if (!visible) return;
    return pollSnapshot(abort => load(sessionId, abort, office.cursor()), value => { office.snapshot(value); setError(null); }, setError);
  }, [sessionId, retry, load, visible, office]);
  useEffect(() => {
    const mounted = office.mount(canvas.current!, signal); seat.current = mounted;
    return () => { mounted.detach(); seat.current = null; };
  }, [office, signal]);
  useEffect(() => { office.update(snapshot?.members ?? [], stateText, kind => kind === 'idle' || kind === 'put-cup' ? '' : t(`activity_${kind}`)); }, [snapshot, selected, ready, t, office]);
  useEffect(() => { seat.current?.visible(visible); }, [visible, office, signal]);

  const members = snapshot?.members ?? [];
  const member = members.find(item => item.id === selected);
  const threeD = view === 'team';
  const overflow = members.filter(item => item.role !== 'lead').length > TEAMMATE_CAPACITY;
  const failure = sceneError || error;
  return <section className={`dsh-agent-teams-office${threeD ? ' office-3d' : ''}`} aria-label={t('title')}>
    <div ref={canvas} className="office-canvas" data-testid="office-canvas"/>
    {(sceneError || (!snapshot || members.length === 0)) && <div className="office-empty">
      <strong>{sceneError ? t('sceneError') : !snapshot ? (error ? t('stale') : t('loading')) : t(snapshot.state)}</strong>
      <p>{sceneError ? sceneError.message : t('emptyHint')}</p>
    </div>}
    <div className="office-tools">
      <div className="office-view-switch" role="group" aria-label={t('viewMode')}>
        <Button variant={threeD ? 'outline' : 'ghost'} size="sm" aria-pressed={threeD} onClick={() => office.setView('team')}>3D</Button>
        <Button variant={!threeD ? 'outline' : 'ghost'} size="sm" aria-pressed={!threeD} onClick={() => office.setView('pixel')}>{t('pixelView')}</Button>
      </div>
      <span className="office-hint" title={t('credits')}>{threeD ? t('orbitHint') : t('selectHint')}</span>
      <Button variant="toolbar" size="sm" onClick={() => office.fit()}>{t('fit')} ⛶</Button>
    </div>
    {failure && <div className="office-notice" role="status">
      <span title={failure.message}>{sceneError ? t('sceneError') : t('stale')}</span>
      <Button variant="outline" size="sm" onClick={() => { setRetry(value => value + 1); if (sceneError) office.retry(); }}>{t('reconnect')}</Button>
    </div>}
    {member && <div className="office-selection">
      <div><strong>{member.name}</strong><span>{stateText(member.status)}</span></div>
      <Button variant={focused === member.id ? 'outline' : 'ghost'} size="sm" disabled={!ready}
        aria-pressed={threeD ? focused === member.id : undefined} title={focused === member.id ? t('stopFocus') : t('focus')}
        onClick={() => office.focus(member.id)}>{t(focused === member.id ? 'focusing' : 'focus')}</Button>
      <Button variant="ghost" size="sm" aria-label={t('dismiss')} onClick={() => office.select(null)}>×</Button>
    </div>}
    {overflow && <div className="office-overflow">{t('overflow')}</div>}
  </section>;
}
