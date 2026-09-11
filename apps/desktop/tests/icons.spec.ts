import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import config from '../electron-builder.portable.config.mjs'

const assets = new URL('../assets/', import.meta.url)

describe('portable desktop icons', () => {
  it('packages the verified native files without invoking the legacy SVG converter', () => {
    expect(config.mac.icon).toBe(fileURLToPath(new URL('icon.icns', assets)))
    expect(config.win.icon).toBe(fileURLToPath(new URL('icon.ico', assets)))
    const inventory = JSON.parse(readFileSync(new URL('icon-integrity.json', assets), 'utf8')) as {
      files: Record<string, string>
    }
    expect(Object.keys(inventory.files)).toEqual(['icon.svg', 'icon.icns', 'icon.ico'])
    for (const [name, digest] of Object.entries(inventory.files)) {
      expect(createHash('sha256').update(readFileSync(new URL(name, assets))).digest('hex')).toBe(digest)
    }
  })

  it('uses Finder-compatible ARGB small frames and correctly sized Retina PNG frames', () => {
    const bytes = readFileSync(new URL('icon.icns', assets))
    expect(bytes.toString('ascii', 0, 4)).toBe('icns')
    expect(bytes.readUInt32BE(4)).toBe(bytes.length)
    const frames = new Map<string, Buffer>()
    for (let offset = 8; offset < bytes.length;) {
      const size = bytes.readUInt32BE(offset + 4)
      expect(size).toBeGreaterThan(8)
      expect(offset + size).toBeLessThanOrEqual(bytes.length)
      frames.set(bytes.toString('ascii', offset, offset + 4), bytes.subarray(offset + 8, offset + size))
      offset += size
    }
    expect([...frames.keys()]).toEqual(['ic04', 'ic05', 'ic07', 'ic08', 'ic09', 'ic10', 'ic11', 'ic12', 'ic13', 'ic14'])
    for (const type of ['ic04', 'ic05']) expect(frames.get(type)!.toString('ascii', 0, 4)).toBe('ARGB')
    const pngSizes = { ic07: 128, ic08: 256, ic09: 512, ic10: 1024, ic11: 32, ic12: 64, ic13: 256, ic14: 512 }
    for (const [type, size] of Object.entries(pngSizes)) {
      const png = frames.get(type)!
      expect(png.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a')
      expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([size, size])
    }
  })

  it('includes all seven Windows icon sizes with bounded image payloads', () => {
    const bytes = readFileSync(new URL('icon.ico', assets))
    expect(bytes.readUInt16LE(0)).toBe(0)
    expect(bytes.readUInt16LE(2)).toBe(1)
    expect(bytes.readUInt16LE(4)).toBe(7)
    const sizes: number[] = []
    for (let index = 0; index < 7; index++) {
      const offset = 6 + index * 16
      const size = bytes[offset] || 256
      expect(bytes[offset + 1] || 256).toBe(size)
      const length = bytes.readUInt32LE(offset + 8)
      const start = bytes.readUInt32LE(offset + 12)
      expect(length).toBeGreaterThan(0)
      expect(start).toBeGreaterThanOrEqual(6 + 7 * 16)
      expect(start + length).toBeLessThanOrEqual(bytes.length)
      sizes.push(size)
    }
    expect(sizes).toEqual([16, 24, 32, 48, 64, 128, 256])
  })
})
