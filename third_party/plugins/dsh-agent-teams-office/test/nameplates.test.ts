import test from 'node:test';
import assert from 'node:assert/strict';
import { layoutNameplates } from '../src/client/team-office/nameplates.ts';
test('seventeen clustered nameplates remain visible, separate, and inside a narrow sidebar',()=>{
  const source=Array.from({length:17},(_,id)=>({id,x:180+(id%4)*18,y:260+Math.floor(id/4)*15}));
  const labels=layoutNameplates(source,430,600);
  assert.equal(new Set(labels.map(v=>v.id)).size,17);
  for(const [i,a] of labels.entries()) {
    assert.ok(a.x-a.width/2>=0 && a.x+a.width/2<=430 && a.y-a.height>=0 && a.y<=600);
    for(const b of labels.slice(i+1)) assert.ok(Math.abs(a.x-b.x)>=a.width || Math.abs(a.y-b.y)>=a.height);
  }
});
