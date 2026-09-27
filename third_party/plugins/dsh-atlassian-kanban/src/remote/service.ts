import type { Context } from '@deepseek-ai/cordis'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { AtlassianProduct, AtlassianSettingsView } from '../shared/config.ts'
import type { ConnectionDraft, ConnectionTestResult, KanbanQuery, KanbanQueryResult, KanbanSuggestionsResult } from '../shared/remote.ts'
import type { AtlassianService } from '../host/service.ts'

/** Renderer-facing, read-only surface. Model tools use the same host service. */
export class AtlassianKanbanRemote extends TypertRemoteService {
  constructor(ctx: Context, private readonly service: AtlassianService) { super(ctx, 'atlassianKanban') }

  @Remote
  settings(): AtlassianSettingsView { return this.service.settings() }

  @Remote
  testConnection(product: AtlassianProduct, draft?: ConnectionDraft): Promise<ConnectionTestResult> { return this.service.testConnection(product, draft) }

  @Remote('query')
  query(input: KanbanQuery, signal: AbortSignal): Promise<KanbanQueryResult> { return this.service.query(input, signal) }

  @Remote('suggestions')
  suggestions(input: KanbanQuery, signal: AbortSignal): Promise<KanbanSuggestionsResult> { return this.service.suggestions(input, signal) }
}
