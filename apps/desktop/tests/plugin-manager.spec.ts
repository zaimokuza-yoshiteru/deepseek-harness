import { readFileSync } from 'node:fs'
import { Script } from 'node:vm'
import { JSDOM } from 'jsdom'
import { describe, expect, it } from 'vitest'
import { resolveDesktopLocale } from '../src/locale.ts'

const html = readFileSync(new URL('../renderer/plugin-manager.html', import.meta.url), 'utf8')
const source = readFileSync(new URL('../renderer/plugin-manager.js', import.meta.url), 'utf8')

describe('Agent Teams switch in the plugin manager', () => {
  it.each(['en', 'zh-CN'])('renders saved state and restores the switch after a busy refusal: %s', async (language) => {
    const dom = new JSDOM(html, { runScripts: 'outside-only' })
    try {
      const locale = resolveDesktopLocale(language)
      let enabled = false
      let busy = false
      const changes: boolean[] = []
      Object.assign(dom.window, { dshDesktop: {
        locale: async () => locale,
        plugins: { list: async () => [{ name: '@zaimokuza/dsh-acp-adapter', version: '0.1.5-rc.2.1' }] },
        agentTeams: {
          enabled: async () => enabled,
          setEnabled: async (next: boolean) => {
            if (busy) throw new dom.window.Error(locale.messages.featureTasksRunning)
            changes.push(next)
            enabled = next
          },
        },
      } })
      await (new Script(source.replace('void main()', 'main()')).runInContext(dom.getInternalVMContext()) as Promise<void>)
      const document = dom.window.document
      const toggle = document.querySelector<HTMLInputElement>('#agent-teams')!
      const status = document.querySelector('#status')!
      const expected = JSON.parse(readFileSync(new URL(`./expected/teams-switch-${language}.json`, import.meta.url), 'utf8')) as unknown
      expect({
        heading: document.querySelector('#features-heading')!.textContent,
        label: document.querySelector('#agent-teams-label')!.textContent,
        description: document.querySelector('#agent-teams-description')!.textContent,
        role: toggle.getAttribute('role'),
        checked: toggle.checked,
      }).toEqual(expected)

      for (const next of [true, false]) {
        toggle.checked = next
        toggle.dispatchEvent(new dom.window.Event('change'))
        expect(toggle.disabled).toBe(true)
        await expect.poll(() => toggle.disabled).toBe(false)
        expect(toggle.checked).toBe(next)
        expect(status.textContent).toBe(locale.messages.operationComplete)
      }
      expect(changes).toEqual([true, false])
      busy = true
      toggle.checked = true
      toggle.dispatchEvent(new dom.window.Event('change'))
      await expect.poll(() => toggle.disabled).toBe(false)
      expect(toggle.checked).toBe(false)
      expect(status.textContent).toBe(locale.messages.featureTasksRunning)
      expect(changes).toEqual([true, false])
    } finally {
      dom.window.close()
    }
  })
})
