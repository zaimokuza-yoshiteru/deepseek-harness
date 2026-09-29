/** One release selection drives runtime profile migration, seed selection and package smoke. */
import releasePlugins from './release-plugins.json' with { type: 'json' }

export const DESKTOP_MANAGED_PLUGINS = releasePlugins.plugins.map(({ name }) => ({ name }))
export const DESKTOP_PORTABLE_PLUGINS = releasePlugins.plugins
  .filter(plugin => plugin.desktopBundle !== false)
  .map(({ name }) => ({ name }))
