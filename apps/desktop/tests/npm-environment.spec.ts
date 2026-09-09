import { execFile, execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:https'
import { once } from 'node:events'
import { promisify } from 'node:util'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { desktopNpmEnvironment } from '../src/npm-environment.ts'

describe('desktop npm configuration', () => {
  it('reads registry and scoped registry through the bundled pnpm without npm', () => {
    const root = mkdtempSync(join(tmpdir(), 'desktop-npm-config-'))
    try {
      writeFileSync(join(root, '.npmrc'), 'registry=https://nexus.example/repository/npm/\nstrict-ssl=false\n@company:registry=https://nexus.example/repository/private/\n')
      const npm = desktopNpmEnvironment({ PATH: '', SystemRoot: process.env.SystemRoot, XDG_CONFIG_HOME: root, XDG_CACHE_HOME: root, XDG_STATE_HOME: root }, root)
      const require = createRequire(import.meta.url)
      const pnpm = join(dirname(require.resolve('pnpm')), 'bin', 'pnpm.mjs')
      const get = (key: string, env = npm.env): string => execFileSync(process.execPath, [
        pnpm, `--config.userconfig=${npm.userconfig}`, 'config', 'get', key,
      ], { cwd: root, env, encoding: 'utf8' }).trim()
      expect(get('registry')).toBe('https://nexus.example/repository/npm/')
      expect(get('@company:registry')).toBe('https://nexus.example/repository/private/')
      expect(get('registry', desktopNpmEnvironment({ ...npm.env, npm_config_registry: 'https://override.example/' }, root).env))
        .toBe('https://override.example/')
      expect(npm.env.NODE_TLS_REJECT_UNAUTHORIZED).toBeUndefined()
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('uses npmrc strict-ssl for real registry TLS and lets the environment re-enable validation', async () => {
    const root = mkdtempSync(join(tmpdir(), 'desktop-npm-tls-'))
    // Public test-only key; never used by a release or external service.
    const server = createServer({
      key: readFileSync(new URL('./fixtures/npm-tls/key.pem', import.meta.url)),
      cert: readFileSync(new URL('./fixtures/npm-tls/cert.pem', import.meta.url)),
    }, (_request, response) => {
      response.setHeader('content-type', 'application/json')
      response.end(JSON.stringify({ name: 'desktop-tls-test', 'dist-tags': { latest: '1.0.0' }, versions: {
        '1.0.0': { name: 'desktop-tls-test', version: '1.0.0' },
      } }))
    })
    try {
      server.listen(0, '127.0.0.1')
      await once(server, 'listening')
      const address = server.address()
      if (address === null || typeof address === 'string') throw new Error('Missing test registry port')
      writeFileSync(join(root, '.npmrc'), `registry=https://127.0.0.1:${address.port}/\nstrict-ssl=false\n`)
      const npm = desktopNpmEnvironment({ PATH: '', SystemRoot: process.env.SystemRoot, XDG_CONFIG_HOME: root, XDG_CACHE_HOME: root, XDG_STATE_HOME: root }, root)
      const require = createRequire(import.meta.url)
      const pnpm = join(dirname(require.resolve('pnpm')), 'bin', 'pnpm.mjs')
      const query = (env: NodeJS.ProcessEnv) => promisify(execFile)(process.execPath, [
        pnpm, `--config.userconfig=${npm.userconfig}`, '--config.fetch-retries=0',
        'view', 'desktop-tls-test', 'version',
      ], { cwd: root, env, timeout: 15_000 })
      expect((await query(npm.env)).stdout.trim()).toBe('1.0.0')
      await expect(query(desktopNpmEnvironment({ ...npm.env, npm_config_strict_ssl: 'true' }, root).env))
        .rejects.toMatchObject({ killed: false, code: 1 })
      // The registry remains reachable; changing only TLS validation restores the request.
      expect((await query(npm.env)).stdout.trim()).toBe('1.0.0')
    } finally {
      server.closeAllConnections()
      if (server.listening) {
        await new Promise<void>((resolve, reject) => server.close((error) => {
          if (error) reject(error)
          else resolve()
        }))
      }
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('honors a custom npmrc and lowercase npm environment precedence', () => {
    const custom = join(tmpdir(), 'company.npmrc')
    const npm = desktopNpmEnvironment({
      NPM_CONFIG_USERCONFIG: custom,
      NPM_CONFIG_REGISTRY: 'https://uppercase.example/',
      npm_config_registry: 'https://lowercase.example/',
      NPM_CONFIG_STRICT_SSL: 'false',
      DSH_DESKTOP_TOKEN: 'not-for-pnpm',
      npm_execpath: '/system/npm',
      PNPM_HOME: '/system/pnpm',
    })
    expect(npm.userconfig).toBe(custom)
    expect(npm.env).toEqual({
      npm_config_userconfig: custom,
      npm_config_registry: 'https://lowercase.example/',
      npm_config_strict_ssl: 'false',
      pnpm_config_registry: 'https://lowercase.example/',
      pnpm_config_strict_ssl: 'false',
    })
  })
})
