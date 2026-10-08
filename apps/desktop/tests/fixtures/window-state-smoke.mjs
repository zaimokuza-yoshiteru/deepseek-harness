/** Verify the persistence helper against native Electron windows across restarts. */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { app, BrowserWindow, screen } from 'electron'

const [stateModule, userData, phase] = process.argv.slice(2)
if (!stateModule || !userData || !['first', 'restart', 'fullscreen-restart'].includes(phase)) {
  throw new Error('expected <built-window-state.js> <userDataDir> <first|restart|fullscreen-restart>')
}
app.setPath('userData', userData)
app.on('window-all-closed', () => {})

async function presentation(window, fullscreen) {
  if (window.isFullScreen() === fullscreen) return
  await new Promise((resolve, reject) => {
    const event = fullscreen ? 'enter-full-screen' : 'leave-full-screen'
    const timer = setTimeout(() => reject(new Error(`timed out waiting for ${event}`)), 10_000)
    window.once(event, () => { clearTimeout(timer); resolve() })
    window.setFullScreen(fullscreen)
  })
}

async function run() {
  await app.whenReady()
  const { DesktopWindowStatePersistence } = await import(pathToFileURL(stateModule).href)
  const path = join(userData, 'window-state.json')
  const persistence = new DesktopWindowStatePersistence(path, () => screen.getAllDisplays())
  const saved = phase === 'first' ? undefined : JSON.parse(await readFile(path, 'utf8'))
  const window = new BrowserWindow({ width: 1280, height: 820, minWidth: 520, minHeight: 600,
    ...persistence.initialBounds, show: false, title: 'DSH window-state regression',
    webPreferences: { sandbox: true, contextIsolation: true } })
  await window.loadURL('data:text/html,<title>DSH window-state regression</title>')
  if (saved) assert.deepEqual(window.getNormalBounds(), saved.bounds)
  let enteredFullscreen
  if (saved?.fullscreen) {
    enteredFullscreen = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('fullscreen restore timed out')), 10_000)
      window.once('enter-full-screen', () => { clearTimeout(timer); resolve() })
    })
  }
  persistence.activate(window)
  window.showInactive()
  if (enteredFullscreen) await enteredFullscreen
  if (phase === 'first') {
    const area = screen.getPrimaryDisplay().workArea
    window.setBounds({ x: area.x + 32, y: area.y + 32,
      width: Math.min(900, Math.max(520, area.width - 64)),
      height: Math.min(700, Math.max(600, area.height - 64)) })
    await persistence.flush()
    assert.deepEqual(JSON.parse(await readFile(path, 'utf8')).bounds, window.getNormalBounds())
  } else if (phase === 'restart') {
    assert.equal(window.isFullScreen(), false)
    await presentation(window, true)
    await persistence.flush()
    const fullscreen = JSON.parse(await readFile(path, 'utf8'))
    assert.equal(fullscreen.fullscreen, true)
    assert.deepEqual(fullscreen.bounds, saved.bounds)
  } else {
    assert.equal(window.isFullScreen(), true)
    assert.deepEqual(window.getNormalBounds(), saved.bounds)
    persistence.prepareForHide(window)
    await presentation(window, false)
    window.hide()
    await persistence.flush()
    const hidden = JSON.parse(await readFile(path, 'utf8'))
    assert.equal(hidden.fullscreen, false)
    assert.deepEqual(hidden.bounds, saved.bounds)
  }
  await persistence.close(window)
  const finalState = JSON.parse(await readFile(path, 'utf8'))
  console.log(`WINDOW_STATE_RESULT ${JSON.stringify({ phase, state: finalState })}`)
  window.destroy()
}

run().then(() => app.exit(0)).catch(error => { console.error(error); app.exit(1) })
