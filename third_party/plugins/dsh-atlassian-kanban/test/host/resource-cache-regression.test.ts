import { getEventListeners } from 'node:events'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { HeavyOperationGate, ResourceCache } from '../../src/host/resource-cache.ts'

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

async function withCache<T>(
  run: (cache: ResourceCache, scratch: string) => Promise<T>,
  options: { maxBytes?: number; maxEntries?: number; ttlMs?: number } = {},
): Promise<T> {
  const scratch = await mkdtemp(join(tmpdir(), 'dsh-kanban-cache-regression-'))
  const cache = new ResourceCache(options.maxBytes, options.ttlMs, options.maxEntries)
  try { return await run(cache, scratch) }
  finally {
    await cache.clear()
    await rm(scratch, { recursive: true, force: true })
  }
}

async function put(cache: ResourceCache, key: string, value: string, metadata: string): Promise<string> {
  const path = await cache.pathFor(key)
  await writeFile(path, value)
  await cache.commit(key, path, Buffer.byteLength(value), metadata)
  return path
}

describe('ResourceCache concurrency and lifecycle regressions', () => {
  it('pins a pending withFile read against quota eviction, then evicts it once released', async () => {
    await withCache(async cache => {
      const pinnedPath = await put(cache, 'pinned', '12345', 'application/x-pinned')
      const started = deferred()
      const finishRead = deferred()
      const read = cache.withFile('pinned', async path => {
        started.resolve()
        await finishRead.promise
        return readFile(path, 'utf8')
      })
      await started.promise

      await expect(cache.reserve('incoming', 6)).rejects.toThrow(/quota|reserved/i)
      expect(await cache.has('pinned')).toBe(true)
      expect(await readFile(pinnedPath, 'utf8')).toBe('12345')

      finishRead.resolve()
      await expect(read).resolves.toBe('12345')
      await cache.reserve('incoming', 6)
      expect(await cache.has('pinned')).toBe(false)
      await cache.release('incoming')
    }, { maxBytes: 10 })
  })

  it('charges outstanding reservations to quota and evicts only the oldest required entry', async () => {
    await withCache(async cache => {
      const oldest = await put(cache, 'oldest', 'aa', 'application/x-oldest')
      const middle = await put(cache, 'middle', 'bbbb', 'application/x-middle')
      const newest = await put(cache, 'newest', 'ccc', 'application/x-newest')

      await cache.reserve('download-1', 1)
      await cache.reserve('download-2', 1)

      expect(await cache.has('oldest')).toBe(false)
      expect(await cache.has('middle')).toBe(true)
      expect(await cache.has('newest')).toBe(true)
      await expect(stat(oldest)).rejects.toThrow()
      expect(await readFile(middle, 'utf8')).toBe('bbbb')
      expect(await readFile(newest, 'utf8')).toBe('ccc')

      // These reservations fit only if both prior downloads are included in
      // accounting; no further eviction should be necessary.
      await cache.reserve('download-3', 1)
      expect(await cache.has('middle')).toBe(true)
      expect(await cache.has('newest')).toBe(true)
      await cache.release('download-1')
      await cache.release('download-2')
      await cache.release('download-3')
    }, { maxBytes: 10 })
  })

  it('clears a late reserved download after clear without deleting files outside its private root', async () => {
    await withCache(async (cache, scratch) => {
      const reservedPath = await cache.pathFor('late-download')
      const privateRoot = dirname(reservedPath)
      await writeFile(reservedPath, 'late bytes')
      await cache.reserve('late-download', 10)
      const outsideFile = join(scratch, 'other-owner.txt')
      await writeFile(outsideFile, 'leave me alone')

      await cache.clear()
      expect(await readFile(reservedPath, 'utf8')).toBe('late bytes')
      await expect(cache.commit('late-download', reservedPath, 10, 'text/plain')).rejects.toThrow(/closing/i)
      await expect(stat(reservedPath)).rejects.toThrow()
      await cache.release('late-download')

      await expect(stat(privateRoot)).rejects.toThrow()
      expect(await readFile(outsideFile, 'utf8')).toBe('leave me alone')
    })
  })

  it('keeps a same-key leader exclusive when queued followers cancel', async () => {
    await withCache(async cache => {
      const leaderStarted = deferred()
      const finishLeader = deferred()
      const leader = cache.singleFlight('same-resource', async () => {
        leaderStarted.resolve()
        await finishLeader.promise
        return 'leader'
      })
      await leaderStarted.promise

      const controller = new AbortController()
      const canceledFollowers = Array.from({ length: 6 }, () => cache.singleFlight('same-resource', async () => 'must not run', controller.signal))
      let laterWorkStarted = false
      const later = cache.singleFlight('same-resource', async () => {
        laterWorkStarted = true
        return 'later'
      })

      expect(getEventListeners(controller.signal, 'abort')).toHaveLength(6)
      controller.abort()
      const outcomes = await Promise.allSettled(canceledFollowers)
      expect(outcomes.every(result => result.status === 'rejected')).toBe(true)
      expect(getEventListeners(controller.signal, 'abort')).toHaveLength(0)
      expect(laterWorkStarted).toBe(false)

      finishLeader.resolve()
      await expect(leader).resolves.toBe('leader')
      await expect(later).resolves.toBe('later')
      expect(laterWorkStarted).toBe(true)
    })
  })

  it('releases the same-key tail and heavy-operation slot when active work aborts', async () => {
    await withCache(async cache => {
      const leaderController = new AbortController()
      const leaderStarted = deferred()
      const leader = cache.singleFlight('abortable-resource', () => new Promise<never>((_resolve, reject) => {
        const abort = () => reject(leaderController.signal.reason ?? new Error('leader aborted'))
        leaderController.signal.addEventListener('abort', abort, { once: true })
        leaderStarted.resolve()
      }), leaderController.signal)
      await leaderStarted.promise

      let followerStarted = false
      const follower = cache.singleFlight('abortable-resource', async () => {
        followerStarted = true
        return 'follower took over'
      })
      leaderController.abort(new Error('leader request aborted'))
      await expect(leader).rejects.toThrow('leader request aborted')
      await expect(follower).resolves.toBe('follower took over')
      expect(followerStarted).toBe(true)
      expect(getEventListeners(leaderController.signal, 'abort')).toHaveLength(0)

      const gate = new HeavyOperationGate(1, 1)
      const activeController = new AbortController()
      const activeStarted = deferred()
      const active = gate.run(activeController.signal, () => new Promise<never>((_resolve, reject) => {
        const abort = () => reject(activeController.signal.reason ?? new Error('active operation aborted'))
        activeController.signal.addEventListener('abort', abort, { once: true })
        activeStarted.resolve()
      }))
      await activeStarted.promise
      let nextWorkStarted = false
      const next = gate.run(undefined, async () => {
        nextWorkStarted = true
        return 'gate slot reused'
      })
      activeController.abort(new Error('active download aborted'))
      await expect(active).rejects.toThrow('active download aborted')
      await expect(next).resolves.toBe('gate slot reused')
      expect(nextWorkStarted).toBe(true)
      expect(getEventListeners(activeController.signal, 'abort')).toHaveLength(0)
      await expect(gate.run(undefined, async () => 'gate remains available')).resolves.toBe('gate remains available')
    })
  })

  it('keeps metadata and cached files in sync across 257 small entries', async () => {
    await withCache(async cache => {
      const created: { key: string; path: string; mime: string }[] = []
      for (let index = 0; index < 257; index += 1) {
        const key = `tiny-${index}`
        const mime = `application/x-fixture-${index}`
        const path = await put(cache, key, String(index), mime)
        created.push({ key, path, mime })
      }

      let retained = 0
      for (const { key, path, mime } of created) {
        const exists = await cache.has(key)
        if (!exists) {
          await expect(cache.metadata(key)).rejects.toThrow(/unavailable/i)
          await expect(stat(path)).rejects.toThrow()
          continue
        }
        retained += 1
        expect(await cache.metadata(key)).toBe(mime)
        expect(await readFile(path, 'utf8')).toBe(key.slice('tiny-'.length))
      }
      expect(retained).toBe(257)
    })
  })

  it('bounds zero-byte cache entries by count and evicts the least recently used entry', async () => {
    await withCache(async cache => {
      const oldest = await put(cache, 'empty-oldest', '', '')
      await put(cache, 'empty-middle', '', '')
      await cache.has('empty-middle') // make the first entry the least recently used
      await put(cache, 'empty-newest', '', '')
      expect(await cache.has('empty-oldest')).toBe(false)
      expect(await cache.has('empty-middle')).toBe(true)
      expect(await cache.has('empty-newest')).toBe(true)
      await expect(stat(oldest)).rejects.toThrow()
    }, { maxBytes: 1, maxEntries: 2 })
  })

  it('rejects a full heavy-operation queue and accepts work after a queued cancellation', async () => {
    const gate = new HeavyOperationGate(1, 1)
    const activeStarted = deferred()
    const finishActive = deferred()
    const active = gate.run(undefined, async () => {
      activeStarted.resolve()
      await finishActive.promise
      return 'active'
    })
    await activeStarted.promise

    const controller = new AbortController()
    const canceled = gate.run(controller.signal, async () => 'must not run')
    await expect(gate.run(undefined, async () => 'queue should reject')).rejects.toThrow(/queued/i)
    controller.abort()
    await expect(canceled).rejects.toThrow(/cancelled/i)

    const recovered = gate.run(undefined, async () => 'recovered')
    finishActive.resolve()
    await expect(active).resolves.toBe('active')
    await expect(recovered).resolves.toBe('recovered')
  })
})
