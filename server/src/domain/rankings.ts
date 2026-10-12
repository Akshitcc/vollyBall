/**
 * Rankings and the points wallet on the API server (1.3.0). Per player per match numbers come from
 * MySQL (the 0005 view player_finished_matches); WHICH matches and players count is decided by the
 * shared src/core/antifraud.ts countMatches() (completed + verified + not flagged + IST caps), and
 * the ranking itself by src/core/ranking.ts rankPlayers() – the same functions the demo and Firebase
 * backends use. Nothing here is stored: points, the win bonus and the wallet are derived per request.
 */
import { MIN_RANKED_MATCHES, rankPlayers, rowFor, type PlayerTotals, type RankingRow } from '../../../src/core/ranking';
import { countMatches, countedMatchIdsFor, walletFromTotals, walletHistory, resultState, type CountableMatch, type Wallet, type WalletHistoryItem, type WalletMatchLine } from '../../../src/core/antifraud';
import { INDOOR_RULES } from '../../../src/core/rules';
import type { Side } from '../../../src/core/scoring';
import { publicFileUrl, type Services } from '../context';
import { toMs, type Trx } from './util';

export const RANKINGS_MAX_LIMIT = 200;

interface PlayerRow {
  match_id: string;
  user_id: string;
  side: Side;
  won: number | string;
  credited_points: number | string;
  potm: number | string;
}

/** Light match records for countMatches (no event log: the winner comes from the stored summary). */
async function countableMatches(db: Trx): Promise<CountableMatch[]> {
  const rows = await db('matches')
    .where('status', 'finished')
    .whereNotNull('player_of_match_id')
    .whereIn('verification_status', ['confirmed', 'approved'])
    .select('id', 'status', 'summary', 'created_by', 'scorer_id', 'player_of_match_id', 'captain_a', 'captain_b', 'verification_status', 'captain_verdict', 'verified_by', 'verified_at', 'dispute_reason', 'started_server_at', 'finished_at', 'reopen_epoch', 'verdict_epoch');
  if (!rows.length) return [];
  const ids = rows.map((r: { id: string }) => r.id);
  const [sides, players] = await Promise.all([
    db('match_sides').whereIn('match_id', ids).select('match_id', 'side', 'team_id'),
    db('match_players').whereIn('match_id', ids).select('match_id', 'side', 'player_key'),
  ]);
  return rows.map((r: Record<string, unknown>): CountableMatch => {
    const summary = (typeof r.summary === 'string' ? JSON.parse(r.summary) : r.summary) as { winner?: Side | null } | null;
    const team = (side: Side) => ({
      teamId: (sides.find((x: { match_id: string; side: Side }) => x.match_id === r.id && x.side === side)?.team_id as string | null) ?? null,
      name: side,
      color: '#000000',
      players: players.filter((p: { match_id: string; side: Side }) => p.match_id === r.id && p.side === side).map((p: { player_key: string }) => ({ id: p.player_key, name: '' })),
    });
    return {
      id: r.id as string,
      status: 'finished',
      rules: INDOOR_RULES,
      events: [],
      teamA: team('A'),
      teamB: team('B'),
      createdBy: r.created_by as string,
      scorerId: r.scorer_id as string,
      playerOfMatchId: r.player_of_match_id as string,
      captains: r.captain_a && r.captain_b ? { A: r.captain_a as string, B: r.captain_b as string } : null,
      // 1.3.8 (V137-1): by/reason too, so an answer kept only in the older fields is recognised
      // (1.3.9, V138-3: and `at` – only an answer from before 1.3.7 may lack the verdict)
      verification: { status: r.verification_status as 'confirmed' | 'approved', captain: (r.captain_verdict as 'confirmed' | 'rejected' | null) ?? null, by: (r.verified_by as string | null) ?? null, at: toMs(r.verified_at as Date | null), reason: (r.dispute_reason as string | null) ?? null, epoch: Number(r.verdict_epoch ?? 0) },
      // 1.4.6 (QA V145-2): a verdict counts only in the current re-open epoch (core/antifraud.ts currentVerification)
      reopenEpoch: Number(r.reopen_epoch ?? 0),
      startedServerAt: toMs(r.started_server_at as Date | null),
      finishedServerAt: toMs(r.finished_at as Date | null),
      winner: summary?.winner ?? null,
    };
  });
}

/** matchId -> players whose result counts (shared core/antifraud.ts countMatches). */
async function countedMap(db: Trx): Promise<Map<string, Set<string>>> {
  return countMatches(await countableMatches(db)).counted;
}

/** Per-player totals over COUNTED matches only. */
export async function rankingTotals(s: Services, db: Trx, onlyUser?: string, pre?: Map<string, Set<string>>): Promise<PlayerTotals[]> {
  const counted = pre ?? (await countedMap(db));
  const ids = [...counted.keys()];
  if (!ids.length) return [];
  const q = db('player_finished_matches as v').whereIn('v.match_id', ids).select('v.match_id', 'v.user_id', 'v.side', 'v.won', 'v.credited_points', 'v.potm');
  if (onlyUser) q.where('v.user_id', onlyUser);
  const rows: PlayerRow[] = await q;
  const totals = new Map<string, PlayerTotals>();
  for (const r of rows) {
    if (!counted.get(r.match_id)?.has(r.user_id)) continue;
    const t = totals.get(r.user_id) ?? { playerId: r.user_id, matches: 0, wins: 0, points: 0, potm: 0 };
    t.matches++;
    t.wins += Number(r.won);
    t.points += Number(r.credited_points);
    t.potm += Number(r.potm);
    totals.set(r.user_id, t);
  }
  if (!totals.size) return [];
  const users: { id: string; name: string; photo_url: string | null }[] = await db('users').whereIn('id', [...totals.keys()]).select('id', 'name', 'photo_url');
  const out: PlayerTotals[] = [];
  for (const u of users) out.push({ ...totals.get(u.id)!, name: u.name, photoURL: publicFileUrl(s, u.photo_url) });
  return out;
}

export interface RankingsResponse {
  /** Top `limit` ranked players, best first. */
  ranked: RankingRow[];
  /** Number of ranked players (M in "Rank #N of M"). */
  total: number;
  minMatches: number;
  /** The requested player's row (ranked or not), or null with no counted matches. */
  me: RankingRow | null;
  /** QA C130-8: the viewer's counted match ids (Profile's Career stats use exactly these). */
  myCountedMatchIds: string[];
}

export async function getRankings(s: Services, viewerUid: string, limit = 100): Promise<RankingsResponse> {
  const counted = await countedMap(s.db);
  const totals = await rankingTotals(s, s.db, undefined, counted);
  const r = rankPlayers(totals);
  const own = totals.find((t) => t.playerId === viewerUid) ?? null;
  return {
    ranked: r.ranked.slice(0, Math.max(1, Math.min(limit, RANKINGS_MAX_LIMIT))),
    total: r.total,
    minMatches: MIN_RANKED_MATCHES,
    me: rowFor(r, viewerUid, own),
    myCountedMatchIds: countedMatchIdsFor(counted, viewerUid),
  };
}

export interface WalletResponse extends Wallet {
  /** My completed matches still waiting for the opposing captain. */
  awaitingConfirmation: number;
  /** My completed matches flagged for an admin. */
  flagged: number;
  /** QA C130-7: points history, newest first (derived from counted matches, never stored). */
  history: WalletHistoryItem[];
}

/** My counted matches as history lines: per-match numbers from the same view as rankingTotals. */
async function walletLinesSql(db: Trx, uid: string, counted: Map<string, Set<string>>, finishedAt: Map<string, number>): Promise<WalletMatchLine[]> {
  const ids = countedMatchIdsFor(counted, uid);
  if (!ids.length) return [];
  const [rows, sides] = await Promise.all([
    db('player_finished_matches').whereIn('match_id', ids).where('user_id', uid).select('match_id', 'user_id', 'side', 'won', 'credited_points', 'potm') as Promise<PlayerRow[]>,
    db('match_sides').whereIn('match_id', ids).select('match_id', 'side', 'name') as Promise<{ match_id: string; side: Side; name: string }[]>,
  ]);
  return rows.map((r) => ({
    matchId: r.match_id,
    at: finishedAt.get(r.match_id) ?? 0,
    opponent: sides.find((x) => x.match_id === r.match_id && x.side !== r.side)?.name ?? '',
    won: Number(r.won) > 0,
    potm: Number(r.potm) > 0,
    credited: Number(r.credited_points),
  }));
}

/** GET /me/wallet: read-only, derived. There is deliberately no redeem/transfer endpoint. */
export async function getWallet(s: Services, uid: string, loadMine: () => Promise<CountableMatch[]>): Promise<WalletResponse> {
  const ms = await countableMatches(s.db);
  const counted = countMatches(ms).counted;
  const [mine] = await rankingTotals(s, s.db, uid, counted);
  const finishedAt = new Map(ms.map((m) => [m.id, m.finishedServerAt ?? 0]));
  const lines = await walletLinesSql(s.db, uid, counted, finishedAt);
  const recent = await loadMine();
  const states = recent.map(resultState);
  return {
    ...walletFromTotals(mine ?? null),
    awaitingConfirmation: states.filter((x) => x === 'awaiting_confirmation').length,
    flagged: states.filter((x) => x === 'flagged').length,
    history: walletHistory(lines),
  };
}
