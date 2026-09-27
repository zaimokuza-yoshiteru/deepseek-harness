import { Context } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
import type { Session, SessionId } from '@deepseek-ai/dsh-session';
import type { HostContext } from '../../src/host/context.ts';
import type { TeamId, TeamTaskId, TeamMemberView, TeamTaskView } from '@deepseek-ai/dsh-experimental-agent-team/types';
import { stub, member, task } from './fixtures.ts';
export const sessionId = (id: string) => id as SessionId;
export function agent(id: string): Agent { return stub<Agent>({id: sessionId(id), session: stub<Session>({ id: sessionId(id) })}); }
export function hostFixture(leadId = 'root', childId = 'child') {
  const ctx: HostContext = new Context(), root = agent(leadId), child = agent(childId);
  const members: TeamMemberView[] = [
    {...member(leadId, { role:'lead' }), id:root.id, status:'running'},
    {...member(childId, {diagnostics:['closed']}), id:child.id, status:'inactive'},
  ];
  const tasks: TeamTaskView[] = [{...task(), id:'task' as TeamTaskId, blockedBy:[]}];
  const agents = new Map([[root.id,root],[child.id,child]]);
  ctx.provide('agents', stub<HostContext['agents']>({get:id=>agents.get(id)}));
  ctx.provide('agentTeams', stub<HostContext['agentTeams']>({
    tryMembership: value => ({root, id:root.id as string as TeamId, role:value===root?'lead':'teammate', name:value===root?'lead':'builder'}),
    listMembers: () => members,
    listTasks: () => tasks,
  }));
  ctx.provide('sessions', stub<HostContext['sessions']>({flush:async()=>true}));
  ctx.provide('sessionProjections', stub<HostContext['sessionProjections']>({stateOf:()=>undefined}));
  return {ctx,root,child,agents};
}
