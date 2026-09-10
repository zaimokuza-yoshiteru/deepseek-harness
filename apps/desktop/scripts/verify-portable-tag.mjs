/** Reject desktop tags from a different DSH base or outside the desktop branch. */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const version = process.env.DSH_DESKTOP_DISTRIBUTION_VERSION
if (version === undefined || !/^0\.1\.5-rc\.1\.[1-9][0-9]*$/u.test(version)) {
  throw new Error('Expected DSH_DESKTOP_DISTRIBUTION_VERSION=0.1.5-rc.1.<positive integer>')
}
const root = JSON.parse(readFileSync(new URL('../../../package.json', import.meta.url)))
if (root.version !== '0.1.5-rc.1') throw new Error('This desktop line requires DSH 0.1.5-rc.1')
execFileSync('git', ['merge-base', '--is-ancestor', 'HEAD', 'origin/desktop'], { stdio: 'inherit' })
if (process.env.GITHUB_REF_TYPE === 'tag' && process.env.GITHUB_REF_NAME !== version) {
  throw new Error('Distribution version must equal the pushed tag')
}
