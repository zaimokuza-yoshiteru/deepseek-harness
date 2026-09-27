import { readFileSync } from 'node:fs'
import { createContext, runInContext } from 'node:vm'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

const harnessRoot = process.env.DSH_HARNESS_ROOT
if (!harnessRoot) throw new Error('Set DSH_HARNESS_ROOT to the built DeepSeek Harness checkout to run integration tests.')
const { default: Loader } = await import(pathToFileURL(resolve(harnessRoot, 'vendor/loader/lib/index.js')).href)

describe('panel plugin loader export contract', () => {
  it('keeps named apply and inject after the real Loader export normalization', () => {
    const panelPath = resolve(dirname(fileURLToPath(import.meta.url)), '../src/panel.ts')
    const panelSource = readFileSync(panelPath, 'utf8')
    const compiled = ts.transpile(panelSource, { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS })
    const moduleExports: Record<string, unknown> = {}
    const sandbox = {
      exports: moduleExports,
      require(specifier: string) {
        if (specifier === 'react') return { createElement: () => null }
        if (specifier === '@deepseek-ai/dsh-client-ui-primitives') return { Button: () => null }
        throw new Error(`unexpected runtime import: ${specifier}`)
      },
    }
    runInContext(compiled, createContext(sandbox))

    const loaded = Loader.prototype.unwrapExports.call({}, moduleExports) as {
      apply?: unknown; inject?: unknown; default?: unknown
    }
    expect(loaded.inject).toEqual(['slots', 'locale'])
    expect(loaded.apply).toBeTypeOf('function')
    expect(loaded.default).toBeUndefined()
  })
})
