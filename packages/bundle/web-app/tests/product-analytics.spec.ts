import OTel from '@deepseek-ai/dsh-otel'
/** Desktop-only collector policy and bounded shutdown against an unresponsive receiver. */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import { composeEntries, loadOverlayPatches, readProfilePatches, type Profile } from '@deepseek-ai/dsh-app-boot'
import * as Telemetry from '@deepseek-ai/dsh-host-product-telemetry-otel'
import Analytics from '@deepseek-ai/dsh-client-product-analytics'
import * as SessionTelemetryOtel from '@deepseek-ai/dsh-session-telemetry-otel'
import * as SessionLogDeepSeek from '@deepseek-ai/dsh-session-log-deepseek'
import Web from '@deepseek-ai/dsh-web'
import * as DeepSeekSearch from '@deepseek-ai/dsh-web-search-deepseek'
import { afterEach, expect, it, onTestFinished, vi } from 'vitest'

afterEach(() => { vi.unstubAllEnvs() })

it.each([
  { profile: 'desktop', intranet: false },
  { profile: 'web', intranet: false },
  { profile: 'desktop', intranet: true },
])('limits collection and its shutdown to the Desktop launch: $profile / intranet=$intranet', async ({ profile, intranet }) => {
  const home = mkdtempSync(join(tmpdir(), 'dsh-product-analytics-profile-'))
  onTestFinished(() => { rmSync(home, { recursive: true, force: true }) })
  const received: string[] = []
  const gotRequest = Promise.withResolvers<undefined>()
  const server = createServer((req) => { received.push(req.url ?? ''); req.resume(); req.once('end', () => { gotRequest.resolve(undefined) }) })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  onTestFinished(async () => { const closed = once(server, 'close'); server.close(); server.closeAllConnections(); await closed })
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('missing collector address')
  vi.stubEnv('DSH_CLIENT_VERSION', 'test-version')
  vi.stubEnv('DSH_PRODUCT_ANALYTICS_OTLP_URL', `http://127.0.0.1:${address.port}/logs`)
  vi.stubEnv('DSH_DESKTOP_INTRANET', intranet ? '1' : '')
  vi.stubEnv('DSH_TELEMETRY_MODE', 'DISABLED')
  const legacyOverrides = intranet && profile === 'desktop' ? [
    { id: 'desktop-product-telemetry', disabled: false },
    { id: 'product-analytics', disabled: false, config: { enabled: true } },
  ] : []
  const profileContext = {
    name: profile, dir: join(home, 'profile'), patchPath: join(home, 'profile', 'cordis.patch.yml'),
    installAnchor: join(home, 'package.json'), cwd: '/workspace', home,
    startedBundles: [], overlays: legacyOverrides, telemetryDisabledEnv: undefined, desktopIntranet: intranet,
  } as const
  const ctx = new Context()
  onTestFinished(() => ctx.fiber.dispose())
  ctx.provide('profileContext', profileContext)
  const identity = vi.fn().mockResolvedValue(undefined)
  if (!intranet) ctx.provide('deepseekAccount', { getDeviceIdentity: identity } as never)
  await ctx.plugin(OTel)
  ctx.baseUrl = 'file:///'
  await ctx.plugin(Loader).await()
  ctx.loader.builtins.telemetry = Telemetry
  ctx.loader.builtins.analytics = Analytics
  ctx.loader.builtins.sessionTelemetry = SessionTelemetryOtel
  ctx.loader.builtins.sessionLog = SessionLogDeepSeek
  const profilePatches = loadOverlayPatches('analytics', fileURLToPath(new URL('../cordis.patch.yml', import.meta.url)))
  const basePatches = loadOverlayPatches('analytics', fileURLToPath(new URL('../../base/cordis.patch.yml', import.meta.url)))
  const selectedProfile: Profile = {
    name: profile, dir: profileContext.dir, patchPath: profileContext.patchPath, patches: legacyOverrides,
    layers: [
      { packageName: '@deepseek-ai/dsh-base', packageDir: '', patchPaths: [], patches: basePatches },
      { packageName: '@deepseek-ai/dsh-web-app', packageDir: '', patchPaths: [], patches: profilePatches },
    ],
    skippedBundles: [],
  }
  const composed = readProfilePatches('analytics', profileContext, selectedProfile)
  const includedIds = new Set(intranet
    ? ['desktop-product-telemetry', 'product-analytics', 'session-telemetry-otel', 'session-log-deepseek']
    : ['desktop-product-telemetry', 'product-analytics'])
  const loaderNames: Record<string, string> = {
    'desktop-product-telemetry': 'cordis:telemetry',
    'product-analytics': 'cordis:analytics',
    'session-telemetry-otel': 'cordis:sessionTelemetry',
    'session-log-deepseek': 'cordis:sessionLog',
  }
  const rows = composeEntries([composed])
    .filter(row => row.id !== undefined && includedIds.has(row.id))
    .map(row => ({ ...row, name: loaderNames[row.id]! }))
  await ctx.loader.root.update(rows)
  await ctx.loader.await()
  const entry = ctx.loader.resolve('desktop-product-telemetry')
  expect(entry.disabled).toBe(profile !== 'desktop' || intranet)
  expect(ctx.loader.resolve('product-analytics').disabled).toBe(profile !== 'desktop' || intranet)
  if (intranet) {
    expect(ctx.loader.resolve('session-telemetry-otel').disabled).toBe(true)
    expect(ctx.loader.resolve('session-log-deepseek').disabled).toBe(true)
    expect(ctx.loader.resolve('session-telemetry-otel').fiber).toBeUndefined()
    expect(ctx.loader.resolve('session-log-deepseek').fiber).toBeUndefined()
  }
  if (profile !== 'desktop' || intranet) {
    expect(ctx.get('productTelemetry')).toBeUndefined()
    expect(ctx.get('productAnalytics')).toBeUndefined()
    // Give accidentally-mounted exporters a chance to resolve their first
    // interval, then dispose the actual composition and prove no request left.
    await new Promise(resolve => setTimeout(resolve, 50))
    await ctx.fiber.dispose()
    expect(received).toEqual([])
    return
  }
  expect(rows.find(row => row.id === 'desktop-product-telemetry')!.config).toMatchObject({
    scheduledDelayMillis: 30000, timeoutMillis: 15000, exportTimeoutMillis: 20000, shutdownTimeoutMillis: 2000,
  })
  const analytics = ctx.productAnalytics
  const analyticsFiber = ctx.loader.resolve('product-analytics').fiber
  const telemetryFiber = entry.fiber
  const lifetime = new AbortController()
  onTestFinished(() => { lifetime.abort() })
  const policy = analytics.watchPolicy(lifetime.signal)[Symbol.asyncIterator]()
  expect(await policy.next()).toEqual({ value: true, done: false })
  for (const enabled of [false, true]) {
    const changed = policy.next()
    await ctx.loader.root.update(rows.map(row => row.id === 'product-analytics'
      ? { ...row, config: { ...row.config as Record<string, unknown>, enabled } } : row))
    await ctx.loader.await()
    expect(await changed).toEqual({ value: enabled, done: false })
    expect(ctx.loader.resolve('product-analytics').fiber === analyticsFiber).toBe(true)
    expect(entry.fiber === telemetryFiber).toBe(true)
    if (!enabled) {
      await analytics.report({ eventName: 'desktop_app_launch', timestamp: 1, attributes: {} })
      expect(identity).not.toHaveBeenCalled()
    }
  }
  const emit = vi.spyOn(ctx.productTelemetry, 'emit')
  await analytics.report({ eventName: 'desktop_app_launch', timestamp: 1, attributes: {} })
  expect(emit).toHaveBeenCalledWith(expect.objectContaining({ attributes: { app_version: 'test-version' } }))
  lifetime.abort()
  await policy.return?.()
  ctx.productTelemetry.emit({ eventName: 'desktop_upgrade_install_restart_click', body: 'upgrade', timestamp: Date.now() })
  const disposal = entry.fiber!.dispose()
  await gotRequest.promise
  expect(received).toContain('/logs')
  await disposal
})

it('keeps the production DeepSeek search route unregistered after a legacy intranet override', async () => {
  vi.stubEnv('DSH_DESKTOP_INTRANET', '1')
  const home = mkdtempSync(join(tmpdir(), 'dsh-desktop-intranet-search-'))
  onTestFinished(() => { rmSync(home, { recursive: true, force: true }) })
  const received: string[] = []
  const server = createServer((req, res) => {
    received.push(req.url ?? '')
    req.resume()
    req.once('end', () => {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ content: [{ type: 'web_search_tool_result', tool_use_id: 'audit', content: [] }] }))
    })
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  onTestFinished(async () => { const closed = once(server, 'close'); server.close(); server.closeAllConnections(); await closed })
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('missing collector address')
  const endpoint = `http://127.0.0.1:${address.port}/anthropic/v1`
  vi.stubEnv('DEEPSEEK_API_KEY', 'audit-only-fake-key')
  writeFileSync(join(home, 'cordis.patch.yml'), JSON.stringify([{
    id: 'web-search-deepseek', disabled: false,
    config: { apiKey: 'audit-only-fake-key', baseURL: endpoint },
  }]))
  const basePatches = loadOverlayPatches('search audit', fileURLToPath(new URL('../../base/cordis.patch.yml', import.meta.url)))
  const profile: Profile = {
    name: 'desktop', dir: join(home, 'profile'), patchPath: join(home, 'profile', 'cordis.patch.yml'),
    patches: [{ id: 'web-search-deepseek', disabled: false }],
    layers: [{ packageName: '@deepseek-ai/dsh-base', packageDir: '', patchPaths: [], patches: basePatches }],
    skippedBundles: [],
  }
  const patches = readProfilePatches('search audit', {
    name: 'desktop', dir: profile.dir, patchPath: profile.patchPath, installAnchor: join(home, 'package.json'),
    cwd: home, home, startedBundles: ['@deepseek-ai/dsh-base'],
    overlays: [{ id: 'web-search-deepseek', disabled: false }], telemetryDisabledEnv: undefined, desktopIntranet: true,
  }, profile)
  const rows = composeEntries([patches]).filter(row => row.id === 'web' || row.id === 'web-search-deepseek')
    .map(row => ({ ...row, name: row.id === 'web' ? 'cordis:actualWeb' : 'cordis:actualSearch' }))
  const ctx = new Context()
  onTestFinished(() => ctx.fiber.dispose())
  ctx.baseUrl = 'file:///'
  await ctx.plugin(Loader).await()
  ctx.loader.builtins.actualWeb = Web
  ctx.loader.builtins.actualSearch = DeepSeekSearch
  await ctx.loader.root.update(rows)
  await ctx.loader.await()
  expect(ctx.loader.resolve('web-search-deepseek').disabled).toBe(true)
  await expect(ctx.web.search({ query: 'intranet audit probe' })).rejects.toMatchObject({
    code: 'WEB_PROVIDER_CONFIGURED_MISSING',
  })
  expect(received).toEqual([])
})
