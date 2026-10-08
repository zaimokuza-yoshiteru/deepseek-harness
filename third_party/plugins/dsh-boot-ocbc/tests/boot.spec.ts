import { readFileSync } from 'node:fs'
import { createContext, runInContext } from 'node:vm'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

type FakeElement = {
  style: Record<string, string>; dataset: Record<string, string>; children: FakeElement[]
  listeners: Map<string, Array<(event: any) => void>>; parent?: FakeElement; removed: boolean
  append(child: FakeElement): void; remove(): void; setAttribute(name: string, value: string): void
  addEventListener(name: string, callback: (event: any) => void): void
  removeEventListener(name: string, callback: (event: any) => void): void
  dispatch(name: string, event?: unknown): void
  focus(options?: unknown): void
}

async function settle(): Promise<void> {
  for (let i = 0; i < 6; i += 1) await Promise.resolve()
}

function browserHarness(loadRenderer?: () => Promise<unknown>, options: { bodyInitially?: boolean } = {}) {
  const renderer = { disposed: 0, frames: [] as number[], render(time: number) { this.frames.push(time) }, dispose() { this.disposed += 1 } }
  const makeElement = (): FakeElement => ({
    style: {}, dataset: {}, children: [], listeners: new Map(), removed: false,
    append(child) {
      if (child.parent !== undefined) child.parent.children = child.parent.children.filter(item => item !== child)
      child.parent = this; this.children.push(child)
    },
    remove() {
      this.removed = true
      if (this.parent !== undefined) this.parent.children = this.parent.children.filter(child => child !== this)
    },
    setAttribute() {},
    focus() {},
    addEventListener(name, callback) { this.listeners.set(name, [...(this.listeners.get(name) ?? []), callback]) },
    removeEventListener(name, callback) { this.listeners.set(name, (this.listeners.get(name) ?? []).filter(item => item !== callback)) },
    dispatch(name, event = {}) { for (const listener of this.listeners.get(name) ?? []) listener(event) },
  })
  const documentListeners = new Map<string, Array<(event: any) => void>>()
  const windowListeners = new Map<string, Array<(event: any) => void>>()
  const root = makeElement()
  let body: FakeElement | null = options.bodyInitially === false ? null : makeElement()
  if (body !== null) root.append(body)
  const mutationCallbacks: Array<() => void> = []
  const timers = new Map<number, () => void>()
  const frames = new Map<number, (now: number) => void>()
  let timerId = 0
  let frameId = 0
  let now = 0
  let hidden = false
  const add = (table: typeof documentListeners, name: string, callback: (event: any) => void): void => {
    table.set(name, [...(table.get(name) ?? []), callback])
  }
  const remove = (table: typeof documentListeners, name: string, callback: (event: any) => void): void => {
    table.set(name, (table.get(name) ?? []).filter(item => item !== callback))
  }
  const window = {
    addEventListener: (name: string, cb: (event: any) => void) => add(windowListeners, name, cb),
    removeEventListener: (name: string, cb: (event: any) => void) => remove(windowListeners, name, cb),
    setTimeout: (cb: () => void) => { const id = ++timerId; timers.set(id, cb); return id },
  }
  const document = {
    currentScript: null,
    documentElement: root,
    get body() { return body },
    get hidden() { return hidden },
    createElement: makeElement,
    addEventListener: (name: string, cb: (event: any) => void) => add(documentListeners, name, cb),
    removeEventListener: (name: string, cb: (event: any) => void) => remove(documentListeners, name, cb),
  }
  const bootPath = resolve(dirname(fileURLToPath(import.meta.url)), '../src/boot.ts')
  const source = readFileSync(bootPath, 'utf8').replace(
    'await import(/* @vite-ignore */ rendererUrl) as RendererModule',
    'await loadMockRenderer() as RendererModule',
  )
  const js = ts.transpile(source, { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None })
  const sandbox = {
    AbortController, HTMLScriptElement: class {}, URL,
    MutationObserver: class {
      private connected = true
      constructor(private callback: () => void) { mutationCallbacks.push(() => { if (this.connected) this.callback() }) }
      observe() {}
      disconnect() { this.connected = false }
    },
    document, window, location: { href: 'http://localhost/' },
    loadMockRenderer: loadRenderer ?? (async () => ({ createRenderer: async () => renderer })),
    performance: { now: () => now },
    requestAnimationFrame: (cb: (time: number) => void) => { const id = ++frameId; frames.set(id, cb); return id },
    cancelAnimationFrame: (id: number) => { frames.delete(id) },
    clearTimeout: (id: number) => { timers.delete(id) },
  }
  const context = createContext(sandbox)
  runInContext(js, context)
  return {
    root, get body() { return body }, windowListeners, documentListeners, timers, frames, renderer, context,
    addBody() { body = makeElement(); root.append(body); for (const callback of [...mutationCallbacks]) callback() },
    rerun() { runInContext(js, context) },
    setNow(value: number) { now = value },
    setHidden(value: boolean) { hidden = value },
    fireTimer(id: number) { const callback = timers.get(id); timers.delete(id); callback?.() },
    fireFrame(id: number, time: number) { const callback = frames.get(id); frames.delete(id); callback?.(time) },
    replay() { (context as Record<string, any>).__DSH_BOOT_OCBC__.replay() },
  }
}

describe('dsh-boot-ocbc browser lifecycle', () => {
  it('mounts an immediate full-viewport 16:9 contain surface; click or Escape skips and cleans up', () => {
    const escapeCase = browserHarness(() => new Promise(() => {}))
    const overlay = escapeCase.body!.children[0]
    expect(overlay).toBeDefined()
    expect(overlay.style).toMatchObject({ position: 'fixed', inset: '0', width: '100vw', height: '100vh', zIndex: '2147483647', background: '#151517' })
    expect(overlay.children[0]!.style).toMatchObject({ position: 'relative', aspectRatio: '16 / 9', width: 'min(100vw, 177.7778vh)', height: 'min(100vh, 56.25vw)', visibility: 'hidden', background: '#151517' })
    const keyHandler = escapeCase.windowListeners.get('keydown')?.[0]
    keyHandler?.({ key: 'Escape', preventDefault() {} })
    expect(escapeCase.body!.children).toHaveLength(0)
    expect(escapeCase.windowListeners.get('keydown')).toHaveLength(0)
    expect(escapeCase.documentListeners.get('visibilitychange')).toHaveLength(0)

    const clickCase = browserHarness(() => new Promise(() => {}))
    clickCase.body!.children[0]!.dispatch('pointerdown')
    expect(clickCase.body!.children).toHaveLength(0)
  })


  it('moves an early documentElement mount into body once it appears so theme tokens inherit correctly', () => {
    const app = browserHarness(() => new Promise(() => {}), { bodyInitially: false })
    const overlay = app.root.children[0]!
    expect(app.body).toBeNull()
    app.addBody()
    expect(app.root.children).toHaveLength(1)
    expect(app.body!.children).toEqual([overlay])
    overlay.dispatch('pointerdown')
    expect(app.body!.children).toHaveLength(0)
  })

  it('plays the full 7.05 second sequence at normal frame cadence, fades, then disposes', async () => {
    const app = browserHarness()
    await settle()
    const frameStep = 7051 / 423
    app.fireFrame([...app.frames.keys()][0]!, 0)
    for (let frame = 1; frame <= 423; frame += 1) {
      app.fireFrame([...app.frames.keys()][0]!, frame * frameStep)
    }
    const overlay = app.body!.children[0]!
    expect(overlay.style.opacity).toBe('0')
    expect(app.renderer.frames.at(-1)).toBeCloseTo(7.05, 6)
    const fadeTimer = [...app.timers.keys()][0]!
    app.fireTimer(fadeTimer)
    expect(app.body!.children).toHaveLength(0)
    expect(app.renderer.disposed).toBe(1)
  })

  it('caps elapsed time to one 24fps source frame after a long visible RAF gap', async () => {
    const app = browserHarness()
    await settle()
    app.fireFrame([...app.frames.keys()][0]!, 0)
    app.fireFrame([...app.frames.keys()][0]!, 1000 / 60)
    expect(app.renderer.frames.at(-1)).toBeCloseTo(1 / 60, 6)

    // Two animation frames have established a baseline before the simulated 3s GPU/main-thread stall.
    app.fireFrame([...app.frames.keys()][0]!, 181000 / 60)
    expect(app.renderer.frames.at(-1)).toBeCloseTo(1 / 60 + 1 / 24, 6)
    expect(app.body!.children[0]!.style.opacity).toBe('1')

    app.fireFrame([...app.frames.keys()][0]!, 182000 / 60)
    expect(app.renderer.frames.at(-1)).toBeCloseTo(1 / 60 + 1 / 24 + 1 / 60, 6)
  })

  it('fails open on a missing renderer and a 20 second initial-load timeout', async () => {
    const missing = browserHarness(async () => { throw new Error('404') })
    await settle()
    expect(missing.body!.children).toHaveLength(0)

    const slow = browserHarness(() => new Promise(() => {}))
    expect(slow.body!.children).toHaveLength(1)
    const timeout = [...slow.timers.keys()][0]!
    slow.fireTimer(timeout)
    expect(slow.body!.children).toHaveLength(0)
    expect(slow.windowListeners.get('keydown')).toHaveLength(0)
  })

  it('disposes a renderer that finishes after a skip and prevents duplicate mounts', async () => {
    let resolveLate!: (value: any) => void
    const lateRenderer = { disposed: 0, render() {}, dispose() { this.disposed += 1 } }
    const pending = browserHarness(async () => ({ createRenderer: async () => new Promise(resolve => { resolveLate = resolve }) }))
    await settle()
    pending.body!.children[0]!.dispatch('pointerdown')
    resolveLate(lateRenderer)
    await settle()
    expect(pending.body!.children).toHaveLength(0)
    expect(lateRenderer.disposed).toBe(1)

    const duplicate = browserHarness(() => new Promise(() => {}))
    const oldOverlay = duplicate.body!.children[0]!
    duplicate.rerun()
    expect(oldOverlay.removed).toBe(true)
    expect(duplicate.body!.children).toHaveLength(1)
    expect(duplicate.windowListeners.get('keydown')).toHaveLength(1)
  })

  it('replay is idempotent while active and works again after skip and normal completion', async () => {
    const app = browserHarness()
    await settle()
    const api = (app.context as Record<string, any>).__DSH_BOOT_OCBC__
    app.replay()
    expect(app.body!.children).toHaveLength(1)
    expect(app.windowListeners.get('keydown')).toHaveLength(1)
    app.body!.children[0]!.dispatch('pointerdown')
    expect(app.body!.children).toHaveLength(0)

    app.replay()
    await settle()
    app.fireFrame([...app.frames.keys()][0]!, 0)
    for (let frame = 1; frame <= 423; frame += 1) {
      app.fireFrame([...app.frames.keys()][0]!, frame * (7051 / 423))
    }
    app.fireTimer([...app.timers.keys()][0]!)
    expect(app.body!.children).toHaveLength(0)
    app.replay()
    expect(app.body!.children).toHaveLength(1)
    expect(api).toBeDefined()
  })

  it('starts the elapsed clock at zero only when a delayed renderer is ready', async () => {
    let resolveReady!: (renderer: any) => void
    const delayed = { disposed: 0, frames: [] as number[], render(time: number) { this.frames.push(time) }, dispose() { this.disposed += 1 } }
    const app = browserHarness(async () => ({ createRenderer: async () => new Promise(resolve => { resolveReady = resolve }) }))
    expect(app.body!.children).toHaveLength(1)
    await settle()
    expect(app.frames.size).toBe(0)
    app.setNow(5000)
    resolveReady(delayed)
    await settle()

    expect(delayed.frames).toEqual([0])
    expect(app.body!.children[0]!.children[0]!.style.visibility).toBe('visible')
    app.fireFrame([...app.frames.keys()][0]!, 20_000)
    expect(delayed.frames).toEqual([0, 0])
    app.fireFrame([...app.frames.keys()][0]!, 20_000 + 1000 / 60)
    expect(delayed.frames.at(-1)).toBeCloseTo(1 / 60, 6)
    expect(app.body!.children[0]!.style.opacity).toBe('1')
  })

  it('keeps a renderer that finishes loading while hidden and starts at zero after visibility returns', async () => {
    let resolveReady!: (renderer: any) => void
    const delayed = { disposed: 0, frames: [] as number[], render(time: number) { this.frames.push(time) }, dispose() { this.disposed += 1 } }
    const app = browserHarness(async () => ({ createRenderer: async () => new Promise(resolve => { resolveReady = resolve }) }))
    await settle()
    app.setHidden(true)
    for (const listener of app.documentListeners.get('visibilitychange') ?? []) listener({})
    app.setNow(5000)
    resolveReady(delayed)
    await settle()

    expect(delayed.frames).toEqual([0])
    expect(delayed.disposed).toBe(0)
    expect(app.frames.size).toBe(0)
    expect(app.body!.children).toHaveLength(1)
    expect(app.body!.children[0]!.children[0]!.style.visibility).toBe('visible')

    app.setHidden(false)
    for (const listener of app.documentListeners.get('visibilitychange') ?? []) listener({})
    app.fireFrame([...app.frames.keys()][0]!, 20_000)
    expect(delayed.frames).toEqual([0, 0])
    app.fireFrame([...app.frames.keys()][0]!, 20_000 + 1000 / 60)
    expect(delayed.frames.at(-1)).toBeCloseTo(1 / 60, 6)
    expect(app.body!.children[0]!.style.opacity).toBe('1')
  })

  it('pauses the elapsed animation clock while the document is hidden', async () => {
    const app = browserHarness()
    await settle()
    app.fireFrame([...app.frames.keys()][0]!, 0)
    app.fireFrame([...app.frames.keys()][0]!, 1000 / 60)
    app.fireFrame([...app.frames.keys()][0]!, 2000 / 60)
    const beforeHide = app.renderer.frames.at(-1)!
    app.setHidden(true)
    for (const listener of app.documentListeners.get('visibilitychange') ?? []) listener({})
    expect(app.frames.size).toBe(0)
    app.setNow(6000)
    app.setHidden(false)
    for (const listener of app.documentListeners.get('visibilitychange') ?? []) listener({})
    app.fireFrame([...app.frames.keys()][0]!, 7050)
    expect(app.renderer.frames.at(-1)).toBeCloseTo(beforeHide, 6)
    expect(app.body!.children[0]!.style.opacity).toBe('1')
    app.fireFrame([...app.frames.keys()][0]!, 7050 + 1000 / 60)
    expect(app.renderer.frames.at(-1)).toBeCloseTo(beforeHide + 1 / 60, 6)
  })
  it('loops on the same renderer without fading, and exits by button or Escape', async () => {
    const app = browserHarness()
    await settle()
    app.body!.children[0]!.dispatch('pointerdown')
    const api = (app.context as Record<string, any>).__DSH_BOOT_OCBC__
    api.toggleLoop('退出循环 · Esc')
    await settle()
    const overlay = app.body!.children[0]!
    const frameStep = 7051 / 423
    app.fireFrame([...app.frames.keys()][0]!, 0)
    for (let frame = 1; frame <= 423; frame += 1) {
      app.fireFrame([...app.frames.keys()][0]!, frame * frameStep)
    }
    expect(app.renderer.frames.at(-1)).toBe(0)
    app.fireFrame([...app.frames.keys()][0]!, 423 * frameStep + frameStep)
    expect(app.renderer.frames.at(-1)).toBeCloseTo(frameStep / 1000, 6)
    for (let frame = 2; frame <= 423; frame += 1) {
      app.fireFrame([...app.frames.keys()][0]!, 423 * frameStep + frame * frameStep)
    }
    expect(app.renderer.frames.at(-1)).toBe(0)
    expect(overlay.style.opacity).toBe('1')
    expect(app.timers.size).toBe(0)
    expect(app.renderer.disposed).toBe(1)
    overlay.dispatch('pointerdown')
    expect(app.body!.children).toHaveLength(1)
    overlay.children[1]!.dispatch('click')
    expect(app.body!.children).toHaveLength(0)
    expect(app.renderer.disposed).toBe(2)
    expect(app.frames.size).toBe(0)
    api.toggleLoop()
    await settle()
    app.windowListeners.get('keydown')?.[0]?.({ key: 'Escape', preventDefault() {} })
    expect(app.body!.children).toHaveLength(0)
    expect(app.renderer.disposed).toBe(3)
  })

  it('toggles off during loading, cleans up late assets, and can start a normal replay', async () => {
    const pending: Array<(value: unknown) => void> = []
    const app = browserHarness(async () => ({ createRenderer: () => new Promise(resolve => pending.push(resolve)) }))
    await settle()
    const api = (app.context as Record<string, any>).__DSH_BOOT_OCBC__
    api.toggleLoop()
    await settle()
    expect(app.body!.children).toHaveLength(1)
    api.toggleLoop()
    expect(app.body!.children).toHaveLength(0)
    expect(app.timers.size).toBe(0)
    const late = { render() {}, dispose() { this.disposed++ }, disposed: 0 }
    pending.forEach(resolve => resolve(late))
    await settle()
    expect(late.disposed).toBe(2)
    api.replay()
    expect(app.body!.children).toHaveLength(1)
    expect(app.body!.children[0]!.children).toHaveLength(1)
    api.dispose()
    expect(app.body!.children).toHaveLength(0)
    expect(app.windowListeners.get('keydown')).toHaveLength(0)
  })

})
