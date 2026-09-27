import { asError, type OfficeScene, type SceneFactory, type OfficeSnapshot, type OfficeActivity, type StatusLabel, type ActivityLabel, type ViewMode, type Cursor } from '../types.ts';
export interface OfficeState { snapshot: OfficeSnapshot | null; selected: string | null; focused: string | null; sceneError: Error | null; ready: boolean; view: ViewMode }
export interface SceneMount { visible(value: boolean): void; detach(): void }
export interface OfficeRecord { key: string; subscribe(listener: () => void): () => void; getSnapshot(): OfficeState; select(id: string | null): void; cursor(): Cursor | null; snapshot(value: OfficeSnapshot): void; update(members: OfficeSnapshot['members'], labels: StatusLabel, activityLabel: ActivityLabel): void; setView(view: ViewMode): void; fit(): void; focus(id: string): void; mount(element: HTMLElement, signal: AbortSignal): SceneMount; retry(): void; dispose(): void }
import { createActivityInbox } from './activities.ts';
/** Keep each office's canvas and UI state alive for its native sidebar tab lifetime. */
export function createSceneCache(createScene: SceneFactory, createHost = () => document.createElement('div')) {
  const records = new Map<string, OfficeRecord>();
  function get(key: string): OfficeRecord {
    if (records.has(key)) return records.get(key)!;
    let state: OfficeState = { snapshot: null, selected: null, focused: null, sceneError: null, ready: false, view: 'team' };
    let host: HTMLElement | undefined, scene: OfficeScene | null | undefined, pending: object | null | undefined, owner: { visible: boolean } | null | undefined, disposed = false;
    const inbox = createActivityInbox();
    let activities: OfficeActivity[] = [], resetActivities = false;
    const listeners = new Set<() => void>(), signals = new Map<AbortSignal, () => void>();
    const publish = (patch: Partial<OfficeState>) => { state = { ...state, ...patch }; for (const listener of listeners) listener(); };
    const cancelFocus = () => { if (state.focused !== null) { scene?.focus(null); publish({ focused: null }); } };
    const initialize = () => {
      if (pending || disposed || !host) return;
      const attempt = {}; pending = attempt;
      createScene(host, id => record.select(id), error => {
        if (!disposed && pending === attempt) publish({ sceneError: error });
      }, { view: state.view })
        .then(value => {
          if (disposed || pending !== attempt) { value.destroy(); return; }
          scene = value; scene.setActive(!!owner?.visible); publish({ ready: true });
        }).catch(error => { if (!disposed && pending === attempt) publish({ sceneError: asError(error) }); });
    };
    const record: OfficeRecord = {
      key,
      subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
      getSnapshot() { return state; },
      select(id) { if (id !== state.selected) cancelFocus(); publish({ selected: id }); },
      cursor() { return inbox.cursor(); },
      snapshot(value) {
        if (state.selected !== null && !value.members.some(member => member.id === state.selected)) record.select(null);
        const fresh = inbox.accept(value);
        if (value.reset || value.state !== 'live') { activities = []; resetActivities = true; }
        activities.push(...fresh); activities = activities.slice(-64);
        publish({ snapshot: value });
      },
      update(members, labels, activityLabel) {
        scene?.update(members, labels, state.selected);
        if (scene) {
          scene.activities?.(activities, { reset: resetActivities, label: activityLabel, tools: state.snapshot?.tools ?? {}, tasks: state.snapshot?.tasks ?? [] });
          activities = []; resetActivities = false;
        }
      },
      setView(view) {
        if (view === state.view || !['team', 'pixel'].includes(view)) return;
        cancelFocus();
        scene?.destroy(); scene = null; pending = null;
        publish({ view, ready: false, sceneError: null }); if (host) initialize();
      },
      fit() { cancelFocus(); scene?.fit(); },
      focus(id) {
        if (!state.ready || !scene) return;
        if (state.view === 'pixel') { scene.focus(id); return; }
        if (state.focused === id) { cancelFocus(); return; }
        if (scene.focus(id)) publish({ focused: id });
      },
      mount(element, signal) {
        if (signal.aborted || disposed) return { visible() {}, detach() {} };
        if (!signals.has(signal)) {
          const release = () => { signals.delete(signal); if (!signals.size) record.dispose(); };
          signals.set(signal, release); signal.addEventListener('abort', release, { once: true });
        }
        host ??= createHost(); host.className = 'office-scene-host'; element.appendChild(host);
        const seat = { visible: false }; owner = seat;
        initialize();
        const attachedHost = host;
        return {
          visible(value) { if (owner === seat) { seat.visible = value; scene?.setActive(value); } },
          detach() { if (owner === seat) { owner = null; scene?.setActive(false); attachedHost.remove(); } },
        };
      },
      retry() {
        cancelFocus();
        scene?.destroy(); scene = null; pending = null;
        publish({ ready: false, sceneError: null }); initialize();
      },
      dispose() {
        if (disposed) return;
        disposed = true; scene?.destroy(); host?.remove();
        for (const [signal, listener] of signals) signal.removeEventListener('abort', listener);
        signals.clear(); listeners.clear(); records.delete(key);
      },
    };
    records.set(key, record);
    return record;
  }
  return { get, has: (key: string) => records.has(key), dispose() { for (const record of records.values()) record.dispose(); } };
}
