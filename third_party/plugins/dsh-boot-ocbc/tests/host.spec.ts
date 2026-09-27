import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runInNewContext } from 'node:vm'
import { afterEach, describe, expect, it } from 'vitest'
import { install } from '../src/host.ts'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'dsh-boot-ocbc-'))
  roots.push(root)
  mkdirSync(join(root, 'assets', 'frames'), { recursive: true })
  mkdirSync(join(root, 'lib'), { recursive: true })
  writeFileSync(join(root, 'asset-manifest.json'), JSON.stringify({ files: [{ path: 'frames/0001.png' }] }))
  writeFileSync(join(root, 'assets', 'frames', '0001.png'), 'frame')
  writeFileSync(join(root, 'lib', 'boot.js'), 'boot')
  writeFileSync(join(root, 'lib', 'renderer.js'), 'renderer')
  writeFileSync(join(root, 'secret.txt'), 'secret')
  return root
}

function fakeHost() {
  let onIndex: ((rows: Array<{ kind: string; placement?: string; src?: string }>) => void) | undefined
  let route: { path: string; handler: (req: { method?: string; url?: string }, res: any) => void } | undefined
  let disposeRoute: (() => void) | undefined
  const host: any = {
    on: (_event: string, listener: typeof onIndex) => { onIndex = listener },
    inject: (_services: string[], callback: (ctx: any) => void) => callback({
      webServer: { register: (row: any) => { route = row; disposeRoute = () => { route = undefined }; return disposeRoute } },
      effect: (effect: () => (() => void)) => { effect() },
    }),
  }
  return {
    host,
    get route() { return route },
    get onIndex() { return onIndex },
    disposeRoute() { disposeRoute?.() },
  }
}

function request(handler: NonNullable<ReturnType<typeof fakeHost>['route']>['handler'], url: string, method = 'GET') {
  let status = 0
  let headers: Record<string, string> = {}
  let body: Uint8Array | string | undefined
  handler({ method, url }, {
    writeHead: (code: number, value?: Record<string, string>) => { status = code; headers = value ?? {} },
    end: (value?: Uint8Array | string) => { body = value },
  })
  return { status, headers, body }
}

describe('dsh-boot-ocbc host plugin', () => {
  it('injects one early boot script and removes its route with the service disposer', () => {
    const fake = fakeHost()
    install(fake.host, fixture())
    const rows: Array<{ kind: string; placement?: string; text?: string }> = []
    fake.onIndex?.(rows)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ kind: 'script', placement: 'head' })
    expect(rows[0].text).toContain("s.src=new URL('/plugins/dsh-boot-ocbc/lib/boot.js',location.href).href")
    expect(rows[0].text).toContain('s.onerror=function(){s.remove()}')
    expect(rows[0].text).not.toContain('await')
    let rejected = false
    const script = { async: false, src: '', onerror: undefined as (() => void) | undefined, remove() {} }
    runInNewContext(rows[0].text!, {
      URL,
      location: { href: 'dsh-app://app/' },
      document: { createElement: () => script, head: { append: () => script.onerror?.() } },
      Promise: { reject: () => { rejected = true } },
    })
    expect(script.src).toBe('dsh-app://app/plugins/dsh-boot-ocbc/lib/boot.js')
    expect(rejected).toBe(false)
    expect(fake.route?.path).toBe('/plugins/dsh-boot-ocbc')
    fake.disposeRoute()
    expect(fake.route).toBeUndefined()
  })

  it('serves only allowlisted assets and boot code, rejecting traversal and package files', () => {
    const fake = fakeHost()
    install(fake.host, fixture())
    const handler = fake.route!.handler
    expect(request(handler, '/plugins/dsh-boot-ocbc/assets/frames/0001.png').body).toBeInstanceOf(Buffer)
    expect(request(handler, '/plugins/dsh-boot-ocbc/lib/boot.js').body).toEqual(Buffer.from('boot'))
    expect(request(handler, '/plugins/dsh-boot-ocbc/lib/renderer.js').body).toEqual(Buffer.from('renderer'))
    expect(request(handler, '/plugins/dsh-boot-ocbc/secret.txt').status).toBe(404)
    expect(request(handler, '/plugins/dsh-boot-ocbc/assets/%2e%2e/secret.txt').status).toBe(404)
    expect(request(handler, '/plugins/dsh-boot-ocbc/assets/frames/0001.png', 'POST').status).toBe(405)
    expect(request(handler, '/plugins/dsh-boot-ocbc/assets/frames/0001.png', 'HEAD').body).toBeUndefined()
  })
})
