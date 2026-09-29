import { readFileSync } from 'node:fs'

/** The locked Typert generator version owns the exact build target. */
const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
export const DSH_COMPAT_RANGE = manifest.engines?.dsh
const supportedVersions = typeof DSH_COMPAT_RANGE === 'string'
  ? DSH_COMPAT_RANGE.split('||').map(version => version.trim())
  : []
if (supportedVersions.length === 0 || supportedVersions.some(version => !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version))) {
  throw new Error('package.json engines.dsh must list exact released host versions separated by ||')
}
export const DSH_SOURCE_VERSION = manifest.devDependencies?.['@deepseek-ai/dsh-typert-generator']
if (!supportedVersions.includes(DSH_SOURCE_VERSION)) {
  throw new Error('@deepseek-ai/dsh-typert-generator must target an exact version declared by package.json engines.dsh')
}
export const DSH_SOURCE_TAG = `dsh-v${DSH_SOURCE_VERSION}`
