import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type PointerEvent, type KeyboardEvent } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { KanbanLocaleKey } from './locales.ts'
import css from './KanbanPage.module.css'

type Product = 'jira' | 'bitbucket'
type Translate = (key: KanbanLocaleKey) => string
interface Column { readonly key: KanbanLocaleKey; readonly width: number; readonly min: number }
const COLUMNS: Record<Product, readonly Column[]> = {
  jira: [{ key: 'type', width: 110, min: 70 }, { key: 'key', width: 150, min: 80 }, { key: 'title', width: 310, min: 120 }, { key: 'state', width: 120, min: 80 }, { key: 'priority', width: 100, min: 70 }],
  bitbucket: [{ key: 'key', width: 100, min: 80 }, { key: 'title', width: 330, min: 120 }, { key: 'state', width: 110, min: 80 }],
}
const MAX_WIDTH = 1600
const storageKey = (product: Product) => `dsh-atlassian-kanban:column-widths:v1:${product}`
const clamp = (width: number, column: Column) => Math.round(Math.max(column.min, Math.min(MAX_WIDTH, width)))

function readWidths(product: Product): number[] | null {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(storageKey(product)) ?? 'null')
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
    const widths = COLUMNS[product].map(column => Reflect.get(value, column.key))
    if (widths.some(width => typeof width !== 'number' || !Number.isFinite(width))) return null
    return widths.map((width: number, index) => clamp(width, COLUMNS[product][index]!))
  } catch { return null }
}

interface Drag {
  readonly pointerId: number
  readonly index: number
  readonly startX: number
  readonly startWidths: number[]
  readonly handle: HTMLSpanElement
  widths: number[]
  frame: number | null
}

export function ResizableTable({ product, t, children }: { readonly product: Product; readonly t: Translate; readonly children: ReactNode }) {
  const columns = COLUMNS[product]
  const [saved, setSaved] = useState<number[] | null>(() => readWidths(product))
  const [availableWidth, setAvailableWidth] = useState(0)
  const container = useRef<HTMLDivElement>(null)
  const table = useRef<HTMLTableElement>(null)
  const drag = useRef<Drag | null>(null)
  const widths = saved ?? columns.map(column => clamp(column.width + (column.key === 'title' ? Math.max(0, availableWidth - columns.reduce((sum, col) => sum + col.width, 0)) : 0), column))

  useLayoutEffect(() => {
    const element = container.current
    if (element === null) return
    const measure = () => { if (drag.current === null) setAvailableWidth(Math.floor(element.clientWidth)) }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  useEffect(() => () => {
    if (drag.current?.frame != null) cancelAnimationFrame(drag.current.frame)
    drag.current = null
  }, [])

  const paint = (next: readonly number[]) => {
    const element = table.current
    if (element === null) return
    element.style.width = `${next.reduce((sum, width) => sum + width, 0)}px`
    element.querySelectorAll('col').forEach((col, index) => { col.style.width = `${next[index]}px` })
  }
  const persist = (next: number[] | null) => {
    setSaved(next)
    try {
      if (next === null) localStorage.removeItem(storageKey(product))
      else localStorage.setItem(storageKey(product), JSON.stringify(Object.fromEntries(columns.map((column, index) => [column.key, next[index]]))))
    } catch { /* Resizing still works when local storage is unavailable. */ }
  }
  const finish = (commit: boolean, clientX?: number) => {
    const active = drag.current
    if (active === null) return
    if (clientX !== undefined) active.widths[active.index] = clamp(active.startWidths[active.index]! + clientX - active.startX, columns[active.index]!)
    if (active.frame !== null) cancelAnimationFrame(active.frame)
    drag.current = null
    if (table.current) delete table.current.dataset.resizing
    if (active.handle.hasPointerCapture(active.pointerId)) active.handle.releasePointerCapture(active.pointerId)
    paint(commit ? active.widths : active.startWidths)
    active.handle.setAttribute('aria-valuenow', String((commit ? active.widths : active.startWidths)[active.index]))
    if (commit) persist(active.widths)
    if (container.current) setAvailableWidth(Math.floor(container.current.clientWidth))
  }
  const start = (event: PointerEvent<HTMLSpanElement>, index: number) => {
    if (event.button !== 0 || !event.isPrimary || drag.current !== null) return
    event.preventDefault()
    event.currentTarget.focus()
    event.currentTarget.setPointerCapture(event.pointerId)
    drag.current = { pointerId: event.pointerId, index, startX: event.clientX, startWidths: [...widths], widths: [...widths], handle: event.currentTarget, frame: null }
    if (table.current) table.current.dataset.resizing = 'true'
  }
  const move = (event: PointerEvent<HTMLSpanElement>) => {
    const active = drag.current
    if (active === null || active.pointerId !== event.pointerId) return
    active.widths[active.index] = clamp(active.startWidths[active.index]! + event.clientX - active.startX, columns[active.index]!)
    if (active.frame === null) active.frame = requestAnimationFrame(() => {
      paint(active.widths)
      active.handle.setAttribute('aria-valuenow', String(active.widths[active.index]))
      active.frame = null
    })
  }
  const keyDown = (event: KeyboardEvent<HTMLSpanElement>, index: number) => {
    if (event.key === 'Escape') { event.preventDefault(); finish(false); return }
    if (drag.current !== null || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
    event.preventDefault()
    const next = [...widths]
    const delta = (event.shiftKey ? 50 : 10) * (event.key === 'ArrowLeft' ? -1 : 1)
    next[index] = clamp(event.key === 'Home' ? columns[index]!.min : event.key === 'End' ? MAX_WIDTH : widths[index]! + delta, columns[index]!)
    persist(next)
  }

  return <div ref={container} className={css.tableContainer}>
    <div className={css.tableToolbar}><Button size="sm" variant="ghost" className={css.actionButton} onClick={() => { finish(false); persist(null) }}>{t('resetColumnWidths')}</Button></div>
    <table ref={table} className={css.table} style={{ width: widths.reduce((sum, width) => sum + width, 0) }}>
      <colgroup>{columns.map((column, index) => <col key={column.key} style={{ width: widths[index] }} />)}</colgroup>
      <thead><tr>{columns.map((column, index) => <th key={column.key} scope="col">
        <span className={css.columnLabel} title={t(column.key)}>{t(column.key)}</span>
        <span className={css.resizeHandle} role="separator" tabIndex={0} aria-orientation="vertical" aria-label={`${t('resizeColumn')} · ${t(column.key)}`}
          aria-valuemin={column.min} aria-valuemax={MAX_WIDTH} aria-valuenow={widths[index]}
          onPointerDown={event => start(event, index)} onPointerMove={move}
          onPointerUp={event => { if (drag.current?.pointerId === event.pointerId) finish(true, event.clientX) }}
          onPointerCancel={() => finish(false)} onLostPointerCapture={() => finish(false)} onKeyDown={event => keyDown(event, index)} />
      </th>)}</tr></thead>
      <tbody>{children}</tbody>
    </table>
  </div>
}
