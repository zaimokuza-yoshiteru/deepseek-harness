/** Built-app checks for the macOS right sidebar across chrome and width changes. */
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import { createMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import { launchWebScaffold, watchConsole, type WebScaffold } from './scaffold.ts'
import { connectFreshWorkspace, newEnglishPage, saveFailureShot } from './support.ts'

const REVIEW_DIR = fileURLToPath(new URL('../../../.artifacts/sidebar-window-state', import.meta.url))

async function capture(page: Page, name: string): Promise<void> {
  await mkdir(REVIEW_DIR, { recursive: true })
  await page.screenshot({ path: join(REVIEW_DIR, `${name}.png`), fullPage: true })
  const state = await page.evaluate(() => {
    const rect = (selector: string) => {
      const element = document.querySelector<HTMLElement>(selector)
      if (element === null) return null
      const { x, y, width, height } = element.getBoundingClientRect()
      return { x, y, width, height, visible: getComputedStyle(element).visibility !== 'hidden' }
    }
    const frame = document.querySelector<HTMLElement>('[class*="frame"]')
    const panel = document.querySelector<HTMLElement>('[data-sidebar-right-panel]')
    return {
      viewport: { width: innerWidth, height: innerHeight },
      platform: document.documentElement.dataset.platform,
      activePanel: panel?.closest('[data-entry-key]')?.getAttribute('data-entry-key') ?? null,
      frame: frame === null ? null : {
        columns: getComputedStyle(frame).gridTemplateColumns,
        sidebarCollapsed: frame.hasAttribute('data-sidebar-collapsed'),
        rightbarCollapsed: frame.hasAttribute('data-rightbar-collapsed'),
      },
      rightbarPanel: panel === null ? null : {
        mode: panel.getAttribute('data-sidebar-right-panel'),
        open: panel.hasAttribute('data-sidebar-right-open'),
        rect: rect('[data-sidebar-right-panel]'),
        controls: [...panel.querySelectorAll<HTMLElement>('[data-sidebar-right-toggle], [data-sidebar-right-mode]')]
          .map(element => ({ hook: element.hasAttribute('data-sidebar-right-toggle') ? 'collapse' : 'mode', visible: getComputedStyle(element).visibility !== 'hidden', rect: (() => {
            const { x, y, width, height } = element.getBoundingClientRect()
            return { x, y, width, height }
          })() })),
      },
      restore: rect('[data-sidebar-right-expand]'),
      activeGlobalPanel: document.querySelector('[class*="panelActive"]')?.textContent?.trim() ?? null,
    }
  })
  await writeFile(join(REVIEW_DIR, `${name}.json`), `${JSON.stringify(state, null, 2)}\n`)
}

async function seedConversation(scaffold: WebScaffold): Promise<void> {
  const agent = scaffold.ctx.agents.list()[0]
  if (agent === undefined) throw new Error('connected workspace did not create an Agent')
  agent.session.append('turn/start', { turn: 1 })
  agent.session.append('user/message', createUserMessage({
    content: [{ type: 'text', text: 'Check the right sidebar controls.' }],
    source: { kind: 'user' },
  }), { surfaceOp: 'append' })
  agent.session.append('step/start', { turn: 1, step: 1 })
  agent.session.append('assistant/message', {
    stream: [],
    turn: 1,
    step: 1,
    message: createMessage({
      role: 'assistant',
      content: [{ type: 'text', text: 'Ready. [Visit the preview page](http://127.0.0.1:3080/start).' }],
      source: { kind: 'model', provider: 'fixture', model: 'fixture' },
    }),
  }, { surfaceOp: 'append' })
  agent.session.append('step/end', { turn: 1, step: 1 })
  agent.session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
  await scaffold.ctx.sessions.flush(agent.session)
}

describe('web e2e: macOS right-sidebar window state', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>

  beforeAll(async () => {
    scaffold = await launchWebScaffold({
      extraOverlayPath: fileURLToPath(new URL('./sidebar-browser.overlay.yml', import.meta.url)),
    })
    browser = await chromium.launch()
    page = await newEnglishPage(browser)
    await page.route('http://127.0.0.1:3080/**', async (route) => {
      const path = new URL(route.request().url()).pathname
      await route.fulfill({
        contentType: 'text/html',
        body: path === '/next'
          ? '<h1>destination</h1><a href="/start">Back to start</a>'
          : '<h1>start page</h1><a href="/next">Ordinary HTTP link</a>',
      })
    })
    tripwire = watchConsole(page)
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await page.evaluate(() => { document.documentElement.dataset.platform = 'darwin' })
    await connectFreshWorkspace(page, scaffold.workspaceCwd)
    await seedConversation(scaffold)
    await page.getByText('Ready.').waitFor({ timeout: 15_000 })
    await page.locator('[data-sidebar-right-expand]').waitFor({ timeout: 15_000 })
  }, 180_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  it('keeps panel and header controls reachable through HTTP navigation and narrow widths', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-sidebar-window-state'))
    const frame = page.locator('[class*="frame"]').first()
    const column = page.locator('[data-rightbar-col]')
    const panel = column.locator('[data-sidebar-right-panel]')
    const restore = page.locator('[data-sidebar-right-expand]')

    await page.setViewportSize({ width: 1280, height: 900 })
    const address = column.getByRole('textbox', { name: 'Enter an HTTP(S) address' })
    await page.getByRole('link', { name: 'Visit the preview page', exact: true }).click()
    await expect.poll(() => address.inputValue()).toBe('http://127.0.0.1:3080/start')
    await column.locator('[data-sidebar-right-open]').waitFor()
    await page.waitForTimeout(500)
    const content = page.frameLocator('[data-sidebar-browser-frame]')
    await content.getByRole('heading', { name: 'start page' }).waitFor()
    await content.getByRole('link', { name: 'Ordinary HTTP link' }).click()
    await content.getByRole('heading', { name: 'destination' }).waitFor()
    await capture(page, '01-http-navigation-open')

    await column.locator('[data-sidebar-right-toggle]').click()
    await expect.poll(async () => await column.locator('[data-sidebar-right-open]').count()).toBe(0)
    await expect.poll(async () => await restore.count()).toBe(1)
    const restoreBox = await restore.boundingBox()
    const viewport = page.viewportSize()
    if (restoreBox === null || viewport === null) throw new Error('header restore control is not measurable')
    expect(restoreBox.x).toBeGreaterThan(0)
    expect(restoreBox.x + restoreBox.width).toBeLessThanOrEqual(viewport.width)
    await capture(page, '02-collapsed-header-restore')
    await restore.click()
    await expect.poll(async () => await column.locator('[data-sidebar-right-open]').count()).toBe(1)
    await content.getByRole('heading', { name: 'destination' }).waitFor()

    const thresholdResults: { width: number; mode: string | null; open: boolean; restoreAfterClose: number }[] = []
    await column.locator('[data-sidebar-right-toggle]').click()
    await expect.poll(async () => await restore.count()).toBe(1)
    for (const width of [769, 768, 767]) {
      await page.setViewportSize({ width, height: viewport.height })
      await restore.click()
      await expect.poll(async () => await column.locator('[data-sidebar-right-open]').count()).toBe(1)
      await page.waitForTimeout(500)
      const mode = await panel.getAttribute('data-sidebar-right-panel')
      const openBeforeClose = await column.locator('[data-sidebar-right-open]').count() === 1
      await capture(page, `width-${width}-open`)
      await column.locator('[data-sidebar-right-toggle]').click()
      await expect.poll(async () => await restore.count()).toBe(1)
      thresholdResults.push({ width, mode, open: openBeforeClose, restoreAfterClose: await restore.count() })
      await capture(page, `width-${width}-closed`)
    }

    const capacityResults: { width: number; open: boolean; mode: string | null; restore: number }[] = []
    for (const width of [1024, 1119, 1120]) {
      await page.setViewportSize({ width, height: viewport.height })
      const sidebar = page.locator('[class*="sidebarCol"]').first()
      const grip = frame.locator('[data-side="sidebar"]')
      const gripBox = await grip.boundingBox()
      if (gripBox === null) throw new Error(`sidebar grip missing at ${width}px`)
      await page.mouse.move(gripBox.x + gripBox.width / 2, gripBox.y + 100)
      await page.mouse.down()
      await page.mouse.move(420, gripBox.y + 100, { steps: 8 })
      await page.mouse.up()
      await expect.poll(async () => Math.round((await sidebar.boundingBox())?.width ?? 0)).toBe(420)
      // Use the conversation's ordinary HTTP link to open the panel. This
      // covers the same entry point users report as unresponsive when the
      // sidebars consume the available window width.
      await page.getByRole('link', { name: 'Visit the preview page', exact: true }).click()
      await page.waitForTimeout(250)
      await page.waitForTimeout(500)
      const open = await column.locator('[data-sidebar-right-open]').count() === 1
      const mode = await panel.getAttribute('data-sidebar-right-panel')
      capacityResults.push({ width, open, mode, restore: await restore.count() })
      await capture(page, `width-${width}-sidebar-420-after-open`)
      if (open) {
        await column.locator('[data-sidebar-right-toggle]').click()
        await expect.poll(async () => await restore.count()).toBe(1)
      }
      // Reset width through the same visible resize affordance for the next case.
      const currentGrip = await grip.boundingBox()
      if (currentGrip !== null) {
        await page.mouse.move(currentGrip.x + currentGrip.width / 2, currentGrip.y + 100)
        await page.mouse.down()
        await page.mouse.move(280, currentGrip.y + 100, { steps: 8 })
        await page.mouse.up()
      }
      await expect.poll(async () => Math.round((await sidebar.boundingBox())?.width ?? 0)).toBe(280)
    }

    // Selecting a global page intentionally removes Session-scoped sidebar
    // content and its Conversation-header restore control. Returning to the
    // existing conversation restores that control and its HTTP link handler.
    await page.setViewportSize({ width: 1280, height: viewport.height })
    await page.getByRole('button', { name: 'Plugins', exact: true }).click()
    await page.locator('[class*="panelActive"]').filter({ hasText: 'Plugins' }).waitFor()
    await expect.poll(async () => await restore.count()).toBe(0)
    await expect.poll(async () => await column.locator('[data-sidebar-right-open]').count()).toBe(0)
    await capture(page, 'global-plugins-page')
    const sessions = page.getByRole('tree', { name: 'Sessions' })
    const seededSession = sessions.getByRole('treeitem').filter({ hasText: 'Check the right sidebar controls' })
    await seededSession.click()
    await expect.poll(async () => await restore.count()).toBe(1)
    await restore.click()
    await expect.poll(async () => await column.locator('[data-sidebar-right-open]').count()).toBe(1)
    await column.locator('[data-sidebar-right-toggle]').click()
    await expect.poll(async () => await restore.count()).toBe(1)
    await page.getByRole('link', { name: 'Visit the preview page', exact: true }).click()
    await expect.poll(async () => await column.locator('[data-sidebar-right-open]').count()).toBe(1)

    expect(thresholdResults).toEqual([
      { width: 769, mode: 'push', open: true, restoreAfterClose: 1 },
      { width: 768, mode: 'push', open: true, restoreAfterClose: 1 },
      { width: 767, mode: 'fullscreen', open: true, restoreAfterClose: 1 },
    ])
    // At 1024..1119px a 420px left sidebar plus the 400px center leaves
    // less than the right sidebar's 300px minimum; 1120px is the fit control.
    expect(capacityResults).toEqual([
      { width: 1024, open: true, mode: 'fullscreen', restore: 0 },
      { width: 1119, open: true, mode: 'fullscreen', restore: 0 },
      { width: 1120, open: true, mode: 'push', restore: 0 },
    ])
    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])
  }, 120_000)
})
