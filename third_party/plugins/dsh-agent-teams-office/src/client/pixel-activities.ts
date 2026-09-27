import type { ActionKind, OfficeMember, OfficeTask, Point2, ActivityAdapter } from '../types.ts';
import type { Character } from '../../vendor/munder/office/Character';
import type { TiledMapRenderer } from '../../vendor/munder/office/TiledMapRenderer';
import type { Text } from 'pixi.js';
import type { PixelMotion } from './motion.ts';
import type { createActivityEffects } from './activity-effects.ts';
export interface PixelEntry { character: Character; label: Text; status: OfficeMember['status'] | null; motion: PixelMotion | null }
import { Graphics } from 'pixi.js';
import { findPath } from '../../vendor/munder/office/pathfinding';
import { createActivityDirector, choreography } from './activities.ts';
import { syncMotion } from './motion.ts';

export const PIXEL_SITES: Partial<Record<string, [number, number]>> = {coffee:[46,8],sink:[49,8],water:[52,8],fridge:[54,8],books:[49,9],bin:[54,29],plant:[52,28],window:[34,4],smoke:[43,30],pin:[44,4],archive:[44,4]};
const LEAD_SITES: Partial<Record<string, [number, number]>> = {host:[12,11],coffee:[3,10],sink:[3,10],water:[3,10],fridge:[3,10],books:[11,5],bin:[11,5],plant:[12,6],window:[5,4],smoke:[5,4],pin:[11,5],archive:[11,5]};
export function createPixelActivities({ characters, map, effects }: { characters: Map<string, PixelEntry>; map: TiledMapRenderer; effects: ReturnType<typeof createActivityEffects> }) {
  let members: OfficeMember[]=[],tasks: OfficeTask[]=[];const arrivals=new Map<string, boolean>(), actions=new Map<string, {kind: ActionKind; start: number}>(), layer=new Graphics();let time=0;
  map.getCharacterContainer().addChild(layer);layer.zIndex=100000;layer.eventMode='none';
  const get=(id: string)=>characters.get(id)?.character;
  function site(kind: string,id: string){const lead=members.find(m=>m.id===id)?.role==='lead',p=(lead?LEAD_SITES:PIXEL_SITES)[kind];return p?{x:p[0],y:p[1],site:`${lead?'lead/':''}${kind}`}:null;}
  function nearest(p: Point2,avoid: Point2) {
    for(let r=0;r<5;r++)for(let y=p.y-r;y<=p.y+r;y++)for(let x=p.x-r;x<=p.x+r;x++)if(map.isWalkable(x,y)&&(!avoid||x!==avoid.x||y!==avoid.y))return{x,y};
    return null;
  }
  const adapter: ActivityAdapter<Point2>={
    plan(event,roster){return choreography(event,{
      leadId:[...roster.values()].find(m=>m.role==='lead')?.id,
      home:id=>get(id)?.getDeskTile(),site,
      meet:(visitor,host,lead)=>lead?map.getSpawnPoint('lead-visitor'):nearest({...get(host)!.getDeskTile(),x:get(host)!.getDeskTile().x+1},get(host)!.getDeskTile()),
    });},
    hold(id){get(id)?.hideThought();get(id)?.stopActivity();arrivals.set(id,true);},
    walk(id,to){const c=get(id);if(!c||!to||!findPath(map,c.getTilePosition(),to))return false;
      c.stopActivity(false);arrivals.set(id,false);effects.clear(id);if(actions.get(id)?.kind!=='carry')actions.delete(id);
      c.walkToAndThen(to,()=>arrivals.set(id,true));return true;
    },
    arrived:id=>arrivals.get(id)!==false,
    action(id,kind,target){const c=get(id);if(!c)return;effects.action(id,kind);actions.set(id,{kind,start:time});
      if(target&&get(target)){const a=c.getTilePosition(),b=get(target)!.getTilePosition();c.faceDirection(Math.abs(b.x-a.x)>Math.abs(b.y-a.y)?(b.x>a.x?'right':'left'):(b.y>a.y?'down':'up'));}
      else c.faceDirection('up');
      if(kind==='cheer')c.cheer();
      if(kind==='plant')c.startWatering(4);
      if(kind==='smoke')c.startSmoking(4);
      if(['cup','brew','drink','wash','water'].includes(kind)){c.setCupOnDesk(false);c.setCarryingCup(true);}
      if(kind==='put-cup'){c.setCarryingCup(false);c.setCupOnDesk(true);}
    },
    release(id){const entry=characters.get(id);if(entry){entry.character.stopActivity();entry.motion=syncMotion(entry.character,entry.status,null);}
      arrivals.delete(id);actions.delete(id);effects.clear(id);
    },
    envelope:(a,b)=>effects.envelope(a,b),reset:()=>effects.reset(),
  };
  const director=createActivityDirector(adapter);
  return {
    tasks(values: OfficeTask[]){tasks=values;},
    update(values: OfficeMember[]){members=values;director.update(values);},
    enqueue:director.enqueue,owns:director.owns,reset:director.reset,
    tick(dt: number){time+=dt;director.tick(dt);layer.clear();
      tasks.filter(t=>!['completed','deleted'].includes(t.status)).slice(0,8).forEach((task,i)=>layer.rect(736+(i%4)*18,27+Math.floor(i/4)*12,13,9).fill(task.status==='in_progress'?'#81b8bb':'#e2c181'));
      for(const [id,a] of actions){const c=get(id);if(!c)continue;const p=c.getPixelPosition(),t=time-a.start;
        if(['carry','take','pin','archive'].includes(a.kind)){layer.rect(p.x+4,p.y-14,5,7).fill('#f1d78d');layer.rect(p.x+5,p.y-12,3,1).fill('#a7895a');}
        if(a.kind==='books'){layer.rect(p.x-6,p.y-13,12,7).fill('#759ca9');layer.rect(p.x-5,p.y-12,10,5).fill('#f1e4c7');layer.rect(p.x,p.y-12,1,5).fill('#ada484');}
        const lead=members.find(m=>m.id===id)?.role==='lead';
        if(a.kind==='fridge'&&!lead){layer.rect(860,83,16,36).fill('#9abcd0');layer.poly([860,83,855,87,855,121,860,119]).fill('#dce5d3');}
        if(a.kind==='fridge'&&lead){layer.rect(39,136,20,17).fill('#6e918f');layer.poly([39,136,33,140,33,156,39,153]).fill('#d9ddc0');}
        if(a.kind==='window'){const x=lead?80:544;layer.poly([x,25,x+22,20,x+22,49,x,48]).fill({color:'#d7f0e5',alpha:.8});layer.moveTo(x,25).lineTo(x+22,20).lineTo(x+22,49).stroke({color:'#668e96',width:1});}
        if(['pin','archive'].includes(a.kind)){const x=lead?182:740,y=lead?66:29;for(let i=0;i<4;i++)layer.rect(x+i*8,y+Math.sin(t*3+i)*2,6,8).fill(a.kind==='pin'?'#e3c572':'#a7beaa');}
        if(a.kind==='drink')layer.circle(p.x+4,p.y-18+Math.sin(t*5),2).fill('#ead8a8');
      }
    },
    dispose(){director.dispose();layer.destroy();},
  };
}
