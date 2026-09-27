import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import type { TeamId, TeamTaskId } from '@deepseek-ai/dsh-experimental-agent-team/types';
import type { SessionSeq } from '@deepseek-ai/dsh-session/types';
import { createActivityFeed } from '../src/host/activity-feed.ts';
import { hostFixture, agent } from './helpers/host.ts';

function fixture(t: TestContext, options: Parameters<typeof createActivityFeed>[1] = {}) {
  const { ctx } = hostFixture();
  const feed = createActivityFeed(ctx, options);
  const [a, b, c] = ['a', 'b', 'c'].map(agent);
  t.after(async () => { feed.dispose(); await ctx.fiber.dispose(); });
  function task(root = a, revision = 1) {
    ctx.emit('session/event', root.session, {
      seq: revision as SessionSeq, time: Date.now(), type: 'team/task',
      data: { version: 2, teamId: root.id as string as TeamId, task: {
        id: 'task' as TeamTaskId, revision, status: 'pending', subject: 'Task',
        description: '', blockedBy: [], writeScopes: [],
      } },
    });
  }
  return { ctx, feed, a, b, c, task };
}

test('capacity evicts the least recently read team, even when timestamps tie', async t => {
  t.mock.method(Date, 'now', () => 1000);
  const { feed, a, b, c, task } = fixture(t, { maxTeams: 2 });
  const first = await feed.read(a);
  const older = await feed.read(b);
  await feed.read(a, first.cursor);
  task();
  await feed.read(c);
  const result = await feed.read(a, first.cursor);
  assert.equal(result.reset, false);
  assert.equal(result.activities.length, 1);
  assert.equal((await feed.read(b, older.cursor)).reset, true);
});

test('a newly inserted team counts toward capacity immediately', async t => {
  const { feed, a, b, c } = fixture(t, { maxTeams: 2 });
  const first = await feed.read(a);
  await feed.read(b);
  await feed.read(c);
  // A would survive here if trimming only happened before C was inserted.
  assert.equal((await feed.read(a, first.cursor)).reset, true);
});

test('expired records are removed before live records compete for capacity', async t => {
  let now = 1000;
  t.mock.method(Date, 'now', () => now);
  const { feed, a, b, c, task } = fixture(t, { maxTeams: 2, ttl: 10 });
  const first = await feed.read(a);
  now = 1001;
  const old = await feed.read(b);
  now = 1009;
  await feed.read(a);
  now = 1012;
  task();
  await feed.read(c);
  const result = await feed.read(a, first.cursor);
  assert.equal(result.reset, false);
  assert.equal(result.activities.length, 1);
  assert.equal((await feed.read(b, old.cursor)).reset, true);
});

test('concurrent checkpoints survive TTL and capacity pressure; completion restores the bound', async t => {
  let now = 1000;
  t.mock.method(Date, 'now', () => now);
  const { ctx, feed, a, b, c, task } = fixture(t, { maxTeams: 2, ttl: 10 });
  const first = await feed.read(a);
  const second = await feed.read(b);
  task();
  task(b);
  const checkpoints: ((value: boolean) => void)[] = [];
  ctx.sessions.flush = () => new Promise<boolean>(resolve => checkpoints.push(resolve));
  const readingA = feed.read(a, first.cursor);
  const duplicateA = feed.read(a, first.cursor);
  const readingB = feed.read(b, second.cursor);
  now = 1020;
  const third = await feed.read(c);
  checkpoints[0](true);
  assert.equal((await readingA).activities.length, 1);
  // A remains pinned by its second reader after the first reader finishes.
  checkpoints[1](true);
  const duplicate = await duplicateA;
  assert.equal(duplicate.cursor.seq, 1);
  assert.equal(duplicate.activities.length, 1);
  // Completed A can now expire; B is still protected despite its age.
  assert.equal((await feed.read(c, third.cursor)).reset, true);
  checkpoints[2](true);
  assert.equal((await readingB).activities.length, 1);
  assert.equal((await feed.read(a, first.cursor)).reset, true);
});

test('a checkpoint publishes only its captured prefix and retries after failure', async t => {
  const { ctx, feed, a, task } = fixture(t);
  const first = await feed.read(a);
  task(a, 1);
  let finish!: (value: boolean) => void;
  ctx.sessions.flush = () => new Promise<boolean>(resolve => { finish = resolve; });
  const reading = feed.read(a, first.cursor);
  task(a, 2);
  finish(true);
  const result = await reading;
  assert.deepEqual(result.activities.map(e => e.kind === 'task' && e.revision), [1]);
  ctx.sessions.flush = async () => false;
  await assert.rejects(feed.read(a, result.cursor));
  ctx.sessions.flush = async () => { throw new Error('disk failure'); };
  await assert.rejects(feed.read(a, result.cursor), /disk failure/);
  ctx.sessions.flush = async () => true;
  const next = await feed.read(a, result.cursor);
  assert.deepEqual(next.activities.map(e => e.kind === 'task' && e.revision), [2]);
  assert.equal('sourceSeq' in next.activities[0], false);
});

for (const scope of ['session', 'feed'] as const) {
  test(`${scope} disposal invalidates an in-flight checkpoint`, async t => {
    const { ctx, feed, a, task } = fixture(t);
    const first = await feed.read(a);
    task();
    let finish!: (value: boolean) => void;
    ctx.sessions.flush = () => new Promise<boolean>(resolve => { finish = resolve; });
    const reading = feed.read(a, first.cursor);
    if (scope === 'session') ctx.emit('session/disposed', a.session);
    else feed.dispose();
    const replacement = await feed.read(a);
    finish(true);
    await assert.rejects(reading, /Team session closed/);
    const result = await feed.read(a, replacement.cursor);
    assert.equal(result.reset, false);
    assert.deepEqual(result.activities, []);
  });
}

test('a failed checkpoint releases its pin so another team can evict it', async t => {
  const { ctx, feed, a, b, task } = fixture(t, { maxTeams: 1 });
  const first = await feed.read(a);
  task();
  let fail!: (reason: Error) => void;
  ctx.sessions.flush = () => new Promise<boolean>((_, reject) => { fail = reject; });
  const reading = feed.read(a, first.cursor);
  await feed.read(b);
  fail(new Error('disk failure'));
  await assert.rejects(reading, /disk failure/);
  await feed.read(b);
  assert.equal((await feed.read(a, first.cursor)).reset, true);
});
