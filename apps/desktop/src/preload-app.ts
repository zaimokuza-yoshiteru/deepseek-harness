/** Startup controls for shell documents and the experiment bridge for application documents. */

import type { DesktopExperimentsApi } from './experiments.ts'
import { contextBridge, ipcRenderer } from 'electron'
import { DESKTOP_IPC, type DshDesktopStartupApi } from './ipc.ts'
import type { DesktopBackendState } from './backend-controller.ts'

const startup: DshDesktopStartupApi = {
  protocolVersion: 1,
  locale: () => ipcRenderer.invoke(DESKTOP_IPC.localeGet) as ReturnType<DshDesktopStartupApi['locale']>,
  backend: {
    status: () => ipcRenderer.invoke(DESKTOP_IPC.backendStatus) as ReturnType<DshDesktopStartupApi['backend']['status']>,
    subscribe(listener) {
      const handle = (_event: Electron.IpcRendererEvent, state: DesktopBackendState): void => { listener(state) }
      ipcRenderer.on(DESKTOP_IPC.backendState, handle)
      return () => { ipcRenderer.off(DESKTOP_IPC.backendState, handle) }
    },
  },
  disablePlugins: () => ipcRenderer.invoke(DESKTOP_IPC.pluginsDisableAll) as Promise<void>,
  restart: () => ipcRenderer.invoke(DESKTOP_IPC.applicationRestart) as Promise<void>,
  resetConfiguration: () => ipcRenderer.invoke(DESKTOP_IPC.configurationReset) as Promise<void>,
}

const experiments: DesktopExperimentsApi = {
  version: 1,
  list: () => ipcRenderer.invoke(DESKTOP_IPC.experimentsList) as ReturnType<DesktopExperimentsApi['list']>,
  setEnabled: change => ipcRenderer.invoke(DESKTOP_IPC.experimentsSet, change) as ReturnType<DesktopExperimentsApi['setEnabled']>,
}

contextBridge.exposeInMainWorld('dshDesktop', location.protocol === 'dsh-app:' && location.hostname === 'shell'
  ? startup : location.protocol === 'dsh-app:' && location.hostname === 'app'
    ? { protocolVersion: 1, experiments } : { protocolVersion: 1 })
