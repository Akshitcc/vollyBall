/**
 * Player of the Match (POTM). Pure TypeScript, shared by the app (all three backends) and the API server.
 *
 * Auto-pick when a match finishes: the player with the most credited points (points the scorer
 * credited to them in "Who scored", over the accepted rallies only). Tie-breaks, in order:
 *   1. more credited points in the deciding set (only when the match went to a deciding set);
 *   2. fewer errors – only if errors are tracked. The scoring log has no error events today, so
 *      callers pass no `errors` map and this step is skipped (every player counts as 0);
 *   3. player id, ascending (plain string order) – arbitrary but stable on every device and the server.
 * No pick when nobody was credited a point (the scorer can still choose a player).
 *
 * The scorer may override the pick before confirming; once confirmed it is stored on the match
 * (`playerOfMatchId`) and can't be changed (firestore.rules / server: set once, by the scorer, while
 * the match is finished and within POTM_WINDOW_MS of the finish, to a player of the match).
 */
import { playerStats, acceptedEvents, creditCounts, type MatchRosters } from './stats';
import { computeState, type MatchEvent, type Side } from './scoring';
import type { RuleSet } from './rules';

export interface PotmMatch {
  rules: RuleSet;
  events: readonly MatchEvent[];
  firstServe?: Side;
  teamA: { players: readonly { id: string }[] };
  teamB: { players: readonly { id: string }[] };
}

export interface PotmLine {
  playerId: string;
  points: number;
  decidingPoints: number;
  errors: number;
}

/** How long after the finish the scorer may confirm the Player of the Match (24 h). */
export const POTM_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Player ids of both teams (the only valid POTM choices), team A first. */
export const matchPlayerIds = (m: Pick<PotmMatch, 'teamA' | 'teamB'>): string[] => [...m.teamA.players, ...m.teamB.players].map((p) => p.id);

/** Credited points per player in the deciding set (empty when the match didn't reach one). */
export function decidingSetPoints(rules: RuleSet, events: readonly MatchEvent[], firstServe: Side = 'A', rosters?: MatchRosters): Record<string, number> {
  const accepted = acceptedEvents(rules, events, firstServe);
  const st = computeState(rules, accepted, firstServe);
  // The deciding set is the last possible one (set number bestOf); it was played when bestOf - 1
  // sets were completed before it.
  const before = rules.bestOf - 1;
  const completed = st.sets.length;
  const reached = st.finished ? completed === rules.bestOf : completed === before && st.isDecidingSet;
  if (!reached) return {};
  // Rallies before the deciding set = the points of the first bestOf-1 sets.
  const skip = st.sets.slice(0, before).reduce((n, x) => n + x.a + x.b, 0);
  const out: Record<string, number> = {};
  let rally = 0;
  for (const ev of accepted) {
    if (ev.type !== 'point') continue;
    if (rally++ < skip) continue;
    if (ev.playerId && creditCounts(ev, rosters)) out[ev.playerId] = (out[ev.playerId] ?? 0) + 1;
  }
  return out;
}

/** Tie order: points desc, deciding-set points desc, errors asc, id asc. */
export function comparePotm(a: PotmLine, b: PotmLine): number {
  return b.points - a.points || b.decidingPoints - a.decidingPoints || a.errors - b.errors || (a.playerId < b.playerId ? -1 : a.playerId > b.playerId ? 1 : 0);
}

/**
 * Every player of the match with their POTM numbers, best first (comparePotm order).
 * Credits to someone who isn't a player of the match are ignored.
 */
export function potmLines(m: PotmMatch, opts: { errors?: Record<string, number> } = {}): PotmLine[] {
  const fs = m.firstServe ?? 'A';
  const pts = playerStats(m.rules, m.events, fs, m);
  const dec = decidingSetPoints(m.rules, m.events, fs, m);
  const ids = [...new Set(matchPlayerIds(m))];
  return ids
    .map((id) => ({ playerId: id, points: pts[id]?.points ?? 0, decidingPoints: dec[id] ?? 0, errors: opts.errors?.[id] ?? 0 }))
    .sort(comparePotm);
}

/** True when `playerId` has no credited point but someone else in the match has. */
export function potmNoPoints(m: PotmMatch, playerId: string): boolean {
  const lines = potmLines(m);
  const mine = lines.find((l) => l.playerId === playerId)?.points ?? 0;
  return mine === 0 && lines.some((l) => l.points > 0);
}

/** The automatic pick, or null when nobody was credited a point. */
export function pickPlayerOfMatch(m: PotmMatch, opts: { errors?: Record<string, number> } = {}): string | null {
  const best = potmLines(m, opts)[0];
  return best && best.points > 0 ? best.playerId : null;
}

export type PotmProblem = 'potm_not_scorer' | 'potm_not_finished' | 'potm_window' | 'potm_already_set' | 'potm_not_player' | 'potm_no_points';

/**
 * Why `uid` may not set `playerId` as Player of the Match (null = allowed). Same checks in
 * firestore.rules (matches update), the demo backend and the API server.
 */
export function potmProblem(
  m: PotmMatch & { scorerId: string; status: string; finishedAt?: number | null; playerOfMatchId?: string | null },
  uid: string | null | undefined,
  playerId: string,
  now = Date.now(),
): PotmProblem | null {
  if (!uid || m.scorerId !== uid) return 'potm_not_scorer';
  if (m.status !== 'finished') return 'potm_not_finished';
  if (m.finishedAt == null || now - m.finishedAt >= POTM_WINDOW_MS) return 'potm_window';
  if (m.playerOfMatchId) return 'potm_already_set';
  if (!matchPlayerIds(m).includes(playerId)) return 'potm_not_player';
  // INFO (retest 1.1.0): a player with no credited point can't be chosen while others scored.
  // (When nobody was credited – credits are optional – any player of the match may be chosen.)
  if (potmNoPoints(m, playerId)) return 'potm_no_points';
  return null;
}

export const POTM_MESSAGES: Record<PotmProblem, string> = {
  potm_not_scorer: 'Only the scorer can choose the Player of the Match',
  potm_not_finished: 'The Player of the Match is chosen when the match finishes',
  potm_window: 'The Player of the Match can only be chosen within 24 hours of the finish',
  potm_already_set: 'The Player of the Match has already been confirmed',
  potm_not_player: 'The Player of the Match must be a player in this match',
  potm_no_points: 'Choose a player who was credited with points in this match',
};
