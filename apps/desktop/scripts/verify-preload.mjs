/** Execute built preloads with the Electron sandbox's restricted module loader. */
import { readFileSync } from 'node:fs'
import { Script } from 'node:vm'
import assert from 'node:assert/strict'

for (const name of ['preload-app', 'preload']) {
  let exposed
  const calls = []
  const electron = {
    contextBridge: { exposeInMainWorld: (key, value) => { assert.equal(key, 'dshDesktop'); exposed = value } },
    ipcRenderer: { invoke: async (...args) => { calls.push(args) }, on() {}, off() {} },
  }
  const source = readFileSync(new URL(`../lib/${name}.cjs`, import.meta.url), 'utf8')
  new Script(source, { filename: `${name}.cjs` }).runInNewContext({ require: id => {
    assert.equal(id, 'electron', 'Sandboxed preload cannot require a local chunk')
    return electron
  } })
  if (name === 'preload-app') {
    assert.deepEqual(Object.keys(exposed), ['protocolVersion', 'experiments'])
    assert.equal(exposed.experiments.version, 1)
    await exposed.experiments.list()
    const change = { profile: '/owned', id: 'agent-teams', expectedEnabled: true, enabled: false }
    await exposed.experiments.setEnabled(change)
    assert.deepEqual(calls, [['dsh-desktop:experiments-list'], ['dsh-desktop:experiments-set', change]])
  } else {
    assert.deepEqual(Object.keys(exposed), ['protocolVersion', 'locale', 'plugins', 'updates'])
  }
}
console.log('Built preloads are self-contained and expose only their window-specific capabilities.')
