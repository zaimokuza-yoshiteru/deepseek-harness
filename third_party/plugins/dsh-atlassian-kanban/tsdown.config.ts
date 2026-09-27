import { readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { basename, dirname, relative, resolve as resolvePath } from 'node:path'
import { transform } from 'lightningcss'
import { defineConfig } from 'tsdown'

const manifest = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { name: string; dsh?: { client?: { external?: unknown } } }
const platformExternals = [
  'react', 'react/jsx-runtime', 'react-dom', 'react-dom/client',
  '@deepseek-ai/cordis', '@deepseek-ai/dsh-client-store', '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives', '@deepseek-ai/dsh-client-ui-dockkit',
]
const external = new Set([
  ...platformExternals,
  ...(Array.isArray(manifest.dsh?.client?.external) ? manifest.dsh.client.external.filter((x): x is string => typeof x === 'string') : []),
])
const packageRoot = resolvePath('.')
const cssPrefix = '\0kanban-css:'
const cssSuffix = ':inline'

function cssModule(source: string, id: string): string {
  const tagId = `${manifest.name}/${basename(id)}`
  return [
    `const css=${JSON.stringify(source)};`,
    `const tagId=${JSON.stringify(tagId)};`,
    `if(typeof document!=='undefined'){let tag=document.querySelector('style[data-plugin-css='+JSON.stringify(tagId)+']');if(!tag){tag=document.createElement('style');tag.dataset.plugin=${JSON.stringify(manifest.name)};tag.dataset.pluginCss=tagId;document.head.appendChild(tag);}tag.textContent=css;}`,
  ].join('\n')
}

export default defineConfig([{
  // Feed the TypeScript-emitted JS to Rolldown so legacy DSH decorators are lowered by tsc first.
  entry: { host: 'lib/index.js' }, outDir: 'lib', format: 'esm', platform: 'node', dts: false, clean: false,
  deps: { neverBundle: id => /^@deepseek-ai\/(cordis|dsh-agent|dsh-tools|dsh-typert-protocol)(\/|$)/.test(id), alwaysBundle: [/./] },
  outputOptions: { entryFileNames: 'host.js', inlineDynamicImports: true },
}, {
  entry: { client: 'src/client/index.ts' }, outDir: 'lib', format: 'cjs', platform: 'browser', dts: false, clean: false, sourcemap: false,
  deps: { neverBundle: id => external.has(id), alwaysBundle: id => !external.has(id) },
  define: { 'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'), 'import.meta.env.MODE': JSON.stringify(process.env.NODE_ENV ?? 'production'), 'import.meta.env': JSON.stringify({ MODE: process.env.NODE_ENV ?? 'production' }) },
  plugins: [{
    name: 'atlassian-kanban-css-modules',
    resolveId(source, importer) {
      if (!source.endsWith('.module.css')) return null
      return cssPrefix + relative(packageRoot, importer ? resolvePath(dirname(importer), source) : resolvePath(source)).replaceAll('\\', '/') + cssSuffix
    },
    async load(id) {
      if (!id.startsWith(cssPrefix)) return null
      const relativeFile = id.slice(cssPrefix.length, -cssSuffix.length)
      const file = resolvePath(packageRoot, relativeFile)
      this.addWatchFile(file)
      const result = transform({ filename: relativeFile, code: await readFile(file), cssModules: { pattern: '[hash]_[local]' }, minify: true })
      const classes: Record<string, string> = {}
      for (const [key, value] of Object.entries(result.exports ?? {})) classes[key] = value.name
      return `${cssModule(result.code.toString(), file)}\nexport default ${JSON.stringify(classes)};`
    },
  }],
  outputOptions: {
    entryFileNames: 'client.js',
    banner: `window.__ModuleLoader__.load({id:${JSON.stringify(manifest.name)},factory:(require)=>{var module={exports:{}};var exports=module.exports;`,
    footer: 'return module.exports;}});',
  },
}])
