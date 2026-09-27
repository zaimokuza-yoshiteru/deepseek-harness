// One clock, alphabet and palette for both the background and iris reflections.
export const FLOW_WORD='LIFRR';
export const FLOW_HEAD='#cfecff',FLOW_TAIL='#9cb9cb';
export function flowPhase(index:number,t:number){return ((t*(32+(index%4)*5)+(index*373)%940)%940)/940}
