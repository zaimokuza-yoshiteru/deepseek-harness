import { describe, expect, it, vi } from 'vitest'
import { DesktopExperiments, type DesktopExperimentChange, type DesktopExperimentOwner } from '../src/experiments.ts'

function fixture(overrides: Partial<DesktopExperimentOwner> = {}) {
  let enabled = true
  let busy = false
  const owner: DesktopExperimentOwner = {
    profile: '/owned/desktop', supported: true, enabled: () => enabled,
    busy: () => busy, setBusy: (value) => { busy = value },
    stopIfIdle: vi.fn(async () => true),
    change: vi.fn(async (value: boolean) => { enabled = value }),
    recover: vi.fn(async () => {}), ...overrides,
  }
  const controller = new DesktopExperiments(owner)
  const change: DesktopExperimentChange = { profile: owner.profile, id: 'agent-teams', expectedEnabled: true, enabled: false }
  return { owner, controller, change }
}

describe('Desktop experimental feature transactions', () => {
  it('reports separate configured/running states and acknowledges only after recovery', async () => {
    const { owner, controller, change } = fixture()
    let finish!: () => void
    owner.recover = vi.fn(() => new Promise<void>((resolve) => { finish = resolve }))
    const operation = controller.setEnabled(change)
    await vi.waitFor(() =>{  expect(owner.recover).toHaveBeenCalledOnce() })
    expect(controller.snapshot().features[0]).toEqual({ id: 'agent-teams', enabled: false, activeEnabled: null, installed: true, canToggle: true, busy: true })
    finish()
    expect(await operation).toEqual({ ok: true, value: { profile: owner.profile, features: [{ id: 'agent-teams', enabled: false, activeEnabled: false, installed: true, canToggle: true, busy: false }] }, reloadRequired: true })
    expect(await controller.setEnabled({ ...change, expectedEnabled: false })).toMatchObject({ ok: true, reloadRequired: false })
    expect(owner.change).toHaveBeenCalledOnce()
  })

  it('rejects unknown features, malformed requests and another profile before side effects', async () => {
    const { owner, controller, change } = fixture()
    for (const input of [null, [], {}, { ...change, id: 'arbitrary-plugin' }, { ...change, enabled: 'yes' }, { ...change, expectedEnabled: undefined }]) {
      expect(await controller.setEnabled(input)).toMatchObject({ ok: false, error: { code: 'invalid-request' } })
    }
    expect(await controller.setEnabled({ ...change, profile: '/another/profile' })).toMatchObject({ ok: false, error: { code: 'profile-changed' } })
    expect(owner.stopIfIdle).not.toHaveBeenCalled()
  })

  it('refuses stale state, an occupied shared transaction lock and running tasks', async () => {
    const { owner, controller, change } = fixture({ stopIfIdle: vi.fn(async () => false) })
    expect(await controller.setEnabled({ ...change, expectedEnabled: false })).toMatchObject({ ok: false, error: { code: 'state-changed' } })
    owner.setBusy(true)
    expect(await controller.setEnabled(change)).toMatchObject({ ok: false, error: { code: 'busy' } })
    owner.setBusy(false)
    expect(await controller.setEnabled(change)).toMatchObject({ ok: false, error: { code: 'tasks-running' } })
    expect(owner.change).not.toHaveBeenCalled()
    expect(owner.recover).not.toHaveBeenCalled()
    expect(owner.busy()).toBe(false)
    expect(controller.snapshot().features[0]?.activeEnabled).toBe(true)
  })

  it('holds the shared lock while waiting for the host to stop', async () => {
    let stop!: (value: boolean) => void
    const { owner, controller, change } = fixture({ stopIfIdle: () => new Promise((resolve) => { stop = resolve }) })
    const operation = controller.setEnabled(change)
    expect(await controller.setEnabled(change)).toMatchObject({ ok: false, error: { code: 'busy' } })
    stop(true)
    expect(await operation).toMatchObject({ ok: true })
    expect(owner.busy()).toBe(false)
  })

  it('recovers the rolled-back profile after transaction failure without requesting reload', async () => {
    const { owner, controller, change } = fixture({ change: async () => { throw new Error('staged health check failed') } })
    expect(await controller.setEnabled(change)).toMatchObject({ ok: false, error: { code: 'failed', message: 'staged health check failed' } })
    expect(owner.recover).toHaveBeenCalledOnce()
    expect(controller.snapshot().features[0]).toMatchObject({ enabled: true, activeEnabled: true, busy: false })
  })

  it('keeps runtime unknown when backend recovery fails and permits an explicit retry', async () => {
    const { owner, controller, change } = fixture({ recover: async () => { throw new Error('backend unavailable') } })
    expect(await controller.setEnabled(change)).toMatchObject({ ok: false, error: { code: 'failed' } })
    expect(controller.snapshot().features[0]).toMatchObject({ enabled: false, activeEnabled: null, busy: false })
    owner.recover = async () => {}
    expect(await controller.setEnabled({ ...change, expectedEnabled: false })).toMatchObject({ ok: true, reloadRequired: true })
  })

  it('does not advertise feature management in unsupported releases or source development mode', async () => {
    const { owner, controller, change } = fixture({ supported: false })
    expect(controller.snapshot()).toEqual({ profile: owner.profile, features: [] })
    expect(await controller.setEnabled(change)).toMatchObject({ ok: false, error: { code: 'unsupported' } })
    expect(owner.stopIfIdle).not.toHaveBeenCalled()
  })
})
