/** Bridges stored matches to tournament results. Pure TypeScript. */
import { computeState } from './scoring';
import type { FixtureResult } from './tournament';
import type { Match } from './types';

export function fixtureResultFromMatch(m: Pick<Match, 'rules' | 'events' | 'firstServe' | 'fixtureId'>): FixtureResult | null {
  if (!m.fixtureId) return null;
  const st = computeState(m.rules, m.events, m.firstServe);
  if (!st.finished) return null;
  const homePoints = st.sets.reduce((s, x) => s + x.a, 0);
  const awayPoints = st.sets.reduce((s, x) => s + x.b, 0);
  return { fixtureId: m.fixtureId, homeSets: st.setsWon.A, awaySets: st.setsWon.B, homePoints, awayPoints };
}
