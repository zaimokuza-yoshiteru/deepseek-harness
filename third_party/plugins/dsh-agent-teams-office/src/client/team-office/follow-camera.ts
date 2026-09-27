import { Vector3, type OrthographicCamera } from 'three';
import type { OrbitControls } from 'three/addons/controls/OrbitControls.js';

type Controls = Pick<OrbitControls, 'target' | 'enablePan' | 'enableDamping' | 'update'>;

/** Follow the actor's ground position while preserving orbit and zoom controls. */
export function createFollowCamera(camera: OrthographicCamera, controls: Controls) {
  let saved: { position: Vector3; target: Vector3; zoom: number; pan: boolean } | null = null;
  const target = new Vector3(), delta = new Vector3();
  // Consume pending OrbitControls inertia before applying an exact saved view.
  function restore(view: NonNullable<typeof saved>) {
    const damping = controls.enableDamping;
    controls.enableDamping = false; controls.update();
    camera.position.copy(view.position); controls.target.copy(view.target); camera.zoom = view.zoom;
    camera.updateProjectionMatrix(); controls.update(); controls.enableDamping = damping;
  }
  function update(position: Vector3) {
    if (!saved) return;
    target.set(position.x, .7, position.z);
    delta.copy(target).sub(controls.target);
    camera.position.add(delta); controls.target.copy(target);
  }
  return {
    start(position: Vector3) {
      if (!saved) {
        saved = { position: camera.position.clone(), target: controls.target.clone(), zoom: camera.zoom, pan: controls.enablePan };
        restore(saved);
      }
      controls.enablePan = false;
      update(position); camera.zoom = 3.8; camera.updateProjectionMatrix(); controls.update();
    },
    update,
    stop() {
      if (!saved) return;
      const view = saved; saved = null;
      restore(view); controls.enablePan = view.pan;
    },
  };
}
