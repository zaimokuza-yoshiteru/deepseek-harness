import type { OfficeMember, OfficeTask, OfficeSnapshot, OfficeScene, OfficeActivity, ActionKind } from '../../src/types.ts';
import type { createActivityEffects } from '../../src/client/activity-effects.ts';
import type { createOfficeProps } from '../../src/client/team-office/props.ts';

/** Opaque SDK services are only exercised through the explicitly supplied members. */
export function stub<T extends object>(fields: Partial<T>): T { return fields as T; }
export function member(id: string, changes: Partial<OfficeMember> = {}): OfficeMember {
  return { id, name: id, role: 'teammate', status: 'inactive', description: '', model: '', provider: '', diagnostics: [], ...changes };
}
export function task(changes: Partial<OfficeTask> = {}): OfficeTask {
  return { id: 'task', revision: 1, subject: 'build', description: '', status: 'pending', blockedBy: [], writeScopes: [], ownerId: null, ready: true, writeScopeWarnings: [], ...changes };
}
export function snapshot(changes: Partial<Extract<OfficeSnapshot, {state: 'live'}>> = {}): Extract<OfficeSnapshot, {state: 'live'}> {
  return { state: 'live', leadId: 'lead', members: [], tasks: [], sampledAt: 0, ...changes };
}
export function emptySnapshot(state: 'disabled' | 'unselected' | 'inactive'): OfficeSnapshot { return { state, leadId: null, members: [], tasks: [] }; }
export function scene(changes: Partial<OfficeScene> = {}): OfficeScene {
  return { update() {}, activities() {}, fit() {}, focus() { return true; }, setActive() {}, destroy() {}, ...changes };
}
export function effects(changes: Partial<ReturnType<typeof createActivityEffects>> = {}): ReturnType<typeof createActivityEffects> {
  return { label() {}, tools() {}, action() {}, clear() {}, envelope() {}, reset() {}, draw() {}, destroy() {}, ...changes };
}
export function props(changes: Partial<ReturnType<typeof createOfficeProps>> = {}): ReturnType<typeof createOfficeProps> {
  return { tasks() {}, action() {}, clear() {}, depart() {}, tick() {}, destroy() {}, ...changes };
}
export function activity(kind: OfficeActivity['kind'], actor: string, target: string): OfficeActivity {
  return { id: kind, kind, actor, target, at: Date.now(), celebrate: kind === 'archive' };
}
export type ActionCall = [string, ActionKind];
