/**
 * Anti-fraud and points (1.3.0). Pure TypeScript: the ONE implementation of which matches count,
 * shared by the API server (server/src/domain/rankings.ts), the Firebase and demo backends and the UI.
 * Decision (Akshit, relayed by Dream): no real-money conversion and no ID numbers. Points are in-app
 * only; there is no redeem/cash feature anywhere.
 *
 * A match COUNTS (towards rankings, the wallet and the win bonus) only if all of these hold:
 *   1. it is completed: status 'finished', a winner from the event log, and a Player of the Match;
 *   2. its result is verified: confirmed by the OPPOSING captain (never the scoring side);
 *   3. it is not flagged – flagged matches (too short, missing server times, disputed) are excluded
 *      until an admin reviews them. 1.3.7 (F135-1, safe default): an admin's approval only CLEARS
 *      THE FLAG – the match still needs the opposing captain's confirmation, and a match the
 *      opponent rejected never counts through approval alone. Void = never counts. One switch:
 *      ADMIN_APPROVAL.COUNTS_WITHOUT_CAPTAIN (false); firestore.rules repeat it in adminApprovalCounts().
 *   4. the same team pair has fewer than MAX_COUNTED_PER_PAIR_PER_WEEK counted matches that IST
 *      week (weeks start Monday 00:00 IST);
 * and, per player, they have fewer than MAX_COUNTED_PER_PLAYER_PER_DAY counted matches that IST day.
 * Days and weeks come from the SERVER finish time. Matches are taken in order of server finish time
 * (then id), so the result is deterministic on every device and the server.
 *
 * The win bonus (+BONUS_POINTS per BONUS_EVERY_WINS counted wins) is always derived, never stored.
 */
import type { Match, MatchCaptains, MatchVerification, VerificationStatus } from './types';
import { computeState, type Side } from './scoring';
import { rankingPoints, totalsFromMatches, type PlayerTotals, type RankableMatch } from './ranking';

export const ANTI_FRAUD = Object.freeze({
  /** A match shorter than this (server start to server finish) is flagged 'too_short'. */
  MIN_MATCH_MINUTES: 10,
  /** Counted matches per player per IST calendar day. */
  MAX_COUNTED_PER_PLAYER_PER_DAY: 3,
  /** Counted matches per team pair per IST week (Monday 00:00 IST start). */
  MAX_COUNTED_PER_PAIR_PER_WEEK: 2,
  /** India Standard Time, UTC+05:30 (no daylight saving). */
  IST_OFFSET_MINUTES: 330,
  /** +BONUS_POINTS for every BONUS_EVERY_WINS counted wins. */
  BONUS_EVERY_WINS: 5,
  BONUS_POINTS: 100,
  /** Reject reason length (UTF-16 units). */
  REJECT_REASON_MAX: 200,
});

/**
 * 1.3.7 (F135-1): what an admin's "approve" means. false (default, safe) = it only clears the fraud
 * flag; the match counts once the opposing captain has also confirmed. true = approval alone counts
 * (the 1.3.0–1.3.6 behaviour). Change it here: the API server and the demo backend import it;
 * firestore.rules repeat the value in adminApprovalCounts() (rules-tests check that they agree).
 */
export const ADMIN_APPROVAL = Object.freeze({ COUNTS_WITHOUT_CAPTAIN: false as boolean });

export const MIN_MATCH_MS = ANTI_FRAUD.MIN_MATCH_MINUTES * 60_000;
const IST_MS = ANTI_FRAUD.IST_OFFSET_MINUTES * 60_000;
const DAY_MS = 86_400_000;

/** IST calendar day of a server time, 'YYYY-MM-DD'. */
export function istDayKey(ms: number): string {
  return new Date(ms + IST_MS).toISOString().slice(0, 10);
}
/** Monday (IST) of the week containing a server time, 'YYYY-MM-DD'. */
export function istWeekKey(ms: number): string {
  const d = new Date(ms + IST_MS);
  const sinceMonday = (d.getUTCDay() + 6) % 7;
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - sinceMonday * DAY_MS).toISOString().slice(0, 10);
}

export const winBonus = (wins: number): number =>
  Math.floor(Math.max(0, wins) / ANTI_FRAUD.BONUS_EVERY_WINS) * ANTI_FRAUD.BONUS_POINTS;
/** Counted wins still needed for the next bonus (1..BONUS_EVERY_WINS). */
export const winsToNextBonus = (wins: number): number => ANTI_FRAUD.BONUS_EVERY_WINS - (Math.max(0, wins) % ANTI_FRAUD.BONUS_EVERY_WINS);

/** The match fields anti-fraud needs. */
export type CountableMatch = RankableMatch &
  Pick<Match, 'id' | 'status' | 'teamA' | 'teamB' | 'createdBy' | 'scorerId'> & {
    captains?: MatchCaptains | null;
    verification?: MatchVerification | null;
    startedServerAt?: number | null;
    finishedServerAt?: number | null;
    playerOfMatchId?: string | null;
    /** Precomputed winner (API server: from the stored summary) – skips replaying the event log. */
    winner?: Side | null;
  };

export const verificationStatus = (m: { verification?: MatchVerification | null }): VerificationStatus => m.verification?.status ?? 'pending';

/** 1.3.7: the opposing captain's verdict, whatever an admin did afterwards (older data: from the status). */
export function captainVerdict(m: { verification?: MatchVerification | null }): 'confirmed' | 'rejected' | null {
  const v = m.verification;
  if (v?.captain) return v.captain;
  const st = verificationStatus(m);
  if (st === 'confirmed') return 'confirmed';
  if (st === 'disputed') return 'rejected';
  // 1.3.8 (V137-1): reviewed before the verdict field existed (1.3.6 data, or a 1.3.6 client before an
  // admin approved): the captain's answer is still in the older fields. `by` set = the opposing captain
  // answered; a reject reason means they rejected, no reason = they confirmed. (A 1.3.6 rejection sent
  // with no reason can't be told apart from a confirmation; it counted under 1.3.6 as well.)
  // 1.3.9 (V138-3): only for answers recorded BEFORE 1.3.7 (v.at, the server-stamped answer time, is
  // the marker). Since 1.3.7 every client writes `captain`, and the rules/API now require it, so a newer
  // answer without it is not a trusted shape: it reads as unanswered (doesn't count).
  if ((st === 'approved' || st === 'voided') && v?.by && isLegacyAnswer(v)) return v.reason ? 'rejected' : 'confirmed';
  return null;
}

/**
 * 1.3.9 (V138-3): captain answers stamped before this time (server clock, ms) may lack the `captain`
 * verdict (1.3.6 clients); from 1.3.7 on every answer carries it. 2026-10-11 10:00 UTC = the 1.3.7
 * build. Data from a server that stayed on 1.3.6 longer: set this to the date that server moved to
 * 1.3.7+ (docs/DEPLOY.md) – on the API the 0012 backfill has already written those verdicts anyway.
 */
export const LEGACY_VERDICT_BEFORE = Date.UTC(2026, 9, 11, 10, 0, 0);
export const isLegacyAnswer = (v: { at?: number | null }) => typeof v.at === 'number' && v.at < LEGACY_VERDICT_BEFORE;

/** 1.3.9 (V138-11): when the opposing captain confirmed (null = not confirmed). Never one of the match's own times. */
export function confirmedAtOf(m: { confirmedAt?: number | null; verification?: MatchVerification | null }): number | null {
  if (m.confirmedAt != null) return m.confirmedAt;
  return captainVerdict(m) === 'confirmed' ? m.verification?.at ?? null : null;
}

/**
 * 1.3.9 (V138-11): the match's own date – finished, else started, else scheduled, else created. Lists of
 * a player's matches are ordered by it (not by updatedAt, which a confirmation or review also bumps).
 */
export const matchDate = (m: { finishedAt?: number | null; startedAt?: number | null; scheduledAt?: number | null; createdAt: number }): number =>
  m.finishedAt ?? m.startedAt ?? m.scheduledAt ?? m.createdAt;
export const byMatchDateDesc = <T extends Parameters<typeof matchDate>[0] & { id: string }>(a: T, b: T): number =>
  matchDate(b) - matchDate(a) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** 1.3.7: an admin cleared the flag, but the opposing captain hasn't confirmed yet (so it doesn't count yet). */
export function awaitingOpponentAfterApproval(m: CountableMatch, policy = ADMIN_APPROVAL): boolean {
  return !policy.COUNTS_WITHOUT_CAPTAIN && verificationStatus(m) === 'approved' && captainVerdict(m) === null;
}

export function matchWinner(m: Pick<RankableMatch, 'rules' | 'events' | 'firstServe'> & { winner?: Side | null }): Side | null {
  if (m.winner !== undefined) return m.winner;
  return computeState(m.rules, m.events, m.firstServe ?? 'A').winner;
}

/** Finished with a winner and a Player of the Match (the only state that can count). */
export function isCompleted(m: CountableMatch): boolean {
  return m.status === 'finished' && !!m.playerOfMatchId && matchWinner(m) !== null;
}

/** The match is over on the scoreboard but the Player of the Match hasn't been picked yet. */
export function awaitingPotm(m: CountableMatch): boolean {
  return m.status === 'finished' && !m.playerOfMatchId;
}

export type FraudFlag = 'too_short' | 'no_server_times' | 'disputed';

/** Automatic flags (derived on every read, never stored). */
export function matchFlags(m: CountableMatch): FraudFlag[] {
  const out: FraudFlag[] = [];
  const st = m.startedServerAt;
  const fin = m.finishedServerAt;
  if (st == null || fin == null) out.push('no_server_times');
  else if (fin - st < MIN_MATCH_MS) out.push('too_short');
  if (verificationStatus(m) === 'disputed') out.push('disputed');
  return out;
}

/** Flagged and still waiting for an admin (approve or void). */
export function needsReview(m: CountableMatch): boolean {
  const v = verificationStatus(m);
  return isCompleted(m) && v !== 'approved' && v !== 'voided' && matchFlags(m).length > 0;
}

/** Completed, verified and not flagged (or approved by an admin). Caps are applied on top. */
export function isEligible(m: CountableMatch, policy = ADMIN_APPROVAL): boolean {
  if (!isCompleted(m)) return false;
  const v = verificationStatus(m);
  if (v === 'approved') return policy.COUNTS_WITHOUT_CAPTAIN || captainVerdict(m) === 'confirmed';
  return v === 'confirmed' && matchFlags(m).length === 0;
}

/** One state for the UI badge. */
export type ResultState = 'not_finished' | 'awaiting_potm' | 'awaiting_confirmation' | 'confirmed' | 'flagged' | 'approved' | 'voided' | 'abandoned' | 'approved_awaiting_confirmation' | 'approved_rejected';
export function resultState(m: CountableMatch): ResultState {
  if (m.status === 'abandoned') return 'abandoned';
  if (m.status !== 'finished') return 'not_finished';
  if (!m.playerOfMatchId) return 'awaiting_potm';
  const v = verificationStatus(m);
  if (v === 'voided') return 'voided';
  if (v === 'approved' && !ADMIN_APPROVAL.COUNTS_WITHOUT_CAPTAIN) {
    const c = captainVerdict(m);
    if (c === null) return 'approved_awaiting_confirmation';
    if (c === 'rejected') return 'approved_rejected';
    // 1.3.8 (V137-13): flag cleared and the opposing captain confirmed: show the result as confirmed
    // (the latest state, and what makes it count), not "Approved by an admin".
    return 'confirmed';
  }
  if (v === 'approved') return 'approved';
  if (matchFlags(m).length) return 'flagged';
  return v === 'confirmed' ? 'confirmed' : 'awaiting_confirmation';
}

/** Key of one side for the pair cap: the registered team, else its captain, else its sorted players. */
export function sideKey(m: Pick<CountableMatch, 'teamA' | 'teamB' | 'captains'>, side: Side): string {
  const t = side === 'A' ? m.teamA : m.teamB;
  const teamId = (t as { teamId?: string | null }).teamId;
  if (teamId) return `team:${teamId}`;
  const cap = m.captains?.[side];
  if (cap) return `captain:${cap}`;
  return `players:${t.players.map((p) => p.id).sort().join(',')}`;
}
/** Order-independent key of the two sides. */
export const pairKey = (m: Pick<CountableMatch, 'teamA' | 'teamB' | 'captains'>): string => [sideKey(m, 'A'), sideKey(m, 'B')].sort().join(' v ');

export type ExclusionReason = 'not_completed' | 'unverified' | 'flagged' | 'voided' | 'pair_weekly_cap' | 'player_daily_cap';

export interface CountResult {
  /** matchId -> players of that match whose result counts. */
  counted: Map<string, Set<string>>;
  /** matchId -> why the whole match doesn't count (player_daily_cap is per player, see playerExcluded). */
  excluded: Map<string, ExclusionReason>;
  /** `${matchId}|${playerId}` for players dropped by the daily cap. */
  playerExcluded: Set<string>;
}

const playersOf = (m: CountableMatch) => [...m.teamA.players, ...m.teamB.players].map((p) => p.id);

export function countMatches(matches: readonly CountableMatch[]): CountResult {
  const counted = new Map<string, Set<string>>();
  const excluded = new Map<string, ExclusionReason>();
  const playerExcluded = new Set<string>();
  const eligible: CountableMatch[] = [];
  for (const m of matches) {
    if (!isCompleted(m)) excluded.set(m.id, 'not_completed');
    else if (verificationStatus(m) === 'voided') excluded.set(m.id, 'voided');
    else if (!isEligible(m)) excluded.set(m.id, matchFlags(m).length ? 'flagged' : 'unverified');
    else eligible.push(m);
  }
  eligible.sort((a, b) => (a.finishedServerAt ?? 0) - (b.finishedServerAt ?? 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const pairWeek = new Map<string, number>();
  const playerDay = new Map<string, number>();
  for (const m of eligible) {
    const at = m.finishedServerAt ?? 0;
    const pk = `${pairKey(m)}#${istWeekKey(at)}`;
    const n = pairWeek.get(pk) ?? 0;
    if (n >= ANTI_FRAUD.MAX_COUNTED_PER_PAIR_PER_WEEK) {
      excluded.set(m.id, 'pair_weekly_cap');
      continue;
    }
    pairWeek.set(pk, n + 1);
    const day = istDayKey(at);
    const ok = new Set<string>();
    for (const p of new Set(playersOf(m))) {
      const k = `${p}#${day}`;
      const c = playerDay.get(k) ?? 0;
      if (c >= ANTI_FRAUD.MAX_COUNTED_PER_PLAYER_PER_DAY) playerExcluded.add(`${m.id}|${p}`);
      else {
        playerDay.set(k, c + 1);
        ok.add(p);
      }
    }
    counted.set(m.id, ok);
  }
  return { counted, excluded, playerExcluded };
}

/**
 * QA C130-8 (1.3.1): ids of the matches whose result counts for `playerId`. The rankings result carries
 * them so Profile's Career stats are computed over exactly the matches behind the rank card (and the
 * wallet): one source, so the two can never disagree (e.g. rank card 0 matches, Career stats 3).
 */
export function countedMatchIdsFor(counted: ReadonlyMap<string, ReadonlySet<string>>, playerId: string): string[] {
  const out: string[] = [];
  for (const [id, players] of counted) if (players.has(playerId)) out.push(id);
  return out;
}

/** Per-player totals over COUNTED matches only (the ranking maths is core/ranking.ts). */
export function countedTotals(matches: readonly CountableMatch[]): PlayerTotals[] {
  const { counted } = countMatches(matches);
  return totalsFromMatches(
    matches.filter((m) => counted.has(m.id)),
    (m, playerId) => counted.get((m as CountableMatch).id)?.has(playerId) ?? false,
  );
}

export interface Wallet {
  /** In-app points only (no cash value, nothing to redeem). */
  balance: number;
  points: number;
  wins: number;
  potm: number;
  /** Ranking points from points, wins and POTM awards (core/ranking.ts rankingPoints). */
  matchPoints: number;
  /** Derived win bonus. */
  bonus: number;
  winsToNextBonus: number;
  countedMatches: number;
}

export function walletFromTotals(t: Pick<PlayerTotals, 'points' | 'wins' | 'potm' | 'matches'> | null | undefined): Wallet {
  const x = t ?? { points: 0, wins: 0, potm: 0, matches: 0 };
  const matchPoints = rankingPoints(x);
  const bonus = winBonus(x.wins);
  return { balance: matchPoints + bonus, points: x.points, wins: x.wins, potm: x.potm, matchPoints, bonus, winsToNextBonus: winsToNextBonus(x.wins), countedMatches: x.matches };
}

// ---------------- points history (QA C130-7, 1.3.1) ----------------
/** One counted match of the player (input of walletHistory). */
export interface WalletMatchLine {
  matchId: string;
  /** Server finish time (ms). */
  at: number;
  opponent: string;
  won: boolean;
  potm: boolean;
  /** Points credited to the player in "Who scored". */
  credited: number;
}
/** One row of the wallet's points history. Derived on every read from counted matches; never stored. */
export type WalletHistoryItem =
  | ({ kind: 'match'; points: number } & WalletMatchLine)
  | { kind: 'bonus'; matchId: string; at: number; points: number; /** the counted-win milestone reached (5, 10, …) */ wins: number };
/** Most rows returned (newest first); the balance is always the full total. */
export const WALLET_HISTORY_MAX = 100;

/**
 * The points history: one row per counted match (its ranking points: credited points + win + POTM,
 * core/ranking.ts rankingPoints) and one bonus row at every BONUS_EVERY_WINS-th counted win. Newest
 * first; with no cap applied the rows add up to the balance exactly.
 */
export function walletHistory(lines: readonly WalletMatchLine[], max = WALLET_HISTORY_MAX): WalletHistoryItem[] {
  const sorted = [...lines].sort((a, b) => a.at - b.at || (a.matchId < b.matchId ? -1 : a.matchId > b.matchId ? 1 : 0));
  const out: WalletHistoryItem[] = [];
  let wins = 0;
  for (const l of sorted) {
    out.push({ kind: 'match', ...l, points: rankingPoints({ points: l.credited, wins: l.won ? 1 : 0, potm: l.potm ? 1 : 0 }) });
    if (l.won && ++wins % ANTI_FRAUD.BONUS_EVERY_WINS === 0) out.push({ kind: 'bonus', matchId: l.matchId, at: l.at, points: ANTI_FRAUD.BONUS_POINTS, wins });
  }
  return out.reverse().slice(0, max);
}

/** The player's counted matches as history lines (demo / Firebase; the API server reads them in SQL). */
export function walletLines(matches: readonly CountableMatch[], playerId: string, counted = countMatches(matches).counted): WalletMatchLine[] {
  const out: WalletMatchLine[] = [];
  for (const m of matches) {
    if (!counted.get(m.id)?.has(playerId)) continue;
    const side = sideOfPlayer(m, playerId);
    if (!side) continue;
    const t = totalsFromMatches([m], (_x, p) => p === playerId).find((x) => x.playerId === playerId);
    out.push({
      matchId: m.id,
      at: m.finishedServerAt ?? 0,
      opponent: (side === 'A' ? m.teamB : m.teamA).name,
      won: (t?.wins ?? 0) > 0,
      potm: (t?.potm ?? 0) > 0,
      credited: t?.points ?? 0,
    });
  }
  return out;
}

/** The wallet screen: balance + the player's matches still waiting (they don't count yet). */
export interface PlayerWallet extends Wallet {
  /** Own completed matches still waiting for the opposing captain. */
  awaitingConfirmation: number;
  /** Own completed matches flagged until an admin reviews them. */
  flagged: number;
  /** QA C130-7: where the points came from, newest first (derived, never stored). */
  history: WalletHistoryItem[];
}
export function playerWallet(matches: readonly CountableMatch[], playerId: string): PlayerWallet {
  const totals = countedTotals(matches).find((t) => t.playerId === playerId);
  const mine = matches.filter((m) => playersOf(m).includes(playerId));
  return {
    ...walletFromTotals(totals),
    awaitingConfirmation: mine.filter((m) => resultState(m) === 'awaiting_confirmation').length,
    flagged: mine.filter(needsReview).length,
    history: walletHistory(walletLines(matches, playerId)),
  };
}

// ---------------- captains and confirmation ----------------
export type CaptainProblem = 'captains_required' | 'captains_same' | 'captain_not_team_captain' | 'captain_not_on_side';
export const CAPTAIN_MESSAGES: Record<CaptainProblem, string> = {
  captains_required: 'Name a captain for both sides',
  captains_same: 'The two captains must be different people',
  captain_not_team_captain: "A registered team's captain is its match captain",
  captain_not_on_side: 'A captain must be a player of their side',
};

/**
 * Captains at creation: a registered team side -> that team's captain (teamCaptains[side]); a side
 * built by number -> a player of that side, named by the creator.
 */
export function captainsProblem(
  m: Pick<Match, 'teamA' | 'teamB'> & { captains?: MatchCaptains | null },
  teamCaptains: { A?: string | null; B?: string | null } = {},
): CaptainProblem | null {
  const c = m.captains;
  if (!c || typeof c.A !== 'string' || typeof c.B !== 'string' || !c.A || !c.B) return 'captains_required';
  if (c.A === c.B) return 'captains_same';
  for (const side of ['A', 'B'] as Side[]) {
    const t = side === 'A' ? m.teamA : m.teamB;
    if (t.teamId) {
      if (teamCaptains[side] !== c[side]) return 'captain_not_team_captain';
    } else if (!t.players.some((p) => p.id === c[side])) return 'captain_not_on_side';
  }
  return null;
}

/** Side whose roster contains the user (null = not a player). */
export function sideOfPlayer(m: Pick<Match, 'teamA' | 'teamB'>, uid: string): Side | null {
  if (m.teamA.players.some((p) => p.id === uid)) return 'A';
  if (m.teamB.players.some((p) => p.id === uid)) return 'B';
  return null;
}

export type ConfirmProblem = 'not_completed' | 'not_captain' | 'scoring_side' | 'already_reviewed' | 'no_captains';
export const CONFIRM_MESSAGES: Record<ConfirmProblem, string> = {
  not_completed: 'Only a finished match with a Player of the Match can be confirmed',
  not_captain: 'Only the opposing captain can confirm or reject the result',
  scoring_side: "The scoring side can't confirm its own result",
  already_reviewed: 'This result was already confirmed or rejected',
  no_captains: 'This match has no captains to confirm it',
};

/**
 * Who may confirm/reject: a captain of the match who is not the scorer, not the creator, and not on
 * the side the scorer or creator plays for. Only once, from pending, on a completed match – or (1.3.7)
 * after an admin cleared the flag while the captain hadn't answered yet.
 */
export function confirmProblem(m: CountableMatch, uid: string): ConfirmProblem | null {
  if (!isCompleted(m)) return 'not_completed';
  if (!m.captains) return 'no_captains';
  const side: Side | null = m.captains.A === uid ? 'A' : m.captains.B === uid ? 'B' : null;
  if (!side) return 'not_captain';
  if (uid === m.scorerId || uid === m.createdBy) return 'scoring_side';
  if (sideOfPlayer(m, m.scorerId) === side || sideOfPlayer(m, m.createdBy) === side) return 'scoring_side';
  const st = verificationStatus(m);
  // 1.3.8 (V137-1): an answer recorded in the older fields (1.3.6: `by` without a verdict) counts as answered
  if (st !== 'pending' && !(st === 'approved' && captainVerdict(m) === null)) return 'already_reviewed';
  return null;
}

/** Captain who should confirm (for the UI), or null when nobody can. */
export function expectedConfirmer(m: Pick<CountableMatch, 'captains' | 'teamA' | 'teamB' | 'scorerId' | 'createdBy'>): string | null {
  if (!m.captains) return null;
  for (const side of ['A', 'B'] as Side[]) {
    const c = m.captains[side];
    if (c === m.scorerId || c === m.createdBy) continue;
    if (sideOfPlayer(m, m.scorerId) === side || sideOfPlayer(m, m.createdBy) === side) continue;
    return c;
  }
  return null;
}

/** Terminal: abandoned, or completed (finished + POTM). Nothing about the score/status changes after. */
export const isTerminal = (m: Pick<Match, 'status' | 'playerOfMatchId'>): boolean =>
  m.status === 'abandoned' || (m.status === 'finished' && !!m.playerOfMatchId);

/**
 * Allowed status moves (anything else is refused). finished -> live only while awaiting POTM (undo);
 * live -> scheduled only before the first rally (the start time is cleared again).
 */
export function statusMoveOk(before: Pick<Match, 'status' | 'playerOfMatchId'> & { events?: readonly unknown[] }, next: Match['status']): boolean {
  if (before.status === next) return true;
  if (isTerminal(before)) return false;
  switch (before.status) {
    case 'scheduled':
      return next === 'live' || next === 'abandoned';
    case 'live':
      return next === 'finished' || next === 'abandoned' || (next === 'scheduled' && !(before.events?.length ?? 0));
    case 'finished':
      return next === 'live';
    default:
      return false;
  }
}

/**
 * 1.3.5 (QA E134-2): an admin may never approve or void a match they are part of: its creator, its
 * scorer, a captain, or a player on either side (by roster or by the participant list). Enforced by
 * every backend (demo, API server, Firebase client) and by firestore.rules.
 */
export const OWN_MATCH_REVIEW = 'own_match';
export const OWN_MATCH_REVIEW_MESSAGE = "You can't review a match you played in, scored or created";
export function ownMatchReview(m: Pick<Match, 'teamA' | 'teamB' | 'createdBy' | 'scorerId'> & { participantIds?: string[]; captains?: MatchCaptains | null }, uid: string): boolean {
  if (!uid) return false;
  if (uid === m.createdBy || uid === m.scorerId) return true;
  if (m.captains && (m.captains.A === uid || m.captains.B === uid)) return true;
  if (sideOfPlayer(m, uid)) return true;
  return !!m.participantIds?.includes(uid);
}
