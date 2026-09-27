import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { OrthographicCamera, Vector3 } from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createFollowCamera } from '../src/client/team-office/follow-camera.ts';
import { makeTeamOffice } from '../src/client/team-office/model.ts';
import { createTeamMotion, updateTeamMotion, poseTeamCharacter } from '../src/client/team-office/motion.ts';

test('camera follows a moving rig, allows orbit/zoom, then restores the exact pre-focus view without residual drift', () => {
  const dom = new JSDOM('<canvas></canvas>'), canvas = dom.window.document.querySelector('canvas')!;
  Object.defineProperties(canvas, { clientHeight: { value: 600 }, clientWidth: { value: 800 } });
  const camera = new OrthographicCamera(-16,16,12,-12,.1,150);
  camera.position.set(17,21,25); camera.zoom=1.6;
  const controls = new OrbitControls(camera,canvas), model = makeTeamOffice();
  controls.enableDamping=true; controls.target.set(2,.45,3); controls.update();
  controls.listenToKeyEvents(canvas);
  const follow=createFollowCamera(camera,controls), rig=model.characters[7], motion=createTeamMotion(7);
  const initial={position:camera.position.clone(),target:controls.target.clone(),zoom:camera.zoom};
  const close=(actual:Vector3, expected:Vector3) => assert.ok(actual.distanceTo(expected)<1e-8,`${actual.toArray()} != ${expected.toArray()}`);
  try {
    follow.start(rig.avatar.position);
    assert.equal(camera.zoom,3.8); assert.equal(controls.enablePan,false);
    const offset=camera.position.clone().sub(controls.target), start=controls.target.clone();
    for(let frame=0;frame<600;frame++) {
      updateTeamMotion(motion,'walk',1/30); poseTeamCharacter(rig,motion);
      follow.update(rig.avatar.position); controls.update();
      close(controls.target,new Vector3(rig.avatar.position.x,.7,rig.avatar.position.z));
      close(camera.position.clone().sub(controls.target),offset);
    }
    assert.ok(start.distanceTo(controls.target)>.1,'actor and camera both move');
    camera.zoom=4.5; camera.updateProjectionMatrix();
    canvas.dispatchEvent(new dom.window.KeyboardEvent('keydown',{code:'ArrowRight',ctrlKey:true}));
    follow.update(rig.avatar.position); controls.update();
    assert.equal(camera.zoom,4.5);
    assert.ok(camera.position.clone().sub(controls.target).distanceTo(offset)>.01,'orbit remains usable');
    follow.stop();
    assert.equal(camera.zoom,initial.zoom); assert.equal(controls.enablePan,true); assert.equal(controls.enableDamping,true);
    for(let frame=0;frame<120;frame++) {
      follow.update(new Vector3(30,10,20)); controls.update();
      close(camera.position,initial.position); close(controls.target,initial.target);
    }
    // A new focus captures the latest view, not the first view from the session.
    camera.position.add(new Vector3(1,2,3)); controls.target.add(new Vector3(1,2,3)); camera.zoom=2.2; controls.enablePan=false; controls.update();
    const second=camera.position.clone(); follow.start(rig.avatar.position); follow.stop();
    close(camera.position,second); assert.equal(camera.zoom,2.2); assert.equal(controls.enablePan,false);
  } finally { controls.dispose(); model.dispose(); dom.window.close(); }
});
