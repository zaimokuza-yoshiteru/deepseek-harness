import type { AfterPackContext } from 'app-builder-lib'

interface DesktopPortableResource {
  readonly from: string
  readonly to: 'runtime' | 'dsh' | 'dsh/node_modules' | 'icon.png' | 'tray.ico' | 'notices/DSH-LICENSE' | 'notices/DSH-THIRD-PARTY-NOTICES.md'
  readonly filter?: readonly ['**/*']
}

/** Portable builder settings consumed by the CLI and source tests. */
declare const config: {
  readonly extraMetadata: { readonly version: string }
  readonly extraResources: readonly DesktopPortableResource[]
  readonly files: readonly string[]
  readonly mac: { readonly icon: string; readonly signIgnore: readonly string[] }
  readonly win: { readonly icon: string }
  readonly asarUnpack: readonly string[]
  afterPack(context: AfterPackContext): Promise<void>
}

export default config
