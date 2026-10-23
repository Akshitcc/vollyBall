/**
 * 1.4.22 Team detail stats row (spec v2 *-03): played / won / lost / win rate from the finished matches the viewer can see.
 * 1.5.0 (Tester F1428-3): only CONFIRMED results count (core/antifraud isEligible: Player of the Match picked, the other
 * captain confirmed or an admin approved, not flagged) – the same rule as the rankings / leaderboard and the Ask tools.
 * A finished result still waiting for confirmation is reported separately as `pending`.
 * 1.5.1 (Tester F150-2): `pending` is split by its real state (core/resultStatus): `awaiting` (really waiting for the
 * other captain), `review` (flagged, waiting for an admin – also when the other captain already confirmed), `disputed`
 * (rejected by the other captain) and `potm` (no Player of the Match yet). Voided results are not counted anywhere.
 * `pending` = awaiting + review + disputed + potm (kept for older callers).
 */
import { resultStatus } from './resultStatus';
import type { Match } from './types';

export type TeamRecord = { played: number; won: number; lost: number; winRate: number; pending: number; awaiting: number; review: number; reviewAwaiting: number; disputed: number; potm: number };
export function teamRecord(teamId: string, matches: readonly Match[] | null | undefined): TeamRecord {
  let played = 0, won = 0;
  const open = { awaiting: 0, review: 0, reviewAwaiting: 0, disputed: 0, potm: 0 };
  for (const m of matches ?? []) {
    if (m.status !== 'finished') continue;
    const side = m.teamA.teamId === teamId ? 'A' : m.teamB.teamId === teamId ? 'B' : null;
    if (!side) continue;
    const winner = m.summary?.winner ?? null;
    if (!winner) continue;
    const st = resultStatus(m);
    if (st === 'voided' || st === null) continue;
    if (st !== 'counted') { open[st]++; continue; }
    played++;
    if (winner === side) won++;
  }
  return { played, won, lost: played - won, winRate: played ? Math.round((won / played) * 100) : 0, pending: open.awaiting + open.review + open.reviewAwaiting + open.disputed + open.potm, ...open };
}
