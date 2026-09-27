import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DSH_SOURCE_VERSION } from './dsh-target.mjs';
import { WorkspaceTypertGenerator } from '@deepseek-ai/dsh-typert-generator';

const checkMode = process.argv.includes('--check');
const PACKAGE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const LIB_DIR = join(PACKAGE_DIR, 'lib');
const SRC_DIR = join(PACKAGE_DIR, 'src');
const STAGE_DIR = join(PACKAGE_DIR, '.local/typert');
const PROTOCOL_FACADE = join(PACKAGE_DIR, 'scripts/typert-protocol-facade.d.ts');

// The generator's `generate(packages)` filter and the emitted manifest.package /
// method-id prefixes all derive from the staged package.json `name` — read the
// real manifest once so a rename never drifts. The
// staging directory below uses a synthetic package-shaped root for analysis;
// its name does not affect the published plugin package.
const REAL_PKG = JSON.parse(readFileSync(join(PACKAGE_DIR, 'package.json'), 'utf8'));
const PACKAGE_NAME = REAL_PKG.name;

// Entry point whose relative-import closure is staged for analysis.
const ENTRY_POINTS = ['remote/service.ts'];

const IMPORT_FROM_RE = /^\s*(?:import|export)\s+(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]/gm;
const DYNAMIC_IMPORT_RE = /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

/**
 * Transitive relative-import closure of `entries` under src/. Imports that
 * leave src/ (../../lib/… in client/index.ts) and unresolved extensions
 * (./x.module.css, covered by the ambient d.ts) are skipped.
 */
function relativeImportClosure(entries) {
  const seen = new Set();
  const queue = [...entries];
  while (queue.length > 0) {
    const rel = queue.pop();
    if (seen.has(rel)) continue;
    seen.add(rel);
    const abs = join(SRC_DIR, rel);
    if (!existsSync(abs)) continue;
    const text = readFileSync(abs, 'utf8');
    for (const re of [IMPORT_FROM_RE, DYNAMIC_IMPORT_RE]) {
      re.lastIndex = 0;
      for (let match = re.exec(text); match !== null; match = re.exec(text)) {
        const spec = match[1];
        if (!spec.startsWith('.')) continue;
        let target = join(dirname(rel), spec);
        if (target.startsWith('..')) continue; // escapes src/ — not staged
        if (!/\.[cm]?[tj]s$/.test(target)) target += '.ts';
        if (!seen.has(target)) queue.push(target);
      }
    }
  }
  return [...seen].filter((rel) => existsSync(join(SRC_DIR, rel)));
}

/** Shared compilerOptions, mirroring the staged workspace tsconfigs. */
const TS_COMPILER_OPTIONS = {
  target: 'ES2024',
  module: 'NodeNext',
  moduleResolution: 'NodeNext',
  strict: true,
  noUncheckedIndexedAccess: true,
  exactOptionalPropertyTypes: true,
  noImplicitOverride: true,
  skipLibCheck: true,
  types: ['node'],
};

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function stage() {
  rmSync(STAGE_DIR, { recursive: true, force: true });

  // packages/typert-protocol — minimal analyzer facade (protocol facade).
  const protocolRoot = join(STAGE_DIR, 'packages', 'typert-protocol');
  mkdirSync(join(protocolRoot, 'src'), { recursive: true });
  cpSync(PROTOCOL_FACADE, join(protocolRoot, 'src', 'index.d.ts'));
  writeJson(join(protocolRoot, 'package.json'), {
    name: '@deepseek-ai/dsh-typert-protocol',
    version: DSH_SOURCE_VERSION,
    private: true,
    type: 'module',
  });
  writeJson(join(protocolRoot, 'tsconfig.json'), {
    compilerOptions: {
      ...TS_COMPILER_OPTIONS,
      composite: true,
      declaration: true,
      outDir: 'lib/types',
      emitDeclarationOnly: true,
    },
    include: ['src'],
  });

  // Narrow exports to the client type entry and add a temporary host service entry so the generator discovers the remote face.
  const staged = join(STAGE_DIR, 'packages', 'dsh-atlassian-kanban');
  mkdirSync(staged, { recursive: true });
  writeJson(join(staged, 'package.json'), {
    ...REAL_PKG,
    exports: {
      './client': REAL_PKG.exports['./client'],
      './service': {
        types: './lib/types/remote/service.d.ts',
        default: './lib/remote/service.js',
      },
      './typert': REAL_PKG.exports['./typert'],
      './remote': REAL_PKG.exports['./remote'],
      './package.json': './package.json',
    },
  });
  writeJson(join(staged, 'tsconfig.json'), {
    compilerOptions: {
      ...TS_COMPILER_OPTIONS,
      composite: true,
      declaration: true,
      rootDir: 'src',
      outDir: 'lib/types',
      allowImportingTsExtensions: true,
      emitDeclarationOnly: true,
      paths: {
        '@deepseek-ai/dsh-typert-protocol': ['../typert-protocol/src/index.d.ts'],
      },
    },
    include: ['src'],
  });
  for (const rel of relativeImportClosure(ENTRY_POINTS)) {
    const dest = join(staged, 'src', rel.split('/').join(sep));
    mkdirSync(dirname(dest), { recursive: true });
    cpSync(join(SRC_DIR, rel), dest);
  }
  // Use a minimal client type entry so generation stays independent of the UI bundle.
  mkdirSync(join(staged, 'src', 'client'), { recursive: true });
  writeFileSync(
    join(staged, 'src', 'client', 'index.ts'),
    "export type * from '../shared/config.ts'\nexport type * from '../shared/remote.ts'\n",
  );

  // Aggregate TypeScript project for Typert analysis.
  writeJson(join(STAGE_DIR, 'tsconfig.host.json'), {
    compilerOptions: {
      ...TS_COMPILER_OPTIONS,
      composite: false,
      noEmit: true,
      allowImportingTsExtensions: true,
      paths: {
        '@deepseek-ai/dsh-typert-protocol': ['packages/typert-protocol/src/index.d.ts'],
      },
    },
    files: [],
    references: [{ path: 'packages/dsh-atlassian-kanban' }, { path: 'packages/typert-protocol' }],
  });
}

function main() {
  stage();

  const generator = new WorkspaceTypertGenerator(STAGE_DIR);
  const artifacts = generator.generate([PACKAGE_NAME], ['host']);
  const artifact = artifacts.find((a) => a.package === PACKAGE_NAME && a.face === 'host');
  if (artifact === undefined || artifact.remote === undefined) {
    throw new Error(
      `typert generation produced no host+remote artifact for ${PACKAGE_NAME} (got: ${JSON.stringify(
        artifacts.map((a) => ({ package: a.package, face: a.face, remote: a.remote !== undefined })),
      )})`,
    );
  }

  const emitted = {
    'typert.host.js': artifact.js,
    'typert.host.d.ts': artifact.dts,
    'typert.remote-client.js': artifact.remote.js,
    'typert.remote-client.d.ts': artifact.remote.dts,
    'typert.remote-client.d.ts.map': artifact.remote.dtsMap,
  };

  if (checkMode) {
    for (const [name, content] of Object.entries(emitted)) {
      const shipped = join(LIB_DIR, name);
      if (!existsSync(shipped) || readFileSync(shipped, 'utf8') !== content) {
        throw new Error(
          `lib/${name} is missing or stale — run \`node scripts/gen-typert.mjs\` and rebuild.`,
        );
      }
    }
    console.log('gen-typert: lib/ typert artifacts are up to date.');
    return;
  }

  mkdirSync(LIB_DIR, { recursive: true });
  for (const [name, content] of Object.entries(emitted)) {
    writeFileSync(join(LIB_DIR, name), content);
  }
  console.log(`gen-typert: wrote ${Object.keys(emitted).length} artifacts to lib/`);
}

main();
