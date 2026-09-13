/** Application bridge exposes experiments without package-management privileges. */

import { contextBridge, ipcRenderer } from 'electron'
import { DESKTOP_IPC } from './ipc.ts'
import type { DesktopExperimentsApi, DesktopExperimentsSnapshot, DesktopExperimentResult } from './experiments.ts'

const experiments: DesktopExperimentsApi = {
  version: 1,
  list: () => ipcRenderer.invoke(DESKTOP_IPC.experimentsList) as Promise<DesktopExperimentsSnapshot>,
  setEnabled: change => ipcRenderer.invoke(DESKTOP_IPC.experimentsSet, change) as Promise<DesktopExperimentResult>,
}
contextBridge.exposeInMainWorld('dshDesktop', { protocolVersion: 1, experiments })
