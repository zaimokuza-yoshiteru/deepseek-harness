import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, readFile, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pipeline } from 'node:stream/promises'

const [mode, windowsDirArg, macDirArg, windowsWrapperArg] = process.argv.slice(2)
assert.equal(mode, 'assemble', 'Usage: verify-rc25-transfer.mjs assemble WINDOWS_DIR MAC_DIR WINDOWS_ARTIFACT_ZIP')
assert.ok(windowsDirArg && macDirArg && windowsWrapperArg)

const windowsDir = resolve(windowsDirArg)
const macDir = resolve(macDirArg)
const windowsWrapper = resolve(windowsWrapperArg)
const manifestName = 'rc25-transfer-mac-arm64.manifest.json'
const expectedManifestSha256 = 'aa627603e6eea87d5c6749807cc7499d76ed8ac444146debe35467125df64b72'
const expectedWindowsArtifactSha256 = '4f3f439cdc7cabf17d910d2b75a6789395d1fd475c499f6db22366515b6f7e56'
const expectedWindowsZipSha256 = 'afb45dfacfee5dcda094bf3f462db260f5cf8f6dba7e55101c4f1836d7fe9158'
const expectedArchive = {
  name: 'dsh-desktop-0.2.0.rc.2.5-mac-arm64.zip',
  bytes: 441459107,
  sha256: '65dfc04d7588be0e6ec44cc27a79e48ce9f8dd2b5e6f7474df49a997ea4d1d0a',
}
const hash = createHash('sha256')
const hashFile = async path => {
  const digest = createHash('sha256')
  for await (const chunk of createReadStream(path)) digest.update(chunk)
  return digest.digest('hex')
}
const manifestPath = join(macDir, manifestName)
const manifestBytes = await readFile(manifestPath)
assert.equal(createHash('sha256').update(manifestBytes).digest('hex'), expectedManifestSha256)
const manifest = JSON.parse(manifestBytes.toString('utf8'))
assert.equal(manifest.schemaVersion, 1)
assert.equal(manifest.sourceCommit, 'b1e845853b9c6f49283fe4cf30eda2ee5bd520c1')
assert.deepEqual(manifest.archive, expectedArchive)
assert.equal(manifest.parts.length, 14)

let aggregateBytes = 0
const partEvidence = []
for (let index = 0; index < 14; index += 1) {
  const expectedName = `rc25-transfer-mac-arm64.part-${String(index).padStart(3, '0')}`
  const part = manifest.parts[index]
  assert.equal(part.name, expectedName, `Unexpected part at index ${index}`)
  assert.match(part.name, /^rc25-transfer-mac-arm64\.part-\d{3}$/u)
  const path = join(macDir, expectedName)
  const details = await stat(path)
  assert.equal(details.size, part.bytes, `${expectedName} length mismatch`)
  partEvidence.push({ name: expectedName, bytes: details.size, sha256: part.sha256 })
  aggregateBytes += details.size
}
assert.equal(aggregateBytes, expectedArchive.bytes)

const archivePath = join(macDir, expectedArchive.name)
const parts = async function* () {
  for (const part of manifest.parts) {
    const partHash = createHash('sha256')
    let partBytes = 0
    for await (const chunk of createReadStream(join(macDir, part.name))) {
      partHash.update(chunk)
      hash.update(chunk)
      partBytes += chunk.length
      yield chunk
    }
    assert.equal(partBytes, part.bytes, `${part.name} length mismatch while reading`)
    assert.equal(partHash.digest('hex'), part.sha256, `${part.name} digest mismatch`)
  }
}
await mkdir(macDir, { recursive: true })
await pipeline(parts(), createWriteStream(archivePath, { flags: 'w' }))
const archiveSize = (await stat(archivePath)).size
assert.equal(archiveSize, expectedArchive.bytes)
assert.equal(hash.digest('hex'), expectedArchive.sha256)

const standardUserPath = join(windowsDir, 'standard-user-win-x64.json')
const windowsReceipt = JSON.parse((await readFile(standardUserPath)).toString('utf8'))
const windowsZipPath = join(windowsDir, 'dsh-desktop-0.2.0.rc.2.5-win-x64.zip')
const windowsZipSha256 = await hashFile(windowsZipPath)
const windowsArtifactSha256 = await hashFile(windowsWrapper)
assert.equal(windowsZipSha256, expectedWindowsZipSha256)
assert.equal(windowsArtifactSha256, expectedWindowsArtifactSha256)
assert.equal(windowsReceipt.target, 'win-x64')
assert.equal(windowsReceipt.version, '0.2.0.rc.2.5')
assert.equal(windowsReceipt.standardUser, true)
assert.equal(windowsReceipt.packagedSmoke, 'passed')
assert.equal(windowsReceipt.archive, 'dsh-desktop-0.2.0.rc.2.5-win-x64.zip')
assert.equal(windowsReceipt.sha256, expectedWindowsZipSha256)

console.log(JSON.stringify({
  passed: true,
  sourceCommit: manifest.sourceCommit,
  manifest: { name: manifestName, sha256: expectedManifestSha256 },
  macArchive: { ...expectedArchive, bytesVerified: archiveSize },
  parts: partEvidence,
  windowsArtifact: { path: 'incoming/windows-artifact.zip', sha256: windowsArtifactSha256, verified: true },
  windowsArchive: { name: 'dsh-desktop-0.2.0.rc.2.5-win-x64.zip', sha256: windowsZipSha256, verified: true },
  windowsStandardUser: windowsReceipt,
}))
