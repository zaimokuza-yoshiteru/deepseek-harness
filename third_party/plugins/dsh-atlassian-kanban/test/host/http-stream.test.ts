import http, { type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AddressInfo } from 'node:net'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AtlassianHttp, AtlassianHttpError } from '../../src/host/http.ts'

type Handler = (request: IncomingMessage, response: ServerResponse) => void

describe('AtlassianHttp.requestToFile', () => {
  const servers: Server[] = []
  let directory: string
  const client = new AtlassianHttp()

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'dsh-kanban-http-stream-'))
  })

  afterEach(async () => {
    for (const server of servers.splice(0)) {
      server.closeAllConnections()
      await new Promise<void>(resolve => server.close(() => resolve()))
    }
    await rm(directory, { recursive: true, force: true })
  })

  async function listen(handler: Handler): Promise<string> {
    const server = http.createServer(handler)
    servers.push(server)
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', () => { server.off('error', reject); resolve() })
    })
    return `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  }

  const destination = () => join(directory, 'download.bin')
  const options = (maxResponseBytes: number, other: { timeoutMs?: number; signal?: AbortSignal } = {}) => ({
    maxResponseBytes,
    ...other,
  })

  it('streams exact bytes to a private mode-0600 destination', async () => {
    const body = Buffer.from([0x00, 0xff, 0x41, 0x80, 0x0a])
    const baseUrl = await listen((_request, response) => {
      response.writeHead(200, { 'content-type': 'application/octet-stream' })
      response.end(body)
    })

    const result = await client.requestToFile(baseUrl, 'secret', 'GET', '/file', destination(), options(32))
    expect(result).toMatchObject({ status: 200, bytes: body.length })
    expect(await readFile(destination())).toEqual(body)
    expect((await stat(destination())).mode & 0o777).toBe(0o600)
  })

  it('removes only its partial file after exceeding the byte cap and preserves an existing destination', async () => {
    const baseUrl = await listen((_request, response) => {
      response.writeHead(200, { 'content-type': 'application/octet-stream' })
      response.end(Buffer.alloc(128, 0x62))
    })
    await writeFile(destination(), 'keep-existing-content')

    await expect(client.requestToFile(baseUrl, 'secret', 'GET', '/large', destination(), options(32)))
      .rejects.toThrow('exceeded the configured 32 byte safety limit')

    expect(await readFile(destination(), 'utf8')).toBe('keep-existing-content')
    expect(await readdir(directory)).toEqual(['download.bin'])
  })

  it('enforces the overall timeout after headers arrive while the body remains stalled', async () => {
    let headersSent!: () => void
    const didSendHeaders = new Promise<void>(resolve => { headersSent = resolve })
    const baseUrl = await listen((_request, response) => {
      response.writeHead(200, { 'content-type': 'application/octet-stream' })
      response.flushHeaders()
      response.write('partial-body')
      headersSent()
    })

    const startedAt = Date.now()
    const pending = client.requestToFile(baseUrl, 'secret', 'GET', '/stall', destination(), options(1024, { timeoutMs: 100 }))
    await didSendHeaders
    await expect(pending).rejects.toThrow(/deadline/)
    expect(Date.now() - startedAt).toBeLessThan(1500)
    expect(await readdir(directory)).toEqual([])
  })

  it('aborts an active body stream and cleans its partial without deleting a prior destination', async () => {
    await writeFile(destination(), 'prior-file')
    let bodyStarted!: () => void
    const didStartBody = new Promise<void>(resolve => { bodyStarted = resolve })
    const baseUrl = await listen((_request, response) => {
      response.writeHead(200, { 'content-type': 'application/octet-stream' })
      response.flushHeaders()
      response.write('partial-body')
      bodyStarted()
    })
    const controller = new AbortController()
    const pending = client.requestToFile(baseUrl, 'secret', 'GET', '/abort', destination(), options(1024, { signal: controller.signal }))
    await didStartBody
    controller.abort(new Error('caller cancelled stream'))

    await expect(pending).rejects.toThrow()
    expect(await readFile(destination(), 'utf8')).toBe('prior-file')
    expect(await readdir(directory)).toEqual(['download.bin'])
  })

  it.each([400, 401])('redacts the bearer token from HTTP %i error message and data', async status => {
    const token = 'token-must-not-escape-into-errors'
    const baseUrl = await listen((_request, response) => {
      response.writeHead(status, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ message: `rejected ${token}`, detail: { echo: token } }))
    })

    let caught: unknown
    try {
      await client.requestToFile(baseUrl, token, 'GET', '/private', destination(), options(1024))
    } catch (error) { caught = error }

    expect(caught).toBeInstanceOf(AtlassianHttpError)
    const serialized = `${(caught as Error).message} ${JSON.stringify((caught as AtlassianHttpError).data)}`
    expect(serialized).not.toContain(token)
    expect(serialized).toContain('[redacted]')
    expect((caught as AtlassianHttpError).status).toBe(status)
    expect(await readdir(directory)).toEqual([])
  })

  it('does not follow a redirect to a second server', async () => {
    let secondServerHits = 0
    const secondUrl = await listen((_request, response) => {
      secondServerHits += 1
      response.end('redirected content')
    })
    const firstUrl = await listen((_request, response) => {
      response.writeHead(302, { location: `${secondUrl}/secret` })
      response.end('redirect')
    })

    await expect(client.requestToFile(firstUrl, 'secret', 'GET', '/redirect', destination(), options(1024)))
      .rejects.toMatchObject({ status: 302 })
    expect(secondServerHits).toBe(0)
    expect(await readdir(directory)).toEqual([])
  })
})
