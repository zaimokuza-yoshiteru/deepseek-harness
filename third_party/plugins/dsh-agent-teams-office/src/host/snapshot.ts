import type { HostContext } from './context.ts';
import type { OfficeSnapshot } from '../types.ts';
import type { SessionId } from '@deepseek-ai/dsh-session/types';
import { officeMembers } from '../shared.ts';

/** Read a live Team using the same service as the native Team panel. No writes. */
export function readOfficeSnapshot(ctx: HostContext, sessionId: string | null): OfficeSnapshot {
  const teams = ctx.get('agentTeams');
  if (!teams) return { state: 'disabled', members: [], tasks: [], leadId: null };
  if (!sessionId) return { state: 'unselected', members: [], tasks: [], leadId: null };
  const agent = ctx.agents.get(sessionId as SessionId);
  const membership = agent && teams.tryMembership(agent);
  if (!membership) return { state: 'inactive', members: [], tasks: [], leadId: null };
  const members = teams.listMembers(membership.root);
  const tasks = teams.listTasks(membership.root);
  return { state: 'live', leadId: membership.root.id,
    members: officeMembers(members), tasks: tasks.map(task => ({ ...task, ownerId: members.find(m => m.name === task.ownerName)?.id ?? null })), sampledAt: Date.now() };
}
