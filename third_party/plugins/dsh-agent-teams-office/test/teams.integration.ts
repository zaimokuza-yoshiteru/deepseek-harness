import type { Context as HostContext } from '@deepseek-ai/cordis';
import type { LlmAdapter, StreamChunk } from '@deepseek-ai/dsh-llm';
import type SessionQueryEngine from '@deepseek-ai/dsh-session-query';
import type { SessionId } from '@deepseek-ai/dsh-session/types';
/** Real DSH services, deterministic local model, no credentials or network. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createActivityFeed } from '../src/host/activity-feed.ts';
import { createActivityInbox } from '../src/client/activities.ts';
import { readOfficeSnapshot } from '../src/host/snapshot.ts';
const repo = process.env.DSH_DESKTOP_REPO;
assert.ok(repo,'DSH_DESKTOP_REPO is required');
const require = createRequire(join(repo, 'node_modules/.pnpm/node_modules/package.json'));
const hostVersion: string = JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8')).version;
interface HostModules {
  '@deepseek-ai/cordis': typeof import('@deepseek-ai/cordis');
  '@deepseek-ai/dsh-agent-loop-testkit': typeof import('@deepseek-ai/dsh-agent-loop-testkit');
  '@deepseek-ai/dsh-agent-loop': typeof import('@deepseek-ai/dsh-agent-loop');
  '@deepseek-ai/dsh-session-persistence-jsonl': typeof import('@deepseek-ai/dsh-session-persistence-jsonl');
  '@deepseek-ai/dsh-subagent': typeof import('@deepseek-ai/dsh-subagent');
  '@deepseek-ai/dsh-subagent-spawn-in-process': typeof import('@deepseek-ai/dsh-subagent-spawn-in-process');
  '@deepseek-ai/dsh-experimental-agent-team': typeof import('@deepseek-ai/dsh-experimental-agent-team');
}
// Runtime code comes from the selected host; its public contract is checked against the SDK.
const load = <K extends keyof HostModules>(name: K): Promise<HostModules[K]> => import(pathToFileURL(require.resolve(name)).href);
const { Context } = await load('@deepseek-ai/cordis');
const { mountAgentLoopTestDependencies } = await load('@deepseek-ai/dsh-agent-loop-testkit');
const { default: AgentLoop } = await load('@deepseek-ai/dsh-agent-loop');
const { default: Persistence } = await load('@deepseek-ai/dsh-session-persistence-jsonl');
const { default: Subagents } = await load('@deepseek-ai/dsh-subagent');
const Spawn = await load('@deepseek-ai/dsh-subagent-spawn-in-process');
const { default: Teams } = await load('@deepseek-ai/dsh-experimental-agent-team');
const { MockAdapter }: {MockAdapter:new(script:('hang'|StreamChunk[])[])=>LlmAdapter} = await import(pathToFileURL(join(repo, 'packages/core/agent-loop/tests/mock-adapter.ts')).href);
const { TestSessionQuery }: {TestSessionQuery:new(ctx:HostContext)=>SessionQueryEngine} = await import(pathToFileURL(join(repo, 'packages/experimental/agent-team/tests/test-session-query.ts')).href);
const storage = mkdtempSync(join(tmpdir(), 'dsh-agent-teams-office-teams-'));
const ctx = new Context();
try {
  await mountAgentLoopTestDependencies(ctx);
  await ctx.plugin(Persistence, { root: storage });
  await ctx.plugin(TestSessionQuery);
  await ctx.plugin(AgentLoop, { agents: [] });
  await ctx.plugin(Subagents);
  await ctx.plugin(Spawn, { providerName: 'spawn' });
  await ctx.plugin(Teams);
  ctx.llm.registerAdapter(['office-test'], new MockAdapter(['hang']));
  const lead = await ctx.agentLoop.create('office-test-lead' as SessionId, { provider: 'office-test', model: 'fixture' });
  const feed = createActivityFeed(ctx), inbox = createActivityInbox();
  const initial = {...readOfficeSnapshot(ctx, lead.id), ...await feed.read(lead, null)}; inbox.accept(initial);
  const task = await ctx.agentTeams.createTask(lead, { subject: 'Verify office state', description: 'Local integration fixture' });
  const { member } = await ctx.agentTeams.spawnTeammate(lead, {
    name: 'builder', description: 'Test the live office', context: 'fresh', provider: 'spawn',
    prompt: [{ type: 'text', text: 'Hold until cancelled by the test' }], signal: new AbortController().signal,
  });
  const worker = ctx.agents.get(member.id);
  assert.ok(worker);
  let running;
  for (let i = 0; i < 100; i++) {
    running = readOfficeSnapshot(ctx, worker.id);
    if (running.members.find(row => row.id === worker.id)?.status === 'running') break;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  assert.ok(running);
  assert.equal(running.leadId, lead.id);
  assert.equal(running.members.length, 2);
  assert.equal(running.members.find(row => row.id === worker.id)?.status, 'running');
  assert.equal(running.tasks[0].id, task.id);
  const claimed = await ctx.agentTeams.updateTask(worker, { taskId:task.id, expectedRevision:task.revision, action:'claim' });
  await ctx.agentTeams.sendMessage(worker, {target:'lead', content:[{type:'text',text:'integration message'}], signal:new AbortController().signal});
  await ctx.agentTeams.updateTask(worker, {taskId:task.id,expectedRevision:claimed.revision,action:'complete'});
  const activity = {...readOfficeSnapshot(ctx, lead.id), ...await feed.read(lead, initial.cursor)};
  const animations = inbox.accept(activity);
  assert.ok(animations.some(e=>e.kind==='handoff'&&e.actor===worker.id));
  assert.ok(animations.some(e=>e.kind==='message'&&e.actor===worker.id&&e.target===lead.id));
  assert.ok(animations.some(e=>e.kind==='archive'&&e.celebrate));
  assert.deepEqual(inbox.accept(activity),[]);
  worker.cancel({ kind: 'parent' });
  await worker.whenIdle();
  const idle = readOfficeSnapshot(ctx, lead.id);
  const restStatus = hostVersion.startsWith('0.1.6') ? 'idle' : 'inactive';
  assert.equal(idle.members.find(row => row.id === worker.id)?.status, restStatus);
  feed.dispose();
  console.log('PASS: committed message, task claim, completion and replay prevention.');
  console.log(`PASS: DSH ${hostVersion} Teams lead/member mapping, shared task, running → ${restStatus}; zero external model calls.`);
} finally {
  await ctx.fiber.dispose();
  rmSync(storage, { recursive: true, force: true });
}
