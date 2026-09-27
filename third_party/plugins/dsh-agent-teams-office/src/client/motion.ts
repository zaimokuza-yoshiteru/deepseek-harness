import type { Character } from '../../vendor/munder/office/Character';
import type { MemberStatus } from '../types.ts';
export type PixelMotion = 'roam' | 'work' | 'wait';
/** Apply a real Teams status without restarting ongoing idle walks on each poll. */
export function syncMotion(character: Pick<Character, 'setStatusGlyph' | 'setBaseAlpha' | 'startWandering' | 'sitAtDesk'>, status: MemberStatus | null, previousMotion: PixelMotion | null): PixelMotion {
  const motion = status === 'idle' || status === 'inactive' ? 'roam' : status === 'running' ? 'work' : 'wait';
  character.setStatusGlyph(status === 'failed' ? 'blocked' : 'none');
  character.setBaseAlpha(1);
  if (motion !== previousMotion) {
    if (motion === 'roam') character.startWandering(false);
    else character.sitAtDesk(motion === 'work');
  }
  return motion;
}
