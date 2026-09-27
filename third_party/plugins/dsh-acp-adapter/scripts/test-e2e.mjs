import { execFileSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const host = process.env.DSH_UPSTREAM_CHECKOUT
if (!host) throw new Error('Set DSH_UPSTREAM_CHECKOUT to a built DSH 0.1.7-rc.2 source checkout before running ACP E2E tests.')
execFileSync(process.execPath, [resolve(root, 'scripts/verify-dsh-reference.ts')], { cwd: root, stdio: 'inherit' })
execFileSync(process.execPath, [resolve(root, 'scripts/verify-dev-dependencies.ts')], { cwd: root, stdio: 'inherit' })
execFileSync(process.env.DSH_E2E_NODE ?? process.execPath, [resolve(host, 'node_modules/vitest/vitest.mjs'), 'run', '--config', resolve(root, 'test/e2e/vitest.config.mjs'), ...process.argv.slice(2)], {
  cwd: root,
  stdio: 'inherit',
  env: { ...process.env, DSH_SNAPSHOT: 'replay' },
})
