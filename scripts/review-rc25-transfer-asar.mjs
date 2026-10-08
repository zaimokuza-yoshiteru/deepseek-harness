import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { createReadStream, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, posix, resolve } from 'node:path'
import { tmpdir } from 'node:os'

const [sourceRootArg, macZip, winZip, output] = process.argv.slice(2)
assert.ok(sourceRootArg && macZip && winZip && output,
  'Usage: review-rc25-transfer-asar.mjs PRODUCT_SOURCE MAC_ZIP WIN_ZIP OUTPUT_JSON')
const sourceRoot = resolve(sourceRootArg)
const sourceCommit = execFileSync('git', ['-C', sourceRoot, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
assert.equal(sourceCommit, 'b1e845853b9c6f49283fe4cf30eda2ee5bd520c1')
const sourcePluginManifest = JSON.parse(readFileSync(join(sourceRoot, 'third_party/plugins/dsh-boot-ocbc/release-manifest.json')))
const expectedOcbcSha256 = 'edfb4344a280d046792eacb5e56aef9cd108b4c7880395cf6c2ee6ee638431a1'
assert.equal(sourcePluginManifest.files['lib/boot.js'], expectedOcbcSha256)
const require = createRequire(join(sourceRoot, 'apps/desktop/package.json'))
const { readAsar } = require('app-builder-lib/out/asar/asar.js')
const scratch = mkdtempSync(join(tmpdir(), 'dsh-rc25-transfer-asar-'))
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const hashFile = async path => {
  const digest = createHash('sha256')
  for await (const chunk of createReadStream(path)) digest.update(chunk)
  return digest.digest('hex')
}
const extractAsar = `import sys,zipfile,shutil\nwith zipfile.ZipFile(sys.argv[1]) as z:\n names=[n for n in z.namelist() if n.lower().endswith('resources/app.asar')]\n assert len(names)==1,names\n with z.open(names[0]) as src,open(sys.argv[2],'wb') as dst: shutil.copyfileobj(src,dst)\n`
const readOcbc = `import sys,zipfile\nwith zipfile.ZipFile(sys.argv[1]) as z:\n names=[n for n in z.namelist() if n.endswith('/plugin-seed/node_modules/dsh-boot-ocbc/lib/boot.js')]\n assert len(names)==1,names\n sys.stdout.buffer.write(z.read(names[0]))\n`
const readOcbcManifest = `import sys,zipfile\nwith zipfile.ZipFile(sys.argv[1]) as z:\n names=[n for n in z.namelist() if n.endswith('/plugin-seed/node_modules/dsh-boot-ocbc/release-manifest.json')]\n assert len(names)==1,names\n sys.stdout.buffer.write(z.read(names[0]))\n`

try {
  const outputs = []
  for (const [target, zip] of [['mac-arm64', macZip], ['win-x64', winZip]]) {
    const asarPath = join(scratch, `${target}.asar`)
    const python = process.platform === 'win32' ? 'python' : 'python3'
    execFileSync(python, ['-c', extractAsar, zip, asarPath], { stdio: 'inherit' })
    const asar = await readAsar(asarPath)
    const read = path => asar.readFile(path)
    const bootRoot = 'dsh/node_modules/@deepseek-ai/dsh-app-boot'
    const cliRoot = 'dsh/node_modules/@deepseek-ai/dsh'
    const bootPackage = JSON.parse((await read(`${bootRoot}/package.json`)).toString())
    const cliPackage = JSON.parse((await read(`${cliRoot}/package.json`)).toString())
    const entry = cliPackage.exports['./profile-boot'].default
    const files = new Map()
    async function visit(path) {
      path = posix.normalize(path)
      if (files.has(path)) return
      assert.ok(path.startsWith(`${bootRoot}/`) || path.startsWith(`${cliRoot}/`))
      const bytes = await read(path)
      files.set(path, { path, bytes: bytes.length, sha256: hash(bytes) })
      for (const match of bytes.toString().matchAll(/(?:from\s*|import\s*\(|import\s*)["'](\.\.?\/[^"']+\.js)["']/gu)) {
        await visit(posix.join(posix.dirname(path), match[1]))
      }
    }
    const bootEntry = posix.join(bootRoot, bootPackage.main)
    const cliEntry = posix.join(cliRoot, entry)
    await visit(bootEntry)
    await visit(cliEntry)
    const bootSource = (await read(bootEntry)).toString()
    assert.ok(bootSource.includes('context.desktopIntranet === true'))
    assert.ok(bootSource.includes('product-analytics'))
    const cliSource = [...files.keys()].filter(path => path.startsWith(`${cliRoot}/`))
    const cliBytes = await Promise.all(cliSource.map(read))
    assert.ok(cliBytes.some(bytes => bytes.toString().includes('desktopIntranet')))
    const ocbcBootSha256 = hash(execFileSync(python, ['-c', readOcbc, zip]))
    assert.equal(ocbcBootSha256, expectedOcbcSha256,
      'Packed OCBC boot must match the fixed b1 source release manifest')
    const packedPluginManifest = JSON.parse(execFileSync(python, ['-c', readOcbcManifest, zip], { encoding: 'utf8' }))
    assert.equal(packedPluginManifest.files['lib/boot.js'], ocbcBootSha256)
    outputs.push({ target, archiveSha256: await hashFile(zip), ocbcBootSha256,
      files: [...files.values()].sort((a, b) => a.path.localeCompare(b.path)) })
  }
  assert.deepEqual(outputs[0].files, outputs[1].files,
    'Mac and Windows must ship identical app-boot and CLI profile-boot runtime closures')
  const result = {
    schemaVersion: 1,
    sourceCommit,
    passed: true,
    comparedTargets: outputs,
    identical: true,
    scope: 'Reads the actual Mac and Windows ZIP ASARs. Records app-boot entry and recursive relative JS imports plus CLI profile-boot entry and recursive relative JS imports, and verifies the packed OCBC boot digest.',
  }
  writeFileSync(output, JSON.stringify(result, null, 2) + '\n')
  console.log(JSON.stringify({ passed: true, sourceCommit, identical: true, fileCount: outputs[0].files.length }))
} finally {
  rmSync(scratch, { recursive: true, force: true })
}
