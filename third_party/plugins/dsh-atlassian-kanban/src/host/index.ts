import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-tools'
import type { Config as KanbanConfig } from '../shared/native-config.ts'
import { AtlassianService } from './service.ts'
import { AtlassianKanbanRemote } from '../remote/service.ts'
import { registerTools } from './tools.ts'

export const name = 'dsh-atlassian-kanban'
export const inject = ['tools', 'settings']

export function apply(ctx: Context, config: KanbanConfig): void {
  const service = new AtlassianService(ctx, () => ({
    refreshMentions: config.refreshMentions.get(),
    jira: { baseUrl: config.jira.baseUrl.get(), bearerToken: config.jira.bearerToken.get(), jql: config.jira.jql.get() },
    bitbucket: { baseUrl: config.bitbucket.baseUrl.get(), bearerToken: config.bitbucket.bearerToken.get(), repositories: config.bitbucket.repositories.get() },
    confluence: { baseUrl: config.confluence.baseUrl.get(), bearerToken: config.confluence.bearerToken.get(), cql: config.confluence.cql.get() },
  }))
  new AtlassianKanbanRemote(ctx, service)
  const disposers = registerTools(ctx, service)
  ctx.effect(() => () => { for (const dispose of disposers.reverse()) dispose() }, 'dsh-atlassian-kanban: tools and remote')
}
