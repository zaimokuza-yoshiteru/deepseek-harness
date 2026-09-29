import ts from 'typescript'
import { fileURLToPath } from 'node:url'
import type { Plugin } from 'vitest/config'

// Match the production tsc lowering for standard @Remote decorators, which the
// default Vitest transform otherwise leaves for Node (where they cannot run).
export function remoteTransform(): Plugin {
  const remoteSource = fileURLToPath(new URL('../src/remote/service.ts', import.meta.url)).replaceAll('\\', '/')
  return {
    name: 'kanban-test-remote-decorators',
    enforce: 'pre',
    transform(code, id) {
      if (id !== remoteSource) return
      return ts.transpileModule(code, {
        compilerOptions: { target: ts.ScriptTarget.ES2024, module: ts.ModuleKind.ESNext },
        fileName: id,
      }).outputText
    },
  }
}
