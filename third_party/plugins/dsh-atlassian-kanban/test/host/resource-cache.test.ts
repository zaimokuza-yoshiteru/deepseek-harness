import { mkdtemp, writeFile, rm, stat, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { HeavyOperationGate, ResourceCache } from '../../src/host/resource-cache.ts'

describe('bounded temporary resources', () => {
  it('keeps an active file pinned and rejects entries above the cache quota', async () => {
    const cache = new ResourceCache(4, 60_000)
    const scratch = await mkdtemp(join(tmpdir(), 'resource-test-')), file = join(scratch, 'item')
    try {
      await writeFile(file, 'data'); await cache.commit('key', file, 4)
      expect(await cache.has('key')).toBe(true)
      expect(await cache.withFile('key', async path => (await readFile(path)).toString())).toBe('data')
      const oversized = join(scratch, 'large'); await writeFile(oversized, '12345')
      await expect(cache.commit('large', oversized, 5)).rejects.toThrow('quota')
      await expect(stat(oversized)).rejects.toThrow()
    } finally { await cache.clear(); await rm(scratch, { recursive: true, force: true }) }
  })

  it('bounds concurrent heavy operations and drops cancelled waiters', async () => {
    const gate = new HeavyOperationGate(1, 1)
    let release!: () => void
    const blocker = gate.run(undefined, () => new Promise<void>(resolve => { release = resolve }))
    await Promise.resolve()
    const abort = new AbortController()
    const waiting = gate.run(abort.signal, async () => 'should not run')
    abort.abort()
    await expect(waiting).rejects.toThrow('cancelled')
    release(); await blocker
    await expect(gate.run(undefined, async () => 'available')).resolves.toBe('available')
  })
})
