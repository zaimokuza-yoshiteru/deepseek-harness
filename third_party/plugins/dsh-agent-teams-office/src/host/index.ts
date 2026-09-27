import type { HostContext } from './context.ts';
import type { SessionId } from '@deepseek-ai/dsh-session/types';
import { asError, type OfficeSnapshot } from '../types.ts';
import { isSnapshotRequest } from './request.ts';
import { createActivityFeed } from './activity-feed.ts';
import { readOfficeSnapshot } from './snapshot.ts';

export const name = 'dsh-agent-teams-office';
export const inject = ['connection', 'agents', 'sessions', 'sessionProjections'];

/** Use the native Connection carrier, shared by Desktop and Web. */
export function apply(ctx: HostContext) {
  const feed = createActivityFeed(ctx);
  ctx.effect(() => () => feed.dispose(), 'dsh-agent-teams-office: activity feed');
  ctx.effect(() => ctx.connection.fetch.register({
    path: '/api/dshOffice/snapshot', methods: ['POST'], requestBody: 'buffered',
    async fetch(request) {
      let envelope: unknown;
      try { envelope = await request.json(); }
      catch { return Response.json({ error: 'Invalid JSON' }, { status: 400 }); }
      if (!isSnapshotRequest(envelope)) {
        return Response.json({ error: 'Invalid office request' }, { status: 400 });
      }
      let result: { ok: true; value: OfficeSnapshot } | { ok: false; error: { code: string; message: string; details: Record<string, never> } };
      try {
        const value = readOfficeSnapshot(ctx, envelope.payload.sessionId);
        if (value.state === 'live') {
          const root = ctx.agents.get(value.leadId as SessionId);
          if (!root) throw new Error('Team session is no longer live');
          Object.assign(value, await feed.read(root, envelope.payload.cursor));
        }
        result = { ok: true, value };
      }
      catch (error) { result = { ok: false, error: { code: 'office-unavailable', message: asError(error).message, details: {} } }; }
      return Response.json({ type: 'server-response', rpcId: envelope.rpcId, result },
        { headers: { 'cache-control': 'no-store' } });
    },
  }), 'dsh-agent-teams-office: read-only snapshot');
}
