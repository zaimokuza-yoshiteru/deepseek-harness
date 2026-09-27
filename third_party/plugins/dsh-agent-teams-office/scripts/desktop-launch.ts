/** Build a disposable application view of the desktop checkout without editing it. */
import { existsSync, mkdirSync, readFileSync, writeFileSync, symlinkSync, lstatSync, unlinkSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve, join, dirname } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const plugin = resolve(fileURLToPath(new URL('..', import.meta.url)));
const repository = process.env.DSH_DESKTOP_REPO!;
const desktop = join(repository, 'apps/desktop');
const local = resolve(process.env.DSH_OFFICE_LOCAL_DIR ?? join(plugin, '.local'));
const shell = join(local, 'desktop-shell');
const project = join(shell, '.desktop-build/development/project');
const read = (path: string) => JSON.parse(readFileSync(path, 'utf8'));
const link = (source: string, target: string) => {
  mkdirSync(dirname(target), { recursive: true });
  try { if (lstatSync(target).isSymbolicLink()) unlinkSync(target); else throw new Error(`Refusing to replace ${target}`); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  symlinkSync(source, target, process.platform === 'win32' ? 'junction' : 'dir');
};
for (const artifact of [join(desktop, 'lib/main.js'), join(repository, 'apps/desktop-host/lib/index.js'), join(plugin, 'lib/client.js')]) {
  if (!existsSync(artifact)) throw new Error(`Missing ${artifact}. Build the plugin and desktop checkout first.`);
}
const { prepareDevelopmentProject } = await import(pathToFileURL(join(desktop, 'scripts/development-project.ts')).href);
const { DESKTOP_HOST_PROTOCOL_VERSION } = await import(pathToFileURL(join(desktop, 'src/host-protocol.ts')).href);
const appManifest = read(join(desktop, 'package.json'));
const requireDesktop = createRequire(join(desktop, 'package.json'));
prepareDevelopmentProject({
  projectDir: project, cliDir: join(repository, 'apps/cli'), hostDir: join(repository, 'apps/desktop-host'),
  dependencyDir: join(repository, 'node_modules/.pnpm/node_modules'),
  release: { schemaVersion: 1, version: appManifest.version, hostProtocolVersion: DESKTOP_HOST_PROTOCOL_VERSION,
    nodeVersion: process.versions.node, pnpmVersion: read(join(desktop, 'node_modules/pnpm/package.json')).version },
});
const manifest = read(join(project, 'package.json'));
manifest.dsh.profile.bundles.push('@deepseek-ai/dsh-experimental-agent-team-profile', '@deepseek-ai/dsh-experimental-agent-team-web-profile');
const plugins = [plugin];
if (process.argv.includes('--acp')) plugins.push(resolve(plugin, '../dsh-acp-adapter'));
for (const directory of plugins) {
  const entry = read(join(directory, 'package.json'));
  if (!existsSync(join(directory, entry.main))) throw new Error(`Build ${entry.name} before launching`);
  manifest.dependencies[entry.name] = entry.version;
  manifest.dsh.profile.bundles.push(entry.name);
  link(directory, join(project, 'node_modules', entry.name));
}
writeFileSync(join(project, 'package.json'), JSON.stringify(manifest, null, 2) + '\n');
// Desktop reads extension bundles from its user profile, independently of the application project.
const profile = join(local, 'desktop-home/profiles/desktop');
mkdirSync(profile, { recursive: true });
const profileFile = join(profile, 'package.json');
const profileManifest = existsSync(profileFile) ? read(profileFile) : {
  name: 'dsh-profile-desktop', private: true, dependencies: {}, dsh: { profile: { bundles: [] } },
};
profileManifest.dependencies ??= {};
profileManifest.dsh ??= {};
profileManifest.dsh.profile ??= {};
profileManifest.dsh.profile.bundles = [...new Set([
  ...(profileManifest.dsh.profile.bundles ?? []), ...manifest.dsh.profile.bundles,
])];
for (const name of manifest.dsh.profile.bundles as string[]) {
  if (name === '@deepseek-ai/dsh-base' || name === '@deepseek-ai/dsh-web-app') continue;
  const directory = join(project, 'node_modules', name);
  profileManifest.dependencies[name] = read(join(directory, 'package.json')).version;
  link(directory, join(profile, 'node_modules', name));
}
writeFileSync(profileFile, JSON.stringify(profileManifest, null, 2) + '\n');
for (const file of ['cordis.yml', 'cordis.patch.yml']) {
  if (!existsSync(join(profile, file))) writeFileSync(join(profile, file), '[]\n');
}
writeFileSync(join(shell, 'package.json'), JSON.stringify({ ...appManifest, name: 'dsh-agent-teams-office-preview', productName: 'DSH Agent Teams Office Preview' }, null, 2) + '\n');
for (const directory of ['lib', 'renderer', 'node_modules']) link(join(desktop, directory), join(shell, directory));
link(join(desktop, 'scripts'), join(shell, 'scripts'));
// Newer Desktop hosts load Office authoring assets even before a dependency tool is used.
const target = `${process.platform === 'darwin' ? 'mac' : 'win'}-${process.arch}`;
const runtime = join(shell, '.desktop-build/targets', target, 'runtime');
const hostRequire = createRequire(join(repository, 'apps/desktop-host/package.json'));
let officeAssets: string | undefined;
try { officeAssets = join(dirname(hostRequire.resolve('@deepseek-ai/dsh-skill-office/package.json')), 'assets'); }
catch (error) { if ((error as NodeJS.ErrnoException).code !== 'MODULE_NOT_FOUND') throw error; }
if (officeAssets) link(officeAssets, join(runtime, 'office-skills'));
const primaryRuntime = join(desktop, '.desktop-build/targets', target, 'runtime/primary-runtime');
if (existsSync(primaryRuntime)) link(primaryRuntime, join(runtime, 'primary-runtime'));
console.log(`Office plugin: ${plugin}\nDesktop source: ${repository}\nIsolated data: ${join(local, 'desktop-home')}`);
if (process.argv.includes('--prepare-only')) process.exit(0);
const env: NodeJS.ProcessEnv = { ...process.env, DSH_HOME: join(local, 'desktop-home'), DSH_DESKTOP_NODE_BINARY: process.execPath,
  DSH_DESKTOP_DSH_DIR: project, DSH_DESKTOP_OPEN_DEVTOOLS: '0', DSH_DESKTOP_HOST_INSPECT_PORT: '9346' };
// Launch as an Electron app even when invoked from a Node-enabled Electron terminal.
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(requireDesktop('electron'), [
  '--remote-debugging-port=9345', `--user-data-dir=${join(local, 'electron-user-data')}`, shell,
], { cwd: shell, env, stdio: 'inherit' });
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => child.kill(signal));
child.on('error', error => { console.error(error); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });
