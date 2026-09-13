/** Profile-bound experimental feature operations for the application renderer. */

/** One built-in experiment's persisted choice and current backend state. */
export interface DesktopExperiment {
  readonly id: 'agent-teams'
  readonly enabled: boolean
  readonly activeEnabled: boolean | null
  readonly installed: boolean
  readonly canToggle: boolean
  readonly busy: boolean
}

/** The canonical profile is an equality token, never a caller-selected write path. */
export interface DesktopExperimentsSnapshot {
  readonly profile: string
  readonly features: readonly DesktopExperiment[]
}

/** A compare-and-set request from the context-isolated application renderer. */
export interface DesktopExperimentChange {
  readonly profile: string
  readonly id: 'agent-teams'
  readonly enabled: boolean
  readonly expectedEnabled: boolean
}

/** Stable failure codes let the consuming plugin use its own active locale. */
export type DesktopExperimentResult =
  | { readonly ok: true; readonly value: DesktopExperimentsSnapshot; readonly reloadRequired: boolean }
  | { readonly ok: false; readonly error: { readonly code: 'invalid-request' | 'profile-changed' | 'unsupported' | 'busy' | 'state-changed' | 'tasks-running' | 'failed'; readonly message?: string } }

/** Versioned experiment-only bridge; package installation is not exposed. */
export interface DesktopExperimentsApi {
  readonly version: 1
  /** Read the current profile's experiments and backend state.
   * @returns Profile identity and currently supported experiments.
   */
  list(): Promise<DesktopExperimentsSnapshot>
  /** Complete a guarded backend restart before acknowledging the change.
   * @param change - Desired state and the profile/state observed by the caller.
   * @returns Updated state or a failure; the caller reloads only after a successful response requesting it.
   */
  setEnabled(change: DesktopExperimentChange): Promise<DesktopExperimentResult>
}

/** Electron owns the transaction, its shared lock and the backend process. */
export interface DesktopExperimentOwner {
  readonly profile: string
  readonly supported: boolean
  /** Read the profile's persisted effective choice.
   * @returns The configured Teams state.
   */
  enabled(this: void): boolean
  /** Read the lock shared with package transactions.
   * @returns Whether a profile mutation is in progress.
   */
  busy(this: void): boolean
  /** Update the shared profile mutation lock.
   * @param value - Whether this controller owns an in-progress mutation.
   */
  setBusy(this: void, value: boolean): void
  /** Stop the backend only when idle, leaving it untouched on refusal.
   * @returns True if stopped or already absent; false if active work prevents shutdown.
   */
  stopIfIdle(this: void): Promise<boolean>
  /** Commit through DesktopProjectManager's staging, health checks and rollback.
   * @param enabled - Desired Teams state.
   */
  change(this: void, enabled: boolean): Promise<void>
  /** Ensure the committed or rolled-back profile has a running backend. */
  recover(this: void): Promise<void>
}

/** Owns the running-state observation across experiment transactions. */
export class DesktopExperiments {
  private activeEnabled: boolean | null

  /** Bind a profile after its initial backend startup.
   * @param owner - Electron callbacks owning this profile and its running backend.
   */
  constructor(private readonly owner: DesktopExperimentOwner) {
    this.activeEnabled = owner.supported ? owner.enabled() : null
  }

  /** Read persisted and running state independently.
   * @returns The canonical profile with each supported feature observation.
   */
  snapshot(): DesktopExperimentsSnapshot {
    const owner = this.owner
    return { profile: owner.profile, features: owner.supported ? [{
      id: 'agent-teams', enabled: owner.enabled(), activeEnabled: this.activeEnabled,
      installed: true, canToggle: true, busy: owner.busy(),
    }] : [] }
  }

  /** Validate renderer input and run one idle-only transaction.
   * @param input - Untrusted IPC request.
   * @returns A locale-independent result; failures never request a page reload.
   */
  async setEnabled(input: unknown): Promise<DesktopExperimentResult> {
    const fail = (
      code: Extract<DesktopExperimentResult, { ok: false }>['error']['code'], message?: string,
    ): DesktopExperimentResult => ({ ok: false, error: { code, ...(message === undefined ? {} : { message }) } })
    if (input === null || typeof input !== 'object' || Array.isArray(input)) return fail('invalid-request')
    const change = input as Record<string, unknown>
    if (change.id !== 'agent-teams' || typeof change.profile !== 'string'
      || typeof change.enabled !== 'boolean' || typeof change.expectedEnabled !== 'boolean') return fail('invalid-request')
    const owner = this.owner
    if (change.profile !== owner.profile) return fail('profile-changed')
    if (!owner.supported) return fail('unsupported')
    if (owner.busy()) return fail('busy')
    if (owner.enabled() !== change.expectedEnabled) return fail('state-changed')
    if (owner.enabled() === change.enabled && this.activeEnabled === change.enabled) {
      return { ok: true, value: this.snapshot(), reloadRequired: false }
    }
    owner.setBusy(true)
    let stopped = false
    let failure: unknown
    try {
      if (!await owner.stopIfIdle()) return fail('tasks-running')
      stopped = true
      this.activeEnabled = null
      await owner.change(change.enabled)
    } catch (error) {
      failure = error
    } finally {
      try {
        if (stopped) {
          await owner.recover()
          this.activeEnabled = owner.enabled()
        }
      } catch (error) {
        failure = failure === undefined ? error : new AggregateError([failure, error], 'Desktop experiment change and recovery failed')
      } finally {
        owner.setBusy(false)
      }
    }
    if (failure !== undefined) return fail('failed', failure instanceof Error ? failure.message : 'Desktop experiment operation failed')
    return { ok: true, value: this.snapshot(), reloadRequired: true }
  }
}
