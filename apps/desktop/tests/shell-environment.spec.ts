import { delimiter, dirname } from 'node:path'
import { describe, expect, it } from 'vitest'
import { desktopShellEnvironment, parseShellEnvironment } from '../src/shell-environment.ts'

describe('desktop login environment', () => {
  it('preserves exported tool settings and credentials while excluding process-control fields', () => {
    const result = parseShellEnvironment('banner\nx\0PATH=/user/node\0DEVIN_TOKEN=private\0npm_config_strict_ssl=false\0NODE_OPTIONS=--inspect\0ELECTRON_RUN_AS_NODE=0\0PWD=/other\0x\0bye', 'x', { PATH: '/usr/bin', PWD: '/app' })
    expect(result).toEqual({ PATH: '/user/node', DEVIN_TOKEN: 'private', npm_config_strict_ssl: 'false', PWD: '/app' })
  })
  it('rejects incomplete shell output rather than accepting a truncated environment', () => {
    expect(() => parseShellEnvironment('x\0PATH=/partial', 'x', {})).toThrow('markers')
  })
  it('keeps a Windows user PATH ahead of bundled Node without duplicating the key', async () => {
    const result = await desktopShellEnvironment({ Path: 'user-node', DEVIN_TOKEN: 'private' }, process.execPath, 'win32')
    expect(result.Path).toBe(`user-node${delimiter}${dirname(process.execPath)}`)
    expect(result.PATH).toBeUndefined()
    expect(result.DEVIN_TOKEN).toBe('private')
  })
  it.runIf(process.platform === 'darwin')('reads exports from a real login shell', async () => {
    const result = await desktopShellEnvironment({ SHELL: '/bin/sh', HOME: '/var/empty', PATH: '/usr/bin:/bin', DSH_TEST_VALUE: 'line one\nline two' }, process.execPath)
    expect(result.DSH_TEST_VALUE).toBe('line one\nline two')
    expect(result.PATH?.split(delimiter).at(-1)).toBe(dirname(process.execPath))
  })
})
