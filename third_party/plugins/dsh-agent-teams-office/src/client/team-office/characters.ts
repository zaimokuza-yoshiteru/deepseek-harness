import type { Object3D } from 'three';
import type { createKit } from './kit.ts';
// Original silhouettes guided by the supplied reference: deep side/back hair,
// broad heads, compact torsos, short separated hands and feet. No imported art.
export const CHARACTERS = [
  { hair: 'part', hairColor: '#3e3b42', skin: '#e8b084', coat: '#447e86', pants: '#394d64', accent: '#f4dcac', glasses: true, label: 'lead' },
  { hair: 'bob', hairColor: '#a8583d', skin: '#f1bd93', coat: '#6c94b5', pants: '#464c71', accent: '#f3d181', label: 'bob' },
  { hair: 'sweep', hairColor: '#d6a152', skin: '#f4c5a2', coat: '#617b55', pants: '#3e5265', accent: '#f8e7ba', label: 'sweep' },
  { hair: 'bun', hairColor: '#b76840', skin: '#e9b390', coat: '#9a7ab5', pants: '#514865', accent: '#f3cb79', label: 'bun' },
  { hair: 'crop', hairColor: '#353741', skin: '#ac7251', coat: '#d28b53', pants: '#465868', accent: '#eed9b3', label: 'crop' },
  { hair: 'ponytail', hairColor: '#514044', skin: '#dfaa82', coat: '#c57876', pants: '#59677c', accent: '#f6d3a1', label: 'ponytail' },
  { hair: 'waves', hairColor: '#afbbc1', skin: '#d8a57b', coat: '#507fad', pants: '#46536a', accent: '#d8e6d9', glasses: true, label: 'waves' },
  { hair: 'bald', hairColor: '#674c3a', skin: '#ba7d58', coat: '#d4aa4e', pants: '#546851', accent: '#f5e5b6', label: 'bald' },
  { hair: 'cap', hairColor: '#745240', skin: '#f0bd97', coat: '#718f90', pants: '#5e5274', accent: '#efc178', label: 'cap' },
  { hair: 'doublebun', hairColor: '#3a3d48', skin: '#d79871', coat: '#af6c67', pants: '#435574', accent: '#edcfa6', label: 'doublebun' },
  { hair: 'headband', hairColor: '#d8ad70', skin: '#f3c5a0', coat: '#5d998c', pants: '#645877', accent: '#f1c579', label: 'headband' },
  { hair: 'longbob', hairColor: '#45414c', skin: '#dbae8c', coat: '#ad94bd', pants: '#4b6373', accent: '#e7d7c0', label: 'longbob' },
  { hair: 'curl', hairColor: '#925740', skin: '#d0966f', coat: '#dec99e', pants: '#775c70', accent: '#809da1', label: 'curl' },
  { hair: 'quiff', hairColor: '#76858d', skin: '#f0bf98', coat: '#6b9379', pants: '#41576f', accent: '#edc694', label: 'quiff' },
  { hair: 'beanie', hairColor: '#3d3540', skin: '#a67154', coat: '#d3a16b', pants: '#626384', accent: '#e3d0a4', label: 'beanie' },
  { hair: 'lowbun', hairColor: '#795342', skin: '#ecc19e', coat: '#698ca3', pants: '#58685c', accent: '#e7c093', label: 'lowbun' },
  { hair: 'braid', hairColor: '#bd8752', skin: '#e8b590', coat: '#bd8c9b', pants: '#485a73', accent: '#ebd6a6', label: 'braid' },
];

export function makeCharacter(kit: ReturnType<typeof createKit>, parent: Object3D, index: number) {
  const { box, sphere, group } = kit, look = CHARACTERS[index];
  const avatar = group(parent), body = group(avatar);
  box(body, [.55, .37, .36], [0, .53, 0], look.coat, .06);
  box(body, [.43, .10, .31], [0, .33, 0], look.pants, .025);
  box(body, [.12, .27, .018], [0, .55, .186], look.accent, .012);
  box(body, [.12, .085, .021], [.16, .54, .192], look.accent, .01);
  // No long exposed neck. Head occupies almost half the standing height.
  const head = group(body, [0, 1.01, 0]);
  box(head, [.70, .60, .57], [0, 0, 0], look.skin, .105);
  for (const sign of [-1, 1]) {
    sphere(head, [.079, .103, .077], [sign * .362, -.045, .015], look.skin);
    box(head, [.050, .073, .024], [sign * .145, -.02, .288], '#343644', .013);
    box(head, [.064, .018, .015], [sign * .145, .07, .289], look.hairColor, .004);
    sphere(head, [.064, .025, .008], [sign * .226, -.11, .284], '#d99579');
  }
  sphere(head, [.04, .036, .032], [0, -.075, .30], look.skin);
  box(head, [.07, .015, .012], [0, -.17, .291], '#9e6655', .005);
  const hair = group(head); hair.name = `hair-${look.hair}`;
  if (look.hair !== 'bald') {
    const color = look.hairColor, bob = ['bob', 'longbob'].includes(look.hair);
    // Hair forms a continuous cap with two side panels reaching both ears,
    // rather than a little slab perched on the top of the skull.
    box(hair, [.735, .23, .62], [0, .258, -.025], color, .09);
    box(hair, [.72, bob ? .53 : .44, .17], [0, bob ? -.015 : .035, -.275], color, .06);
    for (const sign of [-1, 1]) {
      box(hair, [.115, bob ? .48 : .34, .42], [sign * .324, bob ? -.005 : .075, -.072], color, .046);
      box(hair, [.10, .25, .12], [sign * .327, .046, .145], color, .034);
    }
    if (look.hair === 'part' || look.hair === 'sweep' || look.hair === 'waves') {
      const fringe = box(hair, [.48, .17, .13], [-.092, .226, .272], color, .043); fringe.rotation.z = -.13;
      box(hair, [.20, .15, .13], [.244, .204, .262], color, .04);
      if (look.hair === 'waves') for (const x of [-.24, 0, .24]) sphere(hair, [.13, .10, .16], [x, .33, .01], color);
    } else {
      box(hair, [.65, .15, .15], [0, .222, .258], color, .043);
    }
    if (look.hair === 'bun') {
      sphere(hair, [.18, .15, .17], [0, .40, -.17], color);
      box(hair, [.24, .035, .23], [0, .34, -.17], look.accent, .025);
    }
    if (look.hair === 'ponytail') {
      box(hair, [.26, .10, .24], [0, .16, -.36], look.accent, .04);
      box(hair, [.30, .38, .24], [0, -.035, -.43], color, .09);
    }
    if (look.hair === 'doublebun') for (const sign of [-1, 1]) sphere(hair, [.15, .15, .17], [sign * .33, .29, -.13], color);
    if (look.hair === 'headband') box(hair, [.76, .07, .13], [0, .25, .255], look.accent, .026);
    if (look.hair === 'longbob') for (const sign of [-1, 1]) box(hair, [.16, .30, .40], [sign * .31, -.19, -.09], color, .055);
    if (look.hair === 'curl') for (const sign of [-1, 1]) sphere(hair, [.15, .14, .14], [sign * .29, .27, .16], color);
    if (look.hair === 'quiff') { const quiff = box(hair, [.52, .17, .40], [-.05, .35, .05], color, .065); quiff.rotation.z = -.12; }
    if (look.hair === 'beanie') {
      box(hair, [.77, .28, .65], [0, .32, -.025], '#82738e', .10);
      box(hair, [.78, .09, .66], [0, .224, -.025], '#a493ad', .025);
    }
    if (look.hair === 'lowbun') sphere(hair, [.20, .16, .17], [0, -.11, -.38], color);
    if (look.hair === 'braid') for (let i = 0; i < 3; i++) sphere(hair, [.10, .12, .10], [.32, -.16 - i * .13, -.18], color);
    if (look.hair === 'cap') {
      box(hair, [.79, .24, .66], [0, .31, -.015], '#7a80b4', .075);
      box(hair, [.58, .065, .35], [0, .218, .347], '#646fa1', .035);
      box(hair, [.085, .09, .015], [0, .31, .323], look.accent, .015);
    }
  }
  if (look.glasses) {
    // Open frames preserve the eyes at overview scale.
    for (const sign of [-1, 1]) {
      const x = sign * .157;
      for (const y of [-.103, .059]) box(head, [.245, .027, .027], [x, y, .323], '#f5e5c7', .01);
      for (const dx of [-.11, .11]) box(head, [.027, .18, .027], [x + dx, -.022, .323], '#f5e5c7', .01);
    }
    box(head, [.09, .028, .028], [0, -.012, .331], '#f5e5c7', .008);
  }
  const arms = [], legs = [];
  for (const sign of [-1, 1]) {
    const shoulder = group(body, [sign * .36, .65, 0]);
    box(shoulder, [.19, .18, .24], [0, -.07, 0], look.coat, .035);
    const hand = group(shoulder, [0, -.23, .008]);
    box(hand, [.19, .16, .21], [0, 0, .025], look.skin, .04);
    arms.push({ shoulder, hand });
    const hip = group(body, [sign * .15, .31, 0]);
    box(hip, [.23, .19, .25], [0, -.07, 0], look.pants, .035);
    const foot = group(hip, [0, -.19, .045]);
    box(foot, [.25, .12, .34], [0, -.018, .025], '#f5ead4', .038);
    box(foot, [.25, .033, .34], [0, -.066, .025], '#9eaead', .012);
    legs.push({ hip, foot });
  }
  return { avatar, body, head, hair, arms, legs, look };
}
