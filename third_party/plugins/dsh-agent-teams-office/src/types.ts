import type { TeamMemberView, TeamTaskStatus, TeamTaskView } from '@deepseek-ai/dsh-experimental-agent-team/client';

/** DSH 0.1.6 reports idle separately; 0.1.7 includes it in inactive. */
export type MemberStatus = TeamMemberView['status'] | 'idle';
export type MemberRole = TeamMemberView['role'];
export interface OfficeMember {
  id: string;
  name: string;
  role: MemberRole;
  status: MemberStatus;
  description: string;
  model: string;
  provider: string;
  diagnostics: string[];
}
export type SeatMember = Pick<OfficeMember, 'id' | 'role'>;
export type OfficeTask = Omit<TeamTaskView, 'id' | 'blockedBy'> & { id: string; blockedBy: string[]; ownerId: string | null };
export interface Cursor { epoch: string; seq: number }
export interface TaskFact { kind: 'task'; taskId: string; revision: number; owner: string | null; status: TeamTaskStatus }
export interface MessageFact { kind: 'message'; messageId: string; actor: string; target: string }
export type ActivityFact = (TaskFact | MessageFact) & { at: number; seq: number };
export type ToolActivity = Record<string, { name: string }>;
export interface ActivityBatch { cursor: Cursor; reset: boolean; activities: ActivityFact[]; tools: ToolActivity }
interface SnapshotData { members: OfficeMember[]; tasks: OfficeTask[] }
export type OfficeSnapshot = SnapshotData & Partial<ActivityBatch> & (
  { state: 'disabled' | 'unselected' | 'inactive'; leadId: null } |
  { state: 'live'; leadId: string; sampledAt: number }
);
export type AmbientKind = 'coffee' | 'water' | 'plant' | 'window' | 'fridge' | 'books' | 'bin' | 'smoke';
export type ActionKind = AmbientKind | 'talk' | 'listen' | 'take' | 'carry' | 'idle' | 'cup' | 'brew' | 'drink' | 'wash' | 'put-cup' | 'cheer' | 'pin' | 'archive';
interface ActivityBase { id: string; at: number; actor: string; target?: string; speakers?: string[]; celebrate?: boolean }
export type OfficeActivity = ActivityBase & (
  { kind: 'message' | 'handoff'; target: string } | { kind: 'pin' | 'archive' | AmbientKind }
);
export type PlanEvent = OfficeActivity | { kind: AmbientKind; actor: string; ambient: true; target?: undefined; speakers?: undefined; celebrate?: undefined };
export interface Point2 { x: number; y: number }
export interface Point3 { x: number; z: number }
export type Site<P> = P & { site?: string };
export interface Phase<P> {
  walk?: { id: string; to: P | null | undefined }[];
  actions?: { id: string; kind: ActionKind; target?: string }[];
  duration?: number;
}
export interface ActivityPlan<P> { site?: string; phases: Phase<P>[] }
export interface ActivityAdapter<P> {
  plan(event: PlanEvent, members: Map<string, OfficeMember>): ActivityPlan<P> | null;
  hold(id: string): void;
  walk(id: string, to: P | null | undefined): boolean;
  arrived(id: string): boolean;
  action(id: string, kind: ActionKind, target?: string): void;
  release(id: string): void;
  envelope(from: string, to: string): void;
  reset?(): void;
}
export type StatusLabel = (status: MemberStatus) => string;
export type ActivityLabel = (kind: ActionKind) => string;
export type ViewMode = 'team' | 'pixel';
export interface SceneActivities { reset: boolean; label: ActivityLabel; tools: ToolActivity; tasks: OfficeTask[] }
export interface OfficeScene {
  update(members: OfficeMember[], label: StatusLabel, selected: string | null): void;
  activities(events: OfficeActivity[], options: SceneActivities): void;
  setActive(active: boolean): void;
  fit(): void;
  focus(id: string | null): boolean;
  destroy(): void;
}
export type SceneFactory = (element: HTMLElement, select: (id: string) => void, error: (error: Error) => void, options: { view: ViewMode }) => Promise<OfficeScene>;
export type LoadSnapshot = (sessionId: string | null, signal: AbortSignal, cursor?: Cursor | null) => Promise<OfficeSnapshot>;
export function asError(value: unknown): Error { return value instanceof Error ? value : new Error(String(value)); }
