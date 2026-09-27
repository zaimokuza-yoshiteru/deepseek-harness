import * as THREE from 'three';
import { createKit } from './kit.ts';
import { makeCharacter } from './characters.ts';
import { ROOM, LEAD_ROOM, STATIONS } from './layout.ts';

export function makeTeamOffice() {
  const kit = createKit(), root = new THREE.Group(), scenery = kit.group(root);
  const { box, cylinder, group, plant } = kit;
  const wood = '#b98060', edge = '#90654e', cream = '#f6e8ca';
  const colors = ['#77afb9', '#d9b374', '#a0b991', '#b294ad'];
  box(scenery, [ROOM.width, .27, ROOM.depth], [0, -.17, 0], '#829f9b', .12);
  box(scenery, [ROOM.width - .14, .10, ROOM.depth - .14], [0, .005, 0], '#e7d4b4', .06);
  // Broad staggered planks keep the overview quiet.
  for (let z = 0; z < 23; z++) for (let x = 0; x < 8; x++) {
    box(scenery, [2.96, .022, .594], [-10.5 + x * 3, .067, -6.65 + z * .60], ['#e8d3b0', '#e5cfa9', '#edd9b7'][(z + x) % 3], .005);
  }
  box(scenery, [24, 2.35, .15], [0, 1.2, -7.0], '#99b8af', .025);
  box(scenery, [.15, 2.35, 14], [-11.91, 1.2, 0], '#b4cabb', .025);
  box(scenery, [24, .09, .21], [0, 2.40, -7.0], '#d0ddc7', .02);
  box(scenery, [.21, .09, 14], [-11.91, 2.40, 0], '#d5e0c9', .02);
  box(scenery, [23.7, .14, .05], [0, .17, -6.9], '#d2dcc6', .01);
  for (const x of [-8.7, -3.1, 2.8, 8.5]) {
    box(scenery, [2.6, 1.22, .08], [x, 1.64, -6.87], cream, .025);
    box(scenery, [2.42, 1.05, .035], [x, 1.65, -6.81], '#b7d7d9', .008);
    box(scenery, [.065, 1.12, .07], [x, 1.65, -6.77], cream, .01);
    box(scenery, [2.5, .055, .06], [x, 1.68, -6.77], cream, .01);
    box(scenery, [2.8, .10, .26], [x, 1.05, -6.75], cream, .025);
  }
  // Lead's private room. Low cutaway partitions keep the whole avatar visible;
  // the front door is a real opening, used by event-driven visits.
  box(scenery, [6.30, .025, 5.66], [-8.65, .084, -4.00], '#b9c7af', .02);
  box(scenery, [.14, .78, 5.78], [-5.50, .46, -4.0], '#92aaa1', .025);
  box(scenery, [.20, .065, 5.80], [-5.50, .88, -4.0], '#e6dcc1', .022);
  for (const [x, width] of [[-10.50, 2.56], [-6.46, 1.92]]) {
    box(scenery, [width, .78, .14], [x, .46, -1.12], '#a6beb0', .025);
    box(scenery, [width + .05, .065, .20], [x, .88, -1.12], '#e6dcc1', .02);
  }
  // Open doorway: no overhead frame or plaque obscuring the Lead.
  plant(scenery, [-11.10, .10, -6.30], 1.65);
  plant(scenery, [-6.16, .10, -6.30], 1.45);
  // The private desk is wider and warmer; a guest stool is placed at the side.
  const screens: ReturnType<typeof box>[] = [];
  function desk(index: number) {
    const station = STATIONS[index], lead = station.lead;
    const base = group(scenery, [station.x, .08, station.z]);
    const width = lead ? 2.85 : 2.42, accent = lead ? '#699b94' : colors[(index - 1) % 4];
    box(base, [width + .36, .025, 2.28], [0, .015, .48], lead ? '#829c8f' : '#bbcec3', .10);
    box(base, [width, .14, .91], [0, .89, 0], wood, .045);
    for (const x of [-width / 2 + .13, width / 2 - .13]) for (const z of [-.31, .31]) box(base, [.13, .75, .13], [x, .45, z], edge, .02);
    box(base, [.43, .41, .68], [width / 2 - .36, .64, 0], '#d4ae7b', .028);
    for (const y of [.54, .74]) {
      box(base, [.40, .175, .035], [width / 2 - .36, y, .365], '#e8c18b', .012);
      cylinder(base, .025, .04, [width / 2 - .36, y, .403], edge).rotation.x = Math.PI / 2;
    }
    box(base, [1.08, .018, .32], [-.12, .971, .22], accent, .02);
    box(base, [.38, .038, .23], [-.12, .984, -.17], '#d5dfd7', .014);
    box(base, [.065, .24, .065], [-.12, 1.10, -.20], '#bccbca', .008);
    box(base, [.87, .57, .07], [-.12, 1.39, -.22], cream, .022);
    box(base, [.78, .47, .015], [-.12, 1.395, -.175], '#355268', .008);
    for (let line = 0; line < 4; line++) box(base, [.26 + line % 2 * .16, .017, .009], [-.20 + line % 2 * .05, 1.51 - line * .079, -.162], line % 2 ? '#e3bf7d' : '#91bcb5', .002);
    box(base, [.62, .035, .23], [-.12, .997, .23], cream, .014);
    for (let line = 0; line < 3; line++) box(base, [.51, .012, .027], [-.12, 1.02, .16 + line * .063], '#b9cfcc', .004);
    box(base, [.10, .055, .16], [.40, 1.00, .24], cream, .027);
    plant(base, [-width / 2 + .23, .97, -.14], .55);
    cylinder(base, .065, .13, [.68, 1.035, .21], '#e9cea1');
    cylinder(base, .049, .008, [.68, 1.104, .21], '#755548');
    for (let i = 0; i < 3; i++) box(base, [.09, .21 + i % 2 * .05, .21], [-width / 2 + .18 + i * .105, 1.08, .24], [accent, cream, '#d6a15b'][i], .008);
    if (lead) {
      cylinder(base, .11, .035, [1.07, .983, -.20], '#e9bd68');
      box(base, [.033, .40, .033], [1.07, 1.19, -.20], '#70868a', .008);
      cylinder(base, .085, .12, [1.02, 1.39, -.20], '#efc86e', .15);
    }
    // Chairs match the shortened rig: .46 world seat height.
    const chair = group(base, [-.12, 0, .70]);
    cylinder(chair, .045, .25, [0, .20, 0], '#6c8588');
    for (const [x, z] of [[-.23,-.12],[.23,-.12],[-.23,.19],[.23,.19]]) {
      box(chair, [.09, .075, .09], [x, .06, z], '#677f84', .022);
      box(chair, [.06, .07, .30], [x / 2, .10, z / 2], '#7e9291', .01).rotation.y = x > 0 ? .9 : -.9;
    }
    box(chair, [.60, .12, .53], [0, .38, 0], accent, .056);
    box(chair, [.59, .46, .12], [0, .66, .265], accent, .065);
    for (const x of [-.34, .34]) box(chair, [.09, .06, .26], [x, .59, .04], accent, .028);
    const screen = box(root, [.10, .026, .017], [station.x + .19, 1.265, station.z - .162], '#92bca8', .004);
    screens.push(screen);
  }
  STATIONS.forEach((_, index) => desk(index));
  // Lounge, coffee counter, and meeting table sit outside the Lead's room.
  const lounge = group(scenery, [-8.65, .08, 1.70]);
  box(lounge, [4.45, .035, 3.40], [0, .012, 0], '#d9bd8c', .14);
  box(lounge, [2.65, .37, .88], [-.25, .38, -.95], '#dcb66d', .12);
  box(lounge, [2.65, .54, .20], [-.25, .72, -1.30], '#e6c37b', .08);
  for (const x of [-1.47, .98]) box(lounge, [.25, .45, .91], [x, .60, -.95], '#e6c37b', .07);
  for (const x of [-.90, .45]) box(lounge, [.42, .38, .16], [x, .74, -1.16], '#8ab5bd', .08).rotation.z = x > 0 ? .13 : -.13;
  box(lounge, [1.8, .10, .85], [-.15, .49, .23], wood, .08);
  for (const x of [-.83, .52]) box(lounge, [.13, .38, .57], [x, .26, .23], edge, .02);
  box(lounge, [.46, .07, .32], [-.46, .58, .23], '#82a3ac', .014);
  plant(lounge, [.40, .55, .17], .57);
  plant(scenery, [-11.1, .1, 1.9], 1.8);
  const coffee = group(scenery, [-11.05, .08, 4.65]);
  box(coffee, [.90, .90, 2.45], [0, .45, 0], '#9aada1', .035);
  box(coffee, [1.03, .10, 2.56], [0, .96, 0], cream, .028);
  box(coffee, [.43, .56, .60], [0, 1.28, -.62], '#566a6d', .055);
  box(coffee, [.025, .19, .36], [.233, 1.24, -.62], '#273e4c', .005);
  for (const z of [.2, .55]) cylinder(coffee, .085, .16, [.22, 1.09, z], '#e9c581');
  plant(coffee, [0, 1.02, 1.0], .65);
  const meeting = group(scenery, [-7.70, .08, 4.75]);
  box(meeting, [2.50, .12, 1.32], [0, .80, 0], wood, .095);
  for (const x of [-.9, .9]) for (const z of [-.43, .43]) box(meeting, [.12, .73, .12], [x, .40, z], edge, .016);
  for (const x of [-.65,.65]) for (const z of [-1.02,1.02]) {
    box(meeting, [.52,.11,.49], [x,.39,z], '#81a4b1', .046);
    box(meeting, [.50,.42,.10], [x,.62,z + Math.sign(z)*.20], '#81a4b1', .045);
    for (const dx of [-.18,.18]) box(meeting, [.07,.30,.36], [x+dx,.20,z], edge, .012);
  }
  plant(meeting, [0,.88,0], .65);
  // Wall board and shelves give the open plan a workplace identity.
  box(scenery, [.09, 1.22, 2.30], [-11.78, 1.61, -2.60], wood, .035);
  box(scenery, [.03, 1.07, 2.14], [-11.71, 1.61, -2.60], cream, .012);
  for (let i = 0; i < 6; i++) box(scenery, [.025,.23,.29], [-11.68,1.40 + Math.floor(i/3)*.35,-3.22 + i%3*.54], colors[i%4], .012);
  kit.batch(scenery);
  const characters = STATIONS.map((station, index) => {
    const rig = makeCharacter(kit, root, index); rig.avatar.visible = false;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(.41, .021, 6, 32), new THREE.MeshBasicMaterial({ color: '#edbb58', transparent: true, opacity: .8 }));
    ring.rotation.x = -Math.PI / 2; ring.position.set(station.x - .12, .135, station.z + .70); ring.visible = false; root.add(ring);
    return { ...rig, ring, screen: screens[index] };
  });
  return { root, characters, kit, leadRoom: LEAD_ROOM,
    dispose() { for (const rig of characters) { rig.ring.geometry.dispose(); rig.ring.material.dispose(); } kit.dispose(); },
  };
}
