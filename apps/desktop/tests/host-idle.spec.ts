import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { runDesktopHost } from '../../desktop-host/src/index.ts'

const state = vi.hoisted(() => ({ context: {} }))
vi.mock('@deepseek-ai/dsh-app-boot', () => ({
  boot: async () => state.context,
  composeEntries: () => [],
  loadLayeredEnv: () => ({}),
  loadProfileDirectory: () => ({ layers: [], patches: [] }),
  loadOverlayPatches: () => [],
}))

describe('desktop host idle restart guard', () => {
  it('refuses running agents and in-flight API work until both finish', async () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-host-idle-'))
    const reply = Promise.withResolvers<Response>()
    const apiStarted = Promise.withResolvers<undefined>()
    const dispose = vi.fn(async () => {})
    const agents: Array<{ status: string }> = []
    const api = { fetch: async () => { apiStarted.resolve(undefined); return reply.promise } }
    state.context = {
      agents: { list: () => agents },
      fiber: { dispose },
      get: (name: string) => name === 'connection' ? { createSharedFetchHandler: () => api } : {},
    }
    let host: Awaited<ReturnType<typeof runDesktopHost>> | undefined
    let request: Promise<void> | undefined
    try {
      const modules = join(root, 'node_modules', '@deepseek-ai')
      mkdirSync(join(modules, 'dsh'), { recursive: true })
      writeFileSync(join(modules, 'dsh', 'package.json'), '{"version":"0.1.5-rc.2"}')
      mkdirSync(join(modules, 'dsh-web-frontend', 'dist'), { recursive: true })
      writeFileSync(join(modules, 'dsh-web-frontend', 'dist', 'index.html'), '<html></html>')
      host = await runDesktopHost(root, async () => {})
      expect(host.canRestart()).toBe(true)
      agents.push({ status: 'running' })
      expect(host.canRestart()).toBe(false)
      agents[0]!.status = 'idle'
      expect(host.canRestart()).toBe(true)
      request = host.fetch({ streamId: 1, request: {
        url: 'dsh-app://app/api/test', method: 'POST', headers: [],
      } }, null)
      await apiStarted.promise
      expect(host.canRestart()).toBe(false)
      reply.resolve(new Response(null, { status: 204 }))
      await request
      expect(host.canRestart()).toBe(true)
      await host.dispose()
      expect(dispose).toHaveBeenCalledTimes(1)
    } finally {
      reply.resolve(new Response(null, { status: 204 }))
      await request
      await host?.dispose()
      state.context = {}
      rmSync(root, { recursive: true, force: true })
    }
  })
})
