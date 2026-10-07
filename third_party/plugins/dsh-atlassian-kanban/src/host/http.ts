import http from 'node:http'
import https from 'node:https'
import { URL } from 'node:url'
import { createWriteStream } from 'node:fs'
import { mkdir, rename, rm, stat } from 'node:fs/promises'
import { dirname } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { randomUUID } from 'node:crypto'
import { Transform } from 'node:stream'

export interface AtlassianResponse<T> { readonly status: number; readonly headers: http.IncomingHttpHeaders; readonly data: T }

export class AtlassianHttpError extends Error {
  constructor(readonly status: number, message: string, readonly data: unknown) { super(message); this.name = 'AtlassianHttpError' }
}

/** Per-request Atlassian transport. TLS verification is disabled only on this HTTPS agent. */
export class AtlassianHttp {
  /** Stream a successful response to a caller-owned private cache path with a hard byte cap. */
  async requestToFile(baseUrl: string, token: string, method: string, apiPath: string, destination: string, options: {
    readonly query?: URLSearchParams; readonly headers?: http.OutgoingHttpHeaders; readonly signal?: AbortSignal
    readonly accept?: string; readonly timeoutMs?: number; readonly maxResponseBytes: number
  }): Promise<{ status: number; headers: http.IncomingHttpHeaders; bytes: number }> {
    options.signal?.throwIfAborted()
    const timeoutMs = options.timeoutMs ?? 30_000
    if (!Number.isFinite(timeoutMs) || timeoutMs < 1 || !Number.isSafeInteger(options.maxResponseBytes) || options.maxResponseBytes < 1) throw new TypeError('Stream timeout and byte limit must be positive finite integers')
    const base = parseBaseUrl(baseUrl)
    const url = new URL(`${base.pathname.replace(/\/$/, '')}/${apiPath.replace(/^\//, '')}`, base.origin)
    if (options.query) url.search = options.query.toString()
    const headers: http.OutgoingHttpHeaders = { authorization: `Bearer ${token}`, accept: options.accept ?? '*/*', ...options.headers }
    const protocol = url.protocol === 'https:' ? https : http
    const agent = url.protocol === 'https:' ? new https.Agent({ rejectUnauthorized: false, keepAlive: true }) : new http.Agent({ keepAlive: true })
    const partial = `${destination}.partial-${randomUUID()}`
    let committedDestination = false
    const timeoutController = new AbortController()
    const signal = options.signal ? AbortSignal.any([options.signal, timeoutController.signal]) : timeoutController.signal
    const deadline = setTimeout(() => timeoutController.abort(new Error(`Atlassian request exceeded its configured ${timeoutMs} ms deadline`)), timeoutMs)
    try {
      await mkdir(dirname(destination), { recursive: true, mode: 0o700 })
      const response = await new Promise<{ res: http.IncomingMessage; req: http.ClientRequest }>((resolve, reject) => {
        const req = protocol.request(url, { method, headers, agent, signal }, res => resolve({ res, req }))
        req.on('error', reject); req.end()
      })
      if (response.res.statusCode === undefined || response.res.statusCode < 200 || response.res.statusCode >= 300) {
        const chunks: Buffer[] = []; let count = 0
        for await (const chunk of response.res) { const b = Buffer.from(chunk); count += b.length; if (count > 64 * 1024) { response.res.destroy(); throw new Error('Atlassian error response exceeded diagnostic limit') } chunks.push(b) }
        const body = Buffer.concat(chunks).toString('utf8')
        let data: unknown = body; try { data = JSON.parse(body) } catch { /* retain text */ }
        throw new AtlassianHttpError(response.res.statusCode ?? 0, redactString(responseMessage(data) ?? `${method} ${url.pathname} failed with HTTP ${response.res.statusCode}`, token), sanitize(data, token))
      }
      let bytes = 0
      const cap = new Transform({ transform(chunk: Buffer, _encoding, callback) { bytes += chunk.length; callback(bytes > options.maxResponseBytes ? new Error(`Atlassian response exceeded the configured ${options.maxResponseBytes} byte safety limit`) : null, chunk) } })
      await pipeline(response.res, cap, createWriteStream(partial, { flags: 'wx', mode: 0o600 }), { signal })
      await rename(partial, destination)
      committedDestination = true
      const details = await stat(destination)
      return { status: response.res.statusCode ?? 0, headers: response.res.headers, bytes: details.size }
    } catch (error) { await rm(partial, { force: true }).catch(() => undefined); if (committedDestination) await rm(destination, { force: true }).catch(() => undefined); if (timeoutController.signal.aborted) throw timeoutController.signal.reason ?? error; throw error }
    finally { clearTimeout(deadline); agent.destroy() }
  }
  async request<T>(baseUrl: string, token: string, method: string, apiPath: string, options: {
    readonly query?: URLSearchParams
    readonly body?: unknown
    readonly form?: URLSearchParams
    readonly headers?: http.OutgoingHttpHeaders
    readonly signal?: AbortSignal
    readonly accept?: string
    readonly timeoutMs?: number
    readonly maxResponseBytes?: number
    readonly acceptedStatuses?: readonly number[]
    /** Return the raw bounded body as a Buffer (used only for authenticated icons). */
    readonly responseType?: 'json' | 'buffer'
  } = {}): Promise<AtlassianResponse<T>> {
    options.signal?.throwIfAborted()
    const base = parseBaseUrl(baseUrl)
    const path = `${base.pathname.replace(/\/$/, '')}/${apiPath.replace(/^\//, '')}`
    const url = new URL(path, base.origin)
    if (options.query) url.search = options.query.toString()
    const payload = options.form ? Buffer.from(options.form.toString()) : options.body === undefined ? undefined : Buffer.from(JSON.stringify(options.body))
    const headers: http.OutgoingHttpHeaders = {
      authorization: `Bearer ${token}`,
      accept: options.accept ?? 'application/json',
      ...(payload === undefined ? {} : { 'content-type': options.form ? 'application/x-www-form-urlencoded' : 'application/json', 'content-length': payload.byteLength }),
      ...options.headers,
    }
    const protocol = url.protocol === 'https:' ? https : http
    const agent = url.protocol === 'https:' ? new https.Agent({ rejectUnauthorized: false, keepAlive: true }) : new http.Agent({ keepAlive: true })
    try {
      const response = await new Promise<{ status: number; headers: http.IncomingHttpHeaders; body: Buffer }>((resolve, reject) => {
        let settled = false
        const timeoutMs = options.timeoutMs ?? 30_000
        let deadline: ReturnType<typeof setTimeout> | undefined
        const finish = (error?: Error, value?: { status: number; headers: http.IncomingHttpHeaders; body: Buffer }) => {
          if (settled) return
          settled = true
          if (deadline !== undefined) clearTimeout(deadline)
          if (error) reject(error)
          else resolve(value!)
        }
        const req = protocol.request(url, { method, headers, agent, signal: options.signal }, res => {
          const chunks: Buffer[] = []
          let length = 0
          const maxResponseBytes = options.maxResponseBytes ?? 10 * 1024 * 1024
          res.on('data', (chunk: Buffer | string) => {
            const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
            length += buffer.byteLength
            if (length > maxResponseBytes) { finish(new Error(`Atlassian response exceeded the configured ${maxResponseBytes} byte safety limit`)); req.destroy(); return }
            chunks.push(buffer)
          })
          res.on('error', error => finish(error))
          res.on('end', () => finish(undefined, { status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) }))
        })
        deadline = setTimeout(() => req.destroy(new Error(`Atlassian request exceeded its configured ${timeoutMs} ms deadline`)), timeoutMs)
        req.on('error', error => finish(error))
        try {
          if (payload !== undefined) req.write(payload)
          req.end()
        } catch (error) {
          finish(error instanceof Error ? error : new Error(String(error)))
        }
      })
      const raw = response.body.toString('utf8')
      let data: unknown = null
      if (options.responseType === 'buffer' && response.status >= 200 && response.status < 300) {
        data = response.body
      } else if (raw) {
        try { data = JSON.parse(raw) }
        catch { data = raw }
      }
      if (response.status < 200 || response.status >= 300) {
        if (!options.acceptedStatuses?.includes(response.status)) {
          const message = responseMessage(data) ?? `${method} ${url.pathname} failed with HTTP ${response.status}`
          throw new AtlassianHttpError(response.status, redactString(message, token), sanitize(data, token))
        }
      }
      return { status: response.status, headers: response.headers, data: data as T }
    } finally { agent.destroy() }
  }
}

function redactString(value: string, token: string): string { return token ? value.split(token).join('[redacted]') : value }
function sanitize(value: unknown, token: string): unknown {
  if (typeof value === 'string') return redactString(value, token)
  if (Array.isArray(value)) return value.map(item => sanitize(item, token))
  if (typeof value === 'object' && value !== null) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, sanitize(item, token)]))
  return value
}

function responseMessage(data: unknown): string | undefined {
  if (typeof data === 'string') return data.slice(0, 2000)
  if (typeof data !== 'object' || data === null) return undefined
  const row = data as Record<string, unknown>
  if (typeof row['message'] === 'string') return row['message']
  if (Array.isArray(row['errorMessages'])) return row['errorMessages'].filter((x): x is string => typeof x === 'string').join('; ').slice(0, 2000)
  if (typeof row['errors'] === 'object' && row['errors'] !== null && !Array.isArray(row['errors'])) return Object.values(row['errors']).filter((x): x is string => typeof x === 'string').join('; ').slice(0, 2000)
  if (Array.isArray(row['errors'])) return row['errors'].map(x => typeof x === 'object' && x !== null && typeof Reflect.get(x, 'message') === 'string' ? Reflect.get(x, 'message') as string : '').filter(Boolean).join('; ').slice(0, 2000)
  return undefined
}

export function parseBaseUrl(input: string): URL {
  let url: URL
  try { url = new URL(input) }
  catch { throw new TypeError('Atlassian base URL must be an absolute HTTP or HTTPS URL') }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new TypeError('Atlassian base URL must use HTTP(S), contain no credentials, query, or fragment')
  }
  url.pathname = `${url.pathname.replace(/\/+$/, '')}/`
  return url
}
