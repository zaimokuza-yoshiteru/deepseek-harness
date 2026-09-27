import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import type { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'

/** The ordinary callback's registrar disposer is the documented SlotRegistry.inject effect form. */
export function registerReplayAction(registry: SlotRegistry): () => void {
  return registry.inject('plugins.detail.actions', () => () => {})
}
