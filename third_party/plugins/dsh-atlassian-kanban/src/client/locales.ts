import type {} from '@deepseek-ai/dsh-client-ui-slots'

export const NS = 'atlassianKanban'

export const zh = {
  panel: 'Atlassian 看板', atlassianGroup: 'Atlassian', jira: 'Jira', bitbucket: 'Bitbucket', confluence: 'Confluence',
  refresh: '刷新', refreshing: '正在更新…', loading: '正在加载…', loadMore: '加载更多', empty: '没有匹配的项目。',
  notConfigured: '请在插件配置中填写此产品的 Base URL、Bearer Token，并添加 JQL、仓库或 CQL。', configure: '打开插件配置', error: '加载失败', retry: '重试',
  type: '类型', key: 'Key', priority: '优先级', title: '标题', state: '状态', all: '全部', open: '开放', merged: '已合并',
  prOpen: '开放', prMerged: '已合并', prDeclined: '已拒绝', contentTypePage: '页面', contentTypeBlogPost: '博客文章',
  contentStatusCurrent: '当前', contentStatusDraft: '草稿', contentStatusArchived: '已归档', contentStatusDeleted: '已删除', contentStatusTrashed: '已移入回收站',
  spaceKey: '空间 Key', spaceName: '空间名称', contentType: '内容类型', contentStatus: '内容状态', contentId: '内容 ID',
  results: '条结果', newQuery: '新建查询', queryName: '查询名称', queryText: 'JQL / CQL', repo: '仓库',
  newRepo: '添加仓库', projectKey: '项目 Key', repositorySlug: '仓库 Slug', edit: '编辑', remove: '删除',
  save: '保存', cancel: '取消', connection: '连接', testConnection: '测试连接', connected: '连接成功',
  failedConnection: '连接失败', technicalDetails: '查看技术详情', baseUrl: 'Base URL', token: 'Bearer token', tokenPlaceholder: '输入新 token（已保存 token 不会显示）',
  clearToken: '清除已保存 token', saved: '设置已保存', saveFailed: '保存失败', nameRequired: '请填写查询名称。',
  queryRequired: '请填写 JQL / CQL 查询。', duplicateIds: '查询和仓库 ID 必须唯一。', repositoryRequired: '请填写项目 Key 和仓库 Slug。', duplicateRepositories: '仓库列表中有重复项目和仓库组合。',
  titleJira: 'Jira 工单', titlePr: '拉取请求', titleConfluence: 'Confluence 页面',
  sectionJira: 'Jira 查询', sectionRepo: '仓库', sectionPr: '拉取请求', sectionConfluence: 'Confluence 查询',
  hintAt: '在你配置的范围内搜索', noCachedSuggestions: '没有本地候选缓存；开启自动刷新或先刷新看板。',
  mentions: '@ 提及候选', refreshMentions: '自动刷新 @ 候选', refreshMentionsHint: '关闭后只从本次应用运行期间成功查询的缓存读取候选，不会发起 Atlassian 请求。',
  tokenSaved: '已保存', tokenNotSaved: '未设置', tokenHint: '此输入仅用于写入；留空会保留已保存 token。',
  settingsConflict: '设置已被其他操作修改。草稿已保留；放弃草稿后可载入最新设置。', discardChanges: '放弃草稿',
} as const satisfies Record<string, string>

export type KanbanLocaleKey = keyof typeof zh

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap { atlassianKanban: KanbanLocaleKey }
}

export const en = {
  panel: 'Atlassian Kanban', atlassianGroup: 'Atlassian', jira: 'Jira', bitbucket: 'Bitbucket', confluence: 'Confluence',
  refresh: 'Refresh', refreshing: 'Updating…', loading: 'Loading…', loadMore: 'Load more', empty: 'No matching items.',
  notConfigured: 'In plugin settings, enter this product’s Base URL and Bearer Token, then add a JQL query, repository, or CQL query.', configure: 'Open plugin settings', error: 'Could not load results', retry: 'Retry',
  type: 'Type', key: 'Key', priority: 'Priority', title: 'Title', state: 'State', all: 'All', open: 'Open', merged: 'Merged',
  prOpen: 'Open', prMerged: 'Merged', prDeclined: 'Declined', contentTypePage: 'Page', contentTypeBlogPost: 'Blog post',
  contentStatusCurrent: 'Current', contentStatusDraft: 'Draft', contentStatusArchived: 'Archived', contentStatusDeleted: 'Deleted', contentStatusTrashed: 'Trashed',
  spaceKey: 'Space key', spaceName: 'Space name', contentType: 'Content type', contentStatus: 'Content status', contentId: 'Content ID',
  results: 'results', newQuery: 'New query', queryName: 'Query name', queryText: 'JQL / CQL', repo: 'Repository',
  newRepo: 'Add repository', projectKey: 'Project key', repositorySlug: 'Repository slug', edit: 'Edit', remove: 'Remove',
  save: 'Save', cancel: 'Cancel', connection: 'Connection', testConnection: 'Test connection', connected: 'Connected',
  failedConnection: 'Connection failed', technicalDetails: 'Show technical details', baseUrl: 'Base URL', token: 'Bearer token', tokenPlaceholder: 'Enter a new token (saved token cannot be viewed)',
  clearToken: 'Clear saved token', saved: 'Settings saved', saveFailed: 'Could not save settings', nameRequired: 'Enter a name for every saved query.',
  queryRequired: 'Enter a JQL / CQL expression.', duplicateIds: 'Query and repository IDs must be unique.', repositoryRequired: 'Enter both a project key and repository slug.', duplicateRepositories: 'The repository list contains a duplicate project and repository pair.',
  titleJira: 'Jira issues', titlePr: 'Pull requests', titleConfluence: 'Confluence pages',
  sectionJira: 'Jira queries', sectionRepo: 'Repositories', sectionPr: 'Pull requests', sectionConfluence: 'Confluence queries',
  hintAt: 'Search within a configured scope', noCachedSuggestions: 'No local suggestion cache. Turn on automatic refresh or refresh the board first.',
  mentions: '@ suggestions', refreshMentions: 'Refresh @ suggestions automatically', refreshMentionsHint: 'When off, suggestions use only successful results cached during this app run and send no Atlassian requests.',
  tokenSaved: 'Saved', tokenNotSaved: 'Not set', tokenHint: 'This field only writes a token. Leave blank to keep the saved token.',
  settingsConflict: 'Settings changed elsewhere. Your draft is preserved; discard it to load the latest settings.', discardChanges: 'Discard draft',
} as const satisfies Record<KanbanLocaleKey, string>
