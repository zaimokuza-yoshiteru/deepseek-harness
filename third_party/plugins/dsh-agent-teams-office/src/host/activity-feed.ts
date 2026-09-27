import type { HostContext } from './context.ts';
import type { Session } from '@deepseek-ai/dsh-session';
import type { SessionEvent } from '@deepseek-ai/dsh-session/types';
import type { Agent } from '@deepseek-ai/dsh-agent';
import type { Cursor, TaskFact, MessageFact, ActivityFact, ActivityBatch } from '../types.ts';
type PendingFact = TaskFact | { kind: 'queued'; messageId: string; actor: string; target: string } | { kind: 'delivered'; messageId: string; target: string };
type PendingEvent = PendingFact & { at: number };
interface FeedRecord { touched: number; readers: number; epoch: string; seq: number; events: ActivityFact[]; pending: PendingEvent[]; messages: Map<string, { actor: string; target: string }>; tools: Map<string, Map<string, { name: string }>> }
import { randomUUID } from 'node:crypto';

/** Bounded, live-only events. A snapshot checkpoint must succeed before publication. */
export function createActivityFeed(ctx: HostContext, { capacity = 512, maxTeams = 64, ttl = 600000 } = {}) {
  const records = new Map<Session, FeedRecord>();
  function expire() {
    const now = Date.now();
    for (const [session, r] of records) {
      if (r.readers === 0 && now - r.touched > ttl) records.delete(session);
    }
  }
  function trim() {
    // Map order tracks reads. In-flight checkpoints may temporarily exceed the
    // limit; their finally blocks restore it as soon as records are unpinned.
    for (const [session, r] of records) {
      if (records.size <= maxTeams) break;
      if (r.readers === 0) records.delete(session);
    }
  }
  function reset(r: FeedRecord) { r.epoch = randomUUID(); r.seq = 0; r.events = []; r.pending = []; }
  function observe(session: Session, event: SessionEvent) {
    let r = records.get(session);
    if (event.type === 'tool/call' || event.type === 'tool/result') {
      const agent = ctx.agents.get(session.id), teams = ctx.get('agentTeams');
      const root = agent && teams?.tryMembership(agent)?.root;
      r = root && records.get(root.session); if (!r) return;
      const calls = r.tools.get(session.id) ?? new Map<string, { name: string }>();
      if (event.type === 'tool/call') calls.set(event.data.callId, {name:event.data.name.slice(0,80)});
      // The source correlates tool results in both DSH 0.1.6 and Session V4.
      else calls.delete(event.data.message.source.callId);
      while(calls.size > 32) calls.delete(calls.keys().next().value!);
      if(calls.size)r.tools.set(session.id,calls);else r.tools.delete(session.id);
      return;
    }
    if (!r) return;
    if (event.type !== 'team/message/queued' && event.type !== 'team/message/delivered' && event.type !== 'team/task') return;
    if (String(event.data.teamId) !== session.id) return;
    let item: PendingFact | undefined;
    if (event.type === 'team/message/queued') {
      const m = event.data.message; item = { kind: 'queued', messageId: m.id, actor: m.senderId, target: m.targetId };
    } else if (event.type === 'team/message/delivered') item = { kind: 'delivered', messageId: event.data.messageId, target: event.data.targetId };
    else if (event.type === 'team/task') {
      const t = event.data.task; item = { kind: 'task', taskId: t.id, revision: t.revision, owner: t.ownerId ?? null, status: t.status };
    }
    if (!item) return;
    if (r.pending.length >= capacity) reset(r);
    r.pending.push({ ...item, at: Date.now() });
  }
  const offEvent = ctx.on('session/event', observe);
  const offDisposed = ctx.on('session/disposed', session => { records.delete(session); for(const r of records.values())r.tools.delete(session.id); });
  return {
    async read(root: Agent, cursor?: Cursor | null): Promise<ActivityBatch> {
      expire();
      let r = records.get(root.session);
      if (!r) {
        r = { touched: Date.now(), readers: 0, tools: new Map(), messages: new Map(), epoch: randomUUID(), seq: 0, events: [], pending: [] }; records.set(root.session, r);
        // Projection supplies the baseline only; no historical animations are emitted.
        const state = ctx.sessionProjections.stateOf(root.session, 'agentTeam');
        r.messages = new Map((state?.messages ?? []).map(m => [m.id, { actor: m.senderId, target: m.targetId }]));
        for (const id of state?.delivered ?? []) r.messages.delete(id);
        while (r.messages.size > capacity) r.messages.delete(r.messages.keys().next().value!);
      }
      r.touched = Date.now();
      records.delete(root.session);
      records.set(root.session, r);
      r.readers++;
      trim();
      try {
        // Capture this prefix before awaiting durability. Later appends wait for a later checkpoint.
        const prefix = r.pending.slice(), epoch = r.epoch;
        if (prefix.length && await ctx.sessions.flush(root.session) === false) throw new Error('Team session is no longer live');
        if (records.get(root.session) !== r) throw new Error('Team session closed');
        if (epoch === r.epoch) {
          for (const event of prefix) {
            if (!r.pending.includes(event)) continue; // concurrent readers share one publication
            r.pending.splice(r.pending.indexOf(event), 1);
            if (event.kind === 'queued') {
              r.messages.set(event.messageId, { actor: event.actor, target: event.target });
              while (r.messages.size > capacity) r.messages.delete(r.messages.keys().next().value!);
              continue;
            }
            let activity: ((TaskFact | MessageFact) & { at: number }) | undefined;
            if (event.kind === 'delivered') {
              const message = r.messages.get(event.messageId); r.messages.delete(event.messageId);
              if (message) activity = { ...event, ...message, kind: 'message' };
            } else activity = event;
            if (activity) {
              r.events.push({ ...activity, seq: ++r.seq });
              if (r.events.length > capacity) r.events.shift();
            }
          }
        }
        const valid = cursor && cursor.epoch === r.epoch && cursor.seq <= r.seq && cursor.seq >= (r.events[0]?.seq ?? r.seq + 1) - 1;
        return { tools: Object.fromEntries([...r.tools].map(([id,calls])=>[id,[...calls.values()].at(-1)!])), cursor: { epoch: r.epoch, seq: r.seq }, reset: !valid, activities: valid ? r.events.filter(e => e.seq > cursor.seq) : [] };
      } finally {
        r.readers--;
        trim();
      }
    },
    dispose() { offEvent(); offDisposed(); records.clear(); },
  };
}
