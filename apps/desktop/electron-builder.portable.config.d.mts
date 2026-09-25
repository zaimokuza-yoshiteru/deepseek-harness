/** Portable builder settings consumed by the CLI and source tests. */
import type { BeforePackContext } from 'app-builder-lib'

declare const config: {
  readonly extraMetadata: { readonly version: string }
  readonly extraResources: readonly { readonly from: string; readonly to: string; readonly filter?: readonly string[] }[]
  readonly mac: { readonly icon: string }
  readonly win: { readonly icon: string }
  readonly asarUnpack: readonly string[]
  /** Include standalone Office dependencies and target-native executables outside ASAR. */
  beforePack(context: BeforePackContext): Promise<void>
}

export default config
