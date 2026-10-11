/**
 * Player rankings. Pure TypeScript: the ONE implementation of the ranking maths, used by the demo
 * and Firebase backends (totalsFromMatches + rankPlayers over the finished matches they read) and
 * by the API server (a MySQL query, server/src/domain/rankings.ts, produces the same PlayerTotals and
 * then calls rankPlayers).
 *
 * Ranking points = credited points + RANKING_POINTS_PER_WIN per match won
 *                  + RANKING_POINTS_PER_POTM per Player of the Match award,
 * counted over FINISHED matches only (live, scheduled and abandoned matches don't count).
 * A player needs at least MIN_RANKED_MATCHES finished matches to be ranked.
 *
 * Tie order (documented; every position is distinct):
 *   1. ranking points, high to low
 *   2. wins, high to low
 *   3. Player of the Match awards, high to low
 *   4. credited points, high to low
 *   5. matches played, low to high (the same total from fewer matches ranks higher)
 *   6. player id, ascending (plain string order) – stable on every device and on the server.
 */
import { computeState, type MatchEvent, type Side } from './scoring';
import type { RuleSet } from './rules';
import { playerStats } from './stats';

export const RANKING_POINTS_PER_WIN = 10;
export const RANKING_POINTS_PER_POTM = 25;
export const MIN_RANKED_MATCHES = 3;

export interface PlayerTotals {
  playerId: string;
  /** Finished matches played (on team A or B). */
  matches: number;
  wins: number;
  /** Points credited to the player in those matches. */
  points: number;
  /** Player of the Match awards in those matches. */
  potm: number;
  name?: string;
  photoURL?: string | null;
}

export interface RankingRow extends PlayerTotals {
  rankingPoints: number;
  /** Whole percent, 0-100. */
  winPct: number;
  /** 1-based position among ranked players; null while under MIN_RANKED_MATCHES. */
  rank: number | null;
}

export interface Rankings {
  /** Ranked players, best first. */
  ranked: RankingRow[];
  /** Number of ranked players (the M in "Rank #N of M"). */
  total: number;
}

export const rankingPoints = (t: Pick<PlayerTotals, 'points' | 'wins' | 'potm'>): number =>
  t.points + RANKING_POINTS_PER_WIN * t.wins + RANKING_POINTS_PER_POTM * t.potm;

export const winPct = (t: Pick<PlayerTotals, 'wins' | 'matches'>): number => (t.matches > 0 ? Math.round((100 * t.wins) / t.matches) : 0);

export const toRow = (t: PlayerTotals, rank: number | null = null): RankingRow => ({ ...t, rankingPoints: rankingPoints(t), winPct: winPct(t), rank });

/** The documented tie order (see the header). */
export function compareRanking(a: RankingRow, b: RankingRow): number {
  return (
    b.rankingPoints - a.rankingPoints ||
    b.wins - a.wins ||
    b.potm - a.potm ||
    b.points - a.points ||
    a.matches - b.matches ||
    (a.playerId < b.playerId ? -1 : a.playerId > b.playerId ? 1 : 0)
  );
}

/** Ranks players with at least MIN_RANKED_MATCHES finished matches, in compareRanking order. */
export function rankPlayers(totals: readonly PlayerTotals[]): Rankings {
  const ranked = totals
    .filter((t) => t.matches >= MIN_RANKED_MATCHES)
    .map((t) => toRow(t))
    .sort(compareRanking)
    .map((r, i) => ({ ...r, rank: i + 1 }));
  return { ranked, total: ranked.length };
}

/** A player's row: their ranked row, or an unranked row (rank null) from their own totals. */
export function rowFor(r: Rankings, playerId: string, own?: PlayerTotals | null): RankingRow | null {
  return r.ranked.find((x) => x.playerId === playerId) ?? (own ? toRow(own) : null);
}

/** Minimal match shape the ranking needs. */
export interface RankableMatch {
  status?: string;
  rules: RuleSet;
  events: readonly MatchEvent[];
  firstServe?: Side;
  teamA: { players: readonly { id: string; name?: string; photoURL?: string | null }[] };
  teamB: { players: readonly { id: string; name?: string; photoURL?: string | null }[] };
  playerOfMatchId?: string | null;
  finishedAt?: number | null;
}

/**
 * Per-player totals over finished matches (stored status 'finished' and the scoring engine agrees
 * the match is over). Credits to someone who isn't a player of that match are ignored.
 */
export function totalsFromMatches(matches: readonly RankableMatch[], include?: (m: RankableMatch, playerId: string) => boolean): PlayerTotals[] {
  const out = new Map<string, PlayerTotals & { _at: number }>();
  for (const m of matches) {
    if (m.status !== undefined && m.status !== 'finished') continue;
    const fs = m.firstServe ?? 'A';
    const st = computeState(m.rules, m.events, fs);
    if (!st.finished) continue;
    const pts = playerStats(m.rules, m.events, fs, m);
    const at = m.finishedAt ?? 0;
    for (const side of ['A', 'B'] as Side[]) {
      for (const p of (side === 'A' ? m.teamA : m.teamB).players) {
        if (include && !include(m, p.id)) continue;
        let t = out.get(p.id);
        if (!t) {
          t = { playerId: p.id, matches: 0, wins: 0, points: 0, potm: 0, _at: -1 };
          out.set(p.id, t);
        }
        t.matches++;
        if (st.winner === side) t.wins++;
        t.points += pts[p.id]?.points ?? 0;
        if (m.playerOfMatchId === p.id) t.potm++;
        // name/photo from the most recent finished match
        if (at >= t._at) {
          t._at = at;
          if (p.name) t.name = p.name;
          if (p.photoURL !== undefined) t.photoURL = p.photoURL;
        }
      }
    }
  }
  return [...out.values()].map(({ _at, ...t }) => t);
}

/**
 * Convenience: totals + ranking from match documents (demo / Firebase mode). Pass `include` to
 * restrict to counted matches/players (core/antifraud.ts countedTotals does that for the backends).
 */
export const rankMatches = (matches: readonly RankableMatch[], include?: (m: RankableMatch, playerId: string) => boolean) => {
  const totals = totalsFromMatches(matches, include);
  return { ...rankPlayers(totals), totals };
};
