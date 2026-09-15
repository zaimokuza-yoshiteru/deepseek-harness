/** Import macOS login-shell exports without parsing or copying personal shell configuration. */
import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { delimiter, dirname } from 'node:path'

const EXCLUDED = /^(?:ELECTRON_.+|DSH_DESKTOP_.+|NODE_OPTIONS|NODE_PATH|PWD|OLDPWD|SHLVL|_)$/u

/** Parse only exported variables between unique markers; startup banners are ignored.
 * @param output - NUL-delimited shell output.
 * @param marker - Per-invocation framing token.
 * @param inherited - Existing application environment.
 * @returns Exported shell values overlaid on inherited values, excluding process-control fields.
 */
export function parseShellEnvironment(output: string, marker: string, inherited: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const start = output.indexOf(`${marker}\0`)
  const end = output.indexOf(`${marker}\0`, start + marker.length + 1)
  if (start < 0 || end < 0) throw new Error('desktop shell: environment markers were not returned')
  const result = { ...inherited }
  for (const field of output.slice(start + marker.length + 1, end).split('\0')) {
    const equals = field.indexOf('=')
    if (equals <= 0) continue
    const name = field.slice(0, equals)
    if (!EXCLUDED.test(name)) result[name] = field.slice(equals + 1)
  }
  return result
}

/** Load the configured macOS shell's login and interactive startup files once per launch.
 * @param environment - Finder or terminal launch environment.
 * @param node - Bundled Node fallback, appended after the user's PATH.
 * @param platform - Current operating system.
 * @returns Environment for the backend and package manager; timeout or shell failures reject.
 */
export async function desktopShellEnvironment(
  environment: NodeJS.ProcessEnv, node: string, platform: NodeJS.Platform = process.platform,
): Promise<NodeJS.ProcessEnv> {
  let result = { ...environment }
  if (platform === 'darwin') {
    const marker = `dsh_env_${randomUUID().replaceAll('-', '')}`
    const shell = environment.SHELL || '/bin/zsh'
    const output = await new Promise<string>((accept, reject) => {
      execFile(shell, ['-ilc', `printf '${marker}\\0'; /usr/bin/env -0; printf '${marker}\\0'`], {
        env: Object.fromEntries(Object.entries(environment).filter(([name]) => !EXCLUDED.test(name))),
        timeout: 8000, maxBuffer: 4 * 1024 * 1024, encoding: 'utf8',
      }, (error, stdout) => {
        if (error === null) accept(stdout)
        else reject(new Error('desktop shell: login environment failed or exceeded 8 seconds', { cause: error }))
      })
    })
    result = parseShellEnvironment(output, marker, environment)
  }
  const pathKey = Object.keys(result).find(name => name.toLowerCase() === 'path') ?? 'PATH'
  result[pathKey] = [result[pathKey], dirname(node)].filter(Boolean).join(delimiter)
  return result
}
