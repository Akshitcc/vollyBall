/** 1.4.22 Team detail stats row (spec v2 *-03): played / won / lost / win rate from the finished matches the viewer can see. */
import type { Match } from './types';

export type TeamRecord = { played: number; won: number; lost: number; winRate: number };
export function teamRecord(teamId: string, matches: readonly Match[] | null | undefined): TeamRecord {
  let played = 0, won = 0;
  for (const m of matches ?? []) {
    if (m.status !== 'finished' || !m.summary.winner) continue;
    const side = m.teamA.teamId === teamId ? 'A' : m.teamB.teamId === teamId ? 'B' : null;
    if (!side) continue;
    played++;
    if (m.summary.winner === side) won++;
  }
  return { played, won, lost: played - won, winRate: played ? Math.round((won / played) * 100) : 0 };
}
