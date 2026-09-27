import { createReadStream } from 'node:fs'

const READ_CHUNK_BYTES = 64 * 1024
export const MAX_TEXT_PAGE_CHARACTERS = 20_000
export const MAX_TEXT_PAGE_LINES = 200

export class UnsupportedTextFileError extends Error {
  constructor(message = 'File is not valid UTF-8 text or contains a NUL byte.') {
    super(message)
    this.name = 'UnsupportedTextFileError'
  }
}

export interface Utf8TextPage {
  readonly text: string
  readonly nextOffset: number | null
  readonly totalCharacters: number
}

export interface Utf8PageLine {
  /** Zero-based logical line number. Line-ending bytes are not included. */
  readonly line: number
  /** This page's fragment, measured and cut by Unicode code points. */
  readonly text: string
  /** Zero-based Unicode code-point offset within `line`. */
  readonly charOffset: number
  /** True when another page must continue this same line. */
  readonly continued?: boolean
}

export interface Utf8LinePage {
  readonly lines: readonly Utf8PageLine[]
  readonly nextStart: number | null
  readonly nextCharOffset: number | null
  readonly totalLines: number
}

/**
 * Read a Unicode-code-point page from a UTF-8 text file.
 * The file is scanned to EOF to validate UTF-8 and calculate totalCharacters,
 * but only the requested page is retained in memory.
 */
export async function readUtf8TextPage(
  path: string,
  offset: number,
  maxChars: number,
  signal?: AbortSignal,
): Promise<Utf8TextPage> {
  validateInteger(offset, 'offset', 0, Number.MAX_SAFE_INTEGER)
  validateInteger(maxChars, 'maxChars', 1, MAX_TEXT_PAGE_CHARACTERS)

  const parts: string[] = []
  let totalCharacters = 0
  let pageCharacters = 0
  for await (const chunk of utf8Chunks(path, signal)) {
    for (const character of chunk) {
      if (totalCharacters >= offset && pageCharacters < maxChars) {
        parts.push(character)
        pageCharacters += 1
      }
      totalCharacters += 1
    }
  }

  if (offset > totalCharacters) throw new RangeError('offset must not exceed totalCharacters')
  const nextOffset = offset + pageCharacters < totalCharacters ? offset + pageCharacters : null
  return { text: parts.join(''), nextOffset, totalCharacters }
}

/**
 * Read a line-oriented page from a UTF-8 file without buffering whole lines.
 * CRLF is one line ending; lone CR and LF are also supported. A trailing line
 * ending does not add a phantom line, and an empty file has zero lines.
 */
export async function readUtf8LinePage(
  path: string,
  start: number,
  charOffset: number,
  limit: number,
  maxChars: number,
  signal?: AbortSignal,
): Promise<Utf8LinePage> {
  validateInteger(start, 'start', 0, Number.MAX_SAFE_INTEGER)
  validateInteger(charOffset, 'charOffset', 0, Number.MAX_SAFE_INTEGER)
  validateInteger(limit, 'limit', 1, MAX_TEXT_PAGE_LINES)
  validateInteger(maxChars, 'maxChars', 1, MAX_TEXT_PAGE_CHARACTERS)

  type MutablePageLine = { line: number; charOffset: number; parts: string[]; continued?: boolean }
  type Cursor = { line: number; charOffset: number }
  const rows: MutablePageLine[] = []
  let outputCharacters = 0
  let lineNumber = 0
  let lineCharacters = 0
  let lineHasContent = false
  let currentRow: MutablePageLine | null = null
  let pageFull = false
  let nextCursor: Cursor | null = null
  let previousWasCarriageReturn = false
  let invalidOffset = false

  const emitEmptyLineIfNeeded = () => {
    if (lineNumber < start || currentRow !== null) return
    if (pageFull || rows.length >= limit || outputCharacters >= maxChars) {
      pageFull = true
      nextCursor ??= { line: lineNumber, charOffset: lineNumber === start ? charOffset : 0 }
      return
    }
    currentRow = { line: lineNumber, charOffset: lineNumber === start ? charOffset : 0, parts: [] }
    rows.push(currentRow)
  }

  const endLine = () => {
    if (lineNumber === start && lineCharacters < charOffset) invalidOffset = true
    emitEmptyLineIfNeeded()
    lineNumber += 1
    lineCharacters = 0
    lineHasContent = false
    currentRow = null
    if (rows.length >= limit || outputCharacters >= maxChars) pageFull = true
    if (pageFull) nextCursor ??= { line: lineNumber, charOffset: 0 }
  }

  const consume = (character: string) => {
    if (previousWasCarriageReturn) {
      previousWasCarriageReturn = false
      if (character === '\n') return
    }
    if (character === '\r' || character === '\n') {
      endLine()
      previousWasCarriageReturn = character === '\r'
      return
    }

    lineHasContent = true
    const requestedOffset = lineNumber === start ? charOffset : 0
    if (lineNumber >= start && lineCharacters >= requestedOffset) {
      if (pageFull || outputCharacters >= maxChars || (currentRow === null && rows.length >= limit)) {
        pageFull = true
        nextCursor ??= { line: lineNumber, charOffset: lineCharacters }
        if (currentRow !== null) currentRow.continued = true
      } else {
        if (currentRow === null) {
          currentRow = { line: lineNumber, charOffset: lineCharacters, parts: [] }
          rows.push(currentRow)
        }
        currentRow.parts.push(character)
        outputCharacters += 1
        if (outputCharacters >= maxChars) pageFull = true
      }
    }
    lineCharacters += 1
  }

  for await (const chunk of utf8Chunks(path, signal)) {
    for (const character of chunk) consume(character)
  }

  // An unterminated nonempty final line exists. Empty input and input ending
  // with a line delimiter do not invent another line.
  if (lineHasContent) {
    if (lineNumber === start && lineCharacters < charOffset) invalidOffset = true
    lineNumber += 1
  }
  if (invalidOffset) throw new RangeError('charOffset must not exceed the selected line length')
  if (start > lineNumber || (start === lineNumber && charOffset !== 0)) throw new RangeError('start must identify an existing line')

  // Assignments happen inside the streaming consumer closure, so retain the
  // final cursor in a local for TypeScript's control-flow analysis.
  const finalCursor = nextCursor as Cursor | null
  const nextCursorWithinFile = finalCursor !== null && finalCursor.line < lineNumber ? finalCursor : null
  const nextStart = nextCursorWithinFile?.line ?? null
  const nextCharOffset = nextCursorWithinFile?.charOffset ?? null
  const lines: Utf8PageLine[] = rows.map(({ line, charOffset: rowOffset, parts, continued }) => ({
    line,
    text: parts.join(''),
    charOffset: rowOffset,
    ...(continued === true ? { continued: true } : {}),
  }))
  return { lines, nextStart, nextCharOffset, totalLines: lineNumber }
}

async function* utf8Chunks(path: string, signal?: AbortSignal): AsyncGenerator<string> {
  if (signal?.aborted) throw signal.reason ?? new Error('Operation aborted')
  const stream = createReadStream(path, {
    highWaterMark: READ_CHUNK_BYTES,
    ...(signal === undefined ? {} : { signal }),
  })
  // Preserve a UTF-8 BOM as U+FEFF so offsets and returned text account for
  // every decoded code point rather than silently consuming the first one.
  const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true })
  try {
    for await (const bytes of stream) {
      let decoded: string
      try { decoded = decoder.decode(bytes, { stream: true }) }
      catch { throw new UnsupportedTextFileError() }
      assertTextChunk(decoded)
      if (decoded.length > 0) yield decoded
    }
    let tail: string
    try { tail = decoder.decode() }
    catch { throw new UnsupportedTextFileError() }
    assertTextChunk(tail)
    if (tail.length > 0) yield tail
  } finally {
    stream.destroy()
  }
}

function assertTextChunk(chunk: string): void {
  if (chunk.includes('\0')) throw new UnsupportedTextFileError()
}

function validateInteger(value: number, name: string, minimum: number, maximum: number): void {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new RangeError(`${name} must be an integer from ${minimum} to ${maximum}`)
  }
}
