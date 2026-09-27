import type { Point2, ActionKind, ActivityLabel, ToolActivity } from '../types.ts';
interface Effect { kind: ActionKind | 'tool'; start: number; text?: string }
/** Lightweight screen-space effects shared by Pixi and Three; no invented dialogue. */
export function createActivityEffects(element: HTMLElement, position: (id: string) => Point2 | null) {
  const canvas=document.createElement('canvas');canvas.className='office-activity-effects';canvas.setAttribute('aria-hidden','true');element.append(canvas);
  const context=canvas.getContext('2d');
  if (!context) { canvas.remove(); throw new Error('Canvas 2D context unavailable'); }
  const ctx: CanvasRenderingContext2D=context, actions=new Map<string, Effect>(), envelopes: {from: string; to: string; start: number}[]=[];
  let label: ActivityLabel=k=>k,time=0,tools: ToolActivity={};
  function icon(kind: Effect['kind'],x: number,y: number,t: number) {
    ctx.save();ctx.translate(x,y);ctx.lineWidth=1.5;ctx.strokeStyle='#466c70';ctx.fillStyle='#fff6ce';
    if(['carry','take','pin','archive'].includes(kind)) {ctx.fillRect(-4,-8,9,12);ctx.strokeRect(-4,-8,9,12);ctx.beginPath();ctx.moveTo(-2,-4);ctx.lineTo(3,-4);ctx.moveTo(-2,-1);ctx.lineTo(3,-1);ctx.stroke();}
    if(kind==='books'){ctx.fillStyle='#96b4c5';ctx.fillRect(-8,-4,16,10);ctx.strokeRect(-8,-4,16,10);ctx.beginPath();ctx.moveTo(0,-4);ctx.lineTo(0,6);ctx.stroke();}
    if(['cup','brew','drink','wash','water'].includes(kind)){ctx.fillRect(-5,-3,8,8);ctx.strokeRect(-5,-3,8,8);ctx.strokeRect(3,-1,3,4);for(let i=0;i<3;i++){ctx.globalAlpha=.4;ctx.beginPath();ctx.arc(-3+i*3,-7-(t*7+i*3)%10,1.1,0,Math.PI*2);ctx.stroke();}}
    if(['plant','wash'].includes(kind)){ctx.fillStyle='#6db4cc';for(let i=0;i<5;i++){const f=(t*1.5+i*.17)%1;ctx.beginPath();ctx.arc(5+f*10,4+f*16,1.5,0,Math.PI*2);ctx.fill();}}
    if(kind==='smoke'){ctx.fillStyle='#8a6950';ctx.fillRect(3,-5,5,2);for(let i=0;i<5;i++){const f=(t*.4+i*.2)%1;ctx.globalAlpha=(1-f)*.45;ctx.fillStyle='#a8b8b7';ctx.beginPath();ctx.arc(8+Math.sin(f*6)*4,-7-f*22,2+f*4,0,Math.PI*2);ctx.fill();}}
    if(kind==='cheer'){for(let i=0;i<9;i++){const a=i*2.4+t, r=10+(t*20+i*3)%25;ctx.fillStyle=['#dbba67','#78b1ab','#d5a09b'][i%3];ctx.fillRect(Math.cos(a)*r,Math.sin(a)*r-10,3,4);}}
    if(kind==='bin'){const f=t%1;ctx.fillStyle='#fff7d2';ctx.fillRect(7,-6+f*22,4,4);}
    ctx.restore();
  }
  return {
    label(fn: ActivityLabel) {if(fn)label=fn;},
    tools(value: ToolActivity){tools=value;},
    action(id: string,kind: ActionKind) {if(kind==='idle'||kind==='put-cup')actions.delete(id);else actions.set(id,{kind,start:time});},
    clear(id: string) {actions.delete(id);},
    envelope(from: string,to: string) {envelopes.push({from,to,start:time});if(envelopes.length>32)envelopes.shift();},
    reset(){actions.clear();envelopes.length=0;},
    draw(dt: number) {
      time+=dt;const w=element.clientWidth,h=element.clientHeight,dpr=Math.min(window.devicePixelRatio||1,2);
      if(canvas.width!==Math.round(w*dpr)||canvas.height!==Math.round(h*dpr)){canvas.width=w*dpr;canvas.height=h*dpr;}
      ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,w,h);
      for(const [id,a] of new Map<string, Effect>([...Object.entries(tools).map(([id,tool]): [string, Effect]=>[id,{kind:'tool',start:time,text:tool.name}]),...actions])){const p=position(id);if(!p)continue;icon(a.kind,p.x+8,p.y+6,time-a.start);
        if(['carry','cup','listen'].includes(a.kind))continue;
        const text=a.text ?? (a.kind === 'tool' ? '' : label(a.kind));ctx.font='10px system-ui';const width=Math.min(170,ctx.measureText(text).width+14),y=p.y-43;
        ctx.fillStyle='#fffdf0ef';ctx.strokeStyle='#afc6bd';ctx.lineWidth=1;ctx.beginPath();ctx.roundRect(p.x-width/2,y,width,19,6);ctx.fill();ctx.stroke();
        ctx.fillStyle='#365965';ctx.textAlign='center';ctx.fillText(text,p.x,y+13,width-10);
      }
      for(let i=envelopes.length-1;i>=0;i--){const e=envelopes[i],t=(time-e.start)/1.5,a=position(e.from),b=position(e.to);if(t>=1.3||!a||!b){envelopes.splice(i,1);continue;}
        const f=Math.min(t,1),x=a.x+(b.x-a.x)*f,y=a.y+(b.y-a.y)*f-Math.sin(f*Math.PI)*45-15;
        ctx.save();ctx.translate(x,y);ctx.globalAlpha=t>1?(1.3-t)/.3:Math.min(1,t*6);ctx.fillStyle='#fff3c4';ctx.strokeStyle='#aa8b49';ctx.lineWidth=1.5;
        if(t<1){ctx.fillRect(-7,-5,14,10);ctx.strokeRect(-7,-5,14,10);ctx.beginPath();ctx.moveTo(-7,-5);ctx.lineTo(0,1);ctx.lineTo(7,-5);ctx.stroke();}else{ctx.beginPath();ctx.arc(0,0,8+(t-1)*30,0,Math.PI*2);ctx.stroke();}ctx.restore();
      }
    },
    destroy(){canvas.remove();actions.clear();envelopes.length=0;},
  };
}
