import { describe, expect, it, vi } from 'vitest'
import type { ConfigValues } from '../../src/client/KanbanSettings.tsx'
import { buildProductSettingsOps, buildRefreshMentionsOp, canRebaseUnchangedDraft, connectionDraftFor, saveSettingsDraft } from '../../src/client/settings-write.ts'

const values: ConfigValues = {
  refreshMentions: false,
  jira: { baseUrl: 'https://jira.example', jql: [{ id: 'assigned', name: 'Assigned', query: 'assignee = currentUser()' }] },
  bitbucket: { baseUrl: '', repositories: [] },
  confluence: { baseUrl: '', cql: [] },
}

describe('Atlassian native settings writes', () => {
  it('persists the mention switch while retaining blank tokens and clearing only explicit credentials', () => {
    const secrets = {
      values: { jira: '', bitbucket: 'new-bitbucket-token', confluence: '' },
      clear: { jira: false, bitbucket: false, confluence: true },
    }
    const ops = [...buildProductSettingsOps('jira', values, secrets), ...buildProductSettingsOps('bitbucket', values, secrets), ...buildProductSettingsOps('confluence', values, secrets)]
    expect(buildRefreshMentionsOp(false)).toEqual([{ op: 'set', path: ['refreshMentions'], value: false }])
    expect(ops).toContainEqual({ op: 'set', path: ['bitbucket', 'bearerToken'], value: 'new-bitbucket-token' })
    expect(ops).toContainEqual({ op: 'set', path: ['confluence', 'bearerToken'], value: '' })
    expect(ops.some(op => op.path.join('.') === 'jira.bearerToken')).toBe(false)
  })

  it('rejects a stale draft without mutating and fences a current draft to its original revision', async () => {
    const mutate = vi.fn(async () => true)
    const form = { mutate }
    const ops = buildProductSettingsOps('jira', values, { values: { jira: '', bitbucket: '', confluence: '' }, clear: { jira: false, bitbucket: false, confluence: false } })

    await expect(saveSettingsDraft(form as never, ops, 7, 8)).resolves.toBe('conflict')
    expect(mutate).not.toHaveBeenCalled()

    await expect(saveSettingsDraft(form as never, ops, 8, 8)).resolves.toBe('saved')
    expect(mutate).toHaveBeenCalledWith(ops, 8)
  })

  it('writes one product without including sibling drafts and immediately persists the mention switch', () => {
    const ops = buildProductSettingsOps('jira', values, {
      values: { jira: 'draft-token', bitbucket: '', confluence: '' },
      clear: { jira: false, bitbucket: false, confluence: false },
    })
    expect(ops.map(op => op.path[0])).toEqual(['jira', 'jira', 'jira'])
    expect(ops).toContainEqual({ op: 'set', path: ['jira', 'bearerToken'], value: 'draft-token' })
    expect(buildRefreshMentionsOp(true)).toEqual([{ op: 'set', path: ['refreshMentions'], value: true }])
  })

  it('rebases only an unchanged sibling draft after exactly one local revision', () => {
    const baseline = JSON.stringify(values.confluence)
    expect(canRebaseUnchangedDraft(8, 9, baseline, values.confluence)).toBe(true)
    expect(canRebaseUnchangedDraft(8, 10, baseline, values.confluence)).toBe(false)
    expect(canRebaseUnchangedDraft(8, 9, baseline, { ...values.confluence, baseUrl: 'https://changed.example' })).toBe(false)
  })

  it('tests the unsaved connection draft without generating a persistence operation', () => {
    expect(connectionDraftFor('https://draft.example', 'one-time-token', false)).toEqual({ baseUrl: 'https://draft.example', bearerToken: 'one-time-token' })
    expect(connectionDraftFor('https://draft.example', '', false)).toEqual({ baseUrl: 'https://draft.example' })
    expect(connectionDraftFor('https://draft.example', '', true)).toEqual({ baseUrl: 'https://draft.example', clearToken: true })
    expect(buildRefreshMentionsOp(true)).toEqual([{ op: 'set', path: ['refreshMentions'], value: true }])
  })
})
