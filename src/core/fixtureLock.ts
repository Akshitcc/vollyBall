/**
 * 1.4.26 (Tester E2E-2 / E2E-3): played fixtures are locked, and a fixture match starts only when the fixture is ready
 * and is played by exactly its two teams. Pure; used by the demo backend and mirrored by the API server
 * (server/src/domain/tournaments.ts writeTournament, matches.ts claimFixture).
 */
import { resolveFixtures } from './groups';
import type { Fixture, FixtureResult } from './tournament';

export const FIXTURE_LOCKED = 'fixture_locked';
export const FIXTURE_UNKNOWN = 'fixture_unknown';
export const FIXTURE_TAKEN = 'fixture_taken';
export const FIXTURE_NOT_READY = 'fixture_not_ready';
export const FIXTURE_TEAMS = 'fixture_teams';
export type FixtureStartProblem = typeof FIXTURE_UNKNOWN | typeof FIXTURE_TAKEN | typeof FIXTURE_NOT_READY | typeof FIXTURE_TEAMS;

export const LOCK_KEYS = ['homeId', 'awayId', 'homeFrom', 'awayFrom', 'homeSeed', 'awaySeed', 'group', 'matchId', 'round', 'index'] as const;
const KEYS = LOCK_KEYS;

/** The first played fixture (its match has a result) that `next` changes or removes, or null. */
export function lockedFixtureChange(prev: readonly Fixture[], next: readonly Fixture[], played: ReadonlySet<string>): string | null {
  const byId = new Map(next.map((f) => [f.id, f]));
  for (const f of prev) {
    if (!played.has(f.id)) continue;
    const n = byId.get(f.id);
    if (!n || KEYS.some((k) => (n[k] ?? null) !== (f[k] ?? null))) return f.id;
  }
  return null;
}

/** Why a match can't be started for this fixture now (null = it can). */
export function fixtureStartProblem(
  t: { format: string; teams?: readonly { id: string; group?: string; name?: string }[]; fixtures: readonly Fixture[] },
  results: readonly FixtureResult[],
  fixtureId: string,
  teams: { A?: string | null; B?: string | null },
  hasActiveMatch: boolean,
): FixtureStartProblem | null {
  // 1.4.28 (QA V1427-1): the team names go in (core tiebreakNames), so a full tie is broken by name like the app
  const fixtures = resolveFixtures({ format: t.format, teams: t.teams ?? [], fixtures: t.fixtures }, results).fixtures;
  const f = fixtures.find((x) => x.id === fixtureId);
  if (!f) return FIXTURE_UNKNOWN;
  if (hasActiveMatch) return FIXTURE_TAKEN;
  if (!f.homeId || !f.awayId) return FIXTURE_NOT_READY;
  if (teams.A !== f.homeId || teams.B !== f.awayId) return FIXTURE_TEAMS;
  return null;
}
