export type Vec3 = [number, number, number];
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export function createKit() {
  const geometries = new Map<string, THREE.BufferGeometry>(), materials = new Map<THREE.ColorRepresentation, THREE.MeshStandardMaterial>(), merged = new Set<THREE.BufferGeometry>();
  function geometry(key: string, make: () => THREE.BufferGeometry) { if (!geometries.has(key)) geometries.set(key, make()); return geometries.get(key)!; }
  function material(color: THREE.ColorRepresentation) { if (!materials.has(color)) materials.set(color, new THREE.MeshStandardMaterial({ color, roughness: 0.78 })); return materials.get(color)!; }
  function mesh(parent: THREE.Object3D, geo: THREE.BufferGeometry, color: THREE.ColorRepresentation, at: Vec3) {
    const item = new THREE.Mesh(geo, material(color)); item.position.set(...at);
    item.castShadow = item.receiveShadow = true; parent.add(item); return item;
  }
  function box(parent: THREE.Object3D, size: Vec3, at: Vec3, color: THREE.ColorRepresentation, round = .035) {
    const radius = Math.min(round, ...size.map(v => v / 2 - .001));
    return mesh(parent, geometry(JSON.stringify(['b', size, radius]), () => new RoundedBoxGeometry(...size, 2, radius)), color, at);
  }
  function cylinder(parent: THREE.Object3D, radius: number, height: number, at: Vec3, color: THREE.ColorRepresentation, bottom = radius) {
    return mesh(parent, geometry(JSON.stringify(['c', radius, bottom, height]), () => new THREE.CylinderGeometry(radius, bottom, height, 12)), color, at);
  }
  function sphere(parent: THREE.Object3D, size: Vec3, at: Vec3, color: THREE.ColorRepresentation) {
    const item = mesh(parent, geometry('sphere', () => new THREE.SphereGeometry(1, 12, 8)), color, at); item.scale.set(...size); return item;
  }
  function group(parent: THREE.Object3D, at: Vec3 = [0, 0, 0]) { const item = new THREE.Group(); item.position.set(...at); parent.add(item); return item; }
  function plant(parent: THREE.Object3D, at: Vec3, scale = 1) {
    const pot = group(parent, at); pot.scale.setScalar(scale);
    cylinder(pot, .18, .28, [0, .14, 0], '#d4936e', .13);
    cylinder(pot, .185, .04, [0, .27, 0], '#e6aa80');
    for (let i = 0; i < 5; i++) {
      const a = i * 2.4;
      const leaf = sphere(pot, [.075, .23 + i % 2 * .06, .055], [Math.sin(a) * .09, .48, Math.cos(a) * .09], i % 2 ? '#89ad73' : '#4e927c');
      leaf.rotation.set(Math.cos(a) * .6, a, Math.sin(a) * .6);
    }
    return pot;
  }
  // Batch all stationary scenery by material: nine detailed desks still require
  // only one draw call per material. Animated characters remain separate rigs.
  function batch(group: THREE.Group) {
    group.updateMatrixWorld(true);
    const buckets = new Map<THREE.Material | THREE.Material[], THREE.BufferGeometry[]>(), inverse = group.matrixWorld.clone().invert();
    group.traverse(item => {
      if (!(item instanceof THREE.Mesh)) return;
      const geometry = item.geometry.index ? item.geometry.toNonIndexed() : item.geometry.clone();
      geometry.applyMatrix4(inverse.clone().multiply(item.matrixWorld));
      const list = buckets.get(item.material) ?? []; list.push(geometry); buckets.set(item.material, list);
    });
    group.clear();
    for (const [material, list] of buckets) {
      const geo = mergeGeometries(list); for (const item of list) item.dispose();
      if (!geo) throw new Error('Cannot batch office geometry');
      merged.add(geo); const item = new THREE.Mesh(geo, material); item.castShadow = item.receiveShadow = true; group.add(item);
    }
  }
  return { box, cylinder, sphere, group, plant, batch, material,
    dispose() { for (const value of [...geometries.values(), ...merged, ...materials.values()]) value.dispose(); },
  };
}
