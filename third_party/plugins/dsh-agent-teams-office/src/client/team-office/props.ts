import type { Object3D } from 'three';
import type { TeamRig } from './motion.ts';
import type { ActionKind, OfficeTask } from '../../types.ts';
import { createKit } from './kit.ts';
/** Real 3D hand props and hinged scenery, with their own disposable geometry pool. */
export function createOfficeProps(root: Object3D, rigs: TeamRig[]) {
  const kit=createKit(), {box,cylinder,group}=kit, actions=new Map<string, { kind: ActionKind; index: number; start: number }>();let time=0;
  const screenMaterials=rigs.map(rig=>{rig.screen.material=rig.screen.material.clone();return rig.screen.material;});
  const handProps=rigs.map(rig=>{
    const anchor=group(rig.arms[1].hand,[0,-.025,.15]);
    const cup=group(anchor);cylinder(cup,.085,.15,[0,0,0],'#efdda6');cylinder(cup,.067,.009,[0,.079,0],'#795b47');box(cup,[.06,.07,.04],[.10,0,0],'#efdda6',.012);
    const note=box(anchor,[.18,.24,.02],[0,.05,0],'#f1d986',.007);
    const book=group(anchor);box(book,[.32,.025,.21],[0,0,0],'#6592a3',.01);box(book,[.27,.033,.18],[0,.026,0],'#f1e6c9',.005);
    const can=group(anchor);cylinder(can,.105,.18,[0,0,0],'#7ba6a1');box(can,[.16,.045,.045],[.13,0,0],'#7ba6a1',.01).rotation.z=.3;
    for(const p of [cup,note,book,can])p.visible=false;
    return {cup,note,book,can};
  });
  const fridge=group(root,[-11,.1,6.33]);box(fridge,[.85,1.55,.64],[0,.78,0],'#b9ccc4',.04);
  const door=group(fridge,[-.43,0,.34]);box(door,[.85,1.51,.08],[.425,.78,0],'#e2e5d4',.025);box(door,[.035,.28,.05],[.72,1.06,.065],'#6f8e91',.009);
  const dispenser=group(root,[-10.95,.1,5.73]);box(dispenser,[.46,.93,.42],[0,.47,0],'#d1e2df',.03);cylinder(dispenser,.18,.29,[0,1.07,0],'#88bcc7');
  // A shelf and bin sit against the front edge, away from the meeting routes.
  box(root,[1.7,.8,.40],[-5.6,.48,6.92],'#b98d68',.03);for(let i=0;i<11;i++)box(root,[.10,.37+(i%3)*.04,.23],[-6.3+i*.13,.73,6.83],['#91acae','#d5b177','#ad8e9e'][i%3],.006);
  cylinder(root,.22,.47,[-4.35,.34,6.83],'#7c9490');
  const window=group(root,[1.6,1.14,-6.75]);box(window,[1.14,1.02,.025],[.57,.5,0],'#b5d7db',.006);
  const notes=Array.from({length:8},(_,i)=>box(root,[.03,.19,.23],[-11.65,1.30+Math.floor(i/4)*.28,-3.2+(i%4)*.36],'#efca78',.006));
  const privateCounter=group(root,[-11,.08,-3.7]);box(privateCounter,[.63,.8,1.1],[0,.4,0],'#adc1ae',.025);box(privateCounter,[.67,.07,1.15],[0,.84,0],'#e8dbbb',.02);
  box(privateCounter,[.3,.34,.35],[0,1.04,-.23],'#4c676b',.025);box(privateCounter,[.32,.035,.30],[0,.89,.27],'#80a5ad',.02);
  const privateDoor=group(privateCounter,[.34,0,-.54]);box(privateDoor,[.06,.76,1.08],[0,.4,.54],'#d8dfc8',.015);box(privateDoor,[.035,.18,.04],[.045,.54,.90],'#6a8986',.005);
  const privateWindow=group(root,[-9.88,1.14,-6.75]);box(privateWindow,[1.12,1.02,.025],[.56,.5,0],'#b5d7db',.006);
  box(root,[.28,.6,1.2],[-11.55,.40,-2.6],'#ac896b',.02);for(let i=0;i<8;i++)box(root,[.18,.24,.11],[-11.37,.60,-3.05+i*.13],['#9aafb4','#d8b779','#b595a7'][i%3],.005);
  let noteCount=0;
  function clear(id: string){const a=actions.get(id);if(a)for(const p of Object.values(handProps[a.index]))p.visible=false;actions.delete(id);}
  return {
    tasks(values: OfficeTask[]){noteCount=Math.min(notes.length,values.filter(t=>!['completed','deleted'].includes(t.status)).length);},
    action(id: string,kind: ActionKind,index: number){
      const props=handProps[index];if(!props)return;
      actions.set(id,{kind,index,start:time});
      if(['cup','brew','drink','wash','water'].includes(kind))props.cup.visible=true;
      if(kind==='put-cup')props.cup.visible=false;
      props.note.visible=['take','carry','pin','archive'].includes(kind);props.book.visible=kind==='books';props.can.visible=kind==='plant';
    },
    clear,
    depart(id: string){const a=actions.get(id);if(!a)return;
      if(['fridge','window','books','plant','smoke','pin','archive'].includes(a.kind)){
        a.kind='idle';handProps[a.index].book.visible=false;handProps[a.index].can.visible=false;handProps[a.index].note.visible=false;
      }
    },
    tick(dt: number){time+=dt;const values=[...actions.values()];
      door.rotation.y+=((values.some(a=>a.kind==='fridge'&&a.index!==0)?-1.1:0)-door.rotation.y)*Math.min(1,dt*4);
      window.rotation.y+=((values.some(a=>a.kind==='window'&&a.index!==0)?-.65:0)-window.rotation.y)*Math.min(1,dt*4);
      privateDoor.rotation.y+=((values.some(a=>a.kind==='fridge'&&a.index===0) ? .9:0)-privateDoor.rotation.y)*Math.min(1,dt*4);
      privateWindow.rotation.y+=((values.some(a=>a.kind==='window'&&a.index===0)?-.65:0)-privateWindow.rotation.y)*Math.min(1,dt*4);
      notes.forEach((n,i)=>{n.visible=i<noteCount;});
      rigs.forEach((rig,i)=>{rig.screen.material.emissive?.set('#527f69');rig.screen.material.emissiveIntensity=rig.ring.visible ? .25+Math.sin(time*4+i)*.15:0;});
    },
    destroy(){actions.clear();for(const mat of screenMaterials)mat.dispose();kit.dispose();},
  };
}
