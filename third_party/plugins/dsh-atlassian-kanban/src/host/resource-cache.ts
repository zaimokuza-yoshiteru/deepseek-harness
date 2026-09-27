import { createHash, randomUUID } from 'node:crypto'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export const RESOURCE_CACHE_TTL_MS = 30 * 60_000
export const RESOURCE_CACHE_MAX_BYTES = 64 * 1024 * 1024
export const RESOURCE_CACHE_MAX_ENTRIES = 512

type Entry = { path: string; bytes: number; touched: number; expires: number; refs: number; metadata?: string }

/** Process-private bounded disk cache. Callers must revalidate upstream access before get(). */
export class ResourceCache {
  private readonly entries = new Map<string, Entry>()
  private readonly reservations = new Map<string, number>()
  private readonly keyTails = new Map<string, Promise<void>>()
  private readonly rootPromise = mkdtemp(join(tmpdir(), 'dsh-atlassian-'))
  private queue: Promise<void> = Promise.resolve()
  private readonly sweeper: NodeJS.Timeout
  private clearing = false
  constructor(private readonly maxBytes = RESOURCE_CACHE_MAX_BYTES, private readonly ttlMs = RESOURCE_CACHE_TTL_MS, private readonly maxEntries = RESOURCE_CACHE_MAX_ENTRIES) {
    this.sweeper = setInterval(() => { void this.expire().catch(() => undefined) }, Math.min(ttlMs, 60_000)); this.sweeper.unref()
  }

  async pathFor(key: string): Promise<string> {
    if (this.clearing) throw new Error('Temporary resource cache is closing')
    const root = await this.rootPromise
    return join(root, `${createHash('sha256').update(key).digest('hex')}-${randomUUID()}.part`)
  }

  async has(key: string): Promise<boolean> {
    return this.lock(async () => {
      const entry = this.entries.get(key)
      if (!entry) return false
      if (entry.expires <= Date.now()) { if (!entry.refs) await this.remove(key, entry); return false }
      try { const info = await stat(entry.path); if (info.size !== entry.bytes) { await this.remove(key, entry); return false } }
      catch { await this.remove(key, entry); return false }
      entry.touched = Date.now(); entry.expires = entry.touched + this.ttlMs
      return true
    })
  }

  async size(key: string): Promise<number> {
    return this.lock(async () => {
      const entry = this.entries.get(key)
      if (!entry || entry.expires <= Date.now()) throw new Error('Temporary resource cache entry is unavailable')
      return entry.bytes
    })
  }

  async metadata(key: string): Promise<string | undefined> {
    return this.lock(async () => {
      const entry = this.entries.get(key)
      if (!entry || entry.expires <= Date.now()) throw new Error('Temporary resource cache entry is unavailable')
      return entry.metadata
    })
  }

  async commit(key: string, path: string, bytes: number, metadata?: string): Promise<void> {
    if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > this.maxBytes) { await rm(path, { force: true }); throw new Error('Resource cannot fit within the plugin temporary cache quota') }
    try { await this.lock(async () => {
      if (this.clearing) throw new Error('Temporary resource cache is closing')
      this.reservations.delete(key)
      const prior = this.entries.get(key)
      if (prior?.refs) throw new Error('Resource cache entry is currently in use')
      if (prior) await this.remove(key, prior)
      let used = [...this.entries.values()].reduce((sum, entry) => sum + entry.bytes, 0)
      for (const [oldKey, entry] of [...this.entries].sort((a, b) => a[1].touched - b[1].touched)) {
        if (used + bytes <= this.maxBytes && this.entries.size + this.reservations.size + 1 <= this.maxEntries) break
        if (entry.refs) continue
        used -= entry.bytes; await this.remove(oldKey, entry)
      }
      if (used + bytes + [...this.reservations.values()].reduce((a, b) => a + b, 0) > this.maxBytes || this.entries.size + this.reservations.size + 1 > this.maxEntries) throw new Error('Temporary resource cache is full; retry after active reads finish')
      const now = Date.now(); const committed: Entry = { path, bytes, touched: now, expires: now + this.ttlMs, refs: 0, ...(metadata === undefined ? {} : { metadata }) }; this.entries.set(key, committed)
    }) } catch (error) { await rm(path, { force: true }); throw error }
  }

  async reserve(key: string, bytes: number): Promise<void> {
    if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > this.maxBytes) throw new Error('Resource cannot fit within the plugin temporary cache quota')
    await this.lock(async () => {
      if (this.clearing) throw new Error('Temporary resource cache is closing')
      let current = [...this.entries.values()].reduce((sum, entry) => sum + entry.bytes, 0)
      let reserved = [...this.reservations.values()].reduce((a, b) => a + b, 0)
      for (const [oldKey, entry] of [...this.entries].sort((a, b) => a[1].touched - b[1].touched)) {
        if (current + reserved + bytes <= this.maxBytes && this.entries.size + this.reservations.size + 1 <= this.maxEntries) break
        if (entry.refs) continue
        current -= entry.bytes
        await this.remove(oldKey, entry)
      }
      const after = [...this.entries.values()].reduce((sum, entry) => sum + entry.bytes, 0)
      reserved = [...this.reservations.values()].reduce((a, b) => a + b, 0)
      if (after + reserved + bytes > this.maxBytes || this.entries.size + this.reservations.size + 1 > this.maxEntries) throw new Error('Temporary resource cache quota is reserved by active downloads')
      this.reservations.set(key, bytes)
    })
  }

  async release(key: string): Promise<void> {
    await this.lock(async () => {
      this.reservations.delete(key)
      if (this.clearing && this.reservations.size === 0 && ![...this.entries.values()].some(entry => entry.refs)) await rm(await this.rootPromise, { recursive: true, force: true })
    })
  }

  async withFile<T>(key: string, action: (path: string, bytes: number, metadata?: string) => Promise<T>): Promise<T> {
    const entry = await this.lock(async () => {
      const found = this.entries.get(key)
      if (!found || found.expires <= Date.now()) throw new Error('Temporary resource cache entry is unavailable')
      try { const info = await stat(found.path); if (info.size !== found.bytes) throw new Error('cache size mismatch') }
      catch { await this.remove(key, found); throw new Error('Temporary resource cache entry is unavailable') }
      found.refs++; found.touched = Date.now(); found.expires = found.touched + this.ttlMs
      return found
    })
    try { return await action(entry.path, entry.bytes, entry.metadata) }
    finally { await this.lock(async () => { entry.refs--; if ((entry.expires <= Date.now() || this.clearing) && !entry.refs) await this.remove(key, entry); if (this.clearing && this.reservations.size === 0 && ![...this.entries.values()].some(item => item.refs)) await rm(await this.rootPromise, { recursive: true, force: true }) }) }
  }

  async clear(): Promise<void> {
    clearInterval(this.sweeper)
    this.clearing = true
    await this.lock(async () => {
      for (const [key, entry] of this.entries) if (!entry.refs) await this.remove(key, entry)
      const root = await this.rootPromise
      if (this.entries.size === 0 && this.reservations.size === 0) await rm(root, { recursive: true, force: true })
    })
  }

  private async expire(): Promise<void> {
    await this.lock(async () => { const now = Date.now(); for (const [key, entry] of this.entries) if (entry.expires <= now && entry.refs === 0) await this.remove(key, entry) })
  }

  key(parts: readonly (string | number)[]): string { return parts.map(String).join('\0') }
  async singleFlight<T>(key: string, work: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    signal?.throwIfAborted()
    const prior = this.keyTails.get(key) ?? Promise.resolve()
    let release!: () => void
    const tail = new Promise<void>(resolve => { release = resolve })
    this.keyTails.set(key, tail)
    let waiting = true
    let abortedWhileWaiting = false
    let abortListener: (() => void) | undefined
    try {
      if (signal) await Promise.race([prior, new Promise<never>((_, reject) => { abortListener = () => reject(new Error('Resource operation was cancelled')); signal.addEventListener('abort', abortListener, { once: true }) })])
      else await prior
      waiting = false
      signal?.throwIfAborted()
      return await work()
    } catch (error) {
      if (waiting && signal?.aborted) abortedWhileWaiting = true
      throw error
    } finally {
      if (abortListener) signal?.removeEventListener('abort', abortListener)
      if (abortedWhileWaiting) void prior.then(release, release)
      else release()
      void tail.then(() => { if (this.keyTails.get(key) === tail) this.keyTails.delete(key) })
    }
  }
  private async remove(key: string, entry: Entry): Promise<void> { if (entry.refs || this.entries.get(key) !== entry) return; this.entries.delete(key); await rm(entry.path, { force: true }) }
  private async lock<T>(fn: () => Promise<T>): Promise<T> {
    const prior = this.queue; let release!: () => void
    this.queue = new Promise<void>(resolve => { release = resolve })
    await prior
    try { return await fn() } finally { release() }
  }
}

/** A bounded FIFO semaphore. Aborted waiters are removed and do not consume a slot. */
export class HeavyOperationGate {
  private active = 0
  private readonly waiters: { resolve: () => void; reject: (error: Error) => void; signal?: AbortSignal; abort?: () => void }[] = []
  constructor(private readonly concurrency = 2, private readonly maxQueued = 8) {}
  async run<T>(signal: AbortSignal | undefined, work: () => Promise<T>): Promise<T> {
    signal?.throwIfAborted()
    if (this.active >= this.concurrency) {
      if (this.waiters.length >= this.maxQueued) throw new Error('Too many resource operations are queued; retry after current downloads finish')
      await new Promise<void>((resolve, reject) => {
        const waiter = { resolve, reject, ...(signal ? { signal } : {}) } as (typeof this.waiters)[number]
        if (signal) { waiter.abort = () => { const i = this.waiters.indexOf(waiter); if (i >= 0) this.waiters.splice(i, 1); reject(new Error('Resource operation was cancelled')) }; signal.addEventListener('abort', waiter.abort, { once: true }) }
        this.waiters.push(waiter)
      })
    } else this.active++
    try { signal?.throwIfAborted(); return await work() }
    finally { this.active--; const next = this.waiters.shift(); if (next) { next.signal?.removeEventListener('abort', next.abort!); this.active++; next.resolve() } }
  }
}
