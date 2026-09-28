import { createRoot } from 'react-dom/client'
import { KanbanPage } from '../../../../third_party/plugins/dsh-atlassian-kanban/src/client/KanbanPage.tsx'
import { KanbanController } from '../../../../third_party/plugins/dsh-atlassian-kanban/src/client/kanban-state.ts'
import { zh } from '../../../../third_party/plugins/dsh-atlassian-kanban/src/client/locales.ts'
import type { AtlassianKanbanRemote } from '../../../../third_party/plugins/dsh-atlassian-kanban/src/shared/remote.ts'
import '../../../../packages/client/ui-theme/src/styles/design-platform.css'

const remote: AtlassianKanbanRemote = {
  settings: async () => ({ revision: 1, refreshMentions: false,
    jira: { baseUrl: 'https://jira.example.invalid', hasToken: true, jql: [{ id: 'all', name: '示例查询', query: 'project = EXAMPLE' }] },
    bitbucket: { baseUrl: 'https://bitbucket.example.invalid', hasToken: true, repositories: [{ id: 'repo', projectKey: 'DEMO', repositorySlug: 'example' }] },
    confluence: { baseUrl: '', hasToken: false, cql: [] },
  }),
  query: async query => ({ kind: query.kind, nextCursor: null, total: 3, items: query.kind === 'jira-search' ? [
    { id: '1', key: 'EXTRA-LONG-PROJECT-KEY-12345678901234567890', title: '这是很长的工单标题，用来确认每一列都保持单行并显示省略号，不会影响相邻列。', type: '这是非常长的工单类型名称', priority: '这是非常长的优先级名称', status: '这是非常长的状态名称', url: 'https://jira.example.invalid/issue/1' },
    { id: '2', key: 'KEY-WITHOUT-A-LINK-12345678901234567890', title: '没有链接时也保持相同的省略规则', type: '任务', priority: '低', status: '待处理' },
    { id: '3', key: 'ABC-3', title: '短标题', type: '缺陷', priority: '高', status: '完成' },
  ] : [{ id: '12345678901234567890', title: '这是很长的拉取请求标题，测试独立列宽设置。', state: 'OPEN', url: 'https://bitbucket.example.invalid/pr/1' }] }),
  testConnection: async product => ({ product, ok: true, displayName: 'Fixture user', message: 'ok' }),
  suggestions: async () => ({ result: null, fromCache: true }),
}
createRoot(document.getElementById('root')!).render(<KanbanPage controller={new KanbanController(remote)} remote={remote} openConfig={() => {}} t={key => zh[key]} />)
