import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, resolve, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const pluginRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const harnessRoot = resolve(process.env.DSH_HARNESS_ROOT ?? resolve(pluginRoot, '../../../'))
const tsc = resolve(pluginRoot, 'node_modules/typescript/bin/tsc')
const vitest = resolve(pluginRoot, 'node_modules/vitest/vitest.mjs')
const node = process.execPath

for (const path of ['vendor/loader/lib/index.js', 'vendor/cordis/lib/types/index.d.ts', 'packages/client/ui-slots/lib/types/index.d.ts']) {
  try { await readFile(resolve(harnessRoot, path)) }
  catch { throw new Error(`DSH integration prerequisites are missing at ${harnessRoot}; build the host checkout first.`) }
}

execFileSync(node, [tsc, '--ignoreConfig', '--noEmit', '--target', 'ES2022', '--module', 'ESNext', '--moduleResolution', 'bundler', '--lib', 'ES2022,DOM', '--typeRoots', resolve(pluginRoot, 'node_modules/@types'), '--types', 'node', '--strict', '--skipLibCheck', resolve(pluginRoot, 'src/host.ts'), resolve(pluginRoot, 'src/boot.ts')], { stdio: 'inherit' })

const tempRoot = await mkdtemp(join(tmpdir(), 'dsh-ocbc-integration-'))
try {
  const config = JSON.parse(await readFile(resolve(pluginRoot, 'tests/tsconfig.panel.json'), 'utf8'))
  config.compilerOptions.baseUrl = harnessRoot
  config.files = config.files.map(path => resolve(pluginRoot, 'tests', path))
  const configPath = join(tempRoot, 'tsconfig.panel.json')
  await writeFile(configPath, JSON.stringify(config, null, 2))
  execFileSync(node, [tsc, '--project', configPath], { stdio: 'inherit' })
  execFileSync(node, [vitest, 'run', '--config', resolve(pluginRoot, 'tests/integration.vitest.config.ts')], {
    stdio: 'inherit', env: { ...process.env, DSH_HARNESS_ROOT: harnessRoot },
  })
} finally {
  await rm(tempRoot, { recursive: true, force: true })
}

console.log(`Verified OCBC source against DSH at ${pathToFileURL(harnessRoot).href}`)
