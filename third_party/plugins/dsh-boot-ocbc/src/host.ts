/** Host half of dsh-boot-ocbc. Keep the route and index contribution scoped
 * to this plugin's fiber so unloading the plugin removes both automatically. */
import { readFileSync, realpathSync, statSync } from 'node:fs'
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROUTE = '/plugins/dsh-boot-ocbc'
const BOOT_FILE = 'lib/boot.js'
const RENDERER_FILE = 'lib/renderer.js'

type IndexRow = { kind: 'script'; placement: 'head'; text: string }
type RequestLike = { method?: string; url?: string }
type ResponseLike = {
  writeHead(status: number, headers?: Record<string, string>): void
  end(body?: Uint8Array | string): void
}
type WebServerLike = { register(route: {
  kind: 'prefix'; path: string; handler(req: RequestLike, res: ResponseLike): void
}): () => void }
type HostContext = {
  on(event: 'webserver/index-inject', listener: (rows: IndexRow[]) => void): unknown
  inject(services: string[], callback: (ctx: { webServer: WebServerLike; effect(
    effect: () => (() => void), label?: string,
  ): unknown }) => void): unknown
}

const CONTENT_TYPES: Record<string, string> = {
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.css': 'text/css; charset=utf-8', '.bin': 'application/octet-stream',
}

/** Build an exact file allowlist from the release asset manifest. */
function readAllowedFiles(packageRoot: string): Set<string> {
  const manifest = JSON.parse(readFileSync(join(packageRoot, 'asset-manifest.json'), 'utf8')) as {
    files?: Array<{ path?: unknown }>
  }
  if (!Array.isArray(manifest.files)) throw new Error('dsh-boot-ocbc: invalid asset manifest')
  const allowed = new Set<string>([BOOT_FILE, RENDERER_FILE])
  for (const item of manifest.files) {
    if (typeof item.path !== 'string') throw new Error('dsh-boot-ocbc: invalid asset path in manifest')
    const path = `assets/${item.path}`
    if (isSafeRelativePath(path)) allowed.add(path)
  }
  return allowed
}

function isSafeRelativePath(path: string): boolean {
  if (path.length === 0 || path.includes('\\') || path.includes('\0') || isAbsolute(path)) return false
  const segments = path.split('/')
  return segments.every(segment => segment !== '' && segment !== '.' && segment !== '..')
}

function send(res: ResponseLike, status: number, body = ''): void {
  res.writeHead(status, { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' })
  res.end(body)
}

function createAssetHandler(packageRoot: string, allowed: Set<string>) {
  const realPackageRoot = realpathSync(packageRoot)
  return (req: RequestLike, res: ResponseLike): void => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { allow: 'GET, HEAD', 'cache-control': 'no-store' }); res.end(); return
    }
    let url: URL
    try { url = new URL(req.url ?? '/', 'http://dsh.invalid') } catch { send(res, 400); return }
    if (!url.pathname.startsWith(`${ROUTE}/`)) { send(res, 404); return }
    let relativePath: string
    try { relativePath = decodeURIComponent(url.pathname.slice(ROUTE.length + 1)) } catch { send(res, 400); return }
    if (!isSafeRelativePath(relativePath) || !allowed.has(relativePath)) { send(res, 404); return }
    const candidate = resolve(realPackageRoot, relativePath)
    const rel = relative(realPackageRoot, candidate)
    if (rel === '' || rel.startsWith(`..${sep}`) || rel === '..') { send(res, 404); return }
    try {
      const realFile = realpathSync(candidate)
      const realRel = relative(realPackageRoot, realFile)
      if (realRel === '' || realRel.startsWith(`..${sep}`) || realRel === '..' || !statSync(realFile).isFile()) {
        send(res, 404); return
      }
      const body = req.method === 'HEAD' ? undefined : readFileSync(realFile)
      res.writeHead(200, {
        'content-type': CONTENT_TYPES[extname(realFile).toLowerCase()] ?? 'application/octet-stream',
        'content-length': String(statSync(realFile).size),
        'cache-control': 'no-cache',
        'x-content-type-options': 'nosniff',
      })
      res.end(body)
    } catch { send(res, 404) }
  }
}

/** Install the Host route and index injection. Exposed for host-level tests. */
export function install(ctx: HostContext, packageRoot: string): void {
  const allowed = readAllowedFiles(packageRoot)
  const handler = createAssetHandler(packageRoot, allowed)
  ctx.inject(['webServer'], webCtx => {
    webCtx.effect(
      () => webCtx.webServer.register({ kind: 'prefix', path: ROUTE, handler }),
      'dsh-boot-ocbc asset route',
    )
  })
  ctx.on('webserver/index-inject', rows => {
    rows.push({
      kind: 'script',
      placement: 'head',
      text: `;(function(){try{var s=document.createElement('script');s.id='dsh-boot-ocbc-bootstrap';s.async=true;s.src=new URL('${ROUTE}/${BOOT_FILE}',location.href).href;s.onerror=function(){s.remove()};document.head.append(s)}catch(_){}})()`,
    })
  })
}

/** Standard loader entry point. Assets are resolved beside the installed lib. */
export function apply(ctx: HostContext): void {
  const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)))
  install(ctx, packageRoot)
}

export default apply
