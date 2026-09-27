import type { Cursor, TaskFact, OfficeSnapshot, OfficeActivity, OfficeMember, AmbientKind, ActionKind, ActivityAdapter, ActivityPlan, Phase, PlanEvent, Site } from '../types.ts';
interface Job<P> extends ActivityPlan<P> { event?: OfficeActivity; ids: string[]; phase: number; started: boolean; elapsed: number; phaseTime: number; ambient: boolean }
interface ChoreographySites<P> { home(id: string): P | undefined; site(kind: string, id: string): Site<P> | null; meet(visitor: string, host: string, lead: boolean): P | null | undefined; leadId?: string }
/** Translate committed activity facts; a reset establishes a baseline without playback. */
export function createActivityInbox() {
  let cursor: Cursor | null = null, tasks = new Map<string, Pick<TaskFact, 'owner' | 'status' | 'revision'>>();
  return {
    cursor: () => cursor,
    accept(snapshot: OfficeSnapshot): OfficeActivity[] {
      if (snapshot.state !== 'live') { cursor = null; tasks.clear(); return []; }
      const events: OfficeActivity[] = [];
      if (!snapshot.reset && cursor && snapshot.cursor && cursor.epoch === snapshot.cursor.epoch) {
        for (const e of snapshot.activities ?? []) {
          if (e.seq <= cursor.seq) continue;
          const id = `${snapshot.cursor.epoch}/${e.seq}`;
          if (e.kind === 'message') events.push({ ...e, id });
          if (e.kind === 'task') {
            const prior = tasks.get(e.taskId);
            const actor = e.owner ?? prior?.owner ?? snapshot.leadId;
            if (e.status === 'completed' || e.status === 'deleted') {
              if (prior?.status !== e.status) events.push({ ...e, id, actor, kind: 'archive', celebrate: e.status === 'completed' });
            } else if (e.owner && e.owner !== prior?.owner) events.push({ ...e, id, actor, target: snapshot.leadId, kind: 'handoff' });
            else if (!prior) events.push({ ...e, id, actor: snapshot.leadId, kind: 'pin' });
            tasks.set(e.taskId, e);
          }
        }
      }
      cursor = snapshot.cursor ?? null;
      tasks = new Map((snapshot.tasks ?? []).map(t => [t.id, { owner: t.ownerId ?? null, status: t.status, revision: t.revision }]));
      return events;
    },
  };
}

export const AMBIENT_ACTIVITIES: AmbientKind[] = ['coffee', 'water', 'plant', 'window', 'fridge', 'books', 'bin', 'smoke'];
/** One cancellable scheduler for both renderers. It never changes the real Agent state. */
export function createActivityDirector<P>(adapter: ActivityAdapter<P>, { ambientDelay = 9, maxConcurrent = 4 } = {}) {
  let members = new Map<string, OfficeMember>(), queue: (OfficeActivity & { queued: number })[] = [], active: Job<P>[] = [], clock = 0, nextAmbient = ambientDelay, ambientIndex = 0, memberIndex = 0;
  const seen = new Set<string>();
  const free = (ids: string[]) => !active.some(job => job.ids.some(id => ids.includes(id)));
  function finish(job: Job<P>) { for (const id of job.ids) adapter.release(id); active = active.filter(value => value !== job); }
  function cancelAll() { for (const job of [...active]) finish(job); queue = []; adapter.reset?.(); }
  return {
    update(values: OfficeMember[]) {
      members = new Map(values.map(m => [m.id, m]));
      for (const job of [...active]) if (job.ids.some(id => !members.has(id) || ['failed', 'provisioning'].includes(members.get(id)!.status)
        || (job.ambient && members.get(id)!.status === 'running'))) finish(job);
    },
    enqueue(events: OfficeActivity[]) {
      for (const event of events) {
        if (seen.has(event.id)) continue;
        seen.add(event.id); if (seen.size > 1024) seen.delete(seen.values().next().value!);
        if (Date.now() - event.at > 60000) continue;
        if (event.kind === 'message') {
          adapter.envelope(event.actor, event.target);
          const ongoing = active.find(j => j.event?.kind === 'message' && j.phase < j.phases.length - 1 &&
            ((j.event.actor === event.actor && j.event.target === event.target) || (j.event.actor === event.target && j.event.target === event.actor)));
          if (ongoing) {
            ongoing.event!.speakers ??= [ongoing.event!.actor];
            if (!ongoing.event!.speakers.includes(event.actor)) {
              ongoing.event!.speakers.push(event.actor);
              ongoing.phases.splice(ongoing.phases.length-1,0,{actions:[{id:event.actor,kind:'talk',target:event.target},{id:event.target,kind:'listen',target:event.actor}],duration:2.2});
            }
            continue;
          }
        }
        const pair = event.kind === 'message' && queue.find(e => e.kind === 'message' &&
          ((e.actor === event.actor && e.target === event.target) || (e.actor === event.target && e.target === event.actor)));
        if (pair && pair.kind === "message") { pair.speakers = [...new Set([...(pair.speakers ?? [pair.actor]), event.actor])]; continue; }
        queue.push({ ...event, queued: clock });
        if (queue.length > 64) queue.shift();
      }
    },
    tick(dt: number) {
      clock += dt;
      for (const job of [...active]) {
        job.elapsed += dt;
        if (job.elapsed > 75) { finish(job); continue; }
        const phase = job.phases[job.phase];
        if (!phase) { finish(job); continue; }
        if (!job.started) {
          job.started = true; job.phaseTime = 0;
          for (const step of phase.walk ?? []) if (!adapter.walk(step.id, step.to)) { finish(job); break; }
          if (!active.includes(job)) continue;
          for (const step of phase.actions ?? []) adapter.action(step.id, step.kind, step.target);
        }
        job.phaseTime += dt;
        if (phase.walk?.some(step => !adapter.arrived(step.id))) continue;
        if (job.phaseTime < (phase.duration ?? 0)) continue;
        job.phase++; job.started = false;
        if (job.phase >= job.phases.length) finish(job);
      }
      queue = queue.filter(event => clock - event.queued < 45);
      for (const event of [...queue]) {
        if (active.length >= maxConcurrent) break;
        const ids = [...new Set([event.actor, event.target].filter((id): id is string => id !== undefined && members.has(id)))];
        if (!members.has(event.actor) || (event.target && !members.has(event.target))) { queue.splice(queue.indexOf(event),1); continue; }
        for (const job of [...active]) if (job.ambient && job.ids.some(id => ids.includes(id))) finish(job);
        if (!free(ids) || ids.some(id => ['failed','provisioning'].includes(members.get(id)!.status))) continue;
        const plan = adapter.plan(event, members); if (!plan) { queue.splice(queue.indexOf(event),1); continue; }
        if (active.some(job => job.site === plan.site)) continue;
        queue.splice(queue.indexOf(event),1);
        for (const id of ids) adapter.hold(id);
        active.push({ ...plan, event, ids, phase: 0, started: false, elapsed: 0, phaseTime: 0, ambient: false });
      }
      if (clock >= nextAmbient && active.length < maxConcurrent && !queue.length) {
        nextAmbient = clock + 5;
        const available = [...members.values()].filter(m => ['idle','inactive'].includes(m.status) && free([m.id]));
        if (available.length) {
          const actor = available[(memberIndex++ + Math.floor(ambientIndex / AMBIENT_ACTIVITIES.length)) % available.length];
          const kind = AMBIENT_ACTIVITIES[ambientIndex++ % AMBIENT_ACTIVITIES.length];
          const plan = adapter.plan({ kind, actor: actor.id, ambient: true }, members);
          if (plan && !active.some(job => job.site === plan.site)) {
            adapter.hold(actor.id); active.push({ ...plan, ids: [actor.id], phase: 0, started: false, elapsed: 0, phaseTime: 0, ambient: true });
          }
        }
      }
    },
    owns(id: string) { return active.some(job => job.ids.includes(id)); },
    reset() { cancelAll(); seen.clear(); nextAmbient = clock + ambientDelay; },
    dispose: cancelAll,
    inspect() { return { active: active.map(j => ({ ids:j.ids,site:j.site,phase:j.phase })), queued: queue.length }; },
  };
}

/** Scene adapters provide safe waypoints and shared choreography uses them. */
export function choreography<P>(event: PlanEvent, { home, site, meet, leadId }: ChoreographySites<P>): ActivityPlan<P> | null {
  const a = event.actor, go = (id: string, to: P | null | undefined): Phase<P> => ({ walk: [{ id, to }] });
  const act = (id: string, kind: ActionKind, duration = 2, target?: string): Phase<P> => ({ actions: [{ id, kind, target }], duration });
  if (event.kind === 'message' || event.kind === 'handoff') {
    if (event.target === a) return null;
    const leadVisit = a === leadId || event.target === leadId;
    const visitor = a === leadId ? event.target : a, host = a === leadId ? a : event.target;
    const place = meet(visitor, host, leadVisit); if (!place) return null;
    const actions: NonNullable<Phase<P>["actions"]> = event.kind === 'handoff'
      ? [{ id: visitor, kind: 'take', target: host }, { id: host, kind: 'listen', target: visitor }]
      : [{ id: a, kind: 'talk', target: event.target }, { id: event.target, kind: 'listen', target: a }];
    const phases: Phase<P>[] = [{walk:[{id:visitor,to:place},{id:host,to:leadVisit?(site('host',host)??home(host)):home(host)}]}, { actions, duration: 2.2 }];
    if ((event.speakers?.length ?? 0) > 1) phases.push({ actions: [{ id: event.target, kind: 'talk', target: a }, { id: a, kind: 'listen', target: event.target }], duration: 2.2 });
    phases.push(act(visitor, event.kind === 'handoff' ? 'carry' : 'idle', .15), {walk:[{id:visitor,to:home(visitor)},{id:host,to:home(host)}]});
    return { site: leadVisit ? 'lead-door' : `member/${host}`, phases };
  }
  const destination = site(event.kind, a); if (!destination) return null;
  const phases: Phase<P>[] = [];
  if (['coffee','water'].includes(event.kind)) {
    phases.push(go(a, home(a)), act(a,'cup',.4), go(a,destination), act(a,'brew',2), go(a,home(a)), act(a,'drink',2));
    const sink = site('sink',a); if (sink) phases.push(go(a,sink),act(a,'wash',1.8));
    phases.push(go(a,home(a)),act(a,'put-cup',.4));
  } else {
    if (event.kind === 'archive') phases.push(act(a,'carry',.3));
    phases.push(go(a,destination), act(a,event.kind, ['books','smoke','plant'].includes(event.kind)?4:2));
    if (event.celebrate) phases.push(act(a,'cheer',2.5));
    phases.push(go(a,home(a)));
  }
  return { site: destination.site, phases };
}
