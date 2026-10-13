/**
 * Matches: normalised into matches + match_sides + match_players +
 * match_participants + play_requests + points/timeouts (the event log) +
 * sets (materialised) + set_lineups (rotation). The API still speaks the app's
 * `Match` shape, so the UI and the event-sourced scoring engine are unchanged.
 */
import type { RuleSet } from '../../../src/core/rules';
import { PARTICIPANTS_MESSAGE, ROSTER_MESSAGES, canonicalParticipants, isAbandonOnly, missingPlayers, participantsMatchRoster, rosterErrors } from '../../../src/core/roster';
import { offCourtCredit, rotationTimeline, type Lineups, type RotationState } from '../../../src/core/rotation';
import { computeState, summarize, type MatchEvent, type Side } from '../../../src/core/scoring';
import type { Match, MatchPlayer, MatchTeam, StreamInfo } from '../../../src/core/types';
import { notify, publicFileUrl, storedFileUrl, type Services } from '../context';
import { badRequest, forbidden, HttpError, notFound } from '../errors';
import { POTM_MESSAGES, potmProblem } from '../../../src/core/potm';
import { hasStoredRegistration } from '../../../src/core/registration';
import { dobString } from './users';
import type { Identity } from '../auth/verifier';
import { topics } from '../live/bus';
import { checkNotPast, checkOrder, MAX_SCHEDULE_AHEAD_MS, scheduleMsOk, TIME_INVALID_CODE, ValidationError } from '../../../src/core/validate';
import { ABANDON_PENDING, deleteProblem, finishedFreezeProblem, GUARD_MESSAGES, MATCH_DELETE_FORBIDDEN, MATCH_FINISHED, MATCH_RULES_END, MATCH_SETUP_LOCKED, matchOver, SETUP_FIELDS, verdictSetupChanged } from '../../../src/core/matchGuards';
import { maxEventsOf } from '../../../src/core/lifecycle';
import { abandonPatch, ABANDON_MESSAGES, answerAbandon, needsAdminAction, planAbandon, resolvePatch, type AbandonAnswer, type ResolveAction } from '../../../src/core/abandon';
import { CodedError } from '../../../src/core/codedError';
import { REPAIR_INVALID, REPAIR_MESSAGES, repairPatch, type RepairFix } from '../../../src/core/verdictRepair';
import { eligibleHandoffAdmins, HANDOVER_MESSAGES, handoverProblem, reassignProblem, reassignRecord } from '../../../src/core/scorerHandoff';
import { reportAbandon } from '../../../src/core/abandon';
import {
  CAPTAIN_MESSAGES,
  CONFIRM_MESSAGES,
  captainsProblem,
  MATCH_NO_VERDICT,
  MATCH_NO_VERDICT_MESSAGE,
  verdictSetupProblem,
  captainVerdict,
  confirmProblem,
  currentVerification,
  expectedConfirmer,
  isCompleted,
  isTerminal,
  needsReview,
  OWN_MATCH_REVIEW,
  OWN_MATCH_REVIEW_MESSAGE,
  ownMatchReview,
  statusMoveOk,
} from '../../../src/core/antifraud';
import type { MatchCaptains, MatchVerification, VerificationStatus } from '../../../src/core/types';
import { isAdmin } from '../context';
import { canonical, changedKeys, insertRuleSet, loadRuleSets, minus, newId, nowDate, txRetry, placeCols, placeFromRow, toDate, toMs, type Trx } from './util';

export const MATCH_NO_WINNER = 'match_no_winner';
export const MATCH_NO_WINNER_MESSAGE = 'A match can only be finished when a team has won the required sets';

/**
 * QA NB-R3: finishedAt is set by the server, never taken from the client. It is stamped when the
 * match enters 'finished' or 'abandoned', kept while it stays there, and cleared otherwise.
 */
export function serverFinishedAt(before: Pick<Doc, 'status' | 'finishedAt'> | null, status: Doc['status'], now = Date.now()): number | null {
  if (status !== 'finished' && status !== 'abandoned') return null;
  return before && before.status === status && before.finishedAt != null ? before.finishedAt : now;
}

/** Match as returned by the API: the app's Match plus the derived court rotation. */
export type ApiMatch = Match & { rotation: RotationState };

/** Server-only fields (1.3.0): never part of a client document, written by dedicated actions only. */
type ServerOnly = 'verification' | 'startedServerAt' | 'finishedServerAt' | 'confirmedAt';
/** 1.4.5: written by the abandon / resolve actions and the scoring writes only (core/matchGuards.ts MATCH_ACTION_FIELDS). */
type ActionOnly = 'maxEvents' | 'wasWon' | 'abandon' | 'abandonRequest' | 'resolution' | 'scorerReassign' | 'reopenEpoch' | 'abandonHistory' | 'abandonRequests' | 'abandonRequestAt' | 'verdictRepair';
type Doc = Omit<Match, 'id' | 'summary' | 'createdAt' | 'updatedAt' | ServerOnly | ActionOnly>;
/** The stored match before a write: the document plus what the actions keep. */
type Stored = Doc & Pick<Match, ActionOnly>;
export const MATCH_KEYS: (keyof Doc)[] = [
  'title', 'teamA', 'teamB', 'rules', 'firstServe', 'events', 'status', 'createdBy', 'scorerId', 'participantIds', 'location',
  'scheduledAt', 'startedAt', 'finishedAt', 'tournamentId', 'fixtureId', 'challengeId', 'stream', 'interestedIds', 'lineups', 'captains', 'teamSizeMode',
];

export const MATCH_TERMINAL = 'match_terminal';
export const MATCH_STATUS_MOVE = 'match_status_move';
export const MATCH_BAD_STATUS = 'match_bad_status';

export type MatchBranch = 'scorer' | 'handover' | 'interestedToggle';

/** Port of `allow update` in `match /matches/{matchId}` (firestore.rules). */
export function decideMatchUpdate(before: Doc, after: Doc, viewer: Identity): MatchBranch {
  const uid = viewer.uid;
  const isScorer = before.scorerId === uid;
  const changed = changedKeys(before, after, MATCH_KEYS);
  // (isScorer() && scorerId unchanged && createdBy unchanged) – the scorer controls the score, lineups, status…
  if (isScorer && after.scorerId === before.scorerId && after.createdBy === before.createdBy) return 'scorer';
  // (createdBy == uid() || isScorer()) && changed().hasOnly(['scorerId', 'updatedAt'])
  if ((before.createdBy === uid || isScorer) && changed.every((k) => k === 'scorerId')) return 'handover';
  // interestedToggle(): only interestedIds changes and the symmetric difference is exactly the caller
  const b = before.interestedIds ?? [];
  const a = after.interestedIds ?? [];
  if (changed.every((k) => k === 'interestedIds') && [...minus(a, b), ...minus(b, a)].every((x) => x === uid)) return 'interestedToggle';
  if (changed.includes('lineups') || changed.includes('events')) throw forbidden('matches.update.scorer', 'Only the scorer can change the score or the lineup');
  throw forbidden('matches.update', 'Only the scorer can change this match');
}

// ---------------- validation ----------------
const rosterOf = (t: MatchTeam) => t.players.map((p) => p.id);

/**
 * Rejects events the scoring engine would never produce: anything after the end,
 * timeouts over the limit, and point credits for a player who is not on the team
 * that won the rally (QA bug A: a credit must belong to the scoring team).
 */
export function validateEvents(
  rules: RuleSet,
  events: MatchEvent[],
  firstServe: Side,
  rosters: { A: Set<string>; B: Set<string> },
  from = 0,
  court?: { order: { A: string[]; B: string[] }; lineups: Lineups | null | undefined; from: number },
) {
  for (let i = from; i < events.length; i++) {
    const ev = events[i];
    const st = computeState(rules, events.slice(0, i), firstServe);
    if (st.finished) throw badRequest(`Event ${i + 1} comes after the end of the match`);
    if (ev.type === 'timeout' && st.timeoutsLeft[ev.side] <= 0) throw badRequest(`Event ${i + 1}: no timeouts left for team ${ev.side}`);
    if (ev.type === 'point' && ev.playerId && !rosters[ev.side].has(ev.playerId)) throw badRequest(`Event ${i + 1}: ${ev.playerId} is not a player of team ${ev.side}`);
  }
  // 1.3.4 (QA D133-5): a NEW credited point must name a player who was on court for that rally (the
  // set's lineup – substitutions go through the per-set lineups – rotated by the rallies before it).
  // Only events from court.from (the first changed event) are checked, so a match recorded before
  // 1.3.4 whose old events credited a bench player can still be saved.
  if (court) {
    const bench = offCourtCredit(rules, events, firstServe, court.order, court.lineups, court.from);
    if (bench) throw new HttpError(400, 'not_on_court', `Event ${bench.index + 1}: ${bench.playerId} was not on court for team ${bench.side}`);
  }
}

/** Lineups: set 1..bestOf, 6 slots per side, only that side's players, nobody twice in a set. */
export function validateLineups(lineups: Lineups | null | undefined, rules: RuleSet, teamA: MatchTeam, teamB: MatchTeam) {
  if (!lineups) return;
  for (const [set, sides] of Object.entries(lineups)) {
    if (Number(set) > rules.bestOf) throw badRequest(`Lineup for set ${set} but the match is best of ${rules.bestOf}`);
    const seen = new Set<string>();
    for (const side of ['A', 'B'] as Side[]) {
      const roster = new Set(rosterOf(side === 'A' ? teamA : teamB));
      for (const p of sides[side]) {
        if (p === null) continue;
        if (!roster.has(p)) throw badRequest(`Set ${set}: ${p} is not a player of team ${side}`);
        if (seen.has(p)) throw badRequest(`Set ${set}: ${p} is in the lineup twice`);
        seen.add(p);
      }
    }
  }
}

/** Shape rules shared with the app (core/roster.ts): 12 max, nobody twice, nobody on both teams. */
function validateTeams(a: MatchTeam, b: MatchTeam, mode?: Match['teamSizeMode']) {
  const p = rosterErrors(a, b, mode)[0];
  if (p) throw badRequest(ROSTER_MESSAGES[p.code]);
}

const scoringStarted = (d: Pick<Doc, 'status' | 'events'>) => d.status === 'live' || d.events.length > 0;
const sameRoster = (x: MatchTeam, y: MatchTeam) =>
  (x.teamId ?? null) === (y.teamId ?? null) && rosterOf(x).join('\u0000') === rosterOf(y).join('\u0000');

/**
 * Registered players only: every player must be a user (names and photos come from the users
 * table, not the client), and a side that names a registered team may only list its members.
 * Returns the sides with the stored names/photos filled in.
 */
async function resolveRoster(trx: Trx, after: Doc): Promise<{ teamA: MatchTeam; teamB: MatchTeam }> {
  const ids = [...rosterOf(after.teamA), ...rosterOf(after.teamB)];
  const rows: { id: string; name: string; photo_url: string | null }[] = ids.length ? await trx('users').whereIn('id', ids).select('id', 'name', 'photo_url') : [];
  const users = new Map(rows.map((r) => [r.id, r]));
  const unknown = ids.filter((x) => !users.has(x));
  if (unknown.length) throw badRequest(`${ROSTER_MESSAGES.notUser}: ${[...new Set(unknown)].join(', ')}`);
  const side = async (t: MatchTeam): Promise<MatchTeam> => {
    if (t.teamId) {
      if (!(await trx('teams').where({ id: t.teamId }).first('id'))) throw badRequest(`Unknown team ${t.teamId}`);
      const members = new Set((await trx('team_members').where({ team_id: t.teamId }).select('user_id')).map((r: { user_id: string }) => r.user_id));
      const outsiders = rosterOf(t).filter((x) => !members.has(x));
      if (outsiders.length) throw badRequest(`Not a member of team ${t.teamId}: ${outsiders.join(', ')}`);
    }
    return {
      ...t,
      players: t.players.map((p) => {
        const u = users.get(p.id)!;
        return { id: p.id, name: u.name, ...(u.photo_url ? { photoURL: u.photo_url } : {}) };
      }),
    };
  };
  return { teamA: await side(after.teamA), teamB: await side(after.teamB) };
}

// ---------------- loading ----------------
interface EventRow {
  match_id: string;
  seq: number;
  set_number: number;
  side: Side;
  player_key?: string | null;
  kind?: 'kill' | 'block' | 'ace' | 'tip' | null;
  serving_side?: Side;
  server_key?: string | null;
  at: Date;
}

const eventFromRow = (r: EventRow & { type: 'point' | 'timeout' }): MatchEvent => {
  if (r.type === 'timeout') return { type: 'timeout', side: r.side, at: toMs(r.at)! };
  const ev: MatchEvent = { type: 'point', side: r.side, at: toMs(r.at)! };
  if (r.player_key) ev.playerId = r.player_key;
  if (r.kind) ev.kind = r.kind;
  return ev;
};

async function loadEventRows(db: Trx, ids: string[]) {
  const pts: EventRow[] = await db('points').whereIn('match_id', ids).orderBy(['match_id', 'seq']);
  const tos: EventRow[] = await db('timeouts').whereIn('match_id', ids).orderBy(['match_id', 'seq']);
  const all = [...pts.map((p) => ({ ...p, type: 'point' as const })), ...tos.map((t) => ({ ...t, type: 'timeout' as const }))];
  all.sort((x, y) => (x.match_id === y.match_id ? x.seq - y.seq : x.match_id < y.match_id ? -1 : 1));
  return all;
}

/**
 * Loads full matches. `viewer` controls private fields: the stream ingest URL is
 * only returned to the scorer and the creator.
 */
export async function loadMatches(s: Services, db: Trx, ids: string[], viewer: Identity | null): Promise<ApiMatch[]> {
  if (!ids.length) return [];
  const rows = await db('matches').whereIn('id', ids);
  if (!rows.length) return [];
  const found = rows.map((r: { id: string }) => r.id);
  const [rules, sides, players, parts, interest, events, lineupRows] = await Promise.all([
    loadRuleSets(db, rows.map((r: { rule_set_id: number }) => Number(r.rule_set_id))),
    db('match_sides').whereIn('match_id', found),
    db('match_players').whereIn('match_id', found).orderBy(['match_id', 'side', 'sort_order']),
    db('match_participants').whereIn('match_id', found),
    db('play_requests').whereIn('match_id', found).orderBy('created_at'),
    loadEventRows(db, found),
    db('set_lineups').whereIn('match_id', found).orderBy(['match_id', 'set_number', 'side', 'position']),
  ]);
  const out = new Map<string, ApiMatch>();
  for (const r of rows) {
    const team = (side: Side): MatchTeam => {
      const sd = sides.find((x: { match_id: string; side: Side }) => x.match_id === r.id && x.side === side);
      return {
        teamId: sd?.team_id ?? null,
        name: sd?.name ?? (side === 'A' ? 'Team A' : 'Team B'),
        color: sd?.color ?? (side === 'A' ? '#E53935' : '#2B2B2B'), // theme teamA / teamB
        players: players
          .filter((p: { match_id: string; side: Side }) => p.match_id === r.id && p.side === side)
          .map((p: { player_key: string; name: string; photo_url: string | null }): MatchPlayer => ({ id: p.player_key, name: p.name, photoURL: publicFileUrl(s, p.photo_url) })),
      };
    };
    let lineups: Lineups | null = null;
    for (const l of lineupRows.filter((x: { match_id: string }) => x.match_id === r.id)) {
      lineups ??= {};
      const set = (lineups[String(l.set_number)] ??= { A: Array(6).fill(null), B: Array(6).fill(null) });
      set[l.side as Side][l.position - 1] = l.player_key;
    }
    const privateOk = !!viewer && (viewer.uid === r.scorer_id || viewer.uid === r.created_by);
    const stream: StreamInfo | null = r.stream_provider
      ? {
          provider: r.stream_provider,
          live: !!r.stream_live,
          ...(r.stream_playback_url ? { playbackUrl: r.stream_playback_url } : {}),
          ...(privateOk && r.stream_ingest_url ? { ingestUrl: r.stream_ingest_url } : {}),
        }
      : null;
    const m: Match = {
      id: r.id,
      ...(r.title ? { title: r.title } : {}),
      teamA: team('A'),
      teamB: team('B'),
      rules: rules.get(Number(r.rule_set_id))!,
      firstServe: r.first_serve,
      events: events.filter((e) => e.match_id === r.id).map(eventFromRow),
      summary: typeof r.summary === 'string' ? JSON.parse(r.summary) : r.summary,
      status: r.status,
      createdBy: r.created_by,
      scorerId: r.scorer_id,
      participantIds: parts.filter((p: { match_id: string }) => p.match_id === r.id).map((p: { user_id: string }) => p.user_id),
      location: placeFromRow(r),
      scheduledAt: toMs(r.scheduled_at),
      startedAt: toMs(r.started_at),
      finishedAt: toMs(r.finished_at),
      tournamentId: r.tournament_id,
      fixtureId: r.fixture_key,
      challengeId: r.challenge_id,
      stream,
      interestedIds: interest.filter((p: { match_id: string }) => p.match_id === r.id).map((p: { user_id: string }) => p.user_id),
      lineups,
      playerOfMatchId: r.player_of_match_id ?? null,
      captains: r.captain_a && r.captain_b ? { A: r.captain_a, B: r.captain_b } : null,
      ...(r.team_size_mode ? { teamSizeMode: r.team_size_mode } : {}),
      verification: verificationFromRow(r, viewer, parts),
      // 1.3.9 (V138-11): the confirmation time (verified_at), apart from the match's own times
      // 1.4.6 (QA V145-2): only a verdict of the current re-open epoch
      confirmedAt: (r.captain_verdict === 'confirmed' || (!r.captain_verdict && r.verification_status === 'confirmed')) && Number(r.verdict_epoch ?? 0) === Number(r.reopen_epoch ?? 0) ? toMs(r.verified_at ?? null) : null,
      startedServerAt: toMs(r.started_server_at),
      // finished_at is always the server's clock (QA NB-R3), stamped when the match finished.
      finishedServerAt: r.status === 'finished' ? toMs(r.finished_at) : null,
      createdAt: toMs(r.created_at)!,
      updatedAt: toMs(r.updated_at)!,
      // 1.4.5 (QA V144-1/2): abandon bookkeeping (migration 0016)
      maxEvents: Math.max(Number(r.max_events ?? 0), Number(r.event_count ?? 0)),
      wasWon: !!r.was_won,
      abandon: jsonCol(r.abandon_info),
      abandonRequest: jsonCol(r.abandon_request),
      resolution: jsonCol(r.resolution),
      scorerReassign: jsonCol(r.scorer_reassign),
      // 1.4.6 (QA V145-2/5/12, migration 0017)
      reopenEpoch: Number(r.reopen_epoch ?? 0),
      abandonHistory: jsonCol(r.abandon_history),
      abandonRequests: Number(r.abandon_request_count ?? 0),
      abandonRequestAt: r.abandon_request_at == null ? null : Number(r.abandon_request_at),
      verdictRepair: jsonCol(r.verdict_repair), // 1.4.8 (QA V147-2, migration 0018)
    };
    // match_participants has no order column (MySQL returns it by user id): rebuild the canonical order.
    m.participantIds = canonicalParticipants(m);
    const rotation = rotationTimeline(m.rules, m.events, m.firstServe, { A: rosterOf(m.teamA), B: rosterOf(m.teamB) }, m.lineups).final;
    out.set(r.id, { ...m, rotation });
  }
  return ids.map((id) => out.get(id)).filter((m): m is ApiMatch => !!m);
}

/**
 * Verification as the API returns it. The dispute reason is shown only to people involved (players,
 * scorer, creator, captains); everyone sees the coarse status (QA AF-53).
 */
function verificationFromRow(
  r: { id: string; verification_status?: VerificationStatus; verified_by?: string | null; verified_at?: Date | null; dispute_reason?: string | null; captain_verdict?: 'confirmed' | 'rejected' | null; reviewed_by?: string | null; reviewed_at?: Date | null; verdict_epoch?: number | null; scorer_id: string; created_by: string; captain_a?: string | null; captain_b?: string | null },
  viewer: Identity | null,
  parts: { match_id: string; user_id: string }[],
): MatchVerification {
  const involved = !!viewer && (viewer.uid === '\u0000internal' || [r.scorer_id, r.created_by, r.captain_a, r.captain_b].includes(viewer.uid) || parts.some((p) => p.match_id === r.id && p.user_id === viewer.uid));
  return {
    status: r.verification_status ?? 'pending',
    by: r.verified_by ?? null,
    at: toMs(r.verified_at ?? null),
    reason: involved ? (r.dispute_reason ?? null) : null,
    reviewedBy: r.reviewed_by ?? null,
    reviewedAt: toMs(r.reviewed_at ?? null),
    captain: r.captain_verdict ?? null,
    epoch: Number(r.verdict_epoch ?? 0),
  };
}

export async function getMatch(s: Services, id: string, viewer: Identity | null) {
  const [m] = await loadMatches(s, s.db, [id], viewer);
  return m ?? null;
}

const jsonCol = <T>(v: unknown): T | null => (v == null ? null : typeof v === 'string' ? (JSON.parse(v) as T) : (v as T));

// ---------------- writing ----------------
const docOf = (m: Match): Doc => {
  const { id: _i, summary: _s, createdAt: _c, updatedAt: _u, verification: _v, startedServerAt: _ss, finishedServerAt: _fs, confirmedAt: _ca, maxEvents: _mx, wasWon: _w, abandon: _a, abandonRequest: _ar, resolution: _r, scorerReassign: _sr, reopenEpoch: _re, abandonHistory: _ah, abandonRequests: _arc, abandonRequestAt: _ara, verdictRepair: _vr, ...rest } = m as ApiMatch;
  delete (rest as Partial<ApiMatch>).rotation;
  return { ...rest, interestedIds: rest.interestedIds ?? [], lineups: rest.lineups ?? null };
};
const storedOf = (m: Match): Stored => ({ ...docOf(m), maxEvents: m.maxEvents ?? null, wasWon: m.wasWon ?? null, abandon: m.abandon ?? null, abandonRequest: m.abandonRequest ?? null, resolution: m.resolution ?? null, scorerReassign: m.scorerReassign ?? null, reopenEpoch: m.reopenEpoch ?? 0, abandonHistory: m.abandonHistory ?? null, abandonRequests: m.abandonRequests ?? 0, abandonRequestAt: m.abandonRequestAt ?? null, verdictRepair: m.verdictRepair ?? null });

async function existingUsers(trx: Trx, ids: string[]): Promise<Set<string>> {
  if (!ids.length) return new Set();
  return new Set((await trx('users').whereIn('id', [...new Set(ids)]).where({ profile_complete: 1 }).select('id')).map((r: { id: string }) => r.id));
}

/**
 * Writes `after` (a full match document) given the stored `before` (null on create).
 * Only the parts that changed are rewritten; the event log is diffed so a new
 * rally inserts one row.
 */
async function writeMatch(s: Services, trx: Trx, id: string, before: Stored | null, after: Doc, branch: MatchBranch | 'create' = 'create', opts: { seed?: boolean } = {}) {
  const now = nowDate();
  // ----- 1.3.0 anti-fraud: statuses, server times, captains -----
  if (!before) {
    // QA AF-18: a match can't be created already finished/abandoned (seeds keep their history).
    if (!opts.seed && after.status !== 'scheduled' && after.status !== 'live')
      throw new HttpError(400, MATCH_BAD_STATUS, 'A new match must be scheduled or live');
  } else {
    const ch = changedKeys(before, after, MATCH_KEYS);
    // Terminal (abandoned, or finished with a Player of the Match): nothing about the match changes
    // any more, except "I want to play" (harmless). QA PM-10/PM-15/AF-43.
    if (isTerminal(before) && ch.some((k) => k !== 'interestedIds'))
      throw new HttpError(409, MATCH_TERMINAL, 'This match is closed and can no longer be changed');
    // Scoring can't be handed over once the match is over (QA PM-13).
    if ((before.status === 'finished' || before.status === 'abandoned') && ch.includes('scorerId'))
      throw new HttpError(409, MATCH_TERMINAL, 'This match is over; the scorer can no longer change');
    // 1.4.2 (QA V141-8): a finished match's score never changes – no undo, no rally, never back to live; only
    // the credit / shot type of one of the last 3 rallies (core/matchGuards.ts finishedScoreProblem, like the rules)
    // 1.4.3 (QA V142-1): and nothing else about it either – rules (points per set, deciding set, win-by…),
    // first serve, lineups, title, place, times, links, stream, "I want to play": every changed key except the
    // events → 409 match_finished, also before the Player of the Match (core finishedFreezeProblem).
    if (finishedFreezeProblem(before, ch, after.events, after.status))
      throw new HttpError(409, MATCH_FINISHED, GUARD_MESSAGES[MATCH_FINISHED]);
    if (!statusMoveOk(before, after.status))
      throw new HttpError(409, MATCH_STATUS_MOVE, `A match can't go from ${before.status} to ${after.status}`);
    // 1.4.5 (QA V144-1): abandoning is the abandon action's (core/abandon.ts: records who, when, the score, the review)
    if (after.status === 'abandoned' && before.status !== 'abandoned')
      throw new HttpError(409, MATCH_STATUS_MOVE, 'Use the abandon action to abandon a match');
    // 1.4.5 (consent policy): scoring is paused while an abandon request waits for an answer
    if (before.status === 'live' && before.abandonRequest && (ch.includes('events') || ch.includes('status')))
      throw new HttpError(409, ABANDON_PENDING, GUARD_MESSAGES[ABANDON_PENDING]);
    // 1.4.5 (QA V144-4) / 1.4.6 (QA V145-3): the set-up – rules, first server, teams, participants, captains, team size
    // – is frozen once the first rally ever existed (maxEvents: undo to 0 doesn't reopen it), as in core guardUpdate,
    // the demo and firestore.rules (core/lifecycle.ts 'editSetup')
    if (maxEventsOf(before) > 0 && ch.some((k) => (SETUP_FIELDS as readonly string[]).includes(k)))
      throw new HttpError(409, MATCH_SETUP_LOCKED, GUARD_MESSAGES[MATCH_SETUP_LOCKED]);
  }
  // Server time only (QA AF-14/AF-17): startedAt is stamped by the server when the match first goes
  // live; a client value is ignored.
  let startedServer: Date | null = null;
  if (!opts.seed) {
    const goingLive = after.status === 'live' && (!before || before.status === 'scheduled');
    const prevStart = before?.startedAt ?? null;
    if (goingLive && prevStart == null) {
      after.startedAt = now.getTime();
      startedServer = now;
    } else after.startedAt = after.status === 'scheduled' ? null : prevStart; // back to scheduled: start again later
  }
  // Store participantIds in the one order firestore.rules require (team A, team B, creator/scorer),
  // whatever order the client sent: reordering only, so the checks below still see the same set.
  if (Array.isArray(after.participantIds)) after.participantIds = canonicalParticipants(after);
  const changed = new Set(before ? changedKeys(before, after, MATCH_KEYS) : MATCH_KEYS);

  // QA G13 / G9: finish on or after start; a newly set scheduled time can't already be over.
  if (changed.has('startedAt') || changed.has('finishedAt')) checkOrder('finishedAt', after.startedAt, after.finishedAt);
  // 1.4.2 (QA V141-7): a safe integer, at most 2 years ahead when newly set (time_invalid before time_in_past)
  if ((!before || changed.has('scheduledAt')) && after.scheduledAt != null && (!scheduleMsOk(after.scheduledAt) || after.scheduledAt > Date.now() + MAX_SCHEDULE_AHEAD_MS))
    throw new ValidationError(TIME_INVALID_CODE, 'scheduledAt');
  if ((!before || changed.has('scheduledAt')) && after.status === 'scheduled') checkNotPast('scheduledAt', after.scheduledAt);
  const rosterChanged = !before || !sameRoster(before.teamA, after.teamA) || !sameRoster(before.teamB, after.teamB);
  if (changed.has('teamA') || changed.has('teamB') || changed.has('teamSizeMode')) validateTeams(after.teamA, after.teamB, after.teamSizeMode);
  // 1.3.6 / 1.4.6 (QA V145-3): players and the team size mode are part of the set-up lock above (409 match_setup_locked
  // once maxEvents > 0); a roster that differs only by the server-filled photo is caught here the same way.
  if (before && (rosterChanged || changed.has('teamSizeMode')) && maxEventsOf(before) > 0) throw new HttpError(409, MATCH_SETUP_LOCKED, GUARD_MESSAGES[MATCH_SETUP_LOCKED]);
  if (rosterChanged || changed.has('teamA') || changed.has('teamB')) Object.assign(after, await resolveRoster(trx, after));
  // Captains (core/antifraud.ts): fixed at creation; may only change with the roster, before the
  // first rally. A registered team's captain is filled in from the team.
  if (!before || rosterChanged || changed.has('captains')) {
    if (before && maxEventsOf(before) > 0) throw new HttpError(409, MATCH_SETUP_LOCKED, GUARD_MESSAGES[MATCH_SETUP_LOCKED]);
    const teamCaptains = await teamCaptainsOf(trx, after);
    const caps: Partial<MatchCaptains> = { ...(after.captains ?? {}) };
    if (teamCaptains.A) caps.A = teamCaptains.A;
    if (teamCaptains.B) caps.B = teamCaptains.B;
    after.captains = caps.A && caps.B ? (caps as MatchCaptains) : null;
    const problem = opts.seed && !after.captains ? null : captainsProblem(after, teamCaptains);
    if (problem) throw new HttpError(400, problem, CAPTAIN_MESSAGES[problem]);
  }
  // 1.4.8 (QA V147-1): at create and on every roster / captain / participant edit, someone can confirm the result and
  // the scorer isn't on that side (core verdictSetupProblem; a scorer-only change is the handoff's, checked there)
  // 1.4.10 (QA V149-2): with the stored verdict reference (scorerReassign.from) – `after` is the client doc, which
  // never carries it – like core, the demo and the rules (GU11)
  // 1.4.11 (QA V1410-2): an edit that keeps players / participants / captains / creator (a rename) isn't checked – like core
  if (!opts.seed && (!before || verdictSetupChanged(before as never, after as never)) && verdictSetupProblem({ ...after, scorerReassign: before?.scorerReassign ?? null } as unknown as Match))
    throw new HttpError(400, MATCH_NO_VERDICT, MATCH_NO_VERDICT_MESSAGE);
  // participantIds = both rosters (+ creator/scorer), like participantsOk() in firestore.rules.
  // Checked whenever the rosters or the participants change (a handover alone doesn't re-check, as in the rules).
  if ((!before || rosterChanged || changed.has('participantIds')) && !participantsMatchRoster(after))
    throw badRequest(PARTICIPANTS_MESSAGE);
  // MIN_PLAYERS (core/roster.ts) per team before scoring can start (going live or recording a rally).
  // As in the rules, this is part of the scorer's branch (a handover or an "I want to play" toggle
  // doesn't re-check it), and a legacy match left short of players may still be abandoned.
  const abandoning = !!before && isAbandonOnly([...changed], after.status);
  if ((branch === 'create' || branch === 'scorer') && !abandoning && scoringStarted(after) && missingPlayers(after.teamA, after.teamB).length)
    throw forbidden('matches.roster.minPlayers', ROSTER_MESSAGES.needPlayers);
  // participants / scorer / creator must be real users (FKs)
  const people = await existingUsers(trx, [...after.participantIds, after.scorerId, after.createdBy, ...(after.interestedIds ?? [])]);
  const missing = [...after.participantIds, after.scorerId, after.createdBy].filter((u) => !people.has(u));
  if ((changed.has('participantIds') || changed.has('scorerId') || changed.has('createdBy')) && missing.length) throw badRequest(`Unknown user(s): ${[...new Set(missing)].join(', ')}`);

  if (changed.has('lineups') || changed.has('teamA') || changed.has('teamB') || changed.has('rules')) validateLineups(after.lineups, after.rules, after.teamA, after.teamB);

  // ----- event log diff -----
  const oldEvents = before?.events ?? [];
  let firstDiff = 0;
  while (firstDiff < oldEvents.length && firstDiff < after.events.length && canonical(oldEvents[firstDiff]) === canonical(after.events[firstDiff])) firstDiff++;
  const replayAll = changed.has('rules') || changed.has('firstServe') || changed.has('teamA') || changed.has('teamB') || changed.has('lineups');
  const playerKeys = new Set([...rosterOf(after.teamA), ...rosterOf(after.teamB)]);
  validateEvents(after.rules, after.events, after.firstServe, { A: new Set(rosterOf(after.teamA)), B: new Set(rosterOf(after.teamB)) }, replayAll ? 0 : firstDiff, {
    order: { A: rosterOf(after.teamA), B: rosterOf(after.teamB) },
    lineups: after.lineups,
    from: firstDiff,
  });
  const state = computeState(after.rules, after.events, after.firstServe);
  const summary = summarize(state);
  // 1.4.4 (QA V143-8): new rules / first serve that make the last rally the winning one would leave a won match
  // 'live' – refused like the events-after-the-end case above (core rulesEndProblem, also used by the demo)
  if (before && (changed.has('rules') || changed.has('firstServe')) && after.status === 'live' && after.events.length && state.finished)
    throw new HttpError(400, MATCH_RULES_END, GUARD_MESSAGES[MATCH_RULES_END]);
  // QA NB-R2 (SCORE-04): 'finished' only when the event log has a winner (the required sets won).
  if (after.status === 'finished' && !state.winner && (!before || changed.has('status') || changed.has('events')))
    throw new HttpError(400, MATCH_NO_WINNER, MATCH_NO_WINNER_MESSAGE);

  // ----- matches row -----
  let ruleSetId: number | undefined;
  if (!before || changed.has('rules')) ruleSetId = await insertRuleSet(trx, after.rules);
  const row = {
    title: after.title ?? null,
    first_serve: after.firstServe,
    status: after.status,
    created_by: after.createdBy,
    scorer_id: after.scorerId,
    ...placeCols(after.location),
    scheduled_at: toDate(after.scheduledAt),
    started_at: toDate(after.startedAt),
    finished_at: toDate(after.finishedAt),
    tournament_id: after.tournamentId ?? null,
    fixture_key: after.fixtureId ?? null,
    challenge_id: after.challengeId ?? null,
    stream_provider: after.stream?.provider ?? null,
    stream_playback_url: after.stream?.playbackUrl ?? null,
    stream_ingest_url: after.stream?.ingestUrl ?? null,
    stream_live: after.stream ? (after.stream.live ? 1 : 0) : null,
    captain_a: after.captains?.A ?? null,
    captain_b: after.captains?.B ?? null,
    team_size_mode: after.teamSizeMode ?? null,
    ...(startedServer ? { started_server_at: startedServer } : after.status === 'scheduled' ? { started_server_at: null } : {}),
    event_count: after.events.length,
    // 1.4.5 (QA V144-1): only grows (undo never lowers it) / latch once finished
    max_events: Math.max(before?.maxEvents ?? 0, before?.events.length ?? 0, after.events.length),
    // 1.4.6 (QA V145-7): also when the replayed events have a winner (whatever status was sent)
    was_won: before?.wasWon || after.status === 'finished' || state.winner ? 1 : 0,
    summary: JSON.stringify(summary),
    updated_at: now,
  };
  if (!before) {
    await trx('matches').insert({ id, ...row, rule_set_id: ruleSetId, version: 1, created_at: now });
  } else {
    const old = await trx('matches').where({ id }).first('rule_set_id');
    await trx('matches').where({ id }).update({ ...row, ...(ruleSetId ? { rule_set_id: ruleSetId } : {}), version: trx.raw('version + 1') });
    if (ruleSetId) await trx('rule_sets').where({ id: old.rule_set_id }).del();
  }

  // ----- sides + players -----
  if (changed.has('teamA') || changed.has('teamB')) {
    for (const side of ['A', 'B'] as Side[]) {
      const t = side === 'A' ? after.teamA : after.teamB;
      await trx('match_sides')
        .insert({ match_id: id, side, team_id: t.teamId ?? null, name: t.name, color: t.color })
        .onConflict(['match_id', 'side'])
        .merge(['team_id', 'name', 'color']);
    }
    const keep = [...playerKeys];
    await trx('match_players').where({ match_id: id }).whereNotIn('player_key', keep.length ? keep : ['\u0000']).del();
    for (const side of ['A', 'B'] as Side[]) {
      const t = side === 'A' ? after.teamA : after.teamB;
      for (const [i, p] of t.players.entries()) {
        await trx('match_players')
          .insert({ match_id: id, player_key: p.id, side, user_id: p.id, name: p.name, photo_url: storedFileUrl(s, p.photoURL), sort_order: i })
          .onConflict(['match_id', 'player_key'])
          .merge(['side', 'user_id', 'name', 'photo_url', 'sort_order']);
      }
    }
  }

  // ----- participants / play requests -----
  if (changed.has('participantIds')) {
    await trx('match_participants').where({ match_id: id }).del();
    const ps = [...new Set(after.participantIds.filter((p) => people.has(p)))];
    if (ps.length) await trx('match_participants').insert(ps.map((u) => ({ match_id: id, user_id: u })));
  }
  if (changed.has('interestedIds')) {
    const prev = before?.interestedIds ?? [];
    const next = (after.interestedIds ?? []).filter((u) => people.has(u));
    const gone = minus(prev, next);
    if (gone.length) await trx('play_requests').where({ match_id: id }).whereIn('user_id', gone).del();
    const added = minus(next, prev);
    if (added.length) await trx('play_requests').insert(added.map((u) => ({ match_id: id, user_id: u, created_at: now })));
  }

  // ----- lineups (before events: points store the server from the lineup) -----
  if (changed.has('lineups')) {
    await trx('set_lineups').where({ match_id: id }).del();
    const rows: object[] = [];
    for (const [set, sides] of Object.entries(after.lineups ?? {}))
      for (const side of ['A', 'B'] as Side[]) sides[side].forEach((p, i) => rows.push({ match_id: id, set_number: Number(set), side, position: i + 1, player_key: p }));
    if (rows.length) await trx('set_lineups').insert(rows);
  }

  // ----- event log, rotation and sets -----
  if (changed.has('events') || replayAll || !before) {
    const timeline = rotationTimeline(after.rules, after.events, after.firstServe, { A: rosterOf(after.teamA), B: rosterOf(after.teamB) }, after.lineups);
    const pointInfo = new Map(timeline.points.map((p) => [p.eventIndex, p]));
    const setOf = (i: number) => {
      const p = pointInfo.get(i);
      return p ? p.setIndex + 1 : computeState(after.rules, after.events.slice(0, i), after.firstServe).setIndex + 1;
    };
    if (before && firstDiff < oldEvents.length) {
      await trx('points').where({ match_id: id }).where('seq', '>=', firstDiff).del();
      await trx('timeouts').where({ match_id: id }).where('seq', '>=', firstDiff).del();
    }
    const pts: object[] = [];
    const tos: object[] = [];
    after.events.forEach((ev, i) => {
      if (before && i < firstDiff) return;
      if (ev.type === 'point') {
        const info = pointInfo.get(i)!;
        pts.push({ match_id: id, seq: i, set_number: info.setIndex + 1, side: ev.side, player_key: ev.playerId ?? null, kind: ev.kind ?? null, serving_side: info.servingSide, server_key: info.server, at: new Date(ev.at) });
      } else tos.push({ match_id: id, seq: i, set_number: setOf(i), side: ev.side, at: new Date(ev.at) });
    });
    for (let i = 0; i < pts.length; i += 500) await trx('points').insert(pts.slice(i, i + 500));
    if (tos.length) await trx('timeouts').insert(tos);
    if (replayAll && before) {
      // lineups/teams changed: refresh who served the earlier rallies
      for (const p of timeline.points.filter((x) => x.eventIndex < firstDiff)) {
        await trx('points').where({ match_id: id, seq: p.eventIndex }).update({ serving_side: p.servingSide, server_key: p.server, set_number: p.setIndex + 1 });
      }
    }
    // sets: completed sets + the set in progress
    await trx('sets').where({ match_id: id }).del();
    const sets: object[] = [];
    const timeouts = (n: number, side: Side) => after.events.filter((e, i) => e.type === 'timeout' && e.side === side && setOf(i) === n).length;
    state.sets.forEach((st, i) =>
      sets.push({ match_id: id, set_number: i + 1, score_a: st.a, score_b: st.b, winner: st.winner, timeouts_a: timeouts(i + 1, 'A'), timeouts_b: timeouts(i + 1, 'B'), rotations_a: timeline.setRotations[i]?.A ?? 0, rotations_b: timeline.setRotations[i]?.B ?? 0 }),
    );
    if (!state.finished && after.events.length > 0) {
      const n = state.setIndex + 1;
      sets.push({ match_id: id, set_number: n, score_a: state.current.a, score_b: state.current.b, winner: null, timeouts_a: timeouts(n, 'A'), timeouts_b: timeouts(n, 'B'), rotations_a: timeline.setRotations[state.setIndex]?.A ?? 0, rotations_b: timeline.setRotations[state.setIndex]?.B ?? 0 });
    }
    if (sets.length) await trx('sets').insert(sets);
  }
}

async function teamCaptainsOf(trx: Trx, d: Pick<Doc, 'teamA' | 'teamB'>): Promise<{ A?: string | null; B?: string | null }> {
  const ids = [d.teamA.teamId, d.teamB.teamId].filter((x): x is string => !!x);
  if (!ids.length) return {};
  const rows: { id: string; captain_id: string }[] = await trx('teams').whereIn('id', ids).select('id', 'captain_id');
  const cap = (t?: string | null) => (t ? rows.find((r) => r.id === t)?.captain_id ?? null : null);
  return { A: cap(d.teamA.teamId), B: cap(d.teamB.teamId) };
}

function publishMatch(s: Services, m: ApiMatch | null, id: string) {
  if (!m) {
    s.bus.publish({ topic: topics.match(id), type: 'deleted' });
  } else {
    // followers never see the stream ingest URL
    const pub = m.stream?.ingestUrl ? { ...m, stream: { ...m.stream, ingestUrl: undefined } } : m;
    s.bus.publish({ topic: topics.match(id), type: 'doc', data: pub });
  }
  s.bus.publish({ topic: topics.matches, type: 'invalidate' });
}

function notifyLive(s: Services, m: Match) {
  // was Cloud Functions onMatchCreatedLive / onMatchLive
  notify(s, m.participantIds.filter((u) => u !== m.scorerId), '🔴 Your match is live', `${m.teamA.name} vs ${m.teamB.name} – follow the score now.`, { type: 'match', matchId: m.id });
}

/** matches create: createdBy == uid() && scorerId is string && uid() in participantIds */
export async function createMatch(s: Services, viewer: Identity, input: Doc, fixedId?: string): Promise<string> {
  const rule = 'matches.create';
  if (input.createdBy !== viewer.uid) throw forbidden(rule, 'createdBy must be you');
  if (!input.participantIds.includes(viewer.uid)) throw forbidden(rule, 'You must be a participant of a match you create');
  // 1.3.8 (QA V137-2): only a complete profile (first/last name, date of birth, pincode) can create a
  // match – also a legacy row marked complete before 1.3.6 that has no registration fields.
  if (!fixedId) {
    const u = await s.db('users').where({ id: viewer.uid }).first('first_name', 'last_name', 'dob', 'pincode');
    if (!u || !hasStoredRegistration({ firstName: u.first_name, lastName: u.last_name, dob: u.dob ? dobString(u.dob) : null, pincode: u.pincode }))
      throw new HttpError(403, 'profile_incomplete', 'Complete your profile (name, date of birth and pincode) to create a match', { field: 'profile' });
  }
  const id = fixedId ?? newId(); // fixedId: seeds only
  const doc: Doc = { ...input, interestedIds: input.interestedIds ?? [], lineups: input.lineups ?? null, captains: input.captains ?? null };
  delete (doc as Partial<Match>).playerOfMatchId; // set only through PUT /player-of-match
  // The server stamps finishedAt (seeds keep their historical times).
  if (!fixedId) doc.finishedAt = serverFinishedAt(null, doc.status);
  await txRetry(s.db, (trx) => writeMatch(s, trx, id, null, doc, 'create', { seed: !!fixedId }));
  const m = await getMatch(s, id, viewer);
  publishMatch(s, m, id);
  if (m && m.status === 'live') notifyLive(s, m);
  return id;
}

/** Generic update (the old updateDoc): the rule branch is chosen from what changed. */
export async function patchMatch(s: Services, viewer: Identity, id: string, patch: Partial<Doc>) {
  let wentLive = false;
  const branch = await txRetry(s.db, async (trx) => {
    if (!(await trx('matches').where({ id }).forUpdate().first('id'))) throw notFound('Match not found');
    const [current] = await loadMatches(s, trx, [id], { uid: '\u0000internal', phone: null });
    const full = await withPrivateStream(trx, current);
    const before = storedOf(full);
    // 1.4.5 (QA V144-1): PATCH {status: 'abandoned'} alone (older apps) on a scheduled / live match is the abandon
    // action; anything else with it (or on a closed match) keeps the 1.4.4 answers (403 / 409 match_terminal)
    if (patch.status === 'abandoned' && (before.status === 'live' || before.status === 'scheduled')
      && Object.keys(patch).every((k) => k === 'status' || k === 'updatedAt' || k === 'finishedAt')) {
      await abandonIn(s, trx, viewer, full);
      return 'scorer' as MatchBranch;
    }
    const after: Doc = { ...docOf(full), ...patch } as Doc;
    after.finishedAt = serverFinishedAt(before, after.status);
    const b = decideMatchUpdate(before, after, viewer);
    // 1.4.5 (QA V144-8, interim): after the first rally scoring goes only to the scorer's own side (or an admin)
    if (after.scorerId !== before.scorerId) {
      const hp = handoverProblem(before, after.scorerId, { targetIsAdmin: isAdmin(s, after.scorerId) });
      if (hp) throw new HttpError(403, hp, HANDOVER_MESSAGES[hp]);
    }
    await writeMatch(s, trx, id, before, after, b);
    wentLive = before.status !== 'live' && after.status === 'live';
    return b;
  });
  const m = await getMatch(s, id, viewer);
  publishMatch(s, m, id);
  if (m && wentLive) notifyLive(s, m);
  return { match: m!, branch };
}

/** Scorer saving the score (old saveMatchProgress). Summary and status are derived on the server. */
export async function saveProgress(s: Services, viewer: Identity, id: string, p: { events: MatchEvent[]; startedAt?: number | null; finishedAt?: number | null }) {
  let wentLive = false;
  await txRetry(s.db, async (trx) => {
    if (!(await trx('matches').where({ id }).forUpdate().first('id'))) throw notFound('Match not found');
    const [current] = await loadMatches(s, trx, [id], { uid: '\u0000internal', phone: null });
    const full = await withPrivateStream(trx, current);
    const before = storedOf(full);
    if (before.scorerId !== viewer.uid) throw forbidden('matches.update.scorer', 'Only the assigned scorer can change the score');
    const st = computeState(before.rules, p.events, before.firstServe);
    const finished = st.finished;
    const after: Doc = {
      ...docOf(full),
      events: p.events,
      status: finished ? 'finished' : 'live',
      // Server time only (1.3.0): writeMatch stamps startedAt when the match first goes live.
      startedAt: before.startedAt ?? null,
      // QA NB-R3: the server's clock, never the client's finishedAt (p.finishedAt is ignored).
      finishedAt: serverFinishedAt(before, finished ? 'finished' : 'live'),
    };
    const b = decideMatchUpdate(before, after, viewer);
    await writeMatch(s, trx, id, before, after, b);
    // QA NB-R3: a confirmed Player of the Match is locked. Undoing the winning rally re-opens the
    // match but keeps the POTM (it can't be cleared, re-picked or moved to someone else), so the
    // 24 h window can't be restarted by undo + re-finish.
    wentLive = before.status !== 'live' && after.status === 'live';
  });
  const m = await getMatch(s, id, viewer);
  publishMatch(s, m, id);
  if (m && wentLive) notifyLive(s, m);
  return m!;
}

/**
 * The scorer confirms the Player of the Match (auto-picked by the app with src/core/potm.ts, or
 * overridden). Same checks as firestore.rules: only the scorer, only while the match is finished
 * (within 24 h of the finish), only once, and only a player of this match.
 */
export async function setPlayerOfMatch(s: Services, viewer: Identity, id: string, playerId: string) {
  await txRetry(s.db, async (trx) => {
    if (!(await trx('matches').where({ id }).forUpdate().first('id'))) throw notFound('Match not found');
    const [m] = await loadMatches(s, trx, [id], { uid: '\u0000internal', phone: null });
    const problem = potmProblem(m, viewer.uid, playerId);
    if (problem === 'potm_not_scorer') throw forbidden('matches.update.playerOfMatch', POTM_MESSAGES[problem]);
    if (problem === 'potm_already_set') throw new HttpError(409, problem, POTM_MESSAGES[problem]);
    if (problem) throw new HttpError(400, problem, POTM_MESSAGES[problem]);
    await trx('matches').where({ id }).update({ player_of_match_id: playerId, updated_at: nowDate() });
  });
  const m = await getMatch(s, id, viewer);
  publishMatch(s, m, id);
  // 1.3.0: the match is now complete; ask the opposing captain to confirm the result.
  const confirmer = m ? expectedConfirmer(m) : null;
  if (m && confirmer) notify(s, [confirmer], '✅ Confirm the result', `${m.teamA.name} vs ${m.teamB.name} – please confirm or reject the score.`, { type: 'match', matchId: m.id });
  return m!;
}

async function withPrivateStream(trx: Trx, m: ApiMatch): Promise<ApiMatch> {
  if (!m.stream) return m;
  const r = await trx('matches').where({ id: m.id }).first('stream_ingest_url');
  return r?.stream_ingest_url ? { ...m, stream: { ...m.stream, ingestUrl: r.stream_ingest_url } } : m;
}

/**
 * matches delete. 1.4.6 (QA V145-1, core/lifecycle.ts 'delete'): only a match that never had a rally (maxEvents == 0 –
 * undo to 0 doesn't count) and has no abandon record, request or admin re-open; by its creator or an admin who isn't
 * part of it. 1.4.7 (QA V146-1): check-then-act in ONE transaction – the match row is locked (SELECT … FOR UPDATE,
 * like saveProgress and every other write), the check runs on the locked state, and the DELETE is conditional again
 * (max_events = 0, no event rows, no abandon / request / resolution) and must remove exactly one row. Child rows
 * (sides, players, participants, requests, sets, points, timeouts, lineups, photo rows) go with it in the same
 * transaction (ON DELETE CASCADE); a save that waited on the lock then finds no match (404).
 */
export async function deleteMatch(s: Services, viewer: Identity, id: string) {
  const photos = await txRetry(s.db, async (trx) => {
    const r = await trx('matches').where({ id }).forUpdate().first('rule_set_id');
    if (!r) throw notFound('Match not found');
    const [m] = await loadMatches(s, trx, [id], { uid: '\u0000internal', phone: null });
    if (!m || deleteProblem(m, viewer.uid, isAdmin(s, viewer.uid))) throw new HttpError(403, MATCH_DELETE_FORBIDDEN, GUARD_MESSAGES[MATCH_DELETE_FORBIDDEN]);
    const keys: { storage_key: string }[] = await trx('match_photos').where({ match_id: id }).select('storage_key');
    const gone = await trx('matches')
      .where({ id })
      .andWhere((q) => q.whereNull('max_events').orWhere('max_events', 0))
      .whereNull('abandon_info')
      .whereNull('abandon_request')
      .whereNull('resolution')
      .whereNotExists((q) => q.select(trx.raw('1')).from('points').whereRaw('points.match_id = matches.id'))
      .del();
    if (gone !== 1) throw new HttpError(409, MATCH_DELETE_FORBIDDEN, GUARD_MESSAGES[MATCH_DELETE_FORBIDDEN]);
    await trx('rule_sets').where({ id: r.rule_set_id }).del();
    return keys;
  });
  await Promise.all(photos.map((p) => s.storage.delete(p.storage_key)));
  publishMatch(s, null, id);
}

// ---------------- result confirmation and admin review (1.3.0) ----------------
const CONFIRM_STATUS: Record<string, number> = { not_completed: 409, already_reviewed: 409, not_captain: 403, scoring_side: 403, no_captains: 409 };

/** The opposing captain confirms (decision 'confirmed') or rejects ('disputed', flagged for an admin). */
export async function verifyResult(s: Services, viewer: Identity, id: string, decision: 'confirmed' | 'disputed', reason?: string) {
  await txRetry(s.db, async (trx) => {
    if (!(await trx('matches').where({ id }).forUpdate().first('id'))) throw notFound('Match not found');
    const [m] = await loadMatches(s, trx, [id], { uid: '\u0000internal', phone: null });
    // 1.4.6 (QA V145-2): the verdict of the current re-open epoch only
    const v = currentVerification(m);
    // Idempotent replay of the same decision by the same captain (QA AF-45).
    const verdict = decision === 'confirmed' ? 'confirmed' : 'rejected';
    if (v?.by === viewer.uid && (v.status === decision || (v.status === 'approved' && captainVerdict(m) === verdict))) return;
    const problem = confirmProblem(m, viewer.uid);
    if (problem) throw new HttpError(CONFIRM_STATUS[problem] ?? 403, problem, CONFIRM_MESSAGES[problem]);
    await trx('matches').where({ id }).update({
      // 1.3.7 (F135-1): after an admin cleared the flag the status stays 'approved'; the verdict decides.
      verification_status: v?.status === 'approved' ? 'approved' : decision,
      captain_verdict: verdict,
      verified_by: viewer.uid,
      verified_at: nowDate(),
      dispute_reason: decision === 'disputed' ? (reason ?? null) : null,
      verdict_epoch: m.reopenEpoch ?? 0,
      updated_at: nowDate(),
    });
  });
  const m = await getMatch(s, id, viewer);
  publishMatch(s, m, id);
  return m!;
}

/**
 * Admin review of a completed match: approve or void (never counts). ADMIN_UIDS only. 1.3.7 (F135-1):
 * approve clears the fraud flag; whether it counts still depends on the opposing captain
 * (core/antifraud ADMIN_APPROVAL.COUNTS_WITHOUT_CAPTAIN).
 */
export async function reviewMatch(s: Services, viewer: Identity, id: string, decision: 'approve' | 'void') {
  if (!isAdmin(s, viewer.uid)) throw forbidden('admin.review', 'Only an admin can review a match');
  await txRetry(s.db, async (trx) => {
    if (!(await trx('matches').where({ id }).forUpdate().first('id'))) throw notFound('Match not found');
    const [m] = await loadMatches(s, trx, [id], { uid: '\u0000internal', phone: null });
    // 1.4.4 (QA V143-7): a 'live' match whose events already have a winner (stuck: an older or seeded row) can be
    // voided too – it is closed as finished (server time) and voided, so it never counts and leaves "live".
    const stuck = m.status === 'live' && matchOver(m);
    // 1.4.5 (QA V144-2): a match stored as finished without a winner (no POTM needed) can be voided too
    const winnerless = m.status === 'finished' && !matchOver({ ...m, status: 'live' });
    if (!isCompleted(m) && !((stuck || winnerless) && decision === 'void')) throw new HttpError(409, 'not_completed', CONFIRM_MESSAGES.not_completed);
    const st = currentVerification(m)?.status ?? 'pending';
    if (st === 'approved' || st === 'voided') throw new HttpError(409, 'already_reviewed', 'This match was already reviewed');
    // 1.3.5 (QA E134-2): never your own match (creator, scorer, captain or player).
    if (ownMatchReview(m, viewer.uid)) throw new HttpError(403, OWN_MATCH_REVIEW, OWN_MATCH_REVIEW_MESSAGE);
    // 1.3.8 (V137-1): keep the captain's verdict explicitly (also one only recorded in the older fields)
    await trx('matches').where({ id }).update({
      verification_status: decision === 'approve' ? 'approved' : 'voided', captain_verdict: captainVerdict(m), reviewed_by: viewer.uid, reviewed_at: nowDate(), verdict_epoch: m.reopenEpoch ?? 0, updated_at: nowDate(),
      ...(stuck ? { status: 'finished', finished_at: nowDate() } : {}),
    });
  });
  const m = await getMatch(s, id, viewer);
  publishMatch(s, m, id);
  return m!;
}

/**
 * Matches waiting for an admin: completed results that are flagged (too short, no server times, disputed), and
 * 1.4.5 (QA V144-1/2) abandoned matches waiting for review, matches stored as finished without a winner, and pending
 * abandon requests (core/abandon.ts needsAdminAction).
 */
export async function listFlagged(s: Services, viewer: Identity) {
  if (!isAdmin(s, viewer.uid)) throw forbidden('admin.review', 'Only an admin can list flagged matches');
  const ids = (rows: { id: string }[]) => rows.map((r) => r.id);
  const [flagged, actions] = await Promise.all([
    s.db('matches').where({ status: 'finished' }).whereNotNull('player_of_match_id').whereNotIn('verification_status', ['approved', 'voided']).orderBy('finished_at', 'desc').limit(200).select('id'),
    s.db('matches')
      .where((q) =>
        q
          .where((a) => a.where({ status: 'abandoned' }).where((b) => b.whereRaw("JSON_UNQUOTE(JSON_EXTRACT(abandon_info, '$.review')) = 'pending'").orWhere((c) => c.whereNull('abandon_info').where('event_count', '>', 0))))
          .orWhere((a) => a.where({ status: 'live' }).whereNotNull('abandon_request'))
          .orWhere((a) => a.where({ status: 'finished' }).whereNot('verification_status', 'voided').whereRaw("COALESCE(JSON_UNQUOTE(JSON_EXTRACT(summary, '$.winner')), 'null') = 'null'")),
      )
      .orderBy('updated_at', 'desc')
      .limit(200)
      .select('id'),
  ]);
  const all = [...new Set([...ids(actions), ...ids(flagged)])];
  return (await loadMatches(s, s.db, all, viewer)).filter((m) => needsReview(m) || needsAdminAction(m));
}

// ---------------- 1.4.5 (QA V144-1/2/3): abandon, consent request, admin resolution ----------------
const ACTION_STATUS: Record<string, number> = { admin_only: 403, own_match: 403, abandon_not_allowed: 403 };
function asHttp(e: unknown): never {
  if (e instanceof CodedError) throw new HttpError(ACTION_STATUS[e.code] ?? 409, e.code, ABANDON_MESSAGES[e.code] ?? e.message);
  throw e;
}
const tryCore = <T>(f: () => T): T => {
  try {
    return f();
  } catch (e) {
    return asHttp(e);
  }
};
/** Writes an action patch (status / finish time / abandon fields / POTM) straight to the matches row. */
async function writeAction(trx: Trx, id: string, _m: Match, patch: Partial<Match>) {
  const now = nowDate();
  const row: Record<string, unknown> = { updated_at: now, version: trx.raw('version + 1') };
  if (patch.status !== undefined) {
    row.status = patch.status;
    // server times only: finished_at is the server's clock when the match ends (finished or abandoned)
    row.finished_at = patch.status === 'finished' || patch.status === 'abandoned' ? now : null;
    if (patch.status === 'finished') row.was_won = 1;
  }
  if (patch.wasWon !== undefined) row.was_won = patch.wasWon ? 1 : 0;
  if (patch.playerOfMatchId !== undefined) row.player_of_match_id = patch.playerOfMatchId;
  // (the core gets the server's Date.now(), so every time in these records is server time)
  if (patch.abandon !== undefined) row.abandon_info = patch.abandon == null ? null : JSON.stringify(patch.abandon);
  if (patch.abandonRequest !== undefined) row.abandon_request = patch.abandonRequest == null ? null : JSON.stringify(patch.abandonRequest);
  if (patch.resolution !== undefined) row.resolution = patch.resolution == null ? null : JSON.stringify(patch.resolution);
  if (patch.scorerReassign !== undefined) row.scorer_reassign = patch.scorerReassign == null ? null : JSON.stringify(patch.scorerReassign);
  if (patch.scorerId !== undefined) row.scorer_id = patch.scorerId;
  // 1.4.6 (QA V145-2/5/12): re-open epoch (+ the cleared verdict / review), append-only history, request rate limit
  if (patch.reopenEpoch !== undefined) row.reopen_epoch = patch.reopenEpoch ?? 0;
  if (patch.verification === null)
    Object.assign(row, { verification_status: 'pending', captain_verdict: null, verified_by: null, verified_at: null, dispute_reason: null, reviewed_by: null, reviewed_at: null, verdict_epoch: null });
  if (patch.abandonHistory !== undefined) row.abandon_history = patch.abandonHistory == null ? null : JSON.stringify(patch.abandonHistory);
  if (patch.abandonRequests !== undefined) row.abandon_request_count = patch.abandonRequests ?? 0;
  if (patch.abandonRequestAt !== undefined) row.abandon_request_at = patch.abandonRequestAt ?? null;
  // 1.4.8 (QA V147-2): the admin verdict repair – a confirmer (captains) and its audit record
  if (patch.captains !== undefined) Object.assign(row, { captain_a: patch.captains?.A ?? null, captain_b: patch.captains?.B ?? null });
  if (patch.verdictRepair !== undefined) row.verdict_repair = patch.verdictRepair == null ? null : JSON.stringify(patch.verdictRepair);
  await trx('matches').where({ id }).update(row);
}
async function loadForAction(s: Services, trx: Trx, id: string) {
  if (!(await trx('matches').where({ id }).forUpdate().first('id'))) throw notFound('Match not found');
  const [m] = await loadMatches(s, trx, [id], { uid: '\u0000internal', phone: null });
  return m;
}
async function abandonIn(s: Services, trx: Trx, viewer: Identity, m: Match) {
  const now = Date.now();
  const plan = tryCore(() => planAbandon(m, viewer.uid, now));
  await writeAction(trx, m.id, m, abandonPatch(plan, now));
  return plan.kind;
}
/** The scorer's ⋮ Abandon: abandoned (before the first rally / 'flag' policy) or a request ('consent'). */
export async function abandonMatch(s: Services, viewer: Identity, id: string) {
  const kind = await txRetry(s.db, async (trx) => abandonIn(s, trx, viewer, await loadForAction(s, trx, id)));
  const m = await getMatch(s, id, viewer);
  publishMatch(s, m, id);
  // 1.4.6 (QA V145-12): one notification per NEW request (a refused / rate-limited / repeated call notifies nobody;
  // at most ABANDON_REQUEST_LIMIT.MAX_PER_MATCH requests per match, COOLDOWN_MS apart)
  if (m && kind === 'request' && m.abandonRequest) {
    const need = (m.captains ? (m.abandonRequest.side === 'A' ? [m.captains.B] : m.abandonRequest.side === 'B' ? [m.captains.A] : [m.captains.A, m.captains.B]) : []).filter(Boolean);
    if (need.length) notify(s, need, '⏸ Abandon requested', `${m.teamA.name} vs ${m.teamB.name} – the scorer asks to abandon the match. Agree or decline.`, { type: 'match', matchId: m.id });
  }
  return { match: m!, result: kind === 'request' ? 'requested' : 'abandoned' };
}
/** Consent policy: the opposing captain(s) agree / decline, or the requester cancels. */
export async function answerAbandonRequest(s: Services, viewer: Identity, id: string, action: AbandonAnswer) {
  await txRetry(s.db, async (trx) => {
    const m = await loadForAction(s, trx, id);
    await writeAction(trx, id, m, tryCore(() => answerAbandon(m, viewer.uid, action, Date.now())));
  });
  const m = await getMatch(s, id, viewer);
  publishMatch(s, m, id);
  return m!;
}
/** Admin: reinstate / confirm an abandon, re-open or abandon a finished match without a winner, decide a request. */
export async function resolveMatch(s: Services, viewer: Identity, id: string, action: ResolveAction) {
  if (!isAdmin(s, viewer.uid)) throw forbidden('admin.resolve', 'Only an admin can resolve a match');
  await txRetry(s.db, async (trx) => {
    const m = await loadForAction(s, trx, id);
    await writeAction(trx, id, m, tryCore(() => resolvePatch(m, viewer.uid, true, action, Date.now())));
  });
  const m = await getMatch(s, id, viewer);
  publishMatch(s, m, id);
  return m!;
}

/** 1.4.8 (QA V147-2): an admin outside the match repairs a match nobody can confirm (core/verdictRepair.ts). */
export async function repairVerdict(s: Services, viewer: Identity, id: string, fix: RepairFix) {
  if (!isAdmin(s, viewer.uid)) throw forbidden('admin.repair', 'Only an admin can repair a match');
  await txRetry(s.db, async (trx) => {
    const m = await loadForAction(s, trx, id);
    let patch: Partial<Match>;
    try {
      patch = repairPatch(m, viewer.uid, true, fix, Date.now());
    } catch (e) {
      if (e instanceof CodedError && REPAIR_MESSAGES[e.code]) throw new HttpError(e.code === REPAIR_INVALID ? 400 : 409, e.code, REPAIR_MESSAGES[e.code]);
      return asHttp(e);
    }
    await writeAction(trx, id, m, patch);
  });
  const m = await getMatch(s, id, viewer);
  publishMatch(s, m, id);
  return m!;
}

// ---------------- queries ----------------
export async function listMatchIds(db: Trx, q: { status?: string[]; participant?: string; tournament?: string; withLocation?: boolean; limit: number }) {
  // 1.3.9 (V138-11): a player's matches by the match's own date (finished, started, scheduled, created):
  // a confirmation or review bumps updated_at, which must not move an old match to the top
  const query = db('matches').select('matches.id').limit(q.limit);
  if (q.participant) query.orderByRaw('COALESCE(matches.finished_at, matches.started_at, matches.scheduled_at, matches.created_at) DESC, matches.id');
  else query.orderBy('matches.updated_at', 'desc');
  if (q.status?.length) query.whereIn('matches.status', q.status);
  if (q.tournament) query.where('matches.tournament_id', q.tournament);
  if (q.withLocation) query.whereNotNull('matches.location_name');
  if (q.participant) query.join('match_participants as mp', 'mp.match_id', 'matches.id').where('mp.user_id', q.participant);
  return (await query).map((r: { id: string }) => r.id);
}

/** 1.4.5: the opposing captain reports an abandoned match to admin review (core/abandon.ts reportAbandon). */
export async function reportAbandonedMatch(s: Services, viewer: Identity, id: string) {
  await txRetry(s.db, async (trx) => {
    const m = await loadForAction(s, trx, id);
    await writeAction(trx, id, m, tryCore(() => reportAbandon(m, viewer.uid, Date.now())));
  });
  const m = await getMatch(s, id, viewer);
  publishMatch(s, m, id);
  return m!;
}
/** 1.4.5 (QA V144-8): an admin who isn't part of the match moves scoring to any participant (recorded after the first rally). */
/**
 * 1.4.6 (QA V145-17): the admins this match's creator / scorer may hand scoring to (registered ADMIN_UIDS, minus the
 * scorer and the verdict captains). Only the creator and the scorer may ask – it is the list behind their handoff
 * chips, nothing more (id + display name).
 */
export async function handoffAdmins(s: Services, viewer: Identity, id: string): Promise<{ id: string; name: string }[]> {
  const m = await getMatch(s, id, { uid: '\u0000internal', phone: null });
  if (!m) throw notFound('Match not found');
  if (viewer.uid !== m.createdBy && viewer.uid !== m.scorerId) throw forbidden('Only the creator or the scorer can hand scoring over');
  if (m.status !== 'live' && m.status !== 'scheduled') return []; // 1.4.7: nothing to hand over on a closed match
  const ids = [...(s.adminUids ?? [])];
  if (!ids.length) return [];
  const rows = (await s.db('users').whereIn('id', ids).select('id', 'name')) as { id: string; name: string }[];
  return eligibleHandoffAdmins(m, rows.map((r) => ({ id: r.id, name: r.name }))).sort((a, b) => a.name.localeCompare(b.name));
}

export async function reassignScorer(s: Services, viewer: Identity, id: string, scorerId: string) {
  await txRetry(s.db, async (trx) => {
    const m = await loadForAction(s, trx, id);
    const p = reassignProblem(m, viewer.uid, isAdmin(s, viewer.uid), scorerId);
    if (p) throw new HttpError(p === 'match_terminal' ? 409 : 403, p, HANDOVER_MESSAGES[p] ?? ABANDON_MESSAGES[p] ?? p);
    const rec = reassignRecord(m, viewer.uid, scorerId, Date.now());
    await writeAction(trx, id, m, { scorerId, ...(rec ? { scorerReassign: rec } : {}) });
  });
  const m = await getMatch(s, id, viewer);
  publishMatch(s, m, id);
  return m!;
}
