/**
 * Display projection of reference forms in sent user text (bubble and queue
 * rows). The logged model text remains the single truth; this is presentation
 * only. Inline references follow the consumer's wrapping policy and keep long
 * labels within its width. Explicit `dsh-session:` and generic
 * `<dsh-reference>` wire forms fold only after validation; invalid generic
 * envelopes remain literal and ordinary prose is never guessed as a reference.
 * Exact session labels
 * supplied by an adjacent recall decorate their bare `@label` mention; plain
 * `@name` word-boundary tokens decorate by shape alone; and a plain `/name`
 * token decorates only when the caller names it — a skill the host actually
 * loaded for that message (ui-chat reads the step's `skill-invocation`
 * injections) or the command a command-input bubble echoes — so `/123` or a
 * stray `/word` stays plain text. A `/name` token is whitespace-bounded like
 * the host skill gesture (`dsh-tool-skill`): it ends at whitespace or the
 * text end, so slash paths (`/nfs-hg/xxx`, `/plan.md`) and punctuation-glued
 * tokens (`/plan。`) stay plain even for a loaded name.
 */
import type { ReactNode } from 'react'
import clsx from 'clsx'
import { ReferenceIconRegular } from './ReferenceIcon.tsx'
import css from './user-text.module.css'
import markdownCss from './markdown/MarkdownText.module.css'

/** The wire form a session chip serializes to; label is the display text. */
const SESSION_WIRE_RE = /@\[([^\]\n]+)\]\(dsh-session:[^)\s]+\)/gu

/** Sentence punctuation a bare `@name` token may carry without being part of the reference. */
const TRAILING_PUNCTUATION_RE = /[.,;:!?，。；：！？]+$/u

interface DecorationRange {
  readonly start: number
  readonly end: number
  /** Matched source text (hover title). */
  readonly label: string
  readonly kind: 'session' | 'reference' | 'opaque' | 'plain'
  /** Pre-resolved display text (wire folds); derived from label when absent. */
  readonly display?: string
  /** Explicit model-facing locator shown on hover for structured references. */
  readonly title?: string
}

/** One explicit-reference range in the original model-text coordinates. */
export type UserTextReferenceRun = {
  readonly kind: 'plain' | 'opaque'
  readonly start: number
  readonly end: number
  readonly wire: string
} | {
  readonly kind: 'reference'
  readonly start: number
  readonly end: number
  readonly wire: string
  readonly source: string
  readonly label: string
  readonly text: string
}

/**
 * Tokenize explicit reference envelopes without scanning their payloads as
 * ordinary mentions. Valid references retain their complete wire string;
 * malformed or unclosed envelopes remain opaque literal runs.
 * @param text - the full model text to inspect.
 * @returns ordered plain, validated-reference, and opaque runs.
 */
export function tokenizeUserTextReferences(text: string): readonly UserTextReferenceRun[] {
  const runs: UserTextReferenceRun[] = []
  const re = /<dsh-reference>[\s\S]*?(?:<\/dsh-reference>|$)/gu
  let cursor = 0
  let match: RegExpExecArray | null
  while ((match = re.exec(text)) !== null) {
    if (match.index > cursor) runs.push({ kind: 'plain', start: cursor, end: match.index, wire: text.slice(cursor, match.index) })
    const wire = match[0]
    const closed = wire.endsWith('</dsh-reference>')
    const parsed = closed ? parseReferenceWire(wire.slice('<dsh-reference>'.length, -'</dsh-reference>'.length)) : null
    runs.push(parsed === null
      ? { kind: 'opaque', start: match.index, end: match.index + wire.length, wire }
      : { kind: 'reference', start: match.index, end: match.index + wire.length, wire, ...parsed })
    cursor = match.index + wire.length
  }
  if (cursor < text.length) runs.push({ kind: 'plain', start: cursor, end: text.length, wire: text.slice(cursor) })
  return runs.length === 0 && text !== '' ? [{ kind: 'plain', start: 0, end: text.length, wire: text }] : runs
}

/** Optional navigation supplied by consumers that can preview references. */
export interface UserTextReferences {
  /** Open a file path decoded from an `@` mention. */
  openFile: (path: string) => void
  /** Open the source of a skill loaded for this message. */
  openSkill: (name: string) => void
}

/**
 * Split one sent text into inline plain runs and reference chips.
 * @param text - the logged model text of the message or queue row.
 * @param sessionLabels - exact session mention labels associated by an adjacent recall.
 * @param slashNames - names a `/name` token may decorate as: the skills the
 * host loaded for this message, or the command a command bubble echoes
 * (unsent queue rows pass none).
 * @param slashKind - the chip kind those tokens render as.
 * @param references - optional file and skill preview actions; session and command tokens stay labels.
 * @returns inline nodes covering the whole text.
 */
export function projectUserText(
  text: string,
  sessionLabels: readonly string[],
  slashNames: readonly string[] = [],
  slashKind: 'skill' | 'command' = 'skill',
  references?: UserTextReferences,
): ReactNode {
  const ranges: DecorationRange[] = []
  for (const run of tokenizeUserTextReferences(text)) {
    if (run.kind === 'opaque') ranges.push({ start: run.start, end: run.end, label: run.wire, kind: 'opaque' })
    if (run.kind === 'reference') ranges.push({
      start: run.start,
      end: run.end,
      label: run.wire,
      kind: 'reference',
      display: run.label,
      title: run.text,
    })
  }
  SESSION_WIRE_RE.lastIndex = 0
  let wire: RegExpExecArray | null
  while ((wire = SESSION_WIRE_RE.exec(text)) !== null) {
    ranges.push({
      start: wire.index,
      end: wire.index + wire[0].length,
      label: wire[0],
      kind: 'session',
      display: wire[1] as string, // non-optional capture in SESSION_WIRE_RE
    })
  }
  for (const rawLabel of [...new Set(sessionLabels)].sort((a, b) => b.length - a.length)) {
    const label = `@${rawLabel}`
    let start = text.indexOf(label)
    while (start >= 0) {
      ranges.push({ start, end: start + label.length, label, kind: 'session' })
      start = text.indexOf(label, start + label.length)
    }
  }
  // A `/` token ends at whitespace or the text end like the host skill
  // gesture; only `@` tokens shed sentence punctuation below.
  const re = /(^|\s)(\/[\w-]+(?=\s|$)|@"[^"\n]+"|@[^\s]+)/gu
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    const tokenStart = m.index + (m[1] as string).length // (^|\s) captures '' at line start
    const rawLabel = m[2] as string // non-optional alternation capture
    const label = rawLabel.startsWith('@"')
      ? rawLabel
      : rawLabel.replace(TRAILING_PUNCTUATION_RE, '')
    if (label.length <= 1) continue
    if (label.startsWith('/') && !slashNames.includes(label.slice(1))) continue
    ranges.push({ start: tokenStart, end: tokenStart + label.length, label, kind: 'plain' })
  }
  const rankOf = (range: DecorationRange): number => range.kind === 'session' ? 0 : 1
  ranges.sort((a, b) => a.start - b.start || rankOf(a) - rankOf(b) || b.end - a.end)
  const parts: ReactNode[] = []
  let cursor = 0
  const pushPlain = (from: number, to: number): void => {
    parts.push(<span key={`t${from}`} className={css.plainRun}>{text.slice(from, to)}</span>)
  }
  for (const range of ranges) {
    if (range.start < cursor) continue
    const { start: tokenStart, end, label, kind } = range
    if (tokenStart > cursor) pushPlain(cursor, tokenStart)
    if (kind === 'opaque') {
      pushPlain(tokenStart, end)
      cursor = end
      continue
    }
    const referenceKind = kind === 'session'
      ? 'session'
      : kind === 'reference'
        ? undefined
        : label.startsWith('@')
          ? label.replace(/^@"|"$/gu, '').endsWith('/') ? 'folder' : 'file'
          : undefined
    const displayLabel = range.display
      ?? (referenceKind === undefined
        ? label
        : referenceKind === 'session'
          ? label.slice(1)
          : label.slice(1).replace(/^"|"$/gu, '').split(/[\\/]/u).filter(Boolean).at(-1) ?? label.slice(1))
    const contents = <>
      {kind === 'reference' && <span className={css.referenceMarker} aria-hidden>@</span>}
      {referenceKind !== undefined && (
        <ReferenceIconRegular kind={referenceKind} size={16} className={css.refIcon} />
      )}
      {displayLabel}
    </>
    const open = references === undefined ? undefined
      : referenceKind === 'file'
        ? () => { references.openFile(label.slice(1).replace(/^"|"$/gu, '')) }
        : kind === 'plain' && referenceKind === undefined && slashKind === 'skill'
          ? () => { references.openSkill(label.slice(1)) }
          : undefined
    const className = clsx(css.refChip, kind === 'plain' && referenceKind === undefined && css.slashChip)
    parts.push(open === undefined
      ? <span key={tokenStart} className={className} data-ref-chip={kind === 'reference' ? 'reference' : referenceKind ?? slashKind} title={range.title ?? label}>
        {contents}
      </span>
      : <button
        key={tokenStart}
        type="button"
        className={clsx(className, markdownCss.fileMention)}
        data-ref-chip={referenceKind ?? slashKind}
        title={range.title ?? label}
        onClick={(event) => {
          if (event.detail > 1 || (event.detail !== 0 && event.currentTarget.ownerDocument.getSelection()?.isCollapsed === false)) return
          open()
        }}
      >
        {contents}
      </button>)
    cursor = end
  }
  if (parts.length === 0) return <span className={css.plainRun}>{text}</span>
  if (cursor < text.length) pushPlain(cursor, text.length)
  return <>{parts}</>
}

interface ReferenceWirePayload {
  readonly source: string
  readonly label: string
  readonly text: string
}

/** Parse only explicit reference envelopes; legacy prose is never guessed. */
function parseReferenceWire(raw: string): ReferenceWirePayload | null {
  try {
    const value: unknown = JSON.parse(raw)
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
    const record = value as Record<string, unknown>
    if (Object.keys(record).length !== 3 || !('source' in record) || !('label' in record) || !('text' in record)) return null
    if (typeof record.source !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/u.test(record.source)) return null
    if (typeof record.label !== 'string' || record.label.trim() === '') return null
    if (typeof record.text !== 'string' || record.text.trim() === '') return null
    return { source: record.source, label: record.label, text: record.text }
  } catch {
    return null
  }
}
