import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mkdirSync } from 'node:fs'
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const requireWeb = createRequire(resolve(root, 'apps/web/package.json'))
const { createServer } = await import(requireWeb.resolve('vite'))
const { chromium } = requireWeb('playwright')

test('Kanban typography, duplicate actions, table sizing, recovery and themes stay consistent', async () => {
  const server = await createServer({ configFile: false, root: resolve(root, '.maintenance/tests/fixtures/kanban-table'),
    server: { host: '127.0.0.1', port: 0, fs: { allow: [root] } },
    esbuild: { jsx: 'automatic' },
    resolve: { alias: [{ find: '@deepseek-ai/dsh-client-ui-primitives', replacement: resolve(root, 'packages/client/ui-primitives/src/index.ts') }, ...['react', 'react-dom'].map(name => ({ find: name, replacement: dirname(requireWeb.resolve(name + '/package.json')) }))] },
  })
  let browser
  try {
    await server.listen()
    browser = await chromium.launch({ headless: true })
    const page = await browser.newPage({ viewport: { width: 1000, height: 650 } })
    const errors = []
    const externalRequests = []
    page.on('pageerror', error => errors.push(error.message))
    page.on('request', request => {
      const requestUrl = new URL(request.url())
      if (requestUrl.hostname !== '127.0.0.1') externalRequests.push(request.url())
    })
    const address = server.httpServer.address()
    const url = `http://127.0.0.1:${address.port}`
    await page.goto(url)
    await page.locator('tbody tr').nth(2).waitFor()
    const column = index => page.locator('thead th').nth(index)
    const width = index => column(index).evaluate(el => el.getBoundingClientRect().width)
    const handle = index => column(index).getByRole('separator')
    const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 2, `${actual} != ${expected}`)
    const resize = async (index, distance, cancel = false) => {
      const box = await handle(index).boundingBox()
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
      await page.mouse.down()
      await page.mouse.move(box.x + box.width / 2 + distance, box.y + box.height / 2, { steps: 8 })
      if (cancel) await page.keyboard.press('Escape')
      await page.mouse.up()
    }
    const heights = await page.locator('tbody tr').evaluateAll(rows => rows.map(row => row.getBoundingClientRect().height))
    close(heights[0], heights[2]); close(heights[1], heights[2])
    const key = page.locator('tbody tr').first().locator('td').nth(1).locator('a span')
    assert.equal(await key.evaluate(el => getComputedStyle(el).textOverflow), 'ellipsis')
    assert.ok(await key.evaluate(el => el.scrollWidth > el.clientWidth))
    await key.hover()
    await page.getByRole('tooltip').filter({ hasText: 'EXTRA-LONG-PROJECT-KEY-' }).waitFor()
    const before = await width(1), neighbor = await width(2)
    await resize(1, 140)
    close(await width(1), before + 140); close(await width(2), neighbor)
    await page.getByRole('button', { name: '刷新', exact: true }).click()
    close(await width(1), before + 140)
    await page.reload(); await page.locator('tbody tr').nth(2).waitFor()
    close(await width(1), before + 140)
    await resize(1, 80, true)
    close(await width(1), before + 140)
    assert.equal(Number(await handle(1).getAttribute('aria-valuenow')), Math.round(before + 140))
    await handle(1).focus(); await page.keyboard.press('ArrowRight')
    close(await width(1), before + 150)
    await page.getByRole('tab', { name: 'Bitbucket', exact: true }).click()
    await page.locator('thead th').nth(2).waitFor()
    assert.equal(await page.locator('thead th').count(), 3)
    const prBefore = await width(0)
    await resize(0, 80); close(await width(0), prBefore + 80)
    await page.getByRole('tab', { name: 'Jira', exact: true }).click()
    await page.locator('tbody tr').nth(2).waitFor(); close(await width(1), before + 150)
    await page.setViewportSize({ width: 480, height: 650 })
    assert.ok(await page.getByRole('tabpanel').evaluate(el => el.scrollWidth > el.clientWidth))
    close(await width(1), before + 150)
    await page.getByRole('button', { name: '恢复默认列宽' }).click(); close(await width(1), before)
    await page.setViewportSize({ width: 1000, height: 650 })
    await page.evaluate(() => localStorage.setItem('dsh-atlassian-kanban:column-widths:v1:jira', '{broken'))
    await page.reload(); await page.locator('tbody tr').nth(2).waitFor(); close(await width(1), before)
    await page.evaluate(() => { Storage.prototype.setItem = () => { throw new Error('Storage disabled') } })
    await resize(1, 50); close(await width(1), before + 50)
    await handle(1).focus(); await page.keyboard.press('Home'); close(await width(1), 80)
    for (const index of [0, 2, 3, 4]) {
      const original = await width(index)
      await handle(index).focus(); await page.keyboard.press('ArrowLeft')
      close(await width(index), original - 10)
    }
    const firstRow = page.locator('tbody tr').first()
    for (const index of [0, 2, 3, 4]) {
      const selector = index === 2 ? 'a span' : index === 3 ? 'span span' : 'span span:last-child'
      const text = firstRow.locator('td').nth(index).locator(selector).first()
      assert.equal(await text.evaluate(el => getComputedStyle(el).textOverflow), 'ellipsis')
    }
    const screenshotDir = resolve(root, '.artifacts/kanban-table')
    mkdirSync(screenshotDir, { recursive: true })
    await page.emulateMedia({ reducedMotion: 'reduce' })
    const capture = async name => {
      await page.evaluate(() => { if (document.activeElement instanceof HTMLElement) document.activeElement.blur() })
      return page.screenshot({ path: resolve(screenshotDir, `${name}.png`) })
    }
    const pageTypography = await page.locator('section').first().evaluate(el => {
      const family = getComputedStyle(el).fontFamily
      return {
        family,
        actionFamily: getComputedStyle(el.querySelector('header button')).fontFamily,
        scopeFamily: getComputedStyle(el.querySelector('nav button')).fontFamily,
        scopeSize: getComputedStyle(el.querySelector('nav button')).fontSize,
        tabFamily: getComputedStyle(el.querySelector('[role="tab"]')).fontFamily,
        selectedTabWeight: getComputedStyle(el.querySelector('[role="tab"][aria-selected="true"]')).fontWeight,
      }
    })
    assert.equal(pageTypography.actionFamily, pageTypography.family)
    assert.equal(pageTypography.scopeFamily, pageTypography.family)
    assert.equal(pageTypography.tabFamily, pageTypography.family)
    assert.equal(pageTypography.scopeSize, '13px')
    assert.equal(pageTypography.selectedTabWeight, '500')
    await capture('jira-light')
    await page.goto(`${url}?theme=dark`); await page.locator('tbody tr').nth(2).waitFor()
    assert.equal(await page.locator('body').getAttribute('data-ds-dark-theme'), '')
    await capture('jira-dark')
    await page.goto(url); await page.getByRole('tab', { name: 'Bitbucket', exact: true }).click(); await page.locator('tbody tr').first().waitFor()
    await capture('bitbucket-light')
    await page.getByRole('tab', { name: 'Confluence', exact: true }).click(); await page.locator('article').first().waitFor()
    const confluenceLightMetadata = await page.locator('article').first().locator('div').first().evaluate(el => ({ color: getComputedStyle(el).color, size: getComputedStyle(el).fontSize }))
    assert.equal(confluenceLightMetadata.size, '13px')
    await capture('confluence-light')
    await page.goto(`${url}?theme=dark`); await page.getByRole('tab', { name: 'Confluence', exact: true }).click(); await page.locator('article').first().waitFor()
    const confluenceDarkMetadata = await page.locator('article').first().locator('div').first().evaluate(el => ({ color: getComputedStyle(el).color, size: getComputedStyle(el).fontSize }))
    assert.equal(confluenceDarkMetadata.size, '13px')
    assert.notEqual(confluenceDarkMetadata.color, confluenceLightMetadata.color)
    await capture('confluence-dark')

    await page.goto(`${url}?view=settings`)
    await page.getByRole('heading', { name: 'Jira', exact: true }).waitFor()
    const settingsTypography = await page.locator('section[aria-label="Atlassian 看板"] button').first().evaluate(button => ({
      family: getComputedStyle(button).fontFamily, size: getComputedStyle(button).fontSize,
      bodyFamily: getComputedStyle(document.body).fontFamily,
    }))
    assert.equal(settingsTypography.size, '13px')
    assert.equal(settingsTypography.family, settingsTypography.bodyFamily)
    const inputFamily = await page.locator('section[aria-label="Atlassian 看板"] input').first().evaluate(input => getComputedStyle(input).fontFamily)
    assert.equal(inputFamily, settingsTypography.bodyFamily)
    await capture('settings-light')
    await page.goto(`${url}?view=settings&theme=dark&platform=darwin`)
    await page.getByRole('heading', { name: 'Jira', exact: true }).waitFor()
    await capture('settings-dark-darwin')
    await page.setViewportSize({ width: 480, height: 650 })
    await page.goto(`${url}?view=settings`)
    await page.getByRole('heading', { name: 'Jira', exact: true }).waitFor()
    const settingsWidth = await page.locator('section[aria-label="Atlassian 看板"]').evaluate(el => ({ client: el.clientWidth, scroll: el.scrollWidth }))
    assert.ok(settingsWidth.scroll <= settingsWidth.client, `${settingsWidth.scroll}px settings content exceeds ${settingsWidth.client}px viewport`)
    await capture('settings-narrow-light')

    await page.setViewportSize({ width: 480, height: 650 })
    await page.goto(url); await page.locator('tbody tr').nth(2).waitFor()
    assert.ok(await page.getByRole('tabpanel').evaluate(el => el.scrollWidth > el.clientWidth))
    await capture('jira-narrow-light')
    await page.goto(`${url}?theme=dark`); await page.locator('tbody tr').nth(2).waitFor()
    assert.ok(await page.getByRole('tabpanel').evaluate(el => el.scrollWidth > el.clientWidth))
    await capture('jira-narrow-dark')

    await page.setViewportSize({ width: 1000, height: 650 })
    await page.goto(`${url}?scenario=unconfigured`)
    await page.getByText('请在插件配置中填写此产品的 Base URL', { exact: false }).waitFor()
    assert.equal(await page.getByRole('button', { name: '打开插件配置', exact: true }).count(), 1)
    await capture('unconfigured-light')

    await page.goto(`${url}?scenario=query-error`)
    await page.getByRole('alert').waitFor()
    assert.equal(await page.getByRole('button', { name: '刷新', exact: true }).count(), 0)
    assert.equal(await page.getByRole('button', { name: '重试', exact: true }).count(), 1)
    const errorTypography = await page.locator('section').first().evaluate(el => {
      const button = getComputedStyle(el.querySelector('button'))
      return { family: getComputedStyle(el).fontFamily, buttonFamily: button.fontFamily, buttonSize: button.fontSize }
    })
    assert.equal(errorTypography.buttonFamily, errorTypography.family)
    assert.equal(errorTypography.buttonSize, '13px')
    await capture('query-error-light')
    await page.getByRole('button', { name: '重试', exact: true }).click()
    await page.locator('tbody tr').nth(2).waitFor()
    assert.equal(await page.getByRole('alert').count(), 0)
    assert.equal(await page.getByRole('button', { name: '刷新', exact: true }).count(), 1)
    assert.deepEqual(errors, [])
    assert.deepEqual(externalRequests, [])
  } finally { await browser?.close(); await server.close() }
})
