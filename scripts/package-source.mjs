import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { c as createTar } from 'tar'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { parseArgs } from 'node:util'
import { collectSourceInventory, exportSource, writeSourceMetadata } from './export-source.mjs'

const BUILDABLE_SOURCE_README = `# DSH source build archive

This archive contains the DSH workspace and plugin source needed to rebuild the desktop host, renderer, and workspace plugins. It omits GitHub Actions, installer packaging and signing tools, CI and upload/release commands, unit/spec/e2e tests and fixtures, and smoke verification entry points. Test-support workspace helper libraries remain where required by the frozen workspace graph.

Use Node.js 22.19 or newer with pnpm 11.23.0:

\`\`\`sh
pnpm install --frozen-lockfile
pnpm build
pnpm build:plugins
\`\`\`

The build commands compile the desktop host and renderer and build the workspace plugins. The portable ZIP packaging and distribution workflow remains in the GitHub repository.
`

function distributionVersion(root) {
  if (process.env.DSH_DESKTOP_DISTRIBUTION_VERSION) return process.env.DSH_DESKTOP_DISTRIBUTION_VERSION
  const deliveryPath = resolve(root, 'delivery.json')
  if (existsSync(deliveryPath)) {
    const delivery = JSON.parse(readFileSync(deliveryPath, 'utf8'))
    if (typeof delivery.version === 'string' && delivery.version) return delivery.version
  }
  throw new Error('Source delivery version is missing: set DSH_DESKTOP_DISTRIBUTION_VERSION or add version to delivery.json')
}

function digest(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

export function packageSource({ root, output, version, withTests = false }) {
  root = resolve(root)
  version ??= distributionVersion(root)
  if (!/^[0-9A-Za-z][0-9A-Za-z._+-]*$/.test(version)) throw new Error(`Invalid distribution version: ${version}`)
  output = resolve(output || join(root, '.artifacts', 'delivery', version, `dsh-source-${version}.tar.gz`))
  const stageParent = mkdtempSync(join(tmpdir(), 'dsh-source-package-'))
  const stage = join(stageParent, `dsh-source-${version}`)
  mkdirSync(dirname(output), { recursive: true })
  try {
    const inventory = collectSourceInventory(root, withTests)
    const { files } = inventory
    exportSource(root, stage, files, withTests)
    let deliveredFiles = files
    if (!withTests) {
      writeFileSync(join(stage, 'README.md'), BUILDABLE_SOURCE_README)
      deliveredFiles = [...files, 'README.md'].sort()
    }
    const deliveryPath = join(stage, 'delivery.json')
    if (existsSync(deliveryPath)) {
      const delivery = JSON.parse(readFileSync(deliveryPath, 'utf8'))
      if (delivery.version !== version) {
        writeFileSync(deliveryPath, JSON.stringify({ ...delivery, version }, null, 2) + '\n')
      }
    }
    writeSourceMetadata(root, stage, deliveredFiles, withTests, undefined, inventory.excludedSensitiveFiles, version)
    createTar({ file: output, cwd: stageParent, gzip: true, portable: true, sync: true }, [basename(stage)])
    const manifestPath = `${output}.manifest.json`
    const checksumPath = `${output}.sha256`
    copyFileSync(join(stage, 'source-files.json'), manifestPath)
    writeFileSync(checksumPath, `${digest(output)}  ${basename(output)}\n`)
    return { archive: output, manifest: manifestPath, checksum: checksumPath, sha256: digest(output) }
  } finally {
    rmSync(stageParent, { recursive: true, force: true })
  }
}

function runCli() {
  const { values } = parseArgs({ options: { output: { type: 'string' }, version: { type: 'string' }, 'with-tests': { type: 'boolean', default: false } } })
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  const result = packageSource({ root, output: values.output, version: values.version, withTests: values['with-tests'] })
  console.log(`Packaged source archive ${result.archive}`)
  console.log(`SHA-256 ${result.sha256}`)
  console.log(`Manifest ${result.manifest}`)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) runCli()
