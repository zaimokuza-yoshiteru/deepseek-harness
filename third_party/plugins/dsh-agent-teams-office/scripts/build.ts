import { build, type BuildOptions } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { generateArt } from './generate-art.ts';
await generateArt();
const root = fileURLToPath(new URL('../', import.meta.url));
const options = {
  absWorkingDir: root, bundle: true, platform: 'browser', target: 'es2022',
  loader: { '.css': 'text', '.png': 'dataurl', '.tmj': 'text' },
  alias: { '@/design/tokens': root + 'vendor/munder/design/tokens.ts' },
  define: { 'process.env.NODE_ENV': '"production"' },
} satisfies BuildOptions;
const result = await build({ ...options, entryPoints: ['src/client/index.tsx'], outfile: 'lib/client.js', metafile: true,
  format: 'cjs', external: ['react', 'react/jsx-runtime', '@deepseek-ai/dsh-client-ui-primitives'], sourcemap: false,
  banner: { js: 'window.__ModuleLoader__.load({ id: "@zaimokuza/dsh-agent-teams-office", factory: (require) => { var module = { exports: {} }; var exports = module.exports;' },
  footer: { js: 'return module.exports; } });' },
});
await build({ absWorkingDir: root, entryPoints: ['src/host/index.ts'], outfile: 'lib/host.js',
  bundle: true, platform: 'node', target: 'node22', format: 'esm', sourcemap: false });
// Ship the full licenses of the packages actually bundled, including transitive dependencies.
const packages = new Map<string, string>();
for (const input of Object.keys(result.metafile.inputs)) {
  if (!input.startsWith('node_modules/')) continue;
  let directory = dirname(resolve(root, input));
  while (directory !== root && !existsSync(join(directory, 'package.json'))) directory = dirname(directory);
  if (directory === root) throw new Error(`No package metadata for ${input}`);
  const manifest = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'));
  // Nested package.json files can specify module type without naming a package.
  if (!manifest.name) {
    while (directory !== root) {
      directory = dirname(directory);
      if (existsSync(join(directory, 'package.json'))) {
        const parent = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'));
        if (parent.name) { Object.assign(manifest, parent); break; }
      }
    }
  }
  const id = `${manifest.name}@${manifest.version}`;
  if (packages.has(id)) continue;
  const notices = readdirSync(directory).filter(name => /^(licen[cs]e|copying|notice)(\..*)?$/i.test(name)).sort();
  // @pixi/colord 2.9.6 omits its license from npm; retain the upstream text locally.
  // https://github.com/pixijs/colord/blob/master/LICENSE.md (blob e437003733acd123c76c2a9df0c13a6f3b02b51e)
  if (!notices.length && id === '@pixi/colord@2.9.6') {
    packages.set(id, readFileSync(join(root, 'vendor/colord/LICENSE'), 'utf8').trim());
    continue;
  }
  if (!notices.length) throw new Error(`Missing license text for ${id}`);
  packages.set(id, notices.map(name => readFileSync(join(directory, name), 'utf8').trim()).join('\n\n'));
}
writeFileSync(join(root, 'lib/THIRD_PARTY_LICENSES.txt'), [...packages].sort(([a], [b]) => a.localeCompare(b))
  .map(([id, license]) => `${id}\n${'='.repeat(id.length)}\n\n${license}`).join('\n\n') + '\n');
console.log('Built DSH Agent Teams Office client (scene and textures embedded).');
