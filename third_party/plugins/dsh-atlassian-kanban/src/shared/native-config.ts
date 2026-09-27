import z from '@deepseek-ai/schemastery'
import type { Volatile } from '@deepseek-ai/cordis'

const NamedQuery = z.object({ id: z.string().required(), name: z.string().required(), query: z.string().required() })
const Repository = z.object({ id: z.string().required(), projectKey: z.string().required(), repositorySlug: z.string().required() })
const Jira = z.object({ baseUrl: z.string().default('').volatile(), bearerToken: z.string().role('secret').default('').volatile(), jql: z.array(NamedQuery).default([]).volatile() })
const Bitbucket = z.object({ baseUrl: z.string().default('').volatile(), bearerToken: z.string().role('secret').default('').volatile(), repositories: z.array(Repository).default([]).volatile() })
const Confluence = z.object({ baseUrl: z.string().default('').volatile(), bearerToken: z.string().role('secret').default('').volatile(), cql: z.array(NamedQuery).default([]).volatile() })

export interface Config {
  refreshMentions: Volatile<boolean>
  jira: { baseUrl: Volatile<string>; bearerToken: Volatile<string>; jql: Volatile<{ id: string; name: string; query: string }[]> }
  bitbucket: { baseUrl: Volatile<string>; bearerToken: Volatile<string>; repositories: Volatile<{ id: string; projectKey: string; repositorySlug: string }[]> }
  confluence: { baseUrl: Volatile<string>; bearerToken: Volatile<string>; cql: Volatile<{ id: string; name: string; query: string }[]> }
}

/** DSH native config schema; volatile token fields update with host config reloads. */
const ConfigSchema = z.object({
  refreshMentions: z.boolean().default(true).volatile(),
  jira: Jira.default({ baseUrl: '', bearerToken: '', jql: [] }),
  bitbucket: Bitbucket.default({ baseUrl: '', bearerToken: '', repositories: [] }),
  confluence: Confluence.default({ baseUrl: '', bearerToken: '', cql: [] }),
})
export const Config: ReturnType<typeof z.object> = ConfigSchema

export type NativeConfig = Config
