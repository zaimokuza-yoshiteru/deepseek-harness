import type { MemberStatus, Point3, ActionKind } from '../../types.ts';
import type { makeTeamOffice } from './model.ts';
export type TeamRig = ReturnType<typeof makeTeamOffice>['characters'][number];
export interface TeamMotion extends Point3 { index: number; heading: number; mode: 'stand' | 'walk' | 'work' | 'activity'; seated: number; time: number; gait: number; moving: boolean; waypoint: number; pause: number; route: Point3[]; action?: ActionKind | null }
import { CHAIR, CHAIR_ROUTE, STATIONS, roamPoints } from './layout.ts';
export function statusMotion(status: MemberStatus) { return status === 'running' ? 'work' : status === 'idle' || status === 'inactive' ? 'walk' : 'stand'; }
export function createTeamMotion(index: number): TeamMotion {
  return { index, x: -.94, z: 1.48, heading: 0, mode: 'stand', seated: 0, time: index * .57, gait: index, moving: false, waypoint: index % 4, pause: index * .24, route: [], };
}
function same(a: Point3, b: Point3) { return Math.hypot(a.x - b.x, a.z - b.z) < .025; }
export function updateTeamMotion(state: TeamMotion, mode: TeamMotion["mode"], dt: number) {
  dt = Math.max(0, Math.min(dt, .05)); state.time += dt;
  if (mode !== state.mode) {
    const atChair = same(state, CHAIR);
    if (mode === 'work') {
      // When a work request arrives during departure, reuse the safe side corridor.
      state.route = atChair ? [] : state.z < 1.05 ? [CHAIR_ROUTE[1], CHAIR] : [...CHAIR_ROUTE];
    } else if (state.mode === 'work') {
      state.route = (atChair || state.z < 1.05) ? [CHAIR_ROUTE[1], CHAIR_ROUTE[0]] : [CHAIR_ROUTE[0]];
    }
    state.mode = mode; state.pause = .35;
  }
  state.moving = false; state.pause -= dt;
  const atChair = same(state, CHAIR), sit = mode === 'work' && atChair && !state.route.length;
  state.seated += ((sit ? 1 : 0) - state.seated) * Math.min(1, dt * 9);
  let target = state.route[0];
  if (!target && mode === 'walk' && state.pause <= 0) target = roamPoints(state.index)[state.waypoint];
  if (target && state.seated < .06) {
    const dx = target.x - state.x, dz = target.z - state.z, distance = Math.hypot(dx, dz);
    if (distance < .025) {
      state.x = target.x; state.z = target.z;
      if (state.route.length) state.route.shift();
      else { state.waypoint = (state.waypoint + 1) % 4; state.pause = .8 + state.index % 3 * .45; }
    } else {
      const step = Math.min(distance, dt * (state.mode === 'activity' ? 2.6 : .64)); state.x += dx / distance * step; state.z += dz / distance * step;
      state.heading = Math.atan2(dx, dz); state.gait += dt * 9; state.moving = true;
    }
  }
  if (sit) state.heading = Math.PI;
  return state;
}
export function poseTeamCharacter(rig: TeamRig, state: TeamMotion) {
  const station = STATIONS[state.index], sit = state.seated, wave = state.moving ? Math.sin(state.gait) : 0;
  rig.avatar.position.set(station.x + state.x, .105 + sit * .22, station.z + state.z);
  const delta = Math.atan2(Math.sin(state.heading - rig.avatar.rotation.y), Math.cos(state.heading - rig.avatar.rotation.y));
  rig.avatar.rotation.y += delta * .18;
  rig.body.position.y = state.moving ? Math.abs(wave) * .023 : Math.sin(state.time * 2) * .005;
  rig.head.rotation.set(sit * .065, 0, state.moving ? wave * .026 : Math.sin(state.time * 1.2) * .013);
  rig.legs.forEach(({ hip, foot }, i) => {
    hip.rotation.x = -sit * Math.PI / 2 + wave * (i ? -.38 : .38) * (1 - sit);
    foot.rotation.x = sit * Math.PI / 2;
  });
  rig.arms.forEach(({ shoulder, hand }, i) => {
    shoulder.rotation.x = -sit * 1.94 + wave * (i ? .42 : -.42) * (1 - sit);
    shoulder.rotation.z = (i ? -.10 : .10) * (1 - sit);
    hand.rotation.x = Math.sin(state.time * 15 + i * Math.PI) * .10 * sit;
    hand.position.z = .008 + sit * .045;
  });
  if (state.action && !state.moving) {
    const beat = Math.sin(state.time * 7);
    if (state.action === 'cheer') { rig.avatar.position.y += Math.abs(Math.sin(state.time*9))*.18; rig.arms.forEach(({shoulder},i)=>{shoulder.rotation.z=(i?-1:1)*1.9;}); }
    else if (['drink','smoke'].includes(state.action)) rig.arms[1].shoulder.rotation.x=-1.65+beat*.06;
    else if (['talk','take','pin','archive','window','fridge','plant','wash','brew','bin','books'].includes(state.action)) {
      rig.arms[1].shoulder.rotation.x=-.8+beat*.18;
      if (state.action==='books') rig.arms[0].shoulder.rotation.x=-.8;
      if (['plant','bin','wash'].includes(state.action)) rig.body.rotation.x=.10;
    }
  } else rig.body.rotation.x=0;
  rig.ring.visible = state.mode === 'work';
  rig.ring.material.opacity = .62 + Math.sin(state.time * 2) * .13;
}
