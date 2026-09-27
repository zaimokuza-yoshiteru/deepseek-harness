interface PackedArchive { name: string; version: string; filename: string; files: { path: string }[] }
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { runInNewContext } from 'node:vm';

const root = fileURLToPath(new URL('../', import.meta.url));
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const dist = join(root, 'dist');
mkdirSync(dist, { recursive: true });
execFileSync(npm, ['run', 'build'], { cwd: root, stdio: 'inherit' });
const [packed]: PackedArchive[] = JSON.parse(execFileSync(npm, ['pack', '--ignore-scripts', '--json', '--pack-destination', dist], { cwd: root, encoding: 'utf8' }));
assert.equal(packed.name, manifest.name);
assert.equal(packed.version, manifest.version);
const files = packed.files.map(file => file.path).sort();
const expected = [
  'LICENSE', 'THIRD_PARTY_NOTICES.md', 'cordis.patch.yml', 'icon.svg',
  'lib/THIRD_PARTY_LICENSES.txt', 'lib/client.js', 'package.json',
  'lib/host.js',
  'vendor/munder/LICENSE', 'vendor/the-office/LICENSE', 'vendor/three/LICENSE',
].sort();
assert.deepEqual(files, expected, 'Review any change to the published file list');

const privateRoot = join(root, '.local/private/release');
mkdirSync(privateRoot, { recursive: true });
const fixture = mkdtempSync(join(privateRoot, 'install-'));
try {
  writeFileSync(join(fixture, 'package.json'), '{"private":true,"type":"module"}\n');
  execFileSync(npm, ['install', join(dist, packed.filename), '--offline', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: fixture, stdio: 'pipe' });
  const installed = join(fixture, 'node_modules', manifest.name);
  const installedManifest = JSON.parse(readFileSync(join(installed, 'package.json'), 'utf8'));
  assert.equal(installedManifest.icon, './icon.svg');
  assert.deepEqual(readFileSync(join(installed, installedManifest.icon)), readFileSync(join(root, 'icon.svg')));
  const host = await import(pathToFileURL(join(installed, 'lib/host.js')).href);
  assert.equal(host.name, 'dsh-agent-teams-office');
  assert.equal(typeof host.apply, 'function');
  let module: { id: string; factory: unknown } | undefined;
  const bundle = readFileSync(join(installed, 'lib/client.js'), 'utf8');
  runInNewContext(bundle, { window: { __ModuleLoader__: { load: (value: { id: string; factory: unknown }) => { module = value; } } } });
  assert.ok(module);
  assert.equal(module.id, manifest.name);
  assert.equal(typeof module.factory, 'function');
  assert.ok(!bundle.includes('sourceMappingURL='), 'Do not ship development source maps');
  assert.ok(!bundle.includes(root) && !bundle.includes(homedir()), 'Do not embed local filesystem paths');
  const hostBundle = readFileSync(join(installed, 'lib/host.js'), 'utf8');
  assert.ok(!hostBundle.includes(root) && !hostBundle.includes(homedir()), 'Do not embed local paths in host output');
  assert.ok(!hostBundle.includes('@deepseek-ai/'), 'Host SDK imports must remain type-only');
  const licenses = readFileSync(join(installed, 'lib/THIRD_PARTY_LICENSES.txt'), 'utf8');
  assert.ok(licenses.includes('three@') && licenses.includes('pixi.js@'));
} finally {
  rmSync(fixture, { recursive: true, force: true });
}
writeFileSync(join(dist, 'manifest.json'), JSON.stringify(packed, null, 2) + '\n');
const sha256 = createHash('sha256').update(readFileSync(join(dist, packed.filename))).digest('hex');
writeFileSync(join(dist, 'SHA256SUMS'), `${sha256}  ${packed.filename}\n`);
console.log(`Verified ${packed.filename}: ${files.length} files; offline installation, host import and client registration passed.`);
