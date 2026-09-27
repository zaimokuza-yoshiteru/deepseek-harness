import type { OfficeSnapshot } from '../types.ts';
/** No entry until the host confirms Agent Teams; loss of connectivity preserves existing UI. */
export function createOfficeAvailability(register: () => () => void, clear: () => void) {
  let unregister: (() => void) | null;
  return {
    update(snapshot: OfficeSnapshot) {
      if (snapshot.state !== 'disabled' && !unregister) unregister = register();
      if (snapshot.state === 'disabled' && unregister) { unregister(); unregister = null; clear(); }
    },
    dispose() { unregister?.(); unregister = null; },
  };
}
