import { JSDOM } from 'jsdom';
import type { OfficeScene, ViewMode } from '../src/types.ts';
import { member, snapshot, scene } from './helpers/fixtures.ts';
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createSceneCache } from '../src/client/scene-cache.ts';

const dom = new JSDOM('');
after(() => dom.window.close());
const node = () => dom.window.document.createElement('div');
const flush = () => new Promise(resolve => setImmediate(resolve));
test('docking and floating keep one canvas, selection, camera and snapshot until the tab closes', async () => {
  let created = 0, destroyed = 0, onSelect: ((id: string) => void) | undefined;
  const focus: (string | null)[] = [], activity: boolean[] = [];
  const cache = createSceneCache(async (_host, select) => {
    created++; onSelect = select;
    return scene({ destroy: () => destroyed++, setActive: value => activity.push(value), focus: id => { focus.push(id); return true; } });
  }, node);
  const office = cache.get('team-office'), root = new AbortController();
  const first = node(), second = node();
  const a = office.mount(first, root.signal); a.visible(true); await flush();
  const canvas = first.firstChild;
  assert.ok(onSelect); onSelect('member'); office.focus('member'); office.snapshot(snapshot({ members: [member('member')] }));
  a.detach();
  const b = cache.get('team-office').mount(second, root.signal); b.visible(true); await flush();
  assert.equal(created, 1); assert.equal(destroyed, 0); assert.equal(second.firstChild, canvas);
  assert.equal(office.getSnapshot().selected, 'member'); assert.equal(office.getSnapshot().snapshot!.members[0].id, 'member');
  assert.equal(office.getSnapshot().focused, 'member');
  assert.deepEqual(focus, ['member']);
  a.detach(); assert.equal(second.firstChild, canvas);
  b.visible(false); assert.equal(activity.at(-1), false);
  root.abort(); assert.equal(destroyed, 1); assert.equal(cache.has('team-office'), false);
  cache.dispose(); assert.equal(destroyed, 1);
});

test('closing the tab during asynchronous scene loading destroys the late result', async () => {
  let resolve!: (value: OfficeScene) => void, destroyed = 0;
  const cache = createSceneCache(() => new Promise(done => { resolve = done; }), node);
  const abort = new AbortController();
  cache.get('loading').mount(node(), abort.signal);
  abort.abort(); resolve(scene({ destroy() { destroyed++; } })); await flush();
  assert.equal(destroyed, 1); assert.equal(cache.has('loading'), false);
});

test('follow toggles, cancels on selection/removal/fit/view changes, and pixel focus stays a one-shot action', async () => {
  const calls: (string | null)[] = [];
  const cache=createSceneCache(async()=>scene({focus(id){calls.push(id);return id !== 'missing';}}),node);
  const office=cache.get('follow'), root=new AbortController();
  office.mount(node(),root.signal); await flush();
  office.snapshot(snapshot({members:[member('a'),member('b')]})); office.select('a');
  office.focus('missing'); assert.equal(office.getSnapshot().focused,null);
  office.focus('a'); assert.equal(office.getSnapshot().focused,'a');
  office.focus('a'); assert.equal(office.getSnapshot().focused,null); assert.equal(calls.at(-1),null);
  office.focus('a'); office.select('b'); assert.equal(office.getSnapshot().focused,null);
  office.focus('b'); office.select(null); assert.equal(office.getSnapshot().focused,null);
  office.select('b'); office.focus('b'); office.snapshot(snapshot({members:[member('a')]}));
  assert.equal(office.getSnapshot().focused,null); assert.equal(office.getSnapshot().selected,null);
  office.select('a'); office.focus('a'); office.fit(); assert.equal(office.getSnapshot().focused,null);
  office.focus('a'); office.setView('pixel'); assert.equal(office.getSnapshot().focused,null); assert.equal(calls.at(-1),null);
  await flush(); office.focus('a'); office.focus('a'); assert.deepEqual(calls.slice(-2),['a','a']);
  assert.equal(office.getSnapshot().focused,null); root.abort();
});

test('switching renderers during loading releases the stale scene and retains the real snapshot', async () => {
  const pending: { resolve(value: OfficeScene): void; error(error: Error): void; view: ViewMode }[] = [], destroyed: string[] = [], active: [string, boolean][] = [];
  const cache = createSceneCache((_host, _select, error, options) => new Promise(resolve => pending.push({ resolve, error, view: options.view })), node);
  const office = cache.get('sample'), abort = new AbortController();
  office.snapshot(snapshot({ members: [member('real-member')] })); office.select('real-member');
  office.mount(node(), abort.signal).visible(true);
  office.setView('pixel');
  assert.deepEqual(pending.map(p => p.view), ['team', 'pixel']);
  const value = (view: string) => scene({ destroy() { destroyed.push(view); }, setActive(v) { active.push([view, v]); } });
  pending[1].resolve(value('pixel')); await flush();
  pending[0].error(new Error('late failure')); pending[0].resolve(value('team')); await flush();
  assert.deepEqual(destroyed, ['team']); assert.equal(office.getSnapshot().sceneError, null);
  assert.equal(office.getSnapshot().snapshot!.members[0].id, 'real-member');
  assert.equal(office.getSnapshot().selected, 'real-member');
  office.setView('team');
  pending[2].resolve(value('new-team')); await flush();
  assert.deepEqual(active.at(-1), ['new-team', true]);
  abort.abort(); assert.deepEqual(destroyed, ['team', 'pixel', 'new-team']);
});
