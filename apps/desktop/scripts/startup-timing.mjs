/** Measure the shipped GUI from process launch through a successful Settings interaction. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createReadStream, existsSync } from 'node:fs'
import { cp, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { once } from 'node:events'
import { startDependencyAudit } from './startup-dependency-audit.mjs'

const desktopRequire = createRequire(new URL('../package.json', import.meta.url))
const webRequire = createRequire(new URL('../../web/package.json', import.meta.url))
const { _electron } = webRequire('playwright')
const { expect } = webRequire('playwright/test')
const extractZip = desktopRequire('extract-zip')
const target = process.argv[2]
assert.ok(['mac-arm64', 'win-x64'].includes(target), 'Expected mac-arm64 or win-x64')
const output = resolve('.artifacts/startup-timing')
await mkdir(output, { recursive: true })
const intranet = (process.env.DSH_DESKTOP_INTRANET ?? '1') === '1'
const report = { target, archive: null, sha256: null, standardUser: process.env.DSH_STANDARD_USER_VERIFIED === '1',
  intranet,
  measurement: 'Process launch through a Settings click and visible General settings section; overlay completion is recorded separately before plugin inventory, screenshots, and audit work. Overlay-seen time is the first DOM observation, not an exact frame-present timestamp. No model invocation.',
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
const dshHome = target === 'win-x64' ? join(home, '.dsh-desktop') : home
const profile = join(dshHome, 'profiles', 'desktop')
report.homeMode = target === 'win-x64' ? 'default-user-home' : 'explicit-dsh-home'
if (target === 'win-x64') {
  report.initialDirectories = { dshExists: existsSync(join(home, '.dsh')), desktopExists: existsSync(dshHome) }
  assert.deepEqual(report.initialDirectories, { dshExists: false, desktopExists: false })
} else {
  await mkdir(profile, { recursive: true })
  // A test-owned ephemeral Host port avoids collisions without replacing the shipped launcher.
  await writeFile(join(profile, 'cordis.patch.yml'), '- id: webserver\n  config:\n    host: 127.0.0.1\n    port: 0\n')
}
const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !/KEY|SECRET|TOKEN|PASSWORD|^ELECTRON_RUN_AS_NODE$|^NODE_OPTIONS$|^NODE_PATH$/iu.test(name)))
Object.assign(env, { DSH_HOME: home, DSH_TELEMETRY_MODE: 'DISABLED', DSH_DESKTOP_OPEN_DEVTOOLS: '0',
  HOME: home, USERPROFILE: home, ZDOTDIR: home, DSH_DESKTOP_DIAGNOSTIC_FILE: join(output, 'launch-error.txt'),
  npm_config_registry: 'http://127.0.0.1:1/unreachable/', npm_config_userconfig: join(home, 'absent.npmrc') })
// Exercise the ordinary Windows launch path without a preconfigured DSH_HOME.
if (target === 'win-x64') delete env.DSH_HOME
const audit = process.env.DSH_STARTUP_DEPENDENCY_AUDIT === '1'
  ? await startDependencyAudit(dirname(executable), output, home, env) : undefined
const save = () => writeFile(join(output, 'result.json'), JSON.stringify(report, null, 2) + '\n')
const releasePluginManifest = JSON.parse(await readFile(new URL('../src/release-plugins.json', import.meta.url), 'utf8'))
const pluginNames = releasePluginManifest.plugins.filter(plugin => plugin.desktopBundle !== false).map(plugin => plugin.name)
function installStartupOverlayMonitor() {
  if (window.__DSH_STARTUP_OVERLAYS__) return
  const state = window.__DSH_STARTUP_OVERLAYS__ = {
    timeOrigin: performance.timeOrigin, legacySeenAt: null, ocbcSeenAt: null,
    ocbcStageVisibleAt: null, ocbcVisibleRafAt: null, goneAt: null,
  }
  let visibleRafPending = false
  const scan = () => {
    const legacy = document.querySelector('[data-dsh-boot]') !== null
    const overlay = document.querySelector('[data-dsh-boot-ocbc]')
    const ocbc = overlay !== null
    const now = performance.now()
    if (legacy && state.legacySeenAt === null) state.legacySeenAt = now
    if (ocbc && state.ocbcSeenAt === null) state.ocbcSeenAt = now
    const stage = overlay?.firstElementChild
    const canvas = stage?.querySelector('canvas')
    const visible = stage !== null && stage !== undefined && canvas !== null
      && getComputedStyle(stage).visibility === 'visible' && stage.getBoundingClientRect().width > 0
      && stage.getBoundingClientRect().height > 0 && canvas.width > 0 && canvas.height > 0
    if (visible && state.ocbcStageVisibleAt === null) state.ocbcStageVisibleAt = now
    if (visible && state.ocbcVisibleRafAt === null && !visibleRafPending) {
      visibleRafPending = true
      requestAnimationFrame(() => {
        visibleRafPending = false
        const currentOverlay = document.querySelector('[data-dsh-boot-ocbc]')
        const currentStage = currentOverlay?.firstElementChild
        const currentCanvas = currentStage?.querySelector('canvas')
        if (currentStage !== null && currentStage !== undefined && currentCanvas !== null
          && getComputedStyle(currentStage).visibility === 'visible' && currentStage.getBoundingClientRect().width > 0
          && currentStage.getBoundingClientRect().height > 0 && currentCanvas.width > 0 && currentCanvas.height > 0) {
          state.ocbcVisibleRafAt = performance.now()
        }
      })
    }
    if (state.ocbcSeenAt !== null && !legacy && !ocbc && state.goneAt === null) state.goneAt = now
    if (legacy || ocbc) state.goneAt = null
  }
  new MutationObserver(scan).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ['style'] })
  scan()
}
async function verifyPlugins(app, page, run, kind) {
  const resources = await app.evaluate(() => process.resourcesPath)
  const seed = JSON.parse(await readFile(join(resources, 'plugin-seed', 'package.json'), 'utf8'))
  const installed = JSON.parse(await readFile(join(profile, 'package.json'), 'utf8'))
  run.plugins = { seed: Object.keys(seed.dependencies ?? {}), profileDependencies: Object.keys(installed.dependencies ?? {}),
    profileBundles: installed.dsh?.profile?.bundles ?? [], host: [], cards: [] }
  await save()
  for (const name of pluginNames) {
    assert.ok(run.plugins.seed.includes(name), `Release archive is missing ${name}`)
    assert.ok(run.plugins.profileDependencies.includes(name), `First startup did not install ${name}`)
    assert.ok(run.plugins.profileBundles.includes(name), `First startup did not enable ${name}`)
    const pkg = JSON.parse(await readFile(join(profile, 'node_modules', name, 'package.json'), 'utf8'))
    assert.equal(pkg.name, name)
  }
  const bundles = await page.evaluate(async () => {
    const method = 'pluginManager/listBundles'
    const response = await fetch(`/api/${method}`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId: 'startup-plugins', method, payload: { args: {} } }) })
    if (!response.ok) throw new Error(`Plugin inventory HTTP ${response.status}`)
    const value = await response.json()
    if (!value.result?.ok) throw new Error('Plugin inventory RPC failed')
    return value.result.value
  })
  run.plugins.host = bundles.filter(bundle => pluginNames.includes(bundle.name))
    .map(({ name, version, enabled, error }) => ({ name, version, enabled, error }))
  await save()
  for (const name of pluginNames) {
    const bundle = run.plugins.host.find(bundle => bundle.name === name)
    assert.ok(bundle, `Running desktop host is missing ${name}`)
    assert.equal(bundle.enabled, true, `${name} is disabled`)
    assert.equal(bundle.error, undefined, `${name} has a loading error`)
  }
  await expect(page.getByRole('button', { name: /^(Atlassian Kanban|Atlassian 看板)$/u })).toBeVisible()
  if (kind === 'plugin-list-timeout-retry') {
    await page.evaluate(() => {
      const original = window.fetch
      window.__DSH_CI_TIMEOUT_HITS__ = 0
      window.fetch = async (...args) => {
        const input = args[0] instanceof Request ? args[0].url : String(args[0])
        if (input.includes('api/pluginManager/listBundles')) {
          window.fetch = original
          window.__DSH_CI_TIMEOUT_HITS__++
          await new Promise(resolve => setTimeout(resolve, 200))
          throw new DOMException('CI injected list request timeout', 'TimeoutError')
        }
        return original(...args)
      }
    })
  }
  await page.getByRole('button', { name: /^(Plugins|插件)$/u, exact: true }).click()
  if (kind === 'plugin-list-timeout-retry') {
    const retry = page.getByRole('button', { name: /^(Retry|重试)$/u, exact: true })
    await expect(retry).toBeVisible()
    await expect(page.locator('[data-plugin-group="official"]')).toBeVisible()
    for (const name of pluginNames) await expect(page.locator(`[data-plugin-package="${name}"]`)).toHaveCount(0)
    assert.equal(await page.evaluate(() => window.__DSH_CI_TIMEOUT_HITS__), 1)
    await retry.scrollIntoViewIfNeeded()
    await page.screenshot({ path: join(output, `${kind}-injected-failure.png`) })
    run.injectedFailure = { kind: 'synthetic-fetch-TimeoutError', officialVisible: true, packageCards: 0 }
    await retry.click()
  }
  for (const name of pluginNames) {
    const card = page.locator(`[data-plugin-package="${name}"]`)
    await expect(card).toBeVisible()
    await expect(card).not.toHaveAttribute('data-plugin-status', 'problem')
    run.plugins.cards.push(name)
  }
  await page.locator('[data-plugin-group="bundles"]').scrollIntoViewIfNeeded()
  await page.screenshot({ path: join(output, `${kind}-plugins.png`), fullPage: true })
  run.plugins.passed = true
  await save()
}
const scenarios = audit ? ['fresh-profile', 'same-profile-relaunch', 'delete-both'] : ['fresh-profile', 'same-profile-relaunch', ...(target === 'win-x64' ? [
  'delete-both', 'delete-dsh-only', 'delete-desktop-only', 'plugin-list-timeout-retry', 'unicode-space-app-path', 'deep-app-path',
] : [])]
const legacyHome = join(home, '.dsh')
const legacySentinel = join(legacyHome, 'ci-sentinel.txt')
const originalApplication = dirname(executable)
for (const kind of scenarios) {
  const run = { kind, timings: {}, errors: [], requests: [] }
  report.runs.push(run)
  // Every preceding run must pass UI checks and fully exit before touching its test-owned state.
  if (kind.startsWith('delete-')) {
    assert.ok(report.runs.at(-2)?.passed && report.runs.at(-2)?.exit?.code === 0)
    await mkdir(legacyHome, { recursive: true })
    await writeFile(legacySentinel, 'CI legacy directory preservation check\n')
    const manifestBefore = await readFile(join(profile, 'package.json'), 'utf8')
    const removed = kind === 'delete-both' ? [legacyHome, dshHome] : [kind === 'delete-dsh-only' ? legacyHome : dshHome]
    for (const directory of removed) {
      assert.equal(dirname(directory), home)
      await rm(directory, { recursive: true, force: false, maxRetries: 5, retryDelay: 200 })
      assert.equal(existsSync(directory), false)
    }
    if (kind === 'delete-dsh-only') assert.equal(await readFile(join(profile, 'package.json'), 'utf8'), manifestBefore)
    if (kind === 'delete-desktop-only') assert.equal(await readFile(legacySentinel, 'utf8'), 'CI legacy directory preservation check\n')
    run.removedDirectories = removed.map(directory => directory === legacyHome ? '.dsh' : '.dsh-desktop')
  }
  if (kind.endsWith('-app-path')) {
    assert.ok(report.runs.at(-2)?.passed && report.runs.at(-2)?.exit?.code === 0)
    const parent = kind === 'unicode-space-app-path' ? join(output, '企业应用 带空格')
      : join(output, 'deep-path', ...Array.from({ length: 6 }, (_, i) => `level-${i}-abcdefghijklm`))
    await mkdir(parent, { recursive: true })
    const destination = join(parent, 'DSH Desktop')
    run.pathPreparation = { destination, status: 'copying' }
    await save()
    try {
      await cp(originalApplication, destination, { recursive: true, errorOnExist: true, force: false })
      run.pathPreparation.status = 'copied'
    } catch (error) {
      run.pathPreparation.status = 'failed'
      run.failure = error.message
      await save()
      throw error
    }
    executable = join(destination, 'DSH Desktop.exe')
    await rm(dshHome, { recursive: true, force: false, maxRetries: 5, retryDelay: 200 })
  }
  run.beforeLaunch = { dshExists: existsSync(legacyHome), desktopExists: existsSync(dshHome), executable, executablePathLength: executable.length }
  await save()
  let app, page, child
  let stopping = false
  const welcomeTasks = []
  const seenWindows = new WeakSet()
  const started = performance.now()
  const wallStart = Date.now()
  const elapsed = () => Math.round(performance.now() - started)
  const mark = name => { run.timings[name] = elapsed(); console.log(JSON.stringify({ kind, stage: name, ms: run.timings[name] })) }
  const requests = new Map()
  try {
    app = await _electron.launch({ executablePath: executable, cwd: home, env, args: ['--lang=en-US'], timeout: 300_000 })
    child = app.process()
    const handleWelcome = candidate => {
      if (seenWindows.has(candidate)) return
      seenWindows.add(candidate)
      const task = (async () => {
        await candidate.addInitScript(installStartupOverlayMonitor)
        await candidate.waitForURL(url => url.href.startsWith('dsh-app://app/') || url.pathname.endsWith('/welcome.html'), { timeout: 300_000 })
        await candidate.waitForLoadState('domcontentloaded')
        if (!candidate.url().includes('welcome.html')) return
        mark('nativeWelcomeMs')
        await candidate.locator('#api-key').click()
        await candidate.locator('#skip-key').click()
        mark('nativeWelcomeDismissedMs')
      })().catch(error => { if (!stopping) run.errors.push({ ms: elapsed(), type: 'welcome', message: error.message }) })
      welcomeTasks.push(task)
    }
    app.on('window', handleWelcome)
    for (const candidate of app.windows()) handleWelcome(candidate)
    mark('automationConnectedMs')
    run.application = await app.evaluate(({ app }) => ({ version: app.getVersion(), packaged: app.isPackaged }))
    assert.equal(run.application.packaged, true)
    page = await app.firstWindow({ timeout: 300_000 })
    mark('windowAvailableMs')
    page.setDefaultTimeout(300_000)
    await page.evaluate(installStartupOverlayMonitor)
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
      if (!stopping) run.errors.push({ ms: elapsed(), type: 'request-failed', detail: request.failure()?.errorText })
      requests.delete(request)
    })
    await page.waitForURL('dsh-app://app/**', { timeout: 300_000 })
    await page.waitForLoadState('domcontentloaded')
    await page.evaluate(installStartupOverlayMonitor)
    const accountMenu = page.getByRole('button', { name: /^(Account menu|账号菜单)$/u, exact: true })
    const settingsLauncher = intranet ? page.getByRole('button', { name: /^(Settings|设置)$/u, exact: true }) : accountMenu
    await settingsLauncher.waitFor({ state: 'visible' })
    if (intranet) {
      await expect(accountMenu).toHaveCount(0)
      assert.equal(app.windows().some(window => window.url().includes('welcome.html')), false)
    }
    mark('homeVisibleMs')
    const welcome = page.getByRole('button', { name: /^(Continue|继续)$/u, exact: true })
    // Native onboarding can advance asynchronously or skip the key step when a provider exists.
    await page.addLocatorHandler(welcome, async () => { await welcome.click(); mark('welcomeDismissedMs') })
    const configureLater = page.getByRole('button', { name: /^(Configure later|稍后配置)$/u, exact: true })
    await page.addLocatorHandler(configureLater, async () => { await configureLater.click(); mark('apiSetupDismissedMs') })
    await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()
      .some(window => window.webContents.getURL().startsWith('dsh-app://app/') && window.isVisible())),
      { timeout: 300_000, message: 'The workspace must be visible after startup' }).toBe(true)
    mark('workspaceVisibleMs')
    await page.waitForFunction(() => {
      const state = (window).__DSH_STARTUP_OVERLAYS__
      return state?.ocbcSeenAt !== null && state?.ocbcSeenAt !== undefined
        && state?.ocbcVisibleRafAt !== null && state?.ocbcVisibleRafAt !== undefined && state?.goneAt !== null
    }, null, { timeout: 300_000 })
    const overlay = await page.evaluate(() => (window).__DSH_STARTUP_OVERLAYS__)
    const pageToLaunchMs = value => Math.round(overlay.timeOrigin + value - wallStart)
    run.timings.overlaySeenMs = pageToLaunchMs(overlay.ocbcSeenAt)
    run.timings.ocbcStageVisibleMs = overlay.ocbcStageVisibleAt === null ? null : pageToLaunchMs(overlay.ocbcStageVisibleAt)
    run.timings.ocbcVisibleRafMs = pageToLaunchMs(overlay.ocbcVisibleRafAt)
    run.timings.overlayGoneMs = pageToLaunchMs(overlay.goneAt)
    run.timings.legacyBootSeenMs = overlay.legacySeenAt === null ? null : pageToLaunchMs(overlay.legacySeenAt)
    await settingsLauncher.click()
    if (!intranet) await page.getByRole('menuitem', { name: /^(Settings|设置)$/u, exact: true }).click()
    const settingsDialog = page.getByRole('dialog')
    await settingsDialog.getByRole('button', { name: /^(General|通用设置)$/u, exact: true }).waitFor({ state: 'visible' })
    mark('interactiveMs')
    await page.screenshot({ path: join(output, `${kind}-interactive.png`), timeout: 15_000 })
    await page.keyboard.press('Escape')
    await expect(settingsDialog).toHaveCount(0)
    await save()
    await verifyPlugins(app, page, run, kind)
    await audit?.verify(app, profile, kind)
    run.renderer = await page.evaluate(() => ({
      bootPagePresent: !!document.querySelector('[data-dsh-boot]'),
      ocbcOverlayPresent: !!document.querySelector('[data-dsh-boot-ocbc]'),
      timeOrigin: performance.timeOrigin,
      navigation: performance.getEntriesByType('navigation').map(n => ({ domContentLoadedMs: n.domContentLoadedEventEnd, loadMs: n.loadEventEnd })),
      paints: performance.getEntriesByType('paint').map(p => ({ name: p.name, ms: p.startTime })),
      resources: performance.getEntriesByType('resource').map(r => ({ type: r.initiatorType, startMs: r.startTime, durationMs: r.duration, bytes: r.transferSize })),
    }))
    run.renderer.paints.forEach(p => { p.sinceLaunchMs = Math.round(run.renderer.timeOrigin + p.ms - wallStart) })
    assert.equal(run.renderer.bootPagePresent, false)
    assert.equal(run.renderer.ocbcOverlayPresent, false)
    assert.deepEqual(run.errors, [], 'Renderer exceptions or failed requests must be investigated')
    if (kind === 'delete-desktop-only') assert.equal(await readFile(legacySentinel, 'utf8'), 'CI legacy directory preservation check\n')
    run.passed = true
  } catch (error) {
    run.passed = false
    run.failure = error.message
    if (page) await page.screenshot({ path: join(output, `${kind}-failure.png`), timeout: 10_000 }).catch(() => {})
    throw error
  } finally {
    stopping = true
    await save()
    if (app) {
      let timer
      try {
        await Promise.race([app.close(), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('GUI shutdown timed out')), 30_000) })])
        if (child.exitCode === null && child.signalCode === null) await once(child, 'exit')
        await Promise.all(welcomeTasks)
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
await audit?.finish()
console.log(JSON.stringify(report, null, 2))
