import type { OfficeScene } from '../types.ts';
import type { PixelEntry } from './pixel-activities.ts';
import { createActivityEffects } from './activity-effects.ts';
import { createPixelActivities } from './pixel-activities.ts';
import { Application, Container, Texture, Text } from 'pixi.js';
import 'pixi.js/unsafe-eval';
import { TiledMapRenderer } from '../../vendor/munder/office/TiledMapRenderer';
import { Character } from '../../vendor/munder/office/Character';
import { Camera } from '../../vendor/munder/office/Camera';
import { CHARACTERS, characterFrames, SEATS } from './characters.ts';
import mapRaw from '../assets/studio/office.tmj';
import officeImage from '../assets/studio/office.png';
import charactersImage from '../assets/studio/characters.png';
import { reconcileSeats } from '../shared.ts';
import { syncMotion } from './motion.ts';
import { LEAD_BOUNDS, TEAM_BOUNDS } from '../art/pixel-office.ts';

/** A self-contained renderer. The caller owns its lifetime and data. */
export async function createOfficeScene(element: HTMLElement, onSelect: (id: string) => void, onError: (error: Error) => void): Promise<OfficeScene> {
  const app = new Application();
  const atlases: Texture[] = [];
  let frames: Texture[][][] = [];
  const characters = new Map<string, PixelEntry>();
  let observer: ResizeObserver, activities: ReturnType<typeof createPixelActivities>, effects: ReturnType<typeof createActivityEffects>;
  let seats = new Map<string, number>();
  let destroyed = false;
  let initialized = false;
  const destroy = () => {
    if (destroyed) return;
    destroyed = true;
    observer?.disconnect(); activities?.dispose(); effects?.destroy();
    for (const { character, label } of characters.values()) { character.destroy(); label.destroy(); }
    characters.clear();
    if (initialized) app.destroy(true, { children: true, texture: true, textureSource: false });
    for (const member of frames) for (const row of member) for (const texture of row) texture.destroy();
    for (const texture of atlases) texture.destroy(true);
  };
  try {
    await app.init({ background: '#161b20', antialias: false, autoDensity: true,
      resolution: Math.min(window.devicePixelRatio || 1, 2), preference: 'webgl',
      width: Math.max(element.clientWidth, 100), height: Math.max(element.clientHeight, 100) });
    initialized = true;
    for (const url of [officeImage, charactersImage]) {
      const image = new Image(); image.src = url; await image.decode();
      const texture = Texture.from(image); texture.source.scaleMode = 'nearest'; atlases.push(texture);
    }
    frames = characterFrames(atlases[1]);
    const data = JSON.parse(mapRaw);
    const map = new TiledMapRenderer(data, [atlases[0]]);
    const world = new Container(); world.addChild(map.getContainer()); app.stage.addChild(world);
    const camera = new Camera(world);
    camera.setMapSize(map.width * map.tileSize, map.height * map.tileSize);
    const resize = () => {
      if (destroyed) return;
      const width = Math.max(element.clientWidth, 100), height = Math.max(element.clientHeight, 100);
      app.renderer.resize(width, height); camera.setViewSize(width, height);
    };
    observer = new ResizeObserver(resize); observer.observe(element); resize();
    app.canvas.setAttribute('aria-label', 'Agent Teams office');
    app.canvas.addEventListener('webglcontextlost', event => {
      // Pixi deliberately loses the GPU context on destroy; that is not a scene failure.
      if (destroyed) return;
      event.preventDefault(); onError(new Error('WebGL context lost'));
    });
    element.appendChild(app.canvas);
    effects=createActivityEffects(element,id=>{const c=characters.get(id)?.character;if(!c)return null;const p=c.getPixelPosition();return world.toGlobal({x:p.x,y:p.y-28});});
    activities=createPixelActivities({characters,map,effects});
    app.ticker.add(ticker => {
      const dt = Math.min(ticker.deltaMS / 1000, 0.05); camera.update(dt); activities.tick(dt);
      for (const { character, label } of characters.values()) {
        character.update(dt);
        const position = character.getPixelPosition(); label.position.set(position.x, position.y + 5);
      }
      effects.draw(dt);
    });
    return {
      destroy,
      activities(events, options) {activities.tasks(options.tasks ?? []);effects.label(options.label);for(const [id,tool] of Object.entries(options.tools ?? {})){const entry=characters.get(id);if(entry?.status==='running'&&!activities.owns(id))entry.character.showThought(tool.name,tool.name);}if(options.reset)activities.reset();activities.enqueue(events);},
      setActive(active) { if (active) app.start(); else app.stop(); },
      fit() { camera.fitToScreen(); },
      focus(id) {
        if (id === null) return false;
        const entry = characters.get(id);
        if (!entry) return false;
        const p = entry.character.getPixelPosition(); camera.focusOn(p.x, p.y, 2.6); return true;
      },
      update(members, statusLabel) {
        if (destroyed) return;
        seats = reconcileSeats(seats, members, SEATS.length);
        for (const [id, entry] of characters) {
          if (!seats.has(id)) { entry.character.destroy(); entry.label.destroy(); characters.delete(id); }
        }
        for (const member of members) {
          const seat = seats.get(member.id); if (seat === undefined) continue;
          let entry = characters.get(member.id);
          if (!entry) {
            const castIndex = seat;
            const tile = map.getSpawnPoint(SEATS[seat]); if (!tile) continue;
            const character = new Character({ agentId: member.id, mapRenderer: map, frames: frames[castIndex],
              seatTile: tile, seatDirection: 'up', roamBounds: member.role === 'lead' ? LEAD_BOUNDS : TEAM_BOUNDS, glowColor: CHARACTERS[castIndex].shirt, onClick: onSelect });
            character.show(map.getCharacterContainer()); character.setCupSpot({x:tile.x*16+18,y:tile.y*16-12});
            const label = new Text({ text: member.name, style: { fontFamily: 'system-ui', fontSize: 8,
              fill: '#fffdf5', stroke: { color: '#161b20', width: 3 }, fontWeight: '600' }, resolution: 2 });
            label.anchor.set(0.5, 0); label.eventMode = 'none'; label.zIndex = 100001;
            map.getCharacterContainer().addChild(label);
            entry = { character, label, status: null, motion: null }; characters.set(member.id, entry);
          }
          const shortName = member.name.replace(/^worker-/, '');
          entry.label.text = shortName.length > 14 ? shortName.slice(0, 13) + '…' : shortName;
          if (entry.status !== member.status) {
            entry.status = member.status;
            if(!activities.owns(member.id))entry.motion = syncMotion(entry.character, member.status, entry.motion);
          }
          // Only show real state labels, never invented assistant dialogue.
          if (!activities.owns(member.id) && (member.status === 'running' || member.status === 'failed' || member.status === 'provisioning')) {
            entry.character.showThought(statusLabel(member.status));
          } else entry.character.hideThought();
        }
        activities.update(members.filter(m=>seats.has(m.id)));
      },
    };
  } catch (error) { destroy(); throw error; }
}
