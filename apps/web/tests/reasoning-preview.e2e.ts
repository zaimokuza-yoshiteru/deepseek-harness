/** Streaming reasoning previews through the assembled Chat and a paused model adapter. */
import { fileURLToPath } from 'node:url'
import { chromium, type Page } from 'playwright'
import { expect, it } from 'vitest'
import { LlmAdapter, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import {
  captureStableAria, compareOrRefreshGolden, launchWebScaffold, watchConsole, webSnapshotMode,
} from './scaffold.ts'
import { connectFreshWorkspace, expandOwningTurnProcess, newEnglishPage, writeComposerDraft } from './support.ts'

const SUMMARY = `Next paragraph: ${'inspect the loaded context and pending tools '.repeat(8).trim()}`
const DELTAS = ['First paragraph', `\nDetails\n\n\n${SUMMARY}`, '\nMore detail']
const UI_EXPECTED = fileURLToPath(new URL('./expected/reasoning-preview/running.expected.md', import.meta.url))

/** Count changed pixels in two equal-sized Chromium screenshots. */
async function differingPixels(page: Page, first: Buffer, second: Buffer): Promise<number> {
  return page.evaluate(async ({ firstPng, secondPng }) => {
    const decode = async (encoded: string): Promise<HTMLImageElement> => {
      const image = new Image()
      image.src = `data:image/png;base64,${encoded}`
      await image.decode()
      return image
    }
    const [a, b] = await Promise.all([decode(firstPng), decode(secondPng)])
    if (a.naturalWidth !== b.naturalWidth || a.naturalHeight !== b.naturalHeight) throw new Error('Whale screenshots changed dimensions')
    const canvas = document.createElement('canvas')
    canvas.width = a.naturalWidth
    canvas.height = a.naturalHeight
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (context === null) throw new Error('Canvas 2D context unavailable for screenshot pixel comparison')
    context.drawImage(a, 0, 0)
    const pixelsA = context.getImageData(0, 0, canvas.width, canvas.height).data
    context.clearRect(0, 0, canvas.width, canvas.height)
    context.drawImage(b, 0, 0)
    const pixelsB = context.getImageData(0, 0, canvas.width, canvas.height).data
    let count = 0
    for (let offset = 0; offset < pixelsA.length; offset += 4) {
      if (pixelsA[offset] !== pixelsB[offset]
        || pixelsA[offset + 1] !== pixelsB[offset + 1]
        || pixelsA[offset + 2] !== pixelsB[offset + 2]
        || pixelsA[offset + 3] !== pixelsB[offset + 3]) count += 1
    }
    return count
  }, { firstPng: first.toString('base64'), secondPng: second.toString('base64') })
}

class PausedReasoningAdapter extends LlmAdapter {
  override async listModels(provider: string) { return [{ provider, id: 'paused', name: `${provider}/paused` }] }
  readonly stages = DELTAS.map(text => ({
    text,
    arrived: Promise.withResolvers<undefined>(),
    proceed: Promise.withResolvers<undefined>(),
  }))

  release(): void {
    for (const stage of this.stages) stage.proceed.resolve(undefined)
  }

  override async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    yield { type: 'block-start', index: 0, blockType: 'reasoning' }
    for (const stage of this.stages) {
      yield { type: 'reasoning-delta', index: 0, text: stage.text }
      stage.arrived.resolve(undefined)
      await stage.proceed.promise
      options.signal?.throwIfAborted()
    }
    yield { type: 'block-end', index: 0, block: { type: 'reasoning', text: DELTAS.join('') } }
    yield { type: 'block-start', index: 1, blockType: 'text' }
    yield { type: 'text-delta', index: 1, text: 'Done' }
    yield { type: 'block-end', index: 1, block: { type: 'text', text: 'Done' } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

it('shows completed paragraph first lines across blank lines with a right-edge fade', async () => {
  const scaffold = await launchWebScaffold()
  const adapter = new PausedReasoningAdapter()
  try {
    scaffold.ctx.effect(() => scaffold.ctx.llm.registerAdapter(['reasoning-preview-test'], adapter))
    await scaffold.ctx.agentDefaultModel.saveSelection({ provider: 'reasoning-preview-test', model: 'paused' })
    const browser = await chromium.launch()
    try {
      const page = await newEnglishPage(browser)
      const console = watchConsole(page)
      await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
      await connectFreshWorkspace(page, scaffold.workspaceCwd)
      await page.setViewportSize({ width: 480, height: 1000 })
      const input = page.locator('[data-composer-input]').first()
      const settled = scaffold.whenTurnSettled()
      await writeComposerDraft(page, input, 'Show a streamed reasoning preview.')
      await input.press('Enter')

      const [first, second, third] = adapter.stages
      if (first === undefined || second === undefined || third === undefined) throw new Error('preview stages are incomplete')
      await first.arrived.promise
      const reasoning = page.locator('[data-variant="think"][data-state="running"]')
      await expandOwningTurnProcess(page, reasoning)
      await reasoning.waitFor()
      const whale = page.locator('[data-chat-running] span[aria-hidden="true"]:has(> svg)')
      const animatedWhale = whale.locator(':scope > span')
      const restingWhale = whale.locator(':scope > svg')
      await whale.waitFor()
      expect(await whale.locator('animate').count()).toBe(0)
      const expectStaticWhale = async () => {
        await expect.poll(() => animatedWhale.isVisible()).toBe(false)
        await expect.poll(() => restingWhale.isVisible()).toBe(true)
        expect(await animatedWhale.evaluate(element => getComputedStyle(element).maskImage)).toBe('none')
        const colors = await restingWhale.locator('path').evaluate((path) => {
          const probe = document.createElement('span')
          probe.style.cssText = 'color: Canvas; forced-color-adjust: none'
          document.body.append(probe)
          try {
            const style = getComputedStyle(path)
            return {
              stroke: style.stroke.toLowerCase() === 'currentcolor' ? style.color : style.stroke,
              canvas: getComputedStyle(probe).color,
              length: (path as SVGPathElement).getTotalLength(),
            }
          } finally { probe.remove() }
        })
        expect(colors.stroke).not.toBe('none')
        expect(colors.stroke).not.toBe('transparent')
        expect(colors.stroke).not.toBe(colors.canvas)
        expect(colors.length).toBeGreaterThan(0)
      }
      try {
        await page.emulateMedia({ reducedMotion: 'no-preference', forcedColors: 'none' })
        await expect.poll(() => animatedWhale.isVisible()).toBe(true)
        expect(await animatedWhale.evaluate(element => getComputedStyle(element).maskMode)).toBe('alpha')
        const maskPixels = await animatedWhale.evaluate(async (element) => {
          const source = getComputedStyle(element).maskImage.match(/^url\("?(data:image\/png;base64,[A-Za-z0-9+/=]+)"?\)$/)?.[1]
          if (source === undefined) throw new Error('Running whale mask must use the bundled PNG data URL')
          const image = new Image()
          image.src = source
          await image.decode()
          const canvas = document.createElement('canvas')
          canvas.width = image.naturalWidth
          canvas.height = image.naturalHeight
          const context = canvas.getContext('2d', { willReadFrequently: true })
          if (context === null) throw new Error('Canvas 2D context unavailable for whale mask')
          context.drawImage(image, 0, 0)
          const alpha = context.getImageData(0, 0, canvas.width, canvas.height).data
          let visiblePixels = 0
          for (let offset = 3; offset < alpha.length; offset += 4) if (alpha[offset]! > 0) visiblePixels += 1
          const transparent = document.createElement('canvas')
          transparent.width = 28
          transparent.height = 28
          return {
            width: image.naturalWidth,
            height: image.naturalHeight,
            visiblePixels,
            transparentMask: transparent.toDataURL('image/png'),
          }
        })
        expect([maskPixels.width, maskPixels.height]).toEqual([28, 28])
        expect(maskPixels.visiblePixels).toBeGreaterThan(0)
        expect(await restingWhale.isVisible()).toBe(false)
        const priorStyle = await animatedWhale.getAttribute('style')
        await animatedWhale.evaluate((element) => { (element as HTMLElement).style.visibility = 'hidden' })
        const hiddenBaseline = await whale.screenshot({ animations: 'allow' })
        await animatedWhale.evaluate((element) => { (element as HTMLElement).style.visibility = 'visible' })
        const firstWhaleFrame = await whale.screenshot({ animations: 'allow' })
        await animatedWhale.evaluate((element, source) => {
          const style = (element as HTMLElement).style
          style.maskImage = `url("${source}")`
          style.maskMode = 'alpha'
        }, maskPixels.transparentMask)
        const zeroAlphaFrame = await whale.screenshot({ animations: 'allow' })
        await animatedWhale.evaluate((element, styleText) => {
          if (styleText === null) element.removeAttribute('style')
          else element.setAttribute('style', styleText)
        }, priorStyle)
        expect(await differingPixels(page, hiddenBaseline, firstWhaleFrame)).toBeGreaterThan(0)
        expect(await differingPixels(page, hiddenBaseline, zeroAlphaFrame)).toBe(0)
        await expect.poll(async () => !(await whale.screenshot({ animations: 'allow' })).equals(firstWhaleFrame), {
          timeout: 5000,
        }).toBe(true)
        await page.emulateMedia({ reducedMotion: 'reduce' })
        await expectStaticWhale()
        await page.emulateMedia({ reducedMotion: 'no-preference', forcedColors: 'active' })
        await expectStaticWhale()
      } finally {
        await page.emulateMedia({ reducedMotion: null, forcedColors: null })
      }
      expect(await reasoning.getAttribute('data-preview')).toBeNull()

      first.proceed.resolve(undefined)
      await second.arrived.promise
      const preview = reasoning.locator('[data-streaming]:not([inert] *)')
      await expect.poll(() => preview.textContent()).toBe('First paragraph')
      expect(await preview.isVisible()).toBe(true)
      await preview.evaluate((element) => { element.setAttribute('data-retained-preview', 'true') })

      second.proceed.resolve(undefined)
      await third.arrived.promise
      await expect.poll(() => preview.textContent()).toBe(SUMMARY)
      expect(await preview.getAttribute('data-retained-preview')).toBe('true')
      expect(await preview.evaluate(element => getComputedStyle(element).maskImage)).toContain('linear-gradient')
      expect(await preview.evaluate(element => element.scrollWidth > element.clientWidth)).toBe(true)
      expect(await reasoning.getByRole('button').getAttribute('aria-expanded')).toBe('false')
      await compareOrRefreshGolden(UI_EXPECTED,
        await captureStableAria(page, '[data-variant="think"]', scaffold.workspaceCwd), webSnapshotMode())

      third.proceed.resolve(undefined)
      await settled
      await page.getByText('Done', { exact: true }).waitFor()
      await whale.waitFor({ state: 'detached' })
      expect(console.pageErrors).toEqual([])
      expect(console.warnings).toEqual([])
    } finally {
      adapter.release()
      await browser.close()
    }
  } finally {
    adapter.release()
    await scaffold.close()
  }
})
