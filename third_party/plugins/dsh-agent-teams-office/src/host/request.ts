import type { Cursor } from '../types.ts';
export interface SnapshotRequest {
  type: 'client-request';
  rpcId: string;
  method: 'dshOffice/snapshot';
  payload: { sessionId: string | null; cursor?: Cursor | null };
}
function record(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
/** JSON is untrusted even when its consumer is written in TypeScript. */
export function isSnapshotRequest(value: unknown): value is SnapshotRequest {
  if (!record(value) || value.type !== 'client-request' || typeof value.rpcId !== 'string' || value.method !== 'dshOffice/snapshot' || !record(value.payload)) return false;
  const { sessionId, cursor } = value.payload;
  return (sessionId === null || (typeof sessionId === 'string' && sessionId.length <= 256))
    && (cursor == null || (record(cursor) && typeof cursor.epoch === 'string' && cursor.epoch.length <= 128
      && typeof cursor.seq === 'number' && Number.isSafeInteger(cursor.seq) && cursor.seq >= 0));
}
