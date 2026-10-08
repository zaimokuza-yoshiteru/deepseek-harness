import { EventEmitter } from 'node:events'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import {
  DesktopWindowStatePersistence,
  readDesktopWindowState,
  type DesktopWindowBounds,
  type DesktopWindowDisplay,
} from '../src/window-state.ts'

const directories: string[] = []

afterEach(async () => {
  vi.useRealTimers()
  await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

async function stateFile(): Promise<{ directory: string; path: string }> {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-window-state-'))
  directories.push(directory)
  return { directory, path: join(directory, 'window-state.json') }
}

const display: DesktopWindowDisplay = { workArea: { x: 0, y: 24, width: 1440, height: 876 } }

class FakeWindow extends EventEmitter {
  bounds: DesktopWindowBounds = { x: 40, y: 60, width: 1280, height: 820 }
  maximized = false
  fullscreen = false
  minimized = false
  destroyed = false
  readonly maximize = vi.fn(() => { this.maximized = true; this.emit('maximize') })
  readonly setFullScreen = vi.fn((value: boolean) => {
    this.fullscreen = value
    this.emit(value ? 'enter-full-screen' : 'leave-full-screen')
  })
  getNormalBounds() { return { ...this.bounds } }
  isMaximized() { return this.maximized }
  isFullScreen() { return this.fullscreen }
  isMinimized() { return this.minimized }
  isDestroyed() { return this.destroyed }
}

it('falls back for missing, malformed, unsupported, and structurally invalid state', async () => {
  const { path } = await stateFile()
  expect(readDesktopWindowState(path, [display], { width: 520, height: 600 })).toBeUndefined()
  await writeFile(path, '{broken')
  expect(readDesktopWindowState(path, [display], { width: 520, height: 600 })).toBeUndefined()
  await writeFile(path, JSON.stringify({
    version: 2, bounds: { x: 1, y: 2, width: 800, height: 700 }, maximized: false, fullscreen: false,
  }))
  expect(readDesktopWindowState(path, [display], { width: 520, height: 600 })).toBeUndefined()
  await writeFile(path, JSON.stringify({ version: 1, bounds: { x: 1, y: 2, width: 0, height: 700 }, maximized: false, fullscreen: false }))
  expect(readDesktopWindowState(path, [display], { width: 520, height: 600 })).toBeUndefined()
})

it('does not write a stored state while the primary window has not entered the workspace', async () => {
  const { path } = await stateFile()
  const original = '{"version":1,"bounds":{"x":90,"y":70,"width":1200,"height":780},"maximized":false,"fullscreen":false}\n'
  await writeFile(path, original)
  const persistence = new DesktopWindowStatePersistence(path, () => [display])
  expect(persistence.initialBounds).toEqual({ x: 90, y: 70, width: 1200, height: 780 })
  await persistence.flush()
  expect(await readFile(path, 'utf8')).toBe(original)
})

it('clamps saved DIP bounds to a current work area after a monitor is disconnected', async () => {
  const { path } = await stateFile()
  await writeFile(path, JSON.stringify({ version: 1,
    bounds: { x: -4000, y: -1200, width: 1800, height: 1100 }, maximized: true, fullscreen: false }))
  expect(readDesktopWindowState(path, [display], { width: 520, height: 600 })).toEqual({ version: 1,
    bounds: { x: 0, y: 24, width: 1440, height: 876 }, maximized: true, fullscreen: false })
})

it('applies presentation only on activation and debounces normal bounds and state changes', async () => {
  vi.useFakeTimers()
  const { path } = await stateFile()
  await writeFile(path, JSON.stringify({ version: 1,
    bounds: { x: 75, y: 90, width: 1180, height: 760 }, maximized: true, fullscreen: false }))
  const persistence = new DesktopWindowStatePersistence(path, () => [display], undefined, 30)
  const window = new FakeWindow()
  expect(persistence.initialBounds).toEqual({ x: 75, y: 90, width: 1180, height: 760 })
  expect(window.maximize).not.toHaveBeenCalled()
  persistence.activate(window)
  expect(window.maximize).toHaveBeenCalledOnce()
  expect(await readFile(path, 'utf8')).toContain('"x":75')

  window.maximized = false
  window.bounds = { x: 180, y: 130, width: 1100, height: 740 }
  window.emit('unmaximize')
  window.bounds = { ...window.bounds, x: 220 }
  window.emit('move')
  await vi.advanceTimersByTimeAsync(29)
  expect(JSON.parse(await readFile(path, 'utf8'))).toMatchObject({ bounds: { x: 75 }, maximized: true })
  await vi.advanceTimersByTimeAsync(1)
  await persistence.flush()
  expect(JSON.parse(await readFile(path, 'utf8'))).toMatchObject({ bounds: { x: 220, y: 130 }, maximized: false })
  expect(persistence.initialBounds).toEqual({ x: 220, y: 130, width: 1100, height: 740 })
  await persistence.close(window)
})

it('keeps normal bounds while saving maximized and minimized presentation', async () => {
  vi.useFakeTimers()
  const { path } = await stateFile()
  const persistence = new DesktopWindowStatePersistence(path, () => [display], undefined, 10)
  const window = new FakeWindow()
  const normal = { x: 120, y: 100, width: 1100, height: 700 }
  window.bounds = normal
  persistence.activate(window)
  await persistence.flush()

  window.maximized = true
  window.emit('maximize')
  window.bounds = { x: 0, y: 24, width: 1440, height: 876 }
  window.emit('resize')
  await persistence.flush()
  expect(JSON.parse(await readFile(path, 'utf8'))).toMatchObject({ bounds: normal, maximized: true, fullscreen: false })

  window.minimized = true
  window.bounds = { x: 0, y: 0, width: 600, height: 500 }
  window.emit('resize')
  await persistence.flush()
  expect(JSON.parse(await readFile(path, 'utf8'))).toMatchObject({ bounds: normal, maximized: true, fullscreen: false })
  await persistence.close(window)
})

it('keeps normal geometry when fullscreen is left only to hide the primary window', async () => {
  vi.useFakeTimers()
  const { path } = await stateFile()
  const normal = { x: 90, y: 70, width: 1200, height: 780 }
  await writeFile(path, JSON.stringify({ version: 1, bounds: normal, maximized: false, fullscreen: true }))
  const persistence = new DesktopWindowStatePersistence(path, () => [display], undefined, 10)
  const window = new FakeWindow()
  window.bounds = { x: 0, y: 0, width: 1440, height: 900 }
  persistence.activate(window)
  expect(window.setFullScreen).toHaveBeenCalledWith(true)
  persistence.prepareForHide(window)
  window.setFullScreen(false)
  window.bounds = { x: 0, y: 0, width: 1440, height: 900 }
  window.emit('move')
  window.emit('resize')
  window.emit('unmaximize')
  await vi.advanceTimersByTimeAsync(10)
  await persistence.flush()
  expect(JSON.parse(await readFile(path, 'utf8'))).toMatchObject({ bounds: normal, maximized: false, fullscreen: false })
  await persistence.close(window)
})
