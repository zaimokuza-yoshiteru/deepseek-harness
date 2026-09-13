import { createReadStream, createWriteStream, fstatSync, mkdtempSync, openSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { closeDesktopPipe } from '../../desktop-host/src/close-pipe.ts'

it('waits for descriptor closure without closing an autoClose:false stream twice', async () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-host-pipes-'))
  const path = join(root, 'pipe-data')
  writeFileSync(path, 'data')
  const readFd = openSync(path, 'r')
  const writeFd = openSync(join(root, 'output'), 'w')
  const pipes = [createReadStream('', { fd: readFd, autoClose: false }), createWriteStream('', { fd: writeFd, autoClose: false })]
  try {
    for (const [index, pipe] of pipes.entries()) {
      await closeDesktopPipe(pipe)
      expect(pipe.closed).toBe(true)
      expect(() => fstatSync(index === 0 ? readFd : writeFd)).toThrow(/EBADF/u)
      await closeDesktopPipe(pipe)
    }
  } finally {
    await Promise.all(pipes.map(closeDesktopPipe))
    rmSync(root, { recursive: true, force: true })
  }
})
