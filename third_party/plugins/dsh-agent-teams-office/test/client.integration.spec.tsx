import assert from 'node:assert/strict';
import type { OfficeScene, SceneFactory, ViewMode } from '../src/types.ts';
import type { Resources } from '@deepseek-ai/dsh-client-resources/client';
import type { ClientContext } from '../src/client/context.ts';
import type { SidebarRightState } from '@deepseek-ai/dsh-client-ui-sidebar-right/client';
import type { SessionId } from '@deepseek-ai/dsh-session/types';
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client';
import { stub, member, snapshot as makeSnapshot, emptySnapshot } from './helpers/fixtures.ts';
/** Native DSH slots, pane layout and plugin disposal; WebGL is covered separately. */
import { afterEach, expect, it, vi } from 'vitest';
import { act, fireEvent, waitFor, within } from '@testing-library/react';
import { SlotTestRuntime } from '@deepseek-ai/dsh-client-test-runtime';
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client';
import { apply as sidebarApply, inject as sidebarInject } from '@deepseek-ai/dsh-client-ui-sidebar-right/client';
import { findTabPane } from '@deepseek-ai/dsh-client-ui-dockkit';
import * as plugin from '../src/client/index.tsx';

interface TestScene extends OfficeScene {canvas:HTMLCanvasElement;view:ViewMode;select:(id:string)=>void;camera:{zoom:number};tick:number}
const scenes = vi.hoisted(() => [] as TestScene[]);
const emptyShortcutCatalog: readonly never[] = Object.freeze([]);
vi.mock('../src/client/office.css', () => ({ default: '' }));
vi.mock('../src/client/scene-factory.ts', () => ({ createOfficeScene: ((async (host, select, _error, { view }) => {
  const canvas = document.createElement('canvas'); host.append(canvas);
  const scene = { canvas, view, select, camera: { zoom: 1.4 }, tick: 42,
    update: vi.fn(), activities: vi.fn(), fit: vi.fn(), focus: vi.fn(() => true), setActive: vi.fn(), destroy: vi.fn(() => canvas.remove()) };
  scenes.push(scene); return scene;
}) satisfies SceneFactory) }));
let runtime:SlotTestRuntime|null = null;
afterEach(async () => { await runtime?.dispose(); runtime = null; scenes.length = 0; vi.restoreAllMocks(); });

async function setup(enabled = true) {
  Element.prototype.getAnimations = () => [];
  const current = await SlotTestRuntime.create(); runtime = current;
  current.ctx.provide('layout', stub<ClientContext['layout']>({ openRightbar() {}, closeRightbar() {} }));
  current.ctx.provide('resources', stub<Resources>({ pin() {} }));
  const locale = new LocaleRuntime(current.ctx); current.ctx.provide('locale', locale); current.slots.installLocale(locale);
  await current.declare({ rightbar: { kind: 'single', scope: 'root' } });
  // RC2 sidebar installs its page shortcuts through this host service.
  current.ctx.provide('shortcuts', { runtime: 'web', register: () => () => {},
    catalog: { getSnapshot: () => emptyShortcutCatalog, subscribe: () => () => {} } } as never);
  await current.sessions.add({ id: 'lead' });
  await current.sessions.add({ id: 'other' });
  // alpha.2 moved active-view ownership from sessions.open to explicit references.
  let getStore: () => ReturnType<SlotTestRuntime['storeOf']>;
  let selectSession: (id: SessionId) => void;
  if (typeof current.sessions.retainFor === 'function') {
    const reference = current.sessions.retainFor(current.ctx, 'lead' as SessionId, { source: 'mainView' });
    getStore = () => current.storeOf('rightbar.session', reference);
    let selected = reference;
    selectSession = id => {
      const next = current.sessions.retainFor(current.ctx, id, { source: 'mainView' });
      selected.release(); selected = next;
    };
  } else {
    // alpha.1's test runtime uses session IDs before the reference API existed.
    const legacy = current as unknown as {sessions:{open(id:string):void};storeOf(key:'rightbar.session',id:string):ReturnType<SlotTestRuntime['storeOf']>};
    legacy.sessions.open('lead'); getStore = () => legacy.storeOf('rightbar.session','lead');
    selectSession = id => legacy.sessions.open(id);
  }
  await current.mount({ inject: [...sidebarInject], apply: sidebarApply });
  current.ctx.sidebarRightTabs.register({ id: 'fixture/files', kind: 'files', title: () => 'Files',
    guide: [{ id: 'files', order:0, title: () => 'Files' }] });
  const snapshot = makeSnapshot({members:[member('lead',{name:'Lead',role:'lead',status:'running'})]});
  const rpc = vi.fn<ConnectionHandle['rpc']['call']>(async (_path, _method, payload) => ({ ok: true, value: !enabled
    ? emptySnapshot('disabled') : payload && typeof payload === 'object' && 'sessionId' in payload && payload.sessionId ? snapshot : emptySnapshot('unselected') }));
  current.ctx.provide('connection', stub<ConnectionHandle>({rpc:{call:rpc}}));
  const feature = await current.mount(plugin);
  const view = current.renderSlot('rightbar', { width: 680, viewportWidth: 1440, canShow: true });
  const store = getStore();
  const controller = current.ctx.sidebarRight;
  const layout = () => (store.getSnapshot() as SidebarRightState).bySession.lead.layout;
  return { runtime:current, feature, view, rpc, controller, layout, selectSession };
}

it('native floating/docking keeps one scene; selection has no conversation navigation; unload releases it', async () => {
  const h = await setup();
  await act(async () => { h.controller.openTab('dsh-agent-teams-office'); });
  await waitFor(() => expect(scenes).toHaveLength(1));
  const first = scenes[0], tab = h.controller.active(); assert.ok(tab);
  await act(async () => { first.select('lead'); });
  expect(document.body.textContent).toContain('Lead');
  expect(document.body.textContent).not.toMatch(/查看会话|View conversation/);
  expect(within(h.view.container).queryAllByRole('button').some(b => /聚焦|Focus/.test(b.textContent ?? ''))).toBe(true);
  await act(async () => { fireEvent.click(within(document.body).getByRole('button', { name: /^(聚焦|Focus)$/ })); });
  expect(within(document.body).getByRole('button', { name: /聚焦中|Following/ }).getAttribute('aria-pressed')).toBe('true');
  expect(first.focus).toHaveBeenLastCalledWith('lead');
  const tabElement = h.view.container.querySelector(`[data-dockkit-tab="${tab.id}"]`); assert.ok(tabElement);
  fireEvent.contextMenu(tabElement);
  await act(async () => { fireEvent.click(within(document.body).getByRole('menuitem', { name: /悬浮显示办公室|Float office/ })); });
  expect(document.querySelector('[data-dockkit-tab-menu]')).toBeNull();
  expect(findTabPane(h.layout(), tab.id).host).toBe('float');
  expect(document.querySelectorAll('canvas')).toHaveLength(1);
  expect(document.querySelector('canvas')).toBe(first.canvas);
  await act(async () => { fireEvent.click(within(document.body).getByRole('button', { name: /聚焦中|Following/ })); });
  expect(first.focus).toHaveBeenLastCalledWith(null);
  expect(within(document.body).getByRole('button', { name: /^(聚焦|Focus)$/ }).getAttribute('aria-pressed')).toBe('false');
  expect(scenes).toHaveLength(1); expect(first.destroy).not.toHaveBeenCalled();
  expect(first.camera.zoom).toBe(1.4); expect(first.tick).toBe(42);
  await act(async () => { h.controller.dock(findTabPane(h.layout(), tab.id).id); });
  expect(findTabPane(h.layout(), tab.id).host).toBe('dock');
  expect(document.querySelector('canvas')).toBe(first.canvas);
  const pixel = within(h.view.container).getByRole('button', { name: /像素|Pixel/ });
  await act(async () => { fireEvent.click(pixel); });
  await waitFor(() => expect(scenes).toHaveLength(2));
  expect(first.destroy).toHaveBeenCalledOnce(); expect(scenes[1].view).toBe('pixel');
  await act(async () => { await h.feature.dispose(); });
  expect(scenes[1].destroy).toHaveBeenCalledOnce();
  expect(document.querySelector('canvas')).toBeNull();
  const calls = h.rpc.mock.calls.length;
  await new Promise(resolve => setTimeout(resolve, 1600));
  expect(h.rpc).toHaveBeenCalledTimes(calls);
  await act(async () => { await h.runtime.mount(plugin); });
  await waitFor(() => expect(scenes).toHaveLength(3));
  expect(document.querySelectorAll('canvas')).toHaveLength(1);
});

it('disabled Agent Teams leaves no Office entry', async () => {
  const h = await setup(false);
  await act(async () => { h.controller.toggleExpanded(); });
  expect(document.body.textContent).not.toMatch(/办公室|Office/);
  expect(scenes).toHaveLength(0);
});

// DSH 0.1.7 retains visited tabs across main-session changes.
it.skipIf(!sidebarInject.includes('uiSession'))('switching sessions and hiding the sidebar preserves the office and suspends its work', async () => {
  const h = await setup();
  await act(async () => { h.controller.openTab('dsh-agent-teams-office'); });
  await waitFor(() => expect(scenes).toHaveLength(1));
  const first = scenes[0], tab = h.controller.active(); assert.ok(tab);
  await act(async () => { first.select('lead'); h.controller.toggleExpanded(); });
  expect(first.setActive).toHaveBeenLastCalledWith(false);
  const leadCalls = () => h.rpc.mock.calls.filter(([, , payload]) =>
    payload && typeof payload === 'object' && 'sessionId' in payload && payload.sessionId === 'lead').length;
  const beforeHide = leadCalls();
  await new Promise(resolve => setTimeout(resolve, 1600));
  expect(leadCalls()).toBe(beforeHide);
  await act(async () => { h.controller.toggleExpanded(); h.controller.float(tab.id); });
  expect(first.setActive).toHaveBeenLastCalledWith(true);
  await act(async () => { h.selectSession('other' as SessionId); });
  expect(first.setActive).toHaveBeenLastCalledWith(false);
  const beforeSwitch = leadCalls();
  await new Promise(resolve => setTimeout(resolve, 1600));
  expect(leadCalls()).toBe(beforeSwitch);
  expect(first.destroy).not.toHaveBeenCalled();
  await act(async () => { h.selectSession('lead' as SessionId); });
  expect(first.setActive).toHaveBeenLastCalledWith(true);
  expect(scenes).toHaveLength(1);
  expect(document.querySelector('canvas')).toBe(first.canvas);
  expect(first.camera.zoom).toBe(1.4); expect(first.tick).toBe(42);
  expect(within(document.body).getByRole('button', { name: /聚焦|Focus/ })).toBeTruthy();
  await act(async () => { h.controller.dock(findTabPane(h.layout(), tab.id).id); h.controller.close(tab.id); });
  expect(first.destroy).toHaveBeenCalledOnce();
  expect(document.querySelector('canvas')).toBeNull();
});
