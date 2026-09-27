import type { Point3 } from '../../types.ts';
import { STATIONS } from './layout.ts';
const STEP = .2, W = 119, H = 69;
const rects = [
  [-5.72,-5.28,-7,-.98], [-12,-9.12,-1.35,-.9], [-7.52,-5.3,-1.35,-.9],
  [-10.3,-7.4,-.1,1.72], [-9.9,-7.6,1.35,2.63], // sofa and low table
  [-11.72,-10.35,3.15,6.7], [-9.25,-6.15,3.1,6.3], // coffee and meeting furniture
  [-11.52,-10.48,-4.45,-2.95], [-11.55,-10.65,-6.7,-5.85],
  [-11.7,-11.05,-3.32,-1.45],
  ...STATIONS.flatMap(s => [[s.x-(s.lead?1.62:1.4),s.x+(s.lead?1.62:1.4),s.z-.66,s.z+.53], [s.x-.63,s.x+.39,s.z+.46,s.z+1.17]]),
];
export function isOfficeWalkable(x: number,z: number) { return x > -11.7 && x < 11.7 && z > -6.7 && z < 6.7 && !rects.some(r=>x>=r[0]&&x<=r[1]&&z>=r[2]&&z<=r[3]); }
const at = (i: number) => ({x:-11.8+(i%W)*STEP,z:-6.8+Math.floor(i/W)*STEP});
const walkable = Array.from({length:W*H},(_,i)=>{const p=at(i);return isOfficeWalkable(p.x,p.z);});
function nearest(p: Point3) {
  let best=-1,d=Infinity;
  for(let i=0;i<walkable.length;i++) if(walkable[i]) {const v=at(i),n=(v.x-p.x)**2+(v.z-p.z)**2;if(n<d){best=i;d=n;}}
  return best;
}
/** Grid routes go through the Lead doorway and around every desk and lounge prop. */
export function officePath(from: Point3,to: Point3) {
  const start=nearest(from),goal=nearest(to), parents=new Int32Array(W*H).fill(-1),queue=[start];parents[start]=start;
  for(let n=0;n<queue.length&&parents[goal]<0;n++) {
    const i=queue[n];
    for(const j of [i-W,i+W,...(i%W?[i-1]:[]),...(i%W<W-1?[i+1]:[])]) {
      if(j<0||j>=parents.length||!walkable[j]||parents[j]>=0)continue;
      parents[j]=i;queue.push(j);
    }
  }
  if(parents[goal]<0)return null;
  const path: Point3[]=[];for(let i=goal;i!==start;i=parents[i])path.push(at(i));path.push(at(start));path.reverse();
  // Keep turns, dropping collinear cells without cutting corners.
  return path.filter((p,i)=>i===0||i===path.length-1||Math.abs((p.x-path[i-1].x)*(path[i+1].z-p.z)-(p.z-path[i-1].z)*(path[i+1].x-p.x))>.001);
}
export function homePoint(index: number) {const s=STATIONS[index];return {x:s.x-.94,z:s.z+1.48,site:`desk/${index}`};}
export const SITES: Partial<Record<string, Point3>> = {
  coffee:{x:-10.02,z:3.95}, sink:{x:-10.02,z:5.02}, water:{x:-10.02,z:5.85},
  fridge:{x:-9.9,z:6.45}, books:{x:-5.65,z:6.25}, bin:{x:-4.55,z:6.25},
  plant:{x:-10.35,z:2.05}, window:{x:2.5,z:-6.45}, smoke:{x:10.9,z:6.15},
  pin:{x:-10.85,z:-2.6}, archive:{x:-10.85,z:-2.6}, host:{x:-8.8,z:-2.7}, visitor:{x:-7.4,z:-2.7},
};
export function sitePoint(kind: string,index: number) {
  if(index===0) {
    const privateSites: Partial<Record<string, Point3>> = { coffee:{x:-10.35,z:-3.5},sink:{x:-10.35,z:-3.5},water:{x:-10.35,z:-3.5},fridge:{x:-10.35,z:-3.5},books:{x:-10.85,z:-2.6},bin:{x:-10.85,z:-2.6},plant:{x:-10.5,z:-5.7},window:{x:-10.25,z:-6.35},smoke:{x:-10.25,z:-6.35} };
    const p = privateSites[kind] ?? SITES[kind];
    return p ? {...p,site:`lead/${kind}`} : null;
  }
  const p=SITES[kind];return p?{...p,site:kind}:null;
}
