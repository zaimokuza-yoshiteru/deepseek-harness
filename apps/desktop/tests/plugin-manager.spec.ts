import { readFileSync } from 'node:fs'
import { Script } from 'node:vm'
import { JSDOM } from 'jsdom'
import { describe, expect, it } from 'vitest'
import { resolveDesktopLocale } from '../src/locale.ts'

const html = readFileSync(new URL('../renderer/plugin-manager.html', import.meta.url), 'utf8')
const source = readFileSync(new URL('../renderer/plugin-manager.js', import.meta.url), 'utf8')

describe('native plugin manager delegates experiment controls to Hub', () => {
  it.each(['en', 'zh-CN'])('retains package management without requesting experiment privileges: %s', async (language) => {
    const dom = new JSDOM(html, { runScripts: 'outside-only' })
    try {
      const locale = resolveDesktopLocale(language)
      const removed: string[] = []
      Object.assign(dom.window, { dshDesktop: {
        locale: async () => locale,
        plugins: {
          list: async () => [{ name: '@zaimokuza/dsh-plugin-hub', version: '0.2.1' }],
          remove: async (name: string) => { removed.push(name) },
        },
      } })
      await (new Script(source.replace('void main()', 'main()')).runInContext(dom.getInternalVMContext()) as Promise<void>)
      const document = dom.window.document
      expect({
        heading: document.querySelector('#title')!.textContent,
        description: document.querySelector('#description')!.textContent,
        buttons: [...document.querySelectorAll('button')].map(button => button.textContent),
        experimentSwitches: document.querySelectorAll('[role="switch"]').length,
      }).toEqual(JSON.parse(readFileSync(new URL(`./expected/plugin-manager-${language}.json`, import.meta.url), 'utf8')))
      expect(document.querySelector('#agent-teams')).toBeNull()
      const remove = [...document.querySelectorAll('button')].find(button => button.textContent === locale.messages.remove)!
      remove.click()
      await expect.poll(() => document.querySelector('#status')!.textContent).toBe(locale.messages.operationComplete)
      expect(removed).toEqual(['@zaimokuza/dsh-plugin-hub'])
    } finally {
      dom.window.close()
    }
  })
})
