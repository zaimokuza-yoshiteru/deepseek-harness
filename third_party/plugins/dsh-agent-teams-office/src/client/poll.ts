import { asError } from '../types.ts';
/** Sequential polling with a bounded request and no writes after disposal. */
export function pollSnapshot<T>(load: (signal: AbortSignal) => Promise<T>, changed: (value: T) => void, failed: (error: Error) => void, interval = 1500) {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  async function next() {
    try { const value = await load(controller.signal); if (!controller.signal.aborted) changed(value); }
    catch (error) { if (!controller.signal.aborted) failed(asError(error)); }
    if (!controller.signal.aborted) timer = setTimeout(next, interval);
  }
  void next();
  return () => { controller.abort(); clearTimeout(timer); };
}
