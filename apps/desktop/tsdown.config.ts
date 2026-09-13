import { defineConfig } from 'tsdown'

export default defineConfig([
  {
    entry: ['lib/types/main.js'],
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    dts: false,
    clean: false,
    deps: { neverBundle: ['electron'] },
  },
  // Each sandboxed preload must be self-contained: Electron rejects local require() calls.
  ...['preload', 'preload-app'].map(name => ({
    entry: { [name]: `lib/types/${name}.js` },
    outDir: 'lib',
    format: ['cjs' as const],
    platform: 'node' as const,
    target: 'es2024',
    fixedExtension: false,
    dts: false,
    clean: false,
    deps: { neverBundle: ['electron'] },
  })),
])
