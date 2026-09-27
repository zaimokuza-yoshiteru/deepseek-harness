import type { TeamMotion } from './motion.ts';
import type { createOfficeProps } from './props.ts';
import type { createActivityEffects } from '../activity-effects.ts';
import type { OfficeMember, Point3, ActivityAdapter } from '../../types.ts';
import { createActivityDirector, choreography } from '../activities.ts';
import { officePath, homePoint, sitePoint } from './navigation.ts';
import { STATIONS } from './layout.ts';
export function createTeamActivities({ motions, seats, members, effects, props }: { motions: TeamMotion[]; seats(): Map<string, number>; members(): OfficeMember[]; effects: ReturnType<typeof createActivityEffects>; props: ReturnType<typeof createOfficeProps> }) {
  const held=new Set<string>(), returning=new Set<string>();
  const index=(id: string)=>seats().get(id), motion=(id: string)=>{ const i=index(id); return i === undefined ? undefined : motions[i]; };
  function position(id: string){const i=index(id),s=i === undefined ? undefined : STATIONS[i],m=motion(id);return s&&m?{x:s.x+m.x,z:s.z+m.z}:null;}
  function route(id: string,to: Point3 | null | undefined){const i=index(id),m=motion(id);if(i===undefined||!m||!to)return false;const start=position(id),s=STATIONS[i],escape=m.z>=.4&&m.z<1.2&&Math.abs(m.x)<.65?[{x:s.x-.94,z:s.z+.7},{x:s.x-.94,z:s.z+1.48}]:[];const p=officePath(escape.at(-1)??start!,to);if(!p)return false;p.unshift(...escape);m.mode='activity';m.route=p.map(v=>({x:v.x-STATIONS[i].x,z:v.z-STATIONS[i].z}));m.action=null;effects.clear(id);props.depart?.(id);return true;}
  function clear(id: string){const m=motion(id);if(m)m.action=null;effects.clear(id);props.clear(id);}
  const adapter: ActivityAdapter<Point3>={
    plan(event, roster){return choreography(event,{
      leadId:[...roster.values()].find(m=>m.role==='lead')?.id,
      home:id=>homePoint(index(id)!),site:(kind,id)=>sitePoint(kind,index(id)!),
      meet:(visitor,host,lead)=>lead?sitePoint('visitor',0):{...homePoint(index(host)!),x:homePoint(index(host)!).x+.9},
    });},
    hold(id){held.add(id);returning.delete(id);const m=motion(id);if(m){m.mode='activity';m.route=[];}},
    walk:route,
    arrived(id){return !motion(id)?.route.length;},
    action(id,kind,target){const m=motion(id);if(!m)return;m.action=kind;effects.action(id,kind);props.action(id,kind,index(id)!);
      const other=target&&position(target);if(other){const p=position(id)!;m.heading=Math.atan2(other.x-p.x,other.z-p.z);}
    },
    release(id){held.delete(id);clear(id);if(motion(id)&&route(id,homePoint(index(id)!)))returning.add(id);},
    envelope:(a,b)=>effects.envelope(a,b),reset:()=>effects.reset(),
  };
  const director=createActivityDirector(adapter);
  return {
    update(){director.update(members());},
    enqueue:director.enqueue,
    reset(){director.reset();},
    tick(dt: number){director.tick(dt);props.tick(dt);for(const id of [...returning])if(!motion(id)||!motion(id)!.route.length){returning.delete(id);if(motion(id))motion(id)!.mode='stand';}},
    owns:(id: string)=>held.has(id)||returning.has(id),
    dispose(){director.dispose();held.clear();returning.clear();},
  };
}
