// The desktop launcher loads agent-team-profile: maxMembers=8 counts teammates,
// while roster.list() adds the Lead separately. This room reserves 16 teammates
// to accommodate larger configurations; it never changes the service limit.
export const TEAMMATE_CAPACITY = 16;
export const TEAM_CAPACITY = TEAMMATE_CAPACITY + 1;
export const ROOM = { width: 24, depth: 14.2 };
export const LEAD_ROOM = { minX: -11.7, maxX: -5.5, minZ: -6.9, maxZ: -1.15 };
export const CHAIR = { x: -0.12, z: 0.70 };
export const CHAIR_ROUTE = [{ x: -0.94, z: 1.48 }, { x: -0.94, z: CHAIR.z }, CHAIR];
export const STATIONS = [
  { x: -8.60, z: -4.95, lead: true },
  ...Array.from({ length: TEAMMATE_CAPACITY }, (_, i) => ({ x: -3.6 + (i % 4) * 4.3, z: -5.45 + Math.floor(i / 4) * 3.05, lead: false })),
];
export function roamPoints(index: number) {
  return index === 0
    ? [{ x: -1.65, z: 1.65 }, { x: -1.65, z: 2.9 }, { x: 1.45, z: 2.9 }, { x: 1.45, z: 1.65 }]
    : [{ x: -1.35, z: 1.52 }, { x: 0.15, z: 1.91 }, { x: 1.55, z: 1.52 }, { x: 0.55, z: 1.45 }];
}
export { reconcileSeats as assignTeamSeats } from '../../shared.ts';
