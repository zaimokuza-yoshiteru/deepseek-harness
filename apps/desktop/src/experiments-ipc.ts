/** Experiment IPC accepts only the owning application's top-level frame. */

import type { IpcMain, IpcMainInvokeEvent, WebContents } from 'electron'
import { DESKTOP_IPC } from './ipc.ts'
import type { DesktopExperiments } from './experiments.ts'

/** Register the experiment-only operations for the main application window.
 * @param ipc - Electron's application-owned handler registry.
 * @param application - Current main-window contents; management windows have no access.
 * @param experiments - Current profile's guarded experiment controller.
 */
export function registerDesktopExperiments(
  ipc: Pick<IpcMain, 'handle'>,
  application: () => WebContents | undefined,
  experiments: DesktopExperiments,
): void {
  const authorize = (event: IpcMainInvokeEvent): void => {
    const contents = application()
    if (contents === undefined || contents.isDestroyed() || event.sender !== contents || event.senderFrame !== contents.mainFrame) {
      throw new Error('dsh desktop: experiments require the main application frame')
    }
    const url = new URL(event.senderFrame.url)
    if (url.protocol !== 'dsh-app:' || url.hostname !== 'app') {
      throw new Error('dsh desktop: experiments require the application origin')
    }
  }
  ipc.handle(DESKTOP_IPC.experimentsList, (event) => {
    authorize(event)
    return experiments.snapshot()
  })
  ipc.handle(DESKTOP_IPC.experimentsSet, (event, change: unknown) => {
    authorize(event)
    return experiments.setEnabled(change)
  })
}
