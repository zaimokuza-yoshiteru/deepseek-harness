import { describe, expect, it, vi } from 'vitest'
import { projectUserText } from '../../../../../packages/client/ui-primitives/src/user-text.tsx'
import { SessionInputShell } from '../../../../../packages/client/ui-conversation/src/client/input/facade.ts'
import type { Context } from '@deepseek-ai/cordis'
import { createUserMessage } from '../../../../../packages/llm/llm/src/message.ts'
import type { InputTriggerController } from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import { toAcpPrompt } from '../../../dsh-acp-adapter/src/domain/session/prompt-content.ts'
import { createAtlassianReferenceSource } from '../../src/client/atlassian-reference.ts'
import type { AtlassianKanbanRemote, KanbanQuery, KanbanQueryResult } from '../../src/shared/remote.ts'
import type { ReferenceInsert } from '../../../../../packages/client/ui-conversation/src/client/contract/draft-editor.ts'

const queryResult = (kind: KanbanQuery['kind'], items: KanbanQueryResult['items']): KanbanQueryResult => ({
  kind, items, total: items.length, nextCursor: null,
})

function projected(text: string): { readonly text: string; readonly references: readonly { readonly title: unknown }[] } {
  const references: { title: unknown }[] = []
  const visit = (node: unknown): string => {
    if (typeof node === 'string' || typeof node === 'number') return String(node)
    if (Array.isArray(node)) return node.map(visit).join('')
    if (typeof node !== 'object' || node === null || !('props' in node)) return ''
    const props = (node as { props: { children?: unknown; 'data-ref-chip'?: unknown; title?: unknown } }).props
    if (props['data-ref-chip'] === 'reference') references.push({ title: props.title })
    return visit(props.children)
  }
  return { text: visit(projectUserText(text, [])), references }
}

describe('Kanban reference transcript/model round trip', () => {
  it('keeps mixed and repeated @ labels in the bubble while carrying full locators through native and ACP input', async () => {
    const remote = {
      settings: async () => ({
        revision: 1,
        refreshMentions: true,
        jira: { baseUrl: 'https://jira.invalid', hasToken: true, jql: [{ id: 'assigned', name: 'Assigned', query: 'assignee=currentUser()' }] },
        bitbucket: { baseUrl: '', hasToken: false, repositories: [] },
        confluence: { baseUrl: 'https://wiki.invalid', hasToken: true, cql: [{ id: 'pages', name: 'Pages', query: 'type=page' }] },
      }),
      suggestions: async (input: KanbanQuery) => ({
        result: input.kind === 'jira-search'
          ? queryResult(input.kind, [{ key: 'DSH-22', title: 'Fix project editor' }])
          : input.kind === 'confluence-search'
            ? queryResult(input.kind, [{ id: 'page-1700', title: 'Overview' }])
            : queryResult(input.kind, []),
        fromCache: true,
      }),
    } as unknown as AtlassianKanbanRemote
    const source = createAtlassianReferenceSource(remote, key => key)
    const signal = new AbortController().signal
    const jira = await source.candidates({ sessionId: 'mention-test' } as never, { query: 'jira:assigned:', signal, position: 'leading', drilled: false })
    const confluence = await source.candidates({ sessionId: 'mention-test' } as never, { query: 'confluence:pages:', signal, position: 'leading', drilled: false })
    const pick = (candidate: (typeof jira)[number]): ReferenceInsert => {
      const result = source.onPick({
        candidate,
        session: { sessionId: 'mention-test' } as never,
        position: 'inline',
        via: 'menu',
        action: 'pick',
        span: { start: 0, end: 1, draftRev: 0 },
      })
      if (result === undefined || typeof result === 'string' || !('insert' in result)) throw new Error('Expected an Atlassian reference pick')
      return result.insert
    }
    const issue = pick(jira[0]!)
    const page = pick(confluence[0]!)
    expect(JSON.parse(issue.ref)).toMatchObject({ kind: 'jira', key: 'DSH-22', label: 'DSH-22' })
    expect(JSON.parse(page.ref)).toMatchObject({ kind: 'confluence', id: 'page-1700', label: 'Overview' })

    const submitted: string[] = []
    const inputTriggers = {
      serializeReference: async (owner: string, ref: string, codecSignal: AbortSignal) => {
        if (owner !== 'atlassian') throw new Error(`unexpected reference owner ${owner}`)
        return await source.codec!.serialize(ref, codecSignal)
      },
      track: vi.fn(),
      lexicon: { getSnapshot: () => new Map(), subscribe: () => () => {} },
    } as unknown as InputTriggerController
    const shell = new SessionInputShell({
      actx: {} as Context,
      inputTriggers: () => inputTriggers,
      defaultSink: async (text) => { submitted.push(text); return { kind: 'success' } },
      commandAttachments: { serialize: async () => [], release: () => {}, unsupportedNotice: token => token },
    })
    const original = 'Issue @DSH-22 then again @DSH-22 and read @Overview'
    shell.setDraft(original)
    const matches = [...original.matchAll(/@[^\s]+/gu)].map(match => ({
      start: match.index,
      end: match.index + match[0].length,
      insert: match[0] === '@Overview' ? page : issue,
    }))
    for (const match of matches.reverse()) {
      expect(shell.insertReference(match.insert, {
        start: match.start,
        end: match.end,
        draftRev: shell.snapshot.draftRev,
      })).toBe(true)
    }
    const savedDraft = shell.snapshot.draft
    expect(savedDraft.match(/<dsh-reference>/gu)).toHaveLength(3)
    shell.submit()
    await vi.waitFor(() => { expect(submitted).toHaveLength(1) })
    const promptText = submitted[0]!
    expect(promptText).toBe(savedDraft.trim())
    expect(promptText).toContain('"text":"Jira issue DSH-22"')
    expect(promptText).toContain('"text":"Confluence content ID page-1700"')

    const bubble = projected(promptText)
    expect(bubble.references).toEqual([
      { title: 'Jira issue DSH-22' },
      { title: 'Jira issue DSH-22' },
      { title: 'Confluence content ID page-1700' },
    ])
    expect(bubble.text).toBe(original)

    const acpMessage = createUserMessage({
      source: { kind: 'user' },
      content: [{ type: 'text', text: promptText }],
    })
    const acp = await toAcpPrompt([acpMessage], { imageEnabled: false, signal })
    expect(acp).toEqual([{ type: 'text', text: promptText }])

    const remountedDraft = new SessionInputShell({
      actx: {} as Context,
      defaultSink: async (text) => { submitted.push(text); return { kind: 'success' } },
      commandAttachments: { serialize: async () => [], release: () => {}, unsupportedNotice: token => token },
    })
    remountedDraft.setDraft(savedDraft)
    remountedDraft.submit()
    await vi.waitFor(() => { expect(submitted).toHaveLength(2) })
    expect(submitted[1]).toBe(promptText)
    expect(projected(submitted[1]!).text).toBe(original)
  })
})
