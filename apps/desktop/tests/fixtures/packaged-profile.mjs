/** Install the shipped profile resolver for standalone packaged-plugin probes. */
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

export async function packagedProfile(runtime, profile) {
  const require = createRequire(join(runtime, 'package.json'))
  const load = name => import(pathToFileURL(require.resolve(name)).href)
  const { Context } = await load('@deepseek-ai/cordis')
  const { PluginPackages, createRuntimeResolution, loadProfileDirectory } = await load('@deepseek-ai/dsh-app-boot')
  const installAnchor = join(runtime, 'node_modules/@deepseek-ai/dsh/package.json')
  const resolution = await createRuntimeResolution({ installAnchor, profile: loadProfileDirectory('dsh', profile, installAnchor) })
  const ctx = new Context()
  const fiber = ctx.plugin(PluginPackages, { resolution })
  await fiber
  return { ctx, load, close: () => fiber.dispose() }
}
