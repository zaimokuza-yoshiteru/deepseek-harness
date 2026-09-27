export type Point = [number,number];
export const ROI={x:790,y:100,w:400,h:450};
// Traced in the new 1280×720 source coordinate system. Artistic curves, not recovered 3D topology.
export function spline(p:Point[], steps=12):Point[]{
 const out:Point[]=[];
 for(let i=0;i<p.length-1;i++)for(let k=0;k<steps;k++){
  const t=k/steps,a=p[Math.max(0,i-1)],b=p[i],c=p[i+1],d=p[Math.min(p.length-1,i+2)];
  out.push([0,1].map(j=>.5*((2*b[j])+(-a[j]+c[j])*t+(2*a[j]-5*b[j]+4*c[j]-d[j])*t*t+(-a[j]+3*b[j]-3*c[j]+d[j])*t*t*t)) as Point);
 }out.push(p[p.length-1]);return out;
}
