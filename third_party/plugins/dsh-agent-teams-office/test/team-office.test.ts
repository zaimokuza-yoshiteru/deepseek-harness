import type { SeatMember } from '../src/types.ts';
import type { TeamMotion } from '../src/client/team-office/motion.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { TEAM_CAPACITY, STATIONS, LEAD_ROOM, assignTeamSeats, CHAIR } from '../src/client/team-office/layout.ts';
import { createTeamMotion, updateTeamMotion, poseTeamCharacter } from '../src/client/team-office/motion.ts';
import { CHARACTERS } from '../src/client/team-office/characters.ts';
import { makeTeamOffice } from '../src/client/team-office/model.ts';
import { Box3 } from 'three';
const roster: SeatMember[] = [{id:'lead', role:'lead'}, ...Array.from({length:16},(_,i)=>({id:`worker-${i}`,role:'teammate' as const}))];

test('sixteen teammates plus Lead have unique stable seats and appearances; overflow never clones a character',()=>{
  const seats=assignTeamSeats(new Map(),roster);
  assert.equal(TEAM_CAPACITY,17); assert.equal(seats.size,17); assert.equal(seats.get('lead'),0);
  assert.equal(new Set(seats.values()).size,17);
  assert.deepEqual(assignTeamSeats(seats,[...roster].reverse()),seats);
  assert.equal(assignTeamSeats(seats,[...roster,{id:'extra',role:'teammate'}]).has('extra'),false);
  assert.equal(new Set(CHARACTERS.map(look=>look.hair)).size,17);
  assert.equal(assignTeamSeats(new Map(),roster.slice(1)).size,16);
  assert.equal([...assignTeamSeats(new Map(),roster.slice(1)).values()].includes(0),false);
});

test('all 17 rigs wander and return to desks; Lead stays inside its private room through rapid status changes',()=>{
  for(let index=0;index<17;index++) {
    const state=createTeamMotion(index), station=STATIONS[index];
    const advance=(mode: TeamMotion["mode"],seconds: number)=>{
      for(let tick=0;tick<seconds*60;tick++){
        updateTeamMotion(state,mode,1/60);
        assert.ok(state.z>=.67,'never walks through the desk');
        assert.ok(!(state.x>-.48 && state.x<.24 && state.z>.9 && state.z<1.12),'avoids chair backrest');
        if(index===0){
          assert.ok(station.x+state.x>LEAD_ROOM.minX+.35 && station.x+state.x<LEAD_ROOM.maxX-.35);
          assert.ok(station.z+state.z>LEAD_ROOM.minZ+.35 && station.z+state.z<LEAD_ROOM.maxZ-.35);
        }
      }
    };
    advance('walk',65); const previous=[state.x,state.z]; advance('walk',5); assert.notDeepEqual([state.x,state.z],previous);
    advance('work',25); assert.ok(Math.hypot(state.x-CHAIR.x,state.z-CHAIR.z)<.03); assert.ok(state.seated>.99);
    advance('stand',10); assert.ok(state.seated<.01); assert.ok(state.z>1.4);
    for(const mode of ['work','walk','work','stand','work','walk'] as const) advance(mode,.8);
    advance('work',25); assert.ok(state.seated>.99);
    advance('walk',10); assert.ok(state.seated<.01);
  }
});

test('new short rigs retain typing pose; all non-bald styles cover ear height and scenery is batched',()=>{
  const model=makeTeamOffice();
  try {
    assert.equal(model.characters.length,17);
    assert.ok(model.root.children[0].children.length<110,'static furniture batched by material');
    for(let index=0;index<17;index++) {
      const rig=model.characters[index];
      if(rig.look.hair!=='bald') {
        const sides=rig.hair.children.filter(item=>Math.abs(item.position.x)>.32 && item.position.y<.1);
        assert.ok(sides.length>=2,`${rig.look.hair}: both side panels reach the ears`);
        assert.ok(sides.every(item=>new Box3().setFromObject(item).min.y<=1.00));
      }
      const state=createTeamMotion(index); for(let i=0;i<1200;i++) updateTeamMotion(state,'work',1/60);
      poseTeamCharacter(rig,state); assert.ok(rig.legs[0].hip.rotation.x < -1.5); assert.ok(rig.ring.visible);
      const hand=rig.arms[0].hand.rotation.x; updateTeamMotion(state,'work',.04); poseTeamCharacter(rig,state); assert.notEqual(hand,rig.arms[0].hand.rotation.x);
    }
  } finally {model.dispose();}
});
