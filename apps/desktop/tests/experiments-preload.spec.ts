import { describe, expect, it, vi } from 'vitest'
import type { DesktopExperimentsApi } from '../src/experiments.ts'
import { DESKTOP_IPC } from '../src/ipc.ts'
const electron = vi.hoisted(() => ({
  contextBridge: { exposeInMainWorld: vi.fn() },
  ipcRenderer: { invoke: vi.fn(), on: vi.fn(), off: vi.fn() },
}))
vi.mock('electron', () => electron)

describe('context-isolated experiment bridge', () => {
  it('exposes versioned experiment calls in the app without package or raw IPC access', async () => {
    await import('../src/preload-app.ts')
    const [name, api] = electron.contextBridge.exposeInMainWorld.mock.calls.at(-1)! as [
      string, { protocolVersion: number; experiments: DesktopExperimentsApi },
    ]
    expect(name).toBe('dshDesktop')
    expect(Object.keys(api)).toEqual(['protocolVersion', 'experiments'])
    expect(api.experiments.version).toBe(1)
    await api.experiments.list()
    const request = { profile: '/owned', id: 'agent-teams' as const, enabled: false, expectedEnabled: true }
    await api.experiments.setEnabled(request)
    expect(electron.ipcRenderer.invoke.mock.calls).toEqual([[DESKTOP_IPC.experimentsList], [DESKTOP_IPC.experimentsSet, request]])
  })

  it('keeps management-window package privileges separate from experiments', async () => {
    await import('../src/preload.ts')
    const [, api] = electron.contextBridge.exposeInMainWorld.mock.calls.at(-1)! as [string, object]
    expect(Object.keys(api)).toEqual(['protocolVersion', 'locale', 'plugins', 'updates'])
  })
})
