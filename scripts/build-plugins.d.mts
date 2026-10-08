/** One verified local plugin archive produced from a source package. */
export interface BuiltPluginRecord {
  readonly name: string
  readonly version: string
  readonly source: string
  readonly sourceSha256: string
  readonly asset: string
  readonly sha256: string
}

/** Bundle fields required by the Desktop release archive verifier. */
export interface PluginBundleManifest {
  readonly name: string
  readonly version: string
  readonly files: readonly string[]
  readonly main?: string
  readonly icon?: string
  readonly exports?: Readonly<Record<string, unknown>>
  readonly dsh: { readonly bundle: { readonly patch: string } }
}

/** Output directory for release plugin archives. */
export const PLUGIN_OUTPUT: string

/** Hash every relevant source file in a plugin directory in stable path order. */
export function sourceDigest(directory: string): string

/** Validate archive members and identity against the release source manifest. */
export function verifyPluginArchive(
  archive: string,
  expected: Pick<PluginBundleManifest, 'name' | 'version'>,
): Promise<PluginBundleManifest>

/** Build and verify the configured release plugin archives. */
export function buildPlugins(options?: {
  readonly install?: boolean
  readonly test?: boolean
  readonly desktopOnly?: boolean
}): Promise<readonly BuiltPluginRecord[]>
