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

test('Kanban tables truncate, resize, cancel, persist independently and recover from unavailable storage', async () => {
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
    page.on('pageerror', error => errors.push(error.message))
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
    mkdirSync(resolve(root, '.artifacts/kanban-table'), { recursive: true })
    await page.screenshot({ path: resolve(root, '.artifacts/kanban-table/verified.png') })
    assert.deepEqual(errors, [])
  } finally { await browser?.close(); await server.close() }
})
