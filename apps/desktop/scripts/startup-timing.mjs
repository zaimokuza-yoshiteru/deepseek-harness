/** Measure the shipped GUI from process launch through a successful Settings interaction. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createReadStream, existsSync } from 'node:fs'
import { mkdir, mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import { once } from 'node:events'

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
  measurement: 'Process launch through the configured startup flow to a visible Settings launcher and successful Settings dialog interaction; no model invocation.',
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
const save = () => writeFile(join(output, 'result.json'), JSON.stringify(report, null, 2) + '\n')
const pluginNames = ['@zaimokuza/dsh-acp-adapter', '@zaimokuza/dsh-agent-teams-office', 'dsh-boot-ocbc', 'dsh-atlassian-kanban']
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
  await page.getByRole('button', { name: /^(Plugins|插件)$/u, exact: true }).click()
  for (const name of pluginNames) {
    const card = page.locator(`[data-plugin-package="${name}"]`)
    await expect(card).toBeVisible()
    await expect(card).not.toHaveAttribute('data-plugin-status', 'problem')
    run.plugins.cards.push(name)
  }
  await page.screenshot({ path: join(output, `${kind}-plugins.png`), fullPage: true })
  run.plugins.passed = true
  await save()
}
for (const kind of ['fresh-profile', 'same-profile-relaunch']) {
  const run = { kind, timings: {}, errors: [], requests: [] }
  report.runs.push(run)
  let app, page, child, firstScreenshot
  let stopping = false
  const welcomeTasks = []
  const seenWindows = new WeakSet()
  const started = performance.now()
  const wallStart = Date.now()
  const elapsed = () => Math.round(performance.now() - started)
  const mark = name => { run.timings[name] = elapsed(); console.log(JSON.stringify({ kind, stage: name, ms: run.timings[name] })) }
  const requests = new Map()
  try {
    app = await _electron.launch({ executablePath: executable, env, args: ['--lang=en-US'], timeout: 300_000 })
    child = app.process()
    const handleWelcome = candidate => {
      if (seenWindows.has(candidate)) return
      seenWindows.add(candidate)
      const task = (async () => {
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
    firstScreenshot = page.screenshot({ path: join(output, `${kind}-first-window.png`), timeout: 15_000 }).catch(() => {})
    await page.waitForURL('dsh-app://app/**', { timeout: 300_000 })
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
    await verifyPlugins(app, page, run, kind)
    await settingsLauncher.click()
    if (!intranet) await page.getByRole('menuitem', { name: /^(Settings|设置)$/u, exact: true }).click()
    await page.getByRole('dialog').getByRole('button', { name: /^(General|通用设置)$/u, exact: true }).waitFor({ state: 'visible' })
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
    stopping = true
    await firstScreenshot
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
console.log(JSON.stringify(report, null, 2))
