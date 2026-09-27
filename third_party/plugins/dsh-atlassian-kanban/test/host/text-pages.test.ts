import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  MAX_TEXT_PAGE_CHARACTERS,
  readUtf8LinePage,
  readUtf8TextPage,
  UnsupportedTextFileError,
} from '../../src/host/text-pages.ts'

describe('bounded UTF-8 text pages', () => {
  let directory: string
  let path: string

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'dsh-kanban-text-pages-'))
    path = join(directory, 'fixture.txt')
  })

  afterEach(async () => { await rm(directory, { recursive: true, force: true }) })

  it('paginates attachment text by Unicode code point and reports the full size', async () => {
    await writeFile(path, 'A😀中🙂Z', 'utf8')

    const first = await readUtf8TextPage(path, 1, 2)
    const second = await readUtf8TextPage(path, first.nextOffset!, 2)

    expect(first).toEqual({ text: '😀中', nextOffset: 3, totalCharacters: 5 })
    expect(second).toEqual({ text: '🙂Z', nextOffset: null, totalCharacters: 5 })
    expect(await readUtf8TextPage(path, 5, 2)).toEqual({ text: '', nextOffset: null, totalCharacters: 5 })
    await writeFile(path, '\uFEFFA', 'utf8')
    expect(await readUtf8TextPage(path, 0, 2)).toEqual({ text: '\uFEFFA', nextOffset: null, totalCharacters: 2 })
    await expect(readUtf8TextPage(path, 6, 1)).rejects.toThrow(RangeError)
    await expect(readUtf8TextPage(path, 0, MAX_TEXT_PAGE_CHARACTERS + 1)).rejects.toThrow(RangeError)
  })

  it('rejects invalid UTF-8 and NUL anywhere in the file, including after the requested page', async () => {
    await writeFile(path, Buffer.concat([Buffer.from('first-page'), Buffer.from([0xff])]))
    await expect(readUtf8TextPage(path, 0, 2)).rejects.toBeInstanceOf(UnsupportedTextFileError)
    await expect(readUtf8LinePage(path, 0, 0, 1, 2)).rejects.toBeInstanceOf(UnsupportedTextFileError)

    await writeFile(path, Buffer.from('first\0last', 'utf8'))
    await expect(readUtf8TextPage(path, 0, 1)).rejects.toBeInstanceOf(UnsupportedTextFileError)
  })

  it('honors cancellation before opening the file', async () => {
    await writeFile(path, 'some text', 'utf8')
    const controller = new AbortController()
    controller.abort(new Error('test cancelled'))
    await expect(readUtf8TextPage(path, 0, 2, controller.signal)).rejects.toThrow('test cancelled')
  })

  it('cancels an active stream when its AbortSignal is aborted', async () => {
    await writeFile(path, Buffer.alloc(32 * 1024 * 1024, 0x61))
    const controller = new AbortController()
    const pending = readUtf8TextPage(path, 0, 100, controller.signal)
    setTimeout(() => controller.abort(new Error('active read cancelled')), 0)
    await expect(pending).rejects.toBeTruthy()
  })

  it('reconstructs mixed Unicode and empty lines across varied page sizes', async () => {
    const expected = ['A😀', '', '中🙂'.repeat(6), 'z', '', 'tail🧭']
    const endings = ['\r\n', '\n', '\r', '\r\n', '\n']
    const source = expected.map((line, index) => line + (endings[index] ?? '')).join('')
    await writeFile(path, source, 'utf8')

    for (const maxChars of [1, 3, 8, 13]) {
      for (const limit of [1, 2, 5]) {
        const fragments = new Map<number, string>()
        let start = 0
        let charOffset = 0
        let pages = 0
        while (true) {
          const page = await readUtf8LinePage(path, start, charOffset, limit, maxChars)
          pages += 1
          expect(page.lines.length).toBeLessThanOrEqual(limit)
          expect(page.lines.reduce((sum, line) => sum + [...line.text].length, 0)).toBeLessThanOrEqual(maxChars)
          for (const line of page.lines) {
            const previous = fragments.get(line.line) ?? ''
            expect(line.charOffset).toBe([...previous].length)
            fragments.set(line.line, previous + line.text)
          }
          if (page.nextStart === null) {
            expect(page.totalLines).toBe(expected.length)
            break
          }
          start = page.nextStart
          charOffset = page.nextCharOffset!
          expect(pages).toBeLessThan(100)
        }
        expect([...fragments.keys()]).toEqual(expected.map((_, index) => index))
        expect(expected.map((_, index) => fragments.get(index))).toEqual(expected)
      }
    }
  })

  it('reconstructs mixed newline text and long Unicode lines without gaps or duplicates', async () => {
    const longLine = `${'界😀'.repeat(50_000)}尾`
    const source = `α😀\r\n\r\n${longLine}\rfinal`
    await writeFile(path, source, 'utf8')

    const reconstructed: string[] = []
    const fragments = new Map<number, string>()
    let start = 0
    let charOffset = 0
    let totalLines: number | undefined
    let pages = 0
    while (true) {
      const page = await readUtf8LinePage(path, start, charOffset, 2, 20_000)
      pages += 1
      totalLines = page.totalLines
      expect(page.lines.reduce((sum, line) => sum + [...line.text].length, 0)).toBeLessThanOrEqual(20_000)
      for (const line of page.lines) {
        expect(line.charOffset).toBe([...(fragments.get(line.line) ?? '')].length)
        fragments.set(line.line, (fragments.get(line.line) ?? '') + line.text)
      }
      if (page.nextStart === null) break
      start = page.nextStart
      charOffset = page.nextCharOffset!
      expect(pages).toBeLessThan(10)
    }

    expect(totalLines).toBe(4)
    expect([...fragments.keys()]).toEqual([0, 1, 2, 3])
    reconstructed.push(...[0, 1, 2, 3].map(index => fragments.get(index)!))
    expect(reconstructed).toEqual(['α😀', '', longLine, 'final'])
  })

  it('paginates by line count and treats empty and trailing-newline files consistently', async () => {
    const source = Array.from({ length: 205 }, (_, index) => `line-${index}`).join('\n')
    await writeFile(path, source, 'utf8')
    const lines: number[] = []
    let start = 0
    let charOffset = 0
    while (true) {
      const page = await readUtf8LinePage(path, start, charOffset, 73, MAX_TEXT_PAGE_CHARACTERS)
      expect(page.lines.length).toBeLessThanOrEqual(73)
      lines.push(...page.lines.map(line => line.line))
      if (page.nextStart === null) break
      start = page.nextStart
      charOffset = page.nextCharOffset!
    }
    expect(lines).toEqual(Array.from({ length: 205 }, (_, index) => index))

    await writeFile(path, '', 'utf8')
    expect(await readUtf8LinePage(path, 0, 0, 10, 10)).toEqual({ lines: [], nextStart: null, nextCharOffset: null, totalLines: 0 })
    await writeFile(path, 'a\n', 'utf8')
    expect(await readUtf8LinePage(path, 0, 0, 10, 10)).toMatchObject({ lines: [{ line: 0, text: 'a' }], totalLines: 1, nextStart: null })
    await writeFile(path, '\n', 'utf8')
    expect(await readUtf8LinePage(path, 0, 0, 10, 10)).toMatchObject({ lines: [{ line: 0, text: '' }], totalLines: 1 })
  })

  it('returns a continuation cursor when the character budget cuts a line', async () => {
    await writeFile(path, 'abcdefghij\nnext', 'utf8')
    const first = await readUtf8LinePage(path, 0, 0, 10, 4)
    const second = await readUtf8LinePage(path, first.nextStart!, first.nextCharOffset!, 10, 4)
    const third = await readUtf8LinePage(path, second.nextStart!, second.nextCharOffset!, 10, 4)
    expect(first).toMatchObject({ lines: [{ line: 0, text: 'abcd', charOffset: 0, continued: true }], nextStart: 0, nextCharOffset: 4 })
    expect(second).toMatchObject({ lines: [{ line: 0, text: 'efgh', charOffset: 4, continued: true }], nextStart: 0, nextCharOffset: 8 })
    expect(third).toMatchObject({
      lines: [{ line: 0, text: 'ij', charOffset: 8 }, { line: 1, text: 'ne', charOffset: 0, continued: true }],
      nextStart: 1,
      nextCharOffset: 2,
    })
  })
})
