import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const repo = process.env.DSH_DESKTOP_REPO;
if (!repo) throw new Error('DSH_DESKTOP_REPO is required');
const require = createRequire(join(repo, 'package.json'));
const dependencies = createRequire(join(repo, 'node_modules/.pnpm/node_modules/package.json'));
const ts: typeof import('typescript') = require('typescript');
const { defineConfig }: typeof import('vitest/config') = await import(pathToFileURL(require.resolve('vitest/config')).href);
const config = ts.readConfigFile(join(repo, 'tsconfig.base.json'), ts.sys.readFile);
if (config.error) throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, '\n'));
const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, repo);
const alias = Object.entries(parsed.options.paths ?? {}).map(([name, [target]]) => ({
  find: new RegExp('^' + name.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace('*', '(.*)') + '$'),
  replacement: resolve(repo, target).replace('*', '$1'),
}));
for (const name of ['react', 'react/jsx-runtime', 'react/jsx-dev-runtime', 'react-dom', 'react-dom/client', 'react-dom/test-utils', '@testing-library/react']) {
  alias.push({ find: new RegExp('^' + name + '$'), replacement: dependencies.resolve(name) });
}
alias.push({ find: /^vitest$/, replacement: join(repo, 'node_modules/vitest/dist/index.js') });
export default defineConfig({
  resolve: { alias },
  oxc: { jsx: { runtime: 'automatic' } },
  plugins: [{ name: 'dsh-decorators', enforce: 'pre', transform(code, id) {
    if (!/\.[cm]?tsx?$/.test(id) || !/^\s*@[A-Za-z_$]/m.test(code)) return;
    const result = ts.transpileModule(code, { fileName: id, compilerOptions: { target: ts.ScriptTarget.ES2024, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX } });
    return { code: result.outputText, map: null };
  } }],
  test: { include: ['test/client.integration.spec.tsx'], environment: 'jsdom',
    execArgv: process.allowedNodeEnvironmentFlags.has('--webstorage') ? ['--no-webstorage'] : [],
    testTimeout: 15000 },
});
