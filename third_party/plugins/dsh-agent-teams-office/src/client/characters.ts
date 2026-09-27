import { Rectangle, Texture } from 'pixi.js';
import { PALETTES, SEATS } from '../art/pixel-office.ts';
export { SEATS };
export const CHARACTERS = PALETTES.map(([shirt]) => ({ shirt: Number.parseInt(shirt.slice(1), 16) }));

/** Frames belong to one scene; destroying it releases all atlas views. */
export function characterFrames(atlas: Texture) {
  return CHARACTERS.map((_, index) => Array.from({ length: 3 }, (_, direction) =>
    Array.from({ length: 7 }, (_, frame) => new Texture({ source: atlas.source,
      frame: new Rectangle(frame * 16, (index * 3 + direction) * 32, 16, 32) }))));
}
