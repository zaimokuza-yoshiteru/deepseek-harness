import type { IpcMainInvokeEvent, WebContents, WebFrameMain } from 'electron'
import { describe, expect, it, vi } from 'vitest'
import { registerDesktopExperiments } from '../src/experiments-ipc.ts'
import { DesktopExperiments } from '../src/experiments.ts'
import { DESKTOP_IPC } from '../src/ipc.ts'

// Electron supplies native objects; fixtures model only the properties checked by authorization.
function frame(url: string): WebFrameMain { return { url } as WebFrameMain }
function contents(mainFrame: WebFrameMain): WebContents { return { mainFrame, isDestroyed: () => false } as WebContents }

describe('application-only experiment IPC', () => {
  it('accepts the main app frame and rejects management windows, iframes and foreign origins', async () => {
    type Handler = (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown
    const handlers = new Map<string, Handler>()
    const ipc = { handle: (channel: string, listener: Handler) => { handlers.set(channel, listener) } }
    const mainFrame = frame('dsh-app://app/')
    const application = contents(mainFrame)
    const controller = new DesktopExperiments({ profile: '/owned', supported: false, enabled: () => false, busy: () => false, setBusy: () => {}, stopIfIdle: async () => false, change: async () => {}, recover: async () => {} })
    const change = vi.spyOn(controller, 'setEnabled')
    registerDesktopExperiments(ipc, () => application, controller)
    expect([...handlers.keys()]).toEqual([DESKTOP_IPC.experimentsList, DESKTOP_IPC.experimentsSet])
    const event = { sender: application, senderFrame: mainFrame } as IpcMainInvokeEvent
    expect(await handlers.get(DESKTOP_IPC.experimentsList)!(event)).toEqual({ profile: '/owned', features: [] })
    await handlers.get(DESKTOP_IPC.experimentsSet)!(event, {})
    expect(change).toHaveBeenCalledOnce()
    for (const sender of [
      { sender: contents(frame('dsh-app://shell/plugin-manager.html')), senderFrame: frame('dsh-app://shell/plugin-manager.html') },
      { sender: application, senderFrame: frame('dsh-app://app/iframe') },
      { sender: application, senderFrame: null },
    ]) {
      for (const handler of handlers.values()) expect(() => handler(sender as IpcMainInvokeEvent, {})).toThrow('main application frame')
    }
    for (const url of ['https://app/', 'dsh-app://shell/', 'file:///app']) {
      Object.assign(mainFrame, { url })
      expect(() => handlers.get(DESKTOP_IPC.experimentsSet)!(event, {})).toThrow('application origin')
    }
    expect(change).toHaveBeenCalledOnce()
  })
})
