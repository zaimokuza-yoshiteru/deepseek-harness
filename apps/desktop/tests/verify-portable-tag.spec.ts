import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, expect, it } from 'vitest'

const roots: string[] = []
const script = fileURLToPath(new URL('../scripts/verify-portable-tag.mjs', import.meta.url))
const delivery = JSON.parse(readFileSync(new URL('../../../delivery.json', import.meta.url), 'utf8')) as { version: string }

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function repository(): { root: string; base: string } {
  const root = mkdtempSync(join(tmpdir(), 'portable-tag-git-'))
  roots.push(root)
  const git = (args: string[]) => execFileSync('git', args, { cwd: root, stdio: 'ignore' })
  git(['init'])
  git(['checkout', '-b', 'desktop'])
  git(['-c', 'user.name=Portable tag test', '-c', 'user.email=portable-tag@example.invalid', 'commit', '--allow-empty', '-m', 'desktop base'])
  const base = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()
  git(['update-ref', 'refs/remotes/origin/desktop', base])
  return { root, base }
}

function commit(root: string, message: string): void {
  execFileSync('git', ['-c', 'user.name=Portable tag test', '-c', 'user.email=portable-tag@example.invalid', 'commit', '--allow-empty', '-m', message], { cwd: root, stdio: 'ignore' })
}

function verify(root: string, event: string, type: string, ref: string) {
  return spawnSync(process.execPath, [script], {
    cwd: root,
    encoding: 'utf8',
    env: {
      ...process.env,
      DSH_DESKTOP_DISTRIBUTION_VERSION: delivery.version,
      GITHUB_EVENT_NAME: event,
      GITHUB_REF_TYPE: type,
      GITHUB_REF_NAME: ref,
    },
  })
}

it('allows a manual workflow dispatch from a branch based on origin/desktop', () => {
  const { root } = repository()
  execFileSync('git', ['checkout', '-b', 'codex/portable-test'], { cwd: root, stdio: 'ignore' })
  commit(root, 'manual feature change')
  expect(verify(root, 'workflow_dispatch', 'branch', 'codex/portable-test').status).toBe(0)
})

it('rejects a manual workflow dispatch from an unrelated branch', () => {
  const { root } = repository()
  execFileSync('git', ['checkout', '--orphan', 'unrelated'], { cwd: root, stdio: 'ignore' })
  commit(root, 'unrelated root')
  expect(verify(root, 'workflow_dispatch', 'branch', 'unrelated').status).not.toBe(0)
})

it('keeps push builds restricted to commits that are ancestors of origin/desktop', () => {
  const { root } = repository()
  execFileSync('git', ['checkout', '-b', 'feature/push'], { cwd: root, stdio: 'ignore' })
  commit(root, 'push feature change')
  expect(verify(root, 'push', 'branch', 'feature/push').status).not.toBe(0)
})

it('rejects a pushed tag whose name does not match the requested distribution version', () => {
  const { root } = repository()
  expect(verify(root, 'push', 'tag', `${delivery.version}-wrong`).status).not.toBe(0)
})
