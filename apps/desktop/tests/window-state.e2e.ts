import { existsSync } from 'node:fs'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execa } from 'execa'
import { expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const builtState = fileURLToPath(new URL('../lib/types/window-state.js', import.meta.url))

it.skipIf(process.platform !== 'darwin')('restores native macOS window bounds and fullscreen across process restarts', { retry: 0, timeout: 150_000 }, async () => {
  if (!existsSync(builtState)) throw new Error('Build apps/desktop/tsconfig.host.json before this native test')
  const root = await mkdtemp(join(tmpdir(), 'dsh-window-state-native-'))
  try {
    const userData = join(root, 'user-data')
    await mkdir(userData)
    const electron: unknown = require('electron')
    if (typeof electron !== 'string') throw new Error('Electron executable is unavailable')
    const fixture = fileURLToPath(new URL('./fixtures/window-state-smoke.mjs', import.meta.url))
    const states: { bounds: unknown; fullscreen: boolean }[] = []
    for (const phase of ['first', 'restart', 'fullscreen-restart']) {
      const result = await execa(electron, [fixture, builtState, userData, phase], {
        env: { ELECTRON_RUN_AS_NODE: undefined }, timeout: 45_000, forceKillAfterDelay: 5_000, reject: false,
      })
      expect(result.timedOut, result.stderr).toBe(false)
      expect(result.signal, result.stderr).toBeUndefined()
      expect(result.exitCode, result.stderr).toBe(0)
      const line = result.stdout.split('\n').find(value => value.startsWith('WINDOW_STATE_RESULT '))
      if (line === undefined) throw new Error(`Missing Electron result: ${result.stdout}\n${result.stderr}`)
      const parsed = JSON.parse(line.slice('WINDOW_STATE_RESULT '.length)) as { phase: string; state: { bounds: unknown; fullscreen: boolean } }
      expect(parsed.phase).toBe(phase)
      states.push(parsed.state)
    }
    expect(states.map(state => state.bounds)).toEqual([states[0]!.bounds, states[0]!.bounds, states[0]!.bounds])
    expect(states.map(state => state.fullscreen)).toEqual([false, true, false])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
