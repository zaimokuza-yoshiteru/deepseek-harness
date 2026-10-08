import { createRoot } from 'react-dom/client'
import { KanbanPage } from '../../../../third_party/plugins/dsh-atlassian-kanban/src/client/KanbanPage.tsx'
import { KanbanSettings, type ConfigValues } from '../../../../third_party/plugins/dsh-atlassian-kanban/src/client/KanbanSettings.tsx'
import { KanbanController } from '../../../../third_party/plugins/dsh-atlassian-kanban/src/client/kanban-state.ts'
import { zh } from '../../../../third_party/plugins/dsh-atlassian-kanban/src/client/locales.ts'
import type { AtlassianKanbanRemote } from '../../../../third_party/plugins/dsh-atlassian-kanban/src/shared/remote.ts'
import '../../../../packages/client/ui-theme/src/styles/base.css'
import '../../../../packages/client/ui-theme/src/styles/corner-shape.css'
import '../../../../packages/client/ui-theme/src/styles/design-platform.css'
import '../../../../packages/client/ui-theme/src/styles/focus.css'
import '../../../../packages/client/ui-theme/src/styles/gradient-shadow-text.css'
import '../../../../packages/client/ui-theme/src/styles/onboarding.css'
import '../../../../packages/client/ui-theme/src/styles/scrollbar.css'
import '../../../../packages/client/ui-theme/src/styles/shiki.css'

const params = new URLSearchParams(location.search)
if (params.get('theme') === 'dark') document.body.dataset.dsDarkTheme = ''
if (params.get('platform') === 'darwin') document.documentElement.dataset.platform = 'darwin'

const configured = params.get('scenario') !== 'unconfigured'
const failFirstQuery = params.get('scenario') === 'query-error'
let queryCalls = 0

const remote: AtlassianKanbanRemote = {
  settings: async () => ({ revision: 1, refreshMentions: false,
    jira: { baseUrl: configured ? 'https://jira.example.invalid' : '', hasToken: configured, jql: configured ? [{ id: 'all', name: '示例查询', query: 'project = EXAMPLE' }] : [] },
    bitbucket: { baseUrl: 'https://bitbucket.example.invalid', hasToken: true, repositories: [{ id: 'repo', projectKey: 'DEMO', repositorySlug: 'example' }] },
    confluence: { baseUrl: 'https://confluence.example.invalid', hasToken: true, cql: [{ id: 'content', name: '内容页面', query: 'type = page' }] },
  }),
  query: async query => {
    queryCalls += 1
    if (failFirstQuery && queryCalls === 1) throw new Error('Fixture query failure')
    const items = query.kind === 'jira-search' ? [
      { id: '1', key: 'EXTRA-LONG-PROJECT-KEY-12345678901234567890', title: '这是很长的工单标题，用来确认每一列都保持单行并显示省略号，不会影响相邻列。', type: '这是非常长的工单类型名称', priority: '这是非常长的优先级名称', status: '这是非常长的状态名称', url: 'https://jira.example.invalid/issue/1' },
      { id: '2', key: 'KEY-WITHOUT-A-LINK-12345678901234567890', title: '没有链接时也保持相同的省略规则', type: '任务', priority: '低', status: '待处理' },
      { id: '3', key: 'ABC-3', title: '短标题', type: '缺陷', priority: '高', status: '完成' },
    ] : query.kind === 'bitbucket-pull-requests' ? [
      { id: '12345678901234567890', title: '这是很长的拉取请求标题，测试独立列宽设置。', state: 'OPEN', url: 'https://bitbucket.example.invalid/pr/1' },
    ] : [
      { id: 'page-1', title: '这是一个用于检查可读性和卡片间距的 Confluence 页面标题', spaceKey: 'DSH', spaceName: 'DeepSeek Harness', type: 'page', status: 'current', url: 'https://confluence.example.invalid/pages/1' },
      { id: 'page-2', title: '第二个示例内容', spaceKey: 'DOCS', spaceName: '文档', type: 'blogpost', status: 'draft' },
    ]
    return { kind: query.kind, nextCursor: null, total: items.length, items }
  },
  testConnection: async product => ({ product, ok: true, displayName: 'Fixture user', message: 'ok' }),
  suggestions: async () => ({ result: null, fromCache: true }),
}

const configValues: ConfigValues = {
  refreshMentions: false,
  jira: { baseUrl: 'https://jira.example.invalid', jql: [{ id: 'all', name: '示例查询', query: 'project = EXAMPLE' }] },
  bitbucket: { baseUrl: 'https://bitbucket.example.invalid', repositories: [{ id: 'repo', projectKey: 'DEMO', repositorySlug: 'example' }] },
  confluence: { baseUrl: 'https://confluence.example.invalid', cql: [{ id: 'content', name: '内容页面', query: 'type = page' }] },
}
const configSnapshot = { status: 'ready' as const, value: configValues, base: {}, user: {}, revision: 1, writable: true, mode: 'host' as const }
const form = {
  getSnapshot: () => configSnapshot,
  subscribe: () => () => {}, mutate: async () => true, set: async () => true, unset: async () => true,
}
const root = createRoot(document.getElementById('root')!)
if (params.get('view') === 'settings') {
  document.body.dataset.view = 'settings'
  root.render(<KanbanSettings form={form} remote={remote} t={key => zh[key]} />)
}
else root.render(<KanbanPage controller={new KanbanController(remote)} remote={remote} openConfig={() => {}} t={key => zh[key]} />)
