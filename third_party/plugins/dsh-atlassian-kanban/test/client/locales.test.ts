import { describe, expect, it } from 'vitest'
import { en, zh } from '../../src/client/locales.ts'
import { createAtlassianReferenceSource } from '../../src/client/atlassian-reference.ts'

describe('Atlassian Kanban locales', () => {
  it('provides translated labels for tabs, suggestion groups, settings and live notices', () => {
    expect(zh.titleJira).not.toBe('Jira issues')
    expect(zh.titlePr).not.toBe(en.titlePr)
    expect(zh.titleConfluence).not.toBe(en.titleConfluence)
    expect(zh.sectionRepo).not.toBe(en.sectionRepo)
    expect(zh.sectionPr).not.toBe(en.sectionPr)
    expect(zh.noCachedSuggestions).not.toBe(en.noCachedSuggestions)
    expect(zh.settingsConflict).not.toBe(en.settingsConflict)
    expect(zh.refreshMentionsHint).not.toBe(en.refreshMentionsHint)
  })

  it('resolves @ group labels through the current global locale each time candidates are requested', async () => {
    let current: typeof en | typeof zh = en
    const source = createAtlassianReferenceSource({
      settings: async () => ({
        revision: 1, refreshMentions: true,
        jira: { baseUrl: '', hasToken: false, jql: [] },
        bitbucket: { baseUrl: '', hasToken: false, repositories: [] },
        confluence: { baseUrl: '', hasToken: false, cql: [] },
      }),
      suggestions: async () => ({ result: null, fromCache: false }),
    } as never, key => current[key as keyof typeof current] ?? key)
    const request = { query: '', signal: new AbortController().signal, position: 'leading' as const, drilled: false }
    const english = await source.candidates({ sessionId: 's' } as never, request)
    expect(english[0]?.label).toBe(en.jira)
    current = zh
    const chinese = await source.candidates({ sessionId: 's' } as never, request)
    expect(chinese[0]?.label).toBe(zh.jira)
  })
})
