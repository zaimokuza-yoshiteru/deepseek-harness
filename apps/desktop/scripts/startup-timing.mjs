/** Measure the shipped GUI from process launch through a successful Settings interaction. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdir, mkdtemp, readdir, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import { once } from 'node:events'

const desktopRequire = createRequire(new URL('../package.json', import.meta.url))
const webRequire = createRequire(new URL('../../web/package.json', import.meta.url))
const { _electron } = webRequire('playwright')
const extractZip = desktopRequire('extract-zip')
const target = process.argv[2]
assert.ok(['mac-arm64', 'win-x64'].includes(target), 'Expected mac-arm64 or win-x64')
const output = resolve('.artifacts/startup-timing')
await mkdir(output, { recursive: true })
const report = { target, archive: null, sha256: null, standardUser: process.env.DSH_STANDARD_USER_VERIFIED === '1',
  measurement: 'Process launch to visible Settings button and successful Settings dialog interaction; no model invocation.',
  limitations: 'Fresh CI machine, immediately after ZIP extraction; not an OS disk-cache cold boot or a user endpoint security reproduction. Extraction is excluded.',
  runs: [] }
let executable = process.argv[3] && resolve(process.argv[3])
if (!executable) {
  const input = resolve('.artifacts/smoke-input')
  const archives = (await readdir(input)).filter(file => file.endsWith('.zip'))
  assert.equal(archives.length, 1)
  report.archive = archives[0]
  const archive = join(input, archives[0])
  const hash = createHash('sha256')
  for await (const bytes of createReadStream(archive)) hash.update(bytes)
  report.sha256 = hash.digest('hex')
  const unpacked = await mkdtemp(join(output, 'application-'))
  await extractZip(archive, { dir: unpacked })
  executable = target === 'win-x64' ? join(unpacked, 'DSH Desktop.exe')
    : join(unpacked, 'DSH Desktop.app', 'Contents', 'MacOS', 'DSH Desktop')
}
const home = await mkdtemp(join(output, 'profile-'))
const profile = join(home, 'profiles', 'desktop')
await mkdir(profile, { recursive: true })
// A test-owned ephemeral Host port avoids collisions without replacing the shipped launcher.
await writeFile(join(profile, 'cordis.patch.yml'), '- id: webserver\n  config:\n    host: 127.0.0.1\n    port: 0\n')
const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !/KEY|SECRET|TOKEN|PASSWORD|^ELECTRON_RUN_AS_NODE$|^NODE_OPTIONS$|^NODE_PATH$/iu.test(name)))
Object.assign(env, { DSH_HOME: home, DSH_TELEMETRY_MODE: 'DISABLED', DSH_DESKTOP_OPEN_DEVTOOLS: '0',
  npm_config_registry: 'http://127.0.0.1:1/unreachable/', npm_config_userconfig: join(home, 'absent.npmrc') })
const save = () => writeFile(join(output, 'result.json'), JSON.stringify(report, null, 2) + '\n')
for (const kind of ['fresh-profile', 'same-profile-relaunch']) {
  const run = { kind, timings: {}, errors: [], requests: [] }
  report.runs.push(run)
  let app, page, child, firstScreenshot
  const started = performance.now()
  const wallStart = Date.now()
  const elapsed = () => Math.round(performance.now() - started)
  const mark = name => { run.timings[name] = elapsed(); console.log(JSON.stringify({ kind, stage: name, ms: run.timings[name] })) }
  const requests = new Map()
  try {
    app = await _electron.launch({ executablePath: executable, env, args: ['--lang=en-US'], timeout: 300_000 })
    child = app.process()
    mark('automationConnectedMs')
    run.application = await app.evaluate(({ app }) => ({ version: app.getVersion(), packaged: app.isPackaged }))
    assert.equal(run.application.packaged, true)
    page = await app.firstWindow({ timeout: 300_000 })
    mark('windowAvailableMs')
    page.setDefaultTimeout(300_000)
    page.on('pageerror', error => { run.errors.push({ ms: elapsed(), message: error.message }) })
    page.on('request', request => { requests.set(request, elapsed()) })
    page.on('requestfinished', request => {
      const start = requests.get(request)
      if (start === undefined) return
      requests.delete(request)
      const url = new URL(request.url())
      run.requests.push({ startMs: start, durationMs: elapsed() - start, protocol: url.protocol, path: url.pathname })
    })
    page.on('requestfailed', request => {
      run.errors.push({ ms: elapsed(), type: 'request-failed', detail: request.failure()?.errorText })
      requests.delete(request)
    })
    firstScreenshot = page.screenshot({ path: join(output, `${kind}-first-window.png`), timeout: 15_000 }).catch(() => {})
    await page.waitForURL('dsh-app://app/**', { timeout: 300_000 })
    const settings = page.getByRole('button', { name: /^(Settings|设置)$/u, exact: true })
    await settings.waitFor({ state: 'visible' })
    mark('homeVisibleMs')
    const welcome = page.getByRole('button', { name: /^(Continue|继续)$/u, exact: true })
    if (await welcome.isVisible()) { await welcome.click(); mark('welcomeDismissedMs') }
    await settings.click()
    await page.getByRole('dialog').getByRole('button', { name: 'ACP adapter', exact: true }).waitFor({ state: 'visible' })
    mark('interactiveMs')
    run.renderer = await page.evaluate(() => ({
      bootPagePresent: !!document.querySelector('[data-dsh-boot]'),
      timeOrigin: performance.timeOrigin,
      navigation: performance.getEntriesByType('navigation').map(n => ({ domContentLoadedMs: n.domContentLoadedEventEnd, loadMs: n.loadEventEnd })),
      paints: performance.getEntriesByType('paint').map(p => ({ name: p.name, ms: p.startTime })),
      resources: performance.getEntriesByType('resource').map(r => ({ type: r.initiatorType, startMs: r.startTime, durationMs: r.duration, bytes: r.transferSize })),
    }))
    run.renderer.paints.forEach(p => { p.sinceLaunchMs = Math.round(run.renderer.timeOrigin + p.ms - wallStart) })
    assert.equal(run.renderer.bootPagePresent, false)
    await page.screenshot({ path: join(output, `${kind}-interactive.png`), timeout: 15_000 })
    assert.deepEqual(run.errors, [], 'Renderer exceptions or failed requests must be investigated')
    run.passed = true
  } catch (error) {
    run.passed = false
    run.failure = error.message
    if (page) await page.screenshot({ path: join(output, `${kind}-failure.png`), timeout: 10_000 }).catch(() => {})
    throw error
  } finally {
    await firstScreenshot
    await save()
    if (app) {
      let timer
      try {
        await Promise.race([app.close(), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('GUI shutdown timed out')), 30_000) })])
        if (child.exitCode === null && child.signalCode === null) await once(child, 'exit')
        run.exit = { code: child.exitCode, signal: child.signalCode }
        assert.equal(child.exitCode, 0)
        assert.equal(child.signalCode, null)
      } catch (error) {
        run.teardownFailure = error.message
        if (child.exitCode === null && child.signalCode === null) { const exited = once(child, 'exit'); child.kill('SIGKILL'); await exited }
        throw error
      } finally { clearTimeout(timer); await save() }
    }
  }
}
console.log(JSON.stringify(report, null, 2))
