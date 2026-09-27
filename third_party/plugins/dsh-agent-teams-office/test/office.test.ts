import { after } from 'node:test';
import { Context } from '@deepseek-ai/cordis';
import type { HostContext } from '../src/host/context.ts';
import type { ConnectionFetchRoute } from '@deepseek-ai/dsh-client-connection';
import { hostFixture } from './helpers/host.ts';
import { stub } from './helpers/fixtures.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readOfficeSnapshot } from '../src/host/snapshot.ts';
import { apply } from '../src/host/index.ts';
import { officeSessionId, reconcileSeats } from '../src/shared.ts';
import { pollSnapshot } from '../src/client/poll.ts';
import { syncMotion } from '../src/client/motion.ts';

test('inactive and idle members roam without restarting; work interrupts the walk', () => {
  const calls: unknown[][] = [];
  const character: Parameters<typeof syncMotion>[0] = { setStatusGlyph: glyph => calls.push(['glyph', glyph]), setBaseAlpha: () => {},
    startWandering: restAtDesk => { assert.equal(restAtDesk, false); calls.push(['roam']); }, sitAtDesk: working => calls.push(['desk', working]) };
  let motion = syncMotion(character, 'inactive', null);
  motion = syncMotion(character, 'inactive', motion);
  motion = syncMotion(character, 'idle', motion);
  assert.equal(calls.filter(([kind]) => kind === 'roam').length, 1);
  motion = syncMotion(character, 'running', motion);
  assert.deepEqual(calls.at(-1), ['desk', true]);
  motion = syncMotion(character, 'failed', motion);
  assert.deepEqual(calls.slice(-2), [['glyph', 'blocked'], ['desk', false]]);
  motion = syncMotion(character, 'provisioning', motion);
  assert.equal(motion, 'wait');
  syncMotion(character, 'idle', motion);
  assert.deepEqual(calls.at(-1), ['roam']);
});

test('a catalogued member resolves its root Team without a retained client binding', () => {
  const sessions = { subagentAddress: (id: string) => id === 'child' ? { parentSessionId: 'root' } : undefined,
    binding: () => { throw new Error('Must not acquire or borrow a client session'); } };
  assert.equal(officeSessionId(sessions, 'child'), 'root');
  assert.equal(officeSessionId(sessions, 'root'), 'root');
  assert.equal(officeSessionId(sessions, null), null);
});
function context() { const {ctx} = hostFixture(); contexts.push(ctx); return ctx; }
const contexts: HostContext[] = [];
after(async () => { for (const ctx of contexts) await ctx.fiber.dispose(); });
test('a member view resolves to its lead and preserves inactive state and diagnostics', () => {
  const view = readOfficeSnapshot(context(), 'child');
  assert.equal(view.leadId, 'root'); assert.equal(view.members[1].status, 'inactive');
  assert.deepEqual(view.members[1].diagnostics, ['closed']);
  assert.equal(view.tasks[0].subject, 'build');
});
test('disabled Teams, no selection and disposed sessions have explicit empty states', () => {
  assert.equal(readOfficeSnapshot(new Context(), null).state, 'disabled');
  assert.equal(readOfficeSnapshot(context(), null).state, 'unselected');
  assert.equal(readOfficeSnapshot(context(), 'gone').state, 'inactive');
});
test('roster reordering keeps seats; removal frees seats; overflow never duplicates one', () => {
  const a = { id: 'a', role: 'lead' } as const, b = { id: 'b', role: 'teammate' } as const, c = { id: 'c', role: 'teammate' } as const;
  const original = reconcileSeats(new Map(), [b, a], 2);
  assert.equal(original.get('a'), 0); assert.equal(original.get('b'), 1);
  assert.deepEqual(reconcileSeats(original, [a, b], 2), original);
  const next = reconcileSeats(original, [a, c], 2); assert.equal(next.get('c'), 1);
  assert.equal(reconcileSeats(next, [a, b, c], 2).size, 2);
});
test('native Connection route validates requests and returns a standard RPC envelope', async () => {
  const ctx = context(); let route: ConnectionFetchRoute | undefined; let disposed = false;
  ctx.provide('connection', stub<HostContext['connection']>({ fetch: { register: value => { route = value; return async () => { disposed = true; }; } } }));
  apply(ctx); assert.ok(route);
  const request = (payload: unknown) => new Request('http://localhost/api/dshOffice/snapshot', { method: 'POST', body: JSON.stringify(payload) });
  assert.equal((await route.fetch(request({}))).status, 400);
  for (const payload of [null, [], 42, 'bad', {sessionId:'child',cursor:[]}, {sessionId:'child',cursor:{epoch:'e',seq:'0'}}, {sessionId:'child',cursor:{epoch:'e',seq:-1}}]) {
    assert.equal((await route.fetch(request({type:'client-request',rpcId:'bad',method:'dshOffice/snapshot',payload}))).status,400);
  }
  const response = await route.fetch(request({ type: 'client-request', rpcId: '1', method: 'dshOffice/snapshot', payload: { sessionId: 'child' } }));
  const body = await response.json(); assert.equal(body.result.value.leadId, 'root');
  assert.equal(body.rpcId, '1'); assert.equal(body.type, 'server-response');
  await ctx.fiber.dispose(); assert.equal(disposed, true);
});
test('disposing an in-flight poll aborts the request and discards its late response', async () => {
  let resolve!: (value: object) => void, signal: AbortSignal | undefined, updates = 0;
  const stop = pollSnapshot<object>(s => { signal = s; return new Promise(r => { resolve = r; }); }, () => updates++, () => updates++);
  stop(); resolve({}); await new Promise(r => setImmediate(r));
  assert.ok(signal); assert.equal(signal.aborted, true); assert.equal(updates, 0);
});
