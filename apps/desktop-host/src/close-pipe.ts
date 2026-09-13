/** Stream destruction owns descriptor closure, including streams with autoClose disabled. */
import { once } from 'node:events'
import type { ReadStream, WriteStream } from 'node:fs'

/** Destroy a transport stream and wait until its descriptor is closed exactly once.
 * @param pipe - Host-owned request or response stream.
 */
export async function closeDesktopPipe(pipe: ReadStream | WriteStream): Promise<void> {
  if (pipe.closed) return
  const closed = once(pipe, 'close')
  pipe.destroy()
  await closed
}
