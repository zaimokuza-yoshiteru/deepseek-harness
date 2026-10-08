/** Resolve an ACP executable and prepare Windows command shims for the host spawn seam. */
/// <reference types="node" />

import { createRequire } from 'node:module'
import { win32 } from 'node:path'
import type { SubprocessSeam } from './subprocess.ts'

interface CrossSpawnParsed {
  command: string
  args: string[]
  options: { windowsVerbatimArguments?: boolean }
}

export interface AcpCommandLaunch {
  readonly argv: string[]
  readonly windowsVerbatimArguments?: boolean
}

/** Resolve PATH/PATHEXT through the host and safely wrap Windows command shims. */
export async function prepareAcpCommandLaunch(
  subprocess: SubprocessSeam,
  argv: readonly string[],
  cwd: string,
  env: Record<string, string>,
  signal?: AbortSignal,
): Promise<AcpCommandLaunch> {
  const [command, ...args] = argv
  if (command === undefined || command.length === 0) throw new TypeError('ACP command must be non-empty')
  // Keep POSIX launch semantics and avoid an extra PATH/filesystem scan there.
  if (process.platform !== 'win32') return { argv: [...argv] }

  // The host resolver accepts absolute paths and PATH names. Config also allows
  // relative paths such as `./Agent Tools/kimi`; resolve those against the
  // launch cwd first so Windows retains that existing contract.
  const resolverCommand = /[\\/]/u.test(command) && !win32.isAbsolute(command)
    ? win32.resolve(cwd, command)
    : command
  const executable = await subprocess.resolveExecutable(resolverCommand, env, signal)
  if (!/\.(?:bat|cmd)$/iu.test(executable)) {
    return { argv: [executable, ...args] }
  }
  // cross-spawn's parser is needed only for Windows shell shims. Keep it out
  // of the POSIX runtime path; its private parser API is pinned and covered by
  // the packaged Windows smoke.
  const crossSpawn = createRequire(import.meta.url)('cross-spawn') as {
    _parse(command: string, args: string[], options: { cwd: string; env: Record<string, string> }): CrossSpawnParsed
  }
  const parsed = crossSpawn._parse(executable, args, { cwd, env })
  return {
    argv: [parsed.command, ...parsed.args],
    ...(parsed.options.windowsVerbatimArguments === true ? { windowsVerbatimArguments: true } : {}),
  }
}
