/** Reject desktop tags from a different DSH base or outside the desktop branch. */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolveDesktopDistributionVersion } from '../../../scripts/desktop-distribution-version.mjs'

const delivery = JSON.parse(readFileSync(new URL('../../../delivery.json', import.meta.url), 'utf8'))
const requestedVersion = process.env.DSH_DESKTOP_DISTRIBUTION_VERSION
if (requestedVersion === undefined) throw new Error(`Expected DSH_DESKTOP_DISTRIBUTION_VERSION derived from ${delivery.dshVersion}`)
const { tag: version } = resolveDesktopDistributionVersion(delivery, requestedVersion)
const root = JSON.parse(readFileSync(new URL('../../../package.json', import.meta.url)))
if (root.version !== delivery.dshVersion) throw new Error(`This desktop line requires DSH ${delivery.dshVersion}`)
execFileSync('git', ['merge-base', '--is-ancestor', 'HEAD', 'origin/desktop'], { stdio: 'inherit' })
if (process.env.GITHUB_REF_TYPE === 'tag' && process.env.GITHUB_REF_NAME !== version) {
  throw new Error('Distribution version must equal the pushed tag')
}
