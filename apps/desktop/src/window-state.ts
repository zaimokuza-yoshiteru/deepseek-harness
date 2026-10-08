/** Primary Desktop window placement, stored with other Electron device state. */

import { readFileSync } from 'node:fs'
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'

export interface DesktopWindowBounds {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

export interface DesktopWindowState {
  readonly version: 1
  readonly bounds: DesktopWindowBounds
  readonly maximized: boolean
  readonly fullscreen: boolean
}

export interface DesktopWindowDisplay {
  readonly workArea: DesktopWindowBounds
}

export interface DesktopWindowStateTarget {
  getNormalBounds(): DesktopWindowBounds
  isMaximized(): boolean
  isFullScreen(): boolean
  isMinimized(): boolean
  isDestroyed(): boolean
  maximize(): void
  setFullScreen(fullscreen: boolean): void
  on(event: string, listener: () => void): unknown
  off(event: string, listener: () => void): unknown
}

/** A pending atomic replacement exceeded the bound allowed for shutdown preparation. */
export class DesktopWindowStateFlushTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`desktop window state: flush exceeded ${timeoutMs} ms`)
    this.name = 'DesktopWindowStateFlushTimeoutError'
  }
}

const STATE_VERSION = 1
const MAX_COORDINATE = 100_000
const MAX_DIMENSION = 100_000
const VISIBLE_TITLEBAR_WIDTH = 160
const VISIBLE_TITLEBAR_HEIGHT = 48

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isBounds(value: unknown): value is DesktopWindowBounds {
  if (typeof value !== 'object' || value === null) return false
  const bounds = value as Record<string, unknown>
  return isFiniteNumber(bounds.x) && Math.abs(bounds.x) <= MAX_COORDINATE
    && isFiniteNumber(bounds.y) && Math.abs(bounds.y) <= MAX_COORDINATE
    && isFiniteNumber(bounds.width) && bounds.width >= 1 && bounds.width <= MAX_DIMENSION
    && isFiniteNumber(bounds.height) && bounds.height >= 1 && bounds.height <= MAX_DIMENSION
}

function parseState(value: unknown): DesktopWindowState | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const state = value as Record<string, unknown>
  if (state.version !== STATE_VERSION || !isBounds(state.bounds)
    || typeof state.maximized !== 'boolean' || typeof state.fullscreen !== 'boolean') return undefined
  return {
    version: STATE_VERSION,
    bounds: { x: state.bounds.x, y: state.bounds.y, width: state.bounds.width, height: state.bounds.height },
    maximized: state.maximized,
    fullscreen: state.fullscreen,
  }
}

function intersectionArea(left: DesktopWindowBounds, right: DesktopWindowBounds): number {
  const width = Math.max(0, Math.min(left.x + left.width, right.x + right.width) - Math.max(left.x, right.x))
  const height = Math.max(0, Math.min(left.y + left.height, right.y + right.height) - Math.max(left.y, right.y))
  return width * height
}

function distanceSquared(left: DesktopWindowBounds, right: DesktopWindowBounds): number {
  const leftX = left.x + left.width / 2
  const leftY = left.y + left.height / 2
  const rightX = right.x + right.width / 2
  const rightY = right.y + right.height / 2
  return (leftX - rightX) ** 2 + (leftY - rightY) ** 2
}

function validDisplays(displays: readonly DesktopWindowDisplay[]): DesktopWindowDisplay[] {
  return displays.filter(({ workArea }) => isBounds(workArea))
}

/** Keep restored geometry reachable when the saved monitor has been removed or rearranged. */
export function clampDesktopWindowState(
  state: DesktopWindowState,
  displays: readonly DesktopWindowDisplay[],
  minimum: { readonly width: number; readonly height: number },
): DesktopWindowState {
  const available = validDisplays(displays)
  if (available.length === 0) return { ...state,
    bounds: { ...state.bounds, width: Math.max(minimum.width, state.bounds.width), height: Math.max(minimum.height, state.bounds.height) } }

  const display = available.reduce((best, candidate) => {
    const bestOverlap = intersectionArea(state.bounds, best.workArea)
    const candidateOverlap = intersectionArea(state.bounds, candidate.workArea)
    if (candidateOverlap !== bestOverlap) return candidateOverlap > bestOverlap ? candidate : best
    return distanceSquared(state.bounds, candidate.workArea) < distanceSquared(state.bounds, best.workArea) ? candidate : best
  })
  const area = display.workArea
  // Respect BrowserWindow's native minimum even if the selected display is smaller.
  const width = Math.max(minimum.width, Math.min(state.bounds.width, Math.max(minimum.width, area.width)))
  const height = Math.max(minimum.height, Math.min(state.bounds.height, Math.max(minimum.height, area.height)))
  const visibleWidth = Math.min(width, Math.min(VISIBLE_TITLEBAR_WIDTH, area.width))
  const visibleHeight = Math.min(height, Math.min(VISIBLE_TITLEBAR_HEIGHT, area.height))
  const fitsHorizontally = width <= area.width
  const minimumX = fitsHorizontally ? area.x : area.x + area.width - visibleWidth - width
  const maximumX = fitsHorizontally ? area.x + area.width - width : area.x + area.width - visibleWidth
  const minimumY = area.y
  const maximumY = height <= area.height ? area.y + area.height - height : area.y + area.height - visibleHeight
  const x = Math.max(minimumX, Math.min(state.bounds.x, maximumX))
  const y = Math.max(minimumY, Math.min(state.bounds.y, maximumY))
  return { ...state, bounds: { x, y, width, height } }
}

/** Read small, versioned device state; malformed or unreadable files use Electron defaults. */
export function readDesktopWindowState(path: string, displays: readonly DesktopWindowDisplay[],
  minimum: { readonly width: number; readonly height: number }): DesktopWindowState | undefined {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'))
    const state = parseState(parsed)
    return state === undefined ? undefined : clampDesktopWindowState(state, displays, minimum)
  } catch {
    return undefined
  }
}

/** Debounced, atomic persistence attached only after the primary workspace is revealed. */
export class DesktopWindowStatePersistence {
  private readonly restored: DesktopWindowState | undefined
  private active: DesktopWindowStateTarget | undefined
  private state: DesktopWindowState | undefined
  private everActivated = false
  private maximizedBeforeFullscreen = false
  private preservingBoundsOnFullscreenExit = false
  private timer: ReturnType<typeof setTimeout> | undefined
  private writeQueue: Promise<void> = Promise.resolve()
  private queuedState: DesktopWindowState | undefined
  private readonly listeners = new Map<string, () => void>()

  /** @param path - state file under Electron userData. @param displays - current display work areas in DIP. */
  constructor(private readonly path: string, displays: () => readonly DesktopWindowDisplay[],
    private readonly onError: (error: unknown) => void = (error) => { console.warn('desktop window state: could not persist state', error) },
    private readonly debounceMs = 400) {
    this.restored = readDesktopWindowState(path, displays(), { width: 520, height: 600 })
    this.state = this.restored
  }

  /** Restored normal bounds for the BrowserWindow constructor, or `undefined` for first launch. */
  get initialBounds(): DesktopWindowBounds | undefined {
    const bounds = this.state?.bounds ?? this.restored?.bounds
    return bounds === undefined ? undefined : { ...bounds }
  }

  /** Apply prior presentation only when entering the actual workspace, then observe user changes. */
  activate(window: DesktopWindowStateTarget): void {
    if (window === this.active) return
    this.detachListeners()
    this.active = window
    this.everActivated = true
    this.state ??= this.restored ?? {
      version: STATE_VERSION,
      bounds: window.getNormalBounds(),
      maximized: false,
      fullscreen: false,
    }
    this.maximizedBeforeFullscreen = this.state.maximized
    if (this.state.maximized) window.maximize()
    if (this.state.fullscreen) window.setFullScreen(true)
    this.listen(window, 'move', () => this.updateNormalBounds())
    this.listen(window, 'resize', () => this.updateNormalBounds())
    this.listen(window, 'maximize', () => this.updateMaximized(true))
    this.listen(window, 'unmaximize', () => this.updateMaximized(false))
    this.listen(window, 'enter-full-screen', () => this.enterFullscreen())
    this.listen(window, 'leave-full-screen', () => this.leaveFullscreen())
    this.listen(window, 'show', () => this.resumeAfterFullscreenHide())
  }

  /** Preserve normal geometry while macOS leaves fullscreen to hide the window. */
  prepareForHide(window: DesktopWindowStateTarget): void {
    if (window !== this.active || !window.isFullScreen() || this.state === undefined) return
    this.preservingBoundsOnFullscreenExit = true
    this.state = { ...this.state, fullscreen: false }
    this.schedule()
  }

  /** Persist the cached last-good geometry before a window is destroyed. */
  async close(window: DesktopWindowStateTarget): Promise<void> {
    if (window !== this.active) return
    this.clearTimer()
    this.queueState()
    this.detachListeners()
    this.active = undefined
    await this.writeQueuedState()
  }

  /** Capture current non-transient state and wait briefly for atomic replacement to finish. */
  async flush(timeoutMs = 1_000): Promise<void> {
    const window = this.active
    if (window !== undefined && !window.isDestroyed()) this.capture(window)
    this.clearTimer()
    this.queueState()
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      await Promise.race([this.writeQueuedState(), new Promise<void>((_resolve, reject) => {
        timer = setTimeout(() => { reject(new DesktopWindowStateFlushTimeoutError(timeoutMs)) }, timeoutMs)
      })])
    } finally {
      if (timer !== undefined) clearTimeout(timer)
    }
  }

  private listen(window: DesktopWindowStateTarget, event: string, listener: () => void): void {
    window.on(event, listener)
    this.listeners.set(event, listener)
  }

  private detachListeners(): void {
    if (this.active === undefined) return
    for (const [event, listener] of this.listeners) this.active.off(event, listener)
    this.listeners.clear()
  }

  private capture(window: DesktopWindowStateTarget): void {
    if (this.state === undefined || window.isDestroyed()) return
    if (this.preservingBoundsOnFullscreenExit) {
      this.state = { ...this.state, maximized: this.maximizedBeforeFullscreen, fullscreen: false }
      return
    }
    const fullscreen = window.isFullScreen()
    const maximized = fullscreen ? this.maximizedBeforeFullscreen : window.isMaximized()
    const bounds = fullscreen || window.isMinimized() || maximized ? this.state.bounds : window.getNormalBounds()
    this.state = { version: STATE_VERSION, bounds, maximized, fullscreen }
  }

  private updateNormalBounds(): void {
    const window = this.active
    if (window === undefined || this.state === undefined || window.isDestroyed()
      || this.preservingBoundsOnFullscreenExit
      || window.isFullScreen() || window.isMinimized() || window.isMaximized()) return
    this.state = { ...this.state, bounds: window.getNormalBounds() }
    this.schedule()
  }

  private updateMaximized(maximized: boolean): void {
    const window = this.active
    if (window === undefined || this.state === undefined || window.isDestroyed()) return
    if (this.preservingBoundsOnFullscreenExit) return
    if (window.isFullScreen()) {
      this.maximizedBeforeFullscreen = maximized
      return
    }
    this.maximizedBeforeFullscreen = maximized
    this.state = { ...this.state, bounds: window.getNormalBounds(), maximized }
    this.schedule()
  }

  private enterFullscreen(): void {
    const window = this.active
    if (window === undefined || this.state === undefined || window.isDestroyed()) return
    this.maximizedBeforeFullscreen = window.isMaximized() || this.state.maximized
    this.state = { ...this.state, maximized: this.maximizedBeforeFullscreen, fullscreen: true }
    this.schedule()
  }

  private leaveFullscreen(): void {
    const window = this.active
    if (window === undefined || this.state === undefined || window.isDestroyed()) return
    if (this.preservingBoundsOnFullscreenExit) {
      this.state = { ...this.state, maximized: this.maximizedBeforeFullscreen, fullscreen: false }
      this.schedule()
      return
    }
    const maximized = window.isMaximized()
    this.maximizedBeforeFullscreen = maximized
    this.state = { ...this.state, bounds: window.getNormalBounds(), maximized, fullscreen: false }
    this.schedule()
  }

  private resumeAfterFullscreenHide(): void {
    const window = this.active
    if (!this.preservingBoundsOnFullscreenExit || window === undefined || this.state === undefined || window.isDestroyed()) return
    this.preservingBoundsOnFullscreenExit = false
    const maximized = window.isMaximized()
    this.maximizedBeforeFullscreen = maximized
    this.state = { ...this.state, bounds: window.getNormalBounds(), maximized, fullscreen: false }
    this.schedule()
  }

  private schedule(): void {
    this.clearTimer()
    this.timer = setTimeout(() => {
      this.timer = undefined
      this.queueState()
      void this.writeQueuedState().catch(this.onError)
    }, this.debounceMs)
  }

  private clearTimer(): void {
    if (this.timer === undefined) return
    clearTimeout(this.timer)
    this.timer = undefined
  }

  private queueState(): void {
    if (this.everActivated && this.state !== undefined) this.queuedState = { ...this.state, bounds: { ...this.state.bounds } }
  }

  private writeQueuedState(): Promise<void> {
    this.writeQueue = this.writeQueue.catch(() => {}).then(async () => {
      while (this.queuedState !== undefined) {
        const state = this.queuedState
        this.queuedState = undefined
        await writeFileAtomic(this.path, `${JSON.stringify(state)}\n`, { mode: 0o600, dirMode: 0o700 })
      }
    })
    return this.writeQueue
  }
}
