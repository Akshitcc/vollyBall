/**
 * 1.5.2 (Tester F151-1): challenges store from/to_captain_id at send time, but the team's CURRENT captain acts on it.
 * After a captaincy transfer the former captain can no longer accept / decline / cancel, and the new captain can.
 * A team row that no longer exists keeps the stored captain.
 */
import type { Row, Trx } from './util';

export async function currentCaptains(trx: Trx, teamIds: string[], lock = false): Promise<Map<string, string>> {
  const ids = [...new Set(teamIds.filter(Boolean))];
  if (!ids.length) return new Map();
  let q = trx('teams').whereIn('id', ids).select('id', 'captain_id');
  if (lock) q = q.forShare(); // a captaincy transfer waits for the answer (and vice versa)
  const rows: { id: string; captain_id: string }[] = await q;
  return new Map(rows.map((r) => [r.id, r.captain_id]));
}

/** The challenge row with from/to_captain_id replaced by the teams' current captains. */
export async function withCurrentCaptains<T extends Row | undefined>(trx: Trx, r: T, lock = false): Promise<T> {
  if (!r) return r;
  const cap = await currentCaptains(trx, [r.from_team_id, r.to_team_id], lock);
  return { ...r, from_captain_id: cap.get(r.from_team_id) ?? r.from_captain_id, to_captain_id: cap.get(r.to_team_id) ?? r.to_captain_id } as T;
}
