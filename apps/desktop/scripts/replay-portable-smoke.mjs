/** Re-run the host smoke against a downloaded application without rebuilding it. */
import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

const target = process.env.DESKTOP_SMOKE_TARGET
if (target !== 'mac-arm64' && target !== 'win-x64') throw new Error('Expected a supported desktop smoke target')
const directory = '.artifacts/smoke-input'
const archives = readdirSync(directory).filter(name => name.endsWith('.zip'))
if (archives.length !== 1) throw new Error('Expected exactly one downloaded application ZIP')
const result = spawnSync(process.execPath, [
  '--import', 'tsx/esm', 'apps/desktop/scripts/smoke-portable.ts', target, join(directory, archives[0]),
], { stdio: 'inherit' })
if (result.error !== undefined) throw result.error
if (result.status !== 0) throw new Error(`Packaged smoke exited with ${String(result.status ?? result.signal)}`)
