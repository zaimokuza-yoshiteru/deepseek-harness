import type { TeamMemberView } from '@deepseek-ai/dsh-experimental-agent-team/client';
import type { OfficeMember, SeatMember } from './types.ts';
/** Preserve the host's status; both legacy idle and current inactive may rest. */
export function officeMembers(members: readonly TeamMemberView[]): OfficeMember[] {
  return members.map(member => ({
    id: member.id, name: member.name, role: member.role, status: member.status,
    description: member.description ?? '', model: member.model ?? '',
    provider: member.provider ?? '', diagnostics: [...member.diagnostics],
  }));
}

/** Resolve a Team parent from catalog metadata without retaining another session. */
export function officeSessionId(sessions: { subagentAddress(id: string): { parentSessionId: string } | undefined }, sessionId: string | null) {
  if (!sessionId) return null;
  return sessions.subagentAddress(sessionId)?.parentSessionId ?? sessionId;
}

/** Reserve seat zero for Lead and keep IDs stable across roster reordering. */
export function reconcileSeats(previous: ReadonlyMap<string, number>, members: readonly SeatMember[], capacity = 17) {
  const byId = new Map(members.map(member => [member.id, member]));
  const next = new Map<string, number>(), occupied = new Set<number>();
  for (const [id, seat] of previous) {
    const member = byId.get(id);
    if (!member || occupied.has(seat) || seat < 0 || seat >= capacity || (member.role === 'lead') !== (seat === 0)) continue;
    next.set(id, seat); occupied.add(seat);
  }
  for (const member of members) {
    if (next.has(member.id)) continue;
    const seat = member.role === 'lead' ? (occupied.has(0) ? -1 : 0)
      : Array.from({ length: capacity - 1 }, (_, i) => i + 1).find(value => !occupied.has(value));
    if (seat === undefined || seat < 0) continue;
    next.set(member.id, seat); occupied.add(seat);
  }
  return next;
}
