import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createActivityInbox, createActivityDirector, choreography, AMBIENT_ACTIVITIES } from '../src/client/activities.ts';
import { createActivityFeed } from '../src/host/activity-feed.ts';
import { homePoint, officePath, sitePoint, isOfficeWalkable } from '../src/client/team-office/navigation.ts';

import type { SessionEvent, SessionEventMap, SessionEventType, SessionSeq } from '@deepseek-ai/dsh-session/types';
import type { TeamId, TeamMessageId, TeamTaskId } from '@deepseek-ai/dsh-experimental-agent-team/types';
import type { ToolCallId, MessageId } from '@deepseek-ai/dsh-llm';
import { createToolResultMessage } from '@deepseek-ai/dsh-llm';
import type { ActivityAdapter, ActivityFact, OfficeActivity } from '../src/types.ts';
import { hostFixture, agent, sessionId } from './helpers/host.ts';
import { member, task, snapshot, emptySnapshot } from './helpers/fixtures.ts';
const contexts: ReturnType<typeof hostFixture>['ctx'][] = [];
after(async () => { for (const ctx of contexts) await ctx.fiber.dispose(); });
const teamId = 'lead' as TeamId, messageId = 'm' as TeamMessageId;
function fixture(options: Parameters<typeof createActivityFeed>[1] = {}) {
  const {ctx,root} = hostFixture('lead', 'worker'); contexts.push(ctx);
  const feed=createActivityFeed(ctx,options);let source=0;
  function event<K extends SessionEventType>(type: K, data: SessionEventMap[K]) {
    // The generic key and its payload form one correlated SessionEvent variant.
    const value = {seq:++source as SessionSeq,time:Date.now(),type,data} as SessionEvent;
    ctx.emit('session/event',root.session,value);
  }
  return{ctx,feed,root,event};
}
function result(call: string, legacy: boolean, isError = false): SessionEventMap['tool/result'] {
  const callId = call as ToolCallId;
  if (!legacy) return {turn:0,step:0,message:createToolResultMessage({callId,content:[],isError})};
  // Replay the released 0.1.6 wire format at the boundary to the newer SDK.
  return {turn:0,step:0,message:{id:call as MessageId,role:'user',source:{kind:'tool',callId},content:[{type:'tool-result',toolCallId:callId,content:[],isError}]}} as unknown as SessionEventMap['tool/result'];
}
test('first read is a baseline; delivered messages publish once after a successful checkpoint',async()=>{
  const f=fixture(),first=await f.feed.read(f.root,null);
  f.event('team/message/queued',{version:2,teamId,message:{id:messageId,senderId:sessionId('lead'),senderName:'Lead',targetId:sessionId('worker'),content:[{type:'text',text:'private body'}]}});
  let read=await f.feed.read(f.root,first.cursor);assert.deepEqual(read.activities,[]);
  f.event('team/message/delivered',{version:2,teamId,messageId,targetId:sessionId('worker')});
  f.ctx.sessions.flush=async()=>{throw Error('disk');};await assert.rejects(f.feed.read(f.root,read.cursor),/disk/);
  f.ctx.sessions.flush=async()=>true;
  const [a,b]=await Promise.all([f.feed.read(f.root,read.cursor),f.feed.read(f.root,read.cursor)]);
  assert.equal(a.activities.length,1);assert.equal(b.activities.length,1);assert.equal(a.cursor.seq,1);
  assert.equal(a.activities[0].kind,'message');assert.equal(a.activities[0].actor,'lead');assert.ok(!JSON.stringify(a).includes('private body'));
  assert.deepEqual((await f.feed.read(f.root,a.cursor)).activities,[]);
  f.feed.dispose();
  const baseline=await f.feed.read(f.root,null);
  f.event('tool/call',{turn:0,step:0,callId:'late' as ToolCallId,name:'late',arguments:'{}'});
  assert.deepEqual((await f.feed.read(f.root,baseline.cursor)).tools,{});f.feed.dispose();
});
test('overflow, stale cursors and replacement sessions establish new baselines',async()=>{
  const f=fixture({capacity:2});const first=await f.feed.read(f.root,null);
  for(let revision=1;revision<=4;revision++)f.event('team/task',{version:2,teamId,task:{id:'t' as TeamTaskId,revision,status:'pending',subject:'Task',description:'',blockedBy:[],writeScopes:[]}});
  const reset=await f.feed.read(f.root,first.cursor);assert.equal(reset.reset,true);assert.equal(reset.activities.length,0);
  const restored=await f.feed.read(agent('lead'),reset.cursor);assert.equal(restored.reset,true);
  f.feed.dispose();
});
test('inbox maps ownership, message delivery and completion without replay on view changes',()=>{
  const box=createActivityInbox();const base=snapshot({cursor:{epoch:'e',seq:0},reset:true});
  assert.deepEqual(box.accept(base),[]);
  const activities: ActivityFact[]=[{at:0,owner:null,kind:'task',taskId:'t',revision:1,status:'pending',seq:1}, {at:0,kind:'task',taskId:'t',revision:2,status:'in_progress',owner:'w',seq:2}, {at:0,kind:'task',taskId:'t',revision:3,status:'completed',owner:'w',seq:3},{at:0,messageId:'m',kind:'message',actor:'w',target:'lead',seq:4}];
  const next={...base,reset:false,cursor:{epoch:'e',seq:4},activities,tasks:[task({id:'t',status:'completed',ownerId:'w'})]};
  const events=box.accept(next);assert.deepEqual(events.map(e=>e.kind),['pin','handoff','archive','message']);assert.equal(events[2].celebrate,true);
  assert.deepEqual(box.accept(next),[]);assert.deepEqual(box.accept({...next,reset:true,cursor:{epoch:'new',seq:4}}),[]);
});
test('all 17 desks can reach all amenities and the Lead visitor point without crossing furniture',()=>{
  for(let index=0;index<17;index++)for(const kind of [...AMBIENT_ACTIVITIES,'sink','pin','archive','visitor']){
    const target=sitePoint(kind,index);assert.ok(target);const path=officePath(homePoint(index),target);assert.ok(path,`${index}/${kind}`);
    for(let i=0;i<path.length;i++){
      const a=path[i-1]??path[i],b=path[i],n=Math.ceil(Math.hypot(b.x-a.x,b.z-a.z)/.05);
      for(let j=0;j<=n;j++){const t=n?j/n:0;assert.ok(isOfficeWalkable(a.x+(b.x-a.x)*t,a.z+(b.z-a.z)*t),`${index}/${kind}: crosses obstruction`);}
    }
    if(index===0)assert.ok(path.every(p=>p.x < -5.5 && p.z < -1.15),'Lead stays in its private room');
  }
});
const roster=[member('lead',{role:'lead'}),member('a'),member('b')];
interface TestPoint { site?: string; id?: string; kind?: string }
type Call = ['hold'|'release',string] | ['walk',string,TestPoint|null|undefined] | ['action'|'envelope',string,string];
function renderer(): ActivityAdapter<TestPoint> & {calls:Call[]} {
  const calls:Call[]=[];
  return{calls,plan:e=>choreography(e,{leadId:'lead',home:id=>({id,site:id}),site:(kind,id)=>({kind,id,site:kind}),meet:()=>({site:'lead-door'})}),hold:id=>{calls.push(['hold',id]);},walk:(id,to)=>{calls.push(['walk',id,to]);return true;},arrived:()=>true,action:(id,k)=>{calls.push(['action',id,k]);},release:id=>{calls.push(['release',id]);},envelope:(a,b)=>{calls.push(['envelope',a,b]);}};
}
test('visitors serialize, reciprocal messages alternate, and removed members release every actor',()=>{
  const r=renderer(),d=createActivityDirector(r,{ambientDelay:1000});d.update(roster);
  const event=(id:string,actor:string,target:string):OfficeActivity=>({id,kind:'message',actor,target,at:Date.now()});
  d.enqueue([event('1','a','lead'),event('2','lead','a'),event('3','b','lead')]);d.tick(.05);
  assert.equal(d.inspect().active.length,1);assert.equal(d.inspect().queued,1);
  for(let i=0;i<130;i++)d.tick(.05);
  assert.ok(r.calls.some(c=>c[0]==='action'&&c[1]==='lead'&&c[2]==='talk'));
  d.update(roster.slice(0,1));assert.equal(d.inspect().active.length,0);d.dispose();
});
test('every ambient action runs its choreography and new work cancels it',()=>{
  for(const kind of AMBIENT_ACTIVITIES){const plan=choreography({kind,actor:'a',ambient:true},{home:()=>({}),site:()=>({site:kind}),meet:()=>null});assert.ok(plan);assert.ok(plan.phases.some(p=>p.actions?.length));assert.ok(plan.phases.some(p=>p.walk?.length));}
  const r=renderer(),d=createActivityDirector(r,{ambientDelay:0});d.update(roster);d.tick(.05);assert.equal(d.inspect().active.length,1);
  d.update(roster.map(m=>({...m,status:'running'})));assert.equal(d.inspect().active.length,0);assert.ok(r.calls.some(c=>c[0]==='release'));d.dispose();
});

import { createOfficeAvailability } from '../src/client/availability.ts';
test('office entry only exists after Teams is enabled and unregisters when disabled',()=>{
  let entries=0,cleared=0;const gate=createOfficeAvailability(()=>{entries++;return()=>entries--;},()=>cleared++);
  assert.equal(entries,0);gate.update(emptySnapshot('disabled'));assert.equal(entries,0);
  gate.update(emptySnapshot('unselected'));gate.update(snapshot());assert.equal(entries,1);
  gate.update(emptySnapshot('disabled'));assert.equal(entries,0);assert.equal(cleared,1);
  gate.update(emptySnapshot('inactive'));assert.equal(entries,1);gate.dispose();assert.equal(entries,0);
});

test('a reply during an ongoing visit adds the actual speaker without scheduling a second visit',()=>{
  const r=renderer(),d=createActivityDirector(r,{ambientDelay:1000});d.update(roster);
  d.enqueue([{id:'send',kind:'message',actor:'lead',target:'a',at:Date.now()}]);d.tick(.05);
  d.enqueue([{id:'reply',kind:'message',actor:'a',target:'lead',at:Date.now()}]);
  assert.equal(d.inspect().queued,0);
  for(let i=0;i<180;i++)d.tick(.05);
  assert.deepEqual(r.calls.filter(c=>c[0]==='action'&&c[2]==='talk').map(c=>c[1]),['lead','a']);
  d.dispose();
});
test('unreachable routes release actors without performing a fake interaction',()=>{
  const r=renderer();r.walk=()=>false;const d=createActivityDirector(r,{ambientDelay:1000});d.update(roster);
  d.enqueue([{id:'blocked',kind:'message',actor:'a',target:'lead',at:Date.now()}]);d.tick(.05);d.tick(.05);
  assert.equal(d.inspect().active.length,0);assert.ok(!r.calls.some(c=>c[0]==='action'));d.dispose();
});
for (const legacy of [false, true]) test(`${legacy ? '0.1.6' : 'current SDK'} parallel tool results clear only their own call, including empty/error results`,async()=>{
  const f=fixture();
  const initial=await f.feed.read(f.root,null);
  f.event('tool/call',{turn:0,step:0,callId:'a' as ToolCallId,name:'read_file',arguments:'secret'});
  f.event('tool/call',{turn:0,step:0,callId:'b' as ToolCallId,name:'search',arguments:'secret'});
  f.event('tool/result',result('a',legacy));
  let next=await f.feed.read(f.root,initial.cursor);assert.equal(next.tools.lead.name,'search');assert.ok(!JSON.stringify(next).includes('secret'));
  f.event('tool/result',result('b',legacy,true));
  next=await f.feed.read(f.root,next.cursor);assert.deepEqual(next.tools,{});f.feed.dispose();
});
