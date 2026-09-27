/** Classic-script bootstrap shared by official Web and Desktop clients. */
;(function bootOcbcSplash(): void {
type SplashRenderer = { render(timeSeconds: number): void; dispose(): void }
type RendererModule = {
  createRenderer(parent: HTMLElement, assetBase: string, signal?: AbortSignal): Promise<SplashRenderer>
}
type Playback = { dispose(): void; loop: boolean }
type BootApi = { replay(): void; toggleLoop(exitLabel?: string): void; dispose(): void }

const PLAY_SECONDS = 7.05
const FADE_MS = 400
const LOAD_TIMEOUT_MS = 20_000
const bootScript = document.currentScript instanceof HTMLScriptElement
  ? document.currentScript.src
  : new URL('/plugins/dsh-boot-ocbc/lib/boot.js', location.href).href
const assetBase = new URL('../assets/', bootScript).href
const rendererUrl = new URL('./renderer.js', bootScript).href
const state = globalThis as typeof globalThis & { __DSH_BOOT_OCBC__?: BootApi }
state.__DSH_BOOT_OCBC__?.dispose()

let active: Playback | undefined
let pageDisposed = false

function startPlayback(loop = false, exitLabel = 'Exit loop · Esc'): Playback {
  const controller = new AbortController()
  const overlay = document.createElement('div')
  const stage = document.createElement('div')
  let renderer: SplashRenderer | undefined
  let closed = false
  let raf = 0
  let timeout = 0
  let fadeTimer = 0
  let startAt: number | undefined
  let hiddenAt: number | undefined
  let bodyObserver: MutationObserver | undefined

  stage.setAttribute('aria-hidden', 'true')
  if (!loop) overlay.setAttribute('aria-hidden', 'true')
  overlay.dataset.dshBootOcbc = ''
  Object.assign(overlay.style, {
    position: 'fixed', inset: '0', zIndex: '2147483647', width: '100vw', height: '100vh',
    display: 'grid', placeItems: 'center', overflow: 'hidden',
    background: '#151517', opacity: '1', transition: `opacity ${FADE_MS}ms ease`,
    cursor: loop ? 'default' : 'pointer', pointerEvents: 'auto',
  })
  Object.assign(stage.style, {
    width: 'min(100vw, 177.7778vh)', height: 'min(100vh, 56.25vw)',
    position: 'relative', aspectRatio: '16 / 9', overflow: 'hidden', visibility: 'hidden', background: '#151517',
  })
  overlay.append(stage)
  const previousFocus = loop ? document.activeElement as HTMLElement | null : null
  const exitButton = loop ? document.createElement('button') : undefined
  if (exitButton) {
    exitButton.type = 'button'
    exitButton.textContent = exitLabel
    exitButton.dataset.dshBootLoopExit = ''
    Object.assign(exitButton.style, {
      position: 'absolute', top: '16px', right: '20px', zIndex: '1',
      padding: '8px 12px', border: '1px solid #64717c', borderRadius: '6px',
      background: '#151517e8', color: '#e3f2ff', font: '13px system-ui, sans-serif',
      cursor: 'pointer', WebkitAppRegion: 'no-drag',
    })
    exitButton.addEventListener('click', skip)
    overlay.append(exitButton)
  }

  const detach = (): void => {
    overlay.removeEventListener('pointerdown', skip)
    exitButton?.removeEventListener('click', skip)
    window.removeEventListener('keydown', onKeyDown, true)
    document.removeEventListener('visibilitychange', onVisibility)
    bodyObserver?.disconnect()
    bodyObserver = undefined
  }
  const finish = (): void => {
    if (closed) return
    closed = true
    controller.abort()
    cancelAnimationFrame(raf)
    clearTimeout(timeout)
    clearTimeout(fadeTimer)
    detach()
    try { renderer?.dispose() } catch { /* fail open even if renderer cleanup throws */ }
    renderer = undefined
    overlay.remove()
    if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true })
    if (active === playback) active = undefined
  }
  function skip(): void { finish() }
  function onKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Escape') { event.preventDefault(); finish() }
  }
  function onVisibility(): void {
    if (document.hidden) {
      hiddenAt = performance.now()
      cancelAnimationFrame(raf)
    } else if (!closed && renderer !== undefined) {
      const now = performance.now()
      if (startAt !== undefined && hiddenAt !== undefined) startAt += now - hiddenAt
      hiddenAt = undefined
      raf = requestAnimationFrame(frame)
    }
  }
  function frame(now: number): void {
    if (closed || renderer === undefined || document.hidden) return
    if (startAt === undefined) startAt = now
    let elapsed = Math.max(0, (now - startAt) / 1000)
    if (loop && elapsed >= PLAY_SECONDS) {
      startAt = now
      elapsed = 0
    }
    try { renderer.render(elapsed) } catch { finish(); return }
    if (elapsed >= PLAY_SECONDS) {
      overlay.style.opacity = '0'
      overlay.style.pointerEvents = 'none'
      fadeTimer = window.setTimeout(finish, FADE_MS)
      return
    }
    raf = requestAnimationFrame(frame)
  }

  if (!loop) overlay.addEventListener('pointerdown', skip, { once: true })
  window.addEventListener('keydown', onKeyDown, true)
  document.addEventListener('visibilitychange', onVisibility)
  const initialMount = document.body ?? document.documentElement
  initialMount.append(overlay)
  exitButton?.focus({ preventScroll: true })
  if (document.body === null) {
    bodyObserver = new MutationObserver(() => {
      if (document.body === null) return
      document.body.append(overlay)
      bodyObserver?.disconnect()
      bodyObserver = undefined
    })
    bodyObserver.observe(document.documentElement, { childList: true, subtree: true })
  }
  timeout = window.setTimeout(finish, LOAD_TIMEOUT_MS)
  void loadRenderer()

  async function loadRenderer(): Promise<void> {
    try {
      const module = await import(/* @vite-ignore */ rendererUrl) as RendererModule
      if (closed) return
      const loaded = await module.createRenderer(stage, assetBase, controller.signal)
      if (closed) { loaded.dispose(); return }
      renderer = loaded
      clearTimeout(timeout)
      renderer.render(0)
      stage.style.visibility = 'visible'
      if (document.hidden) { hiddenAt = performance.now(); return }
      // The first RAF timestamp defines zero: time spent downloading and preparing assets never consumes play time.
      raf = requestAnimationFrame(frame)
    } catch {
      finish()
    }
  }

  const playback: Playback = { dispose: finish, loop }
  return playback
}

function replay(): void {
  if (pageDisposed || active !== undefined) return
  active = startPlayback()
}

function toggleLoop(exitLabel?: string): void {
  if (pageDisposed) return
  const wasLooping = active?.loop === true
  active?.dispose()
  if (!wasLooping) active = startPlayback(true, exitLabel)
}

function dispose(): void {
  if (pageDisposed) return
  pageDisposed = true
  active?.dispose()
  window.removeEventListener('pagehide', dispose)
  if (state.__DSH_BOOT_OCBC__?.dispose === dispose) delete state.__DSH_BOOT_OCBC__
}

state.__DSH_BOOT_OCBC__ = { replay, toggleLoop, dispose }
window.addEventListener('pagehide', dispose, { once: true })
replay()
})()
