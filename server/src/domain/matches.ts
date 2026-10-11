/**
 * Matches: normalised into matches + match_sides + match_players +
 * match_participants + play_requests + points/timeouts (the event log) +
 * sets (materialised) + set_lineups (rotation). The API still speaks the app's
 * `Match` shape, so the UI and the event-sourced scoring engine are unchanged.
 */
import type { RuleSet } from '../../../src/core/rules';
import { PARTICIPANTS_MESSAGE, ROSTER_LOCKED_MESSAGE, ROSTER_MESSAGES, canonicalParticipants, isAbandonOnly, missingPlayers, participantsMatchRoster, rosterErrors } from '../../../src/core/roster';
import { offCourtCredit, rotationTimeline, type Lineups, type RotationState } from '../../../src/core/rotation';
import { computeState, summarize, type MatchEvent, type Side } from '../../../src/core/scoring';
import type { Match, MatchPlayer, MatchTeam, StreamInfo } from '../../../src/core/types';
import { notify, publicFileUrl, storedFileUrl, type Services } from '../context';
import { badRequest, forbidden, HttpError, notFound } from '../errors';
import { POTM_MESSAGES, potmProblem } from '../../../src/core/potm';
import { hasStoredRegistration } from '../../../src/core/registration';
import type { Identity } from '../auth/verifier';
import { topics } from '../live/bus';
import { checkNotPast, checkOrder } from '../../../src/core/validate';
import {
  CAPTAIN_MESSAGES,
  CONFIRM_MESSAGES,
  captainsProblem,
  captainVerdict,
  confirmProblem,
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
import { canonical, changedKeys, insertRuleSet, loadRuleSets, minus, newId, nowDate, placeCols, placeFromRow, toDate, toMs, type Trx } from './util';

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
type ServerOnly = 'verification' | 'startedServerAt' | 'finishedServerAt';
type Doc = Omit<Match, 'id' | 'summary' | 'createdAt' | 'updatedAt' | ServerOnly>;
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
      startedServerAt: toMs(r.started_server_at),
      // finished_at is always the server's clock (QA NB-R3), stamped when the match finished.
      finishedServerAt: r.status === 'finished' ? toMs(r.finished_at) : null,
      createdAt: toMs(r.created_at)!,
      updatedAt: toMs(r.updated_at)!,
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
  r: { id: string; verification_status?: VerificationStatus; verified_by?: string | null; verified_at?: Date | null; dispute_reason?: string | null; captain_verdict?: 'confirmed' | 'rejected' | null; reviewed_by?: string | null; reviewed_at?: Date | null; scorer_id: string; created_by: string; captain_a?: string | null; captain_b?: string | null },
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
  };
}

export async function getMatch(s: Services, id: string, viewer: Identity | null) {
  const [m] = await loadMatches(s, s.db, [id], viewer);
  return m ?? null;
}

// ---------------- writing ----------------
const docOf = (m: Match): Doc => {
  const { id: _i, summary: _s, createdAt: _c, updatedAt: _u, verification: _v, startedServerAt: _ss, finishedServerAt: _fs, ...rest } = m as ApiMatch;
  delete (rest as Partial<ApiMatch>).rotation;
  return { ...rest, interestedIds: rest.interestedIds ?? [], lineups: rest.lineups ?? null };
};

async function existingUsers(trx: Trx, ids: string[]): Promise<Set<string>> {
  if (!ids.length) return new Set();
  return new Set((await trx('users').whereIn('id', [...new Set(ids)]).where({ profile_complete: 1 }).select('id')).map((r: { id: string }) => r.id));
}

/**
 * Writes `after` (a full match document) given the stored `before` (null on create).
 * Only the parts that changed are rewritten; the event log is diffed so a new
 * rally inserts one row.
 */
async function writeMatch(s: Services, trx: Trx, id: string, before: Doc | null, after: Doc, branch: MatchBranch | 'create' = 'create', opts: { seed?: boolean } = {}) {
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
    if (!statusMoveOk(before, after.status))
      throw new HttpError(409, MATCH_STATUS_MOVE, `A match can't go from ${before.status} to ${after.status}`);
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
  if ((!before || changed.has('scheduledAt')) && after.status === 'scheduled') checkNotPast('scheduledAt', after.scheduledAt);
  const rosterChanged = !before || !sameRoster(before.teamA, after.teamA) || !sameRoster(before.teamB, after.teamB);
  if (changed.has('teamA') || changed.has('teamB') || changed.has('teamSizeMode')) validateTeams(after.teamA, after.teamB, after.teamSizeMode);
  // 1.3.6: the team size mode is part of the roster: fixed once the first rally is played.
  if (before && changed.has('teamSizeMode') && before.events.length > 0) throw forbidden('matches.roster.locked', ROSTER_LOCKED_MESSAGE);
  // Players can only change before the first rally (the scorer can't rewrite rosters mid-match).
  if (before && rosterChanged && before.events.length > 0) throw forbidden('matches.roster.locked', ROSTER_LOCKED_MESSAGE);
  if (rosterChanged || changed.has('teamA') || changed.has('teamB')) Object.assign(after, await resolveRoster(trx, after));
  // Captains (core/antifraud.ts): fixed at creation; may only change with the roster, before the
  // first rally. A registered team's captain is filled in from the team.
  if (!before || rosterChanged || changed.has('captains')) {
    if (before && before.events.length > 0) throw forbidden('matches.captains.locked', 'Captains are fixed once scoring has started');
    const teamCaptains = await teamCaptainsOf(trx, after);
    const caps: Partial<MatchCaptains> = { ...(after.captains ?? {}) };
    if (teamCaptains.A) caps.A = teamCaptains.A;
    if (teamCaptains.B) caps.B = teamCaptains.B;
    after.captains = caps.A && caps.B ? (caps as MatchCaptains) : null;
    const problem = opts.seed && !after.captains ? null : captainsProblem(after, teamCaptains);
    if (problem) throw new HttpError(400, problem, CAPTAIN_MESSAGES[problem]);
  }
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
    if (!u || !hasStoredRegistration({ firstName: u.first_name, lastName: u.last_name, dob: u.dob ? 'set' : null, pincode: u.pincode }))
      throw new HttpError(403, 'profile_incomplete', 'Complete your profile (name, date of birth and pincode) to create a match', { field: 'profile' });
  }
  const id = fixedId ?? newId(); // fixedId: seeds only
  const doc: Doc = { ...input, interestedIds: input.interestedIds ?? [], lineups: input.lineups ?? null, captains: input.captains ?? null };
  delete (doc as Partial<Match>).playerOfMatchId; // set only through PUT /player-of-match
  // The server stamps finishedAt (seeds keep their historical times).
  if (!fixedId) doc.finishedAt = serverFinishedAt(null, doc.status);
  await s.db.transaction((trx) => writeMatch(s, trx, id, null, doc, 'create', { seed: !!fixedId }));
  const m = await getMatch(s, id, viewer);
  publishMatch(s, m, id);
  if (m && m.status === 'live') notifyLive(s, m);
  return id;
}

/** Generic update (the old updateDoc): the rule branch is chosen from what changed. */
export async function patchMatch(s: Services, viewer: Identity, id: string, patch: Partial<Doc>) {
  let wentLive = false;
  const branch = await s.db.transaction(async (trx) => {
    if (!(await trx('matches').where({ id }).forUpdate().first('id'))) throw notFound('Match not found');
    const [current] = await loadMatches(s, trx, [id], { uid: '\u0000internal', phone: null });
    const full = await withPrivateStream(trx, current);
    const before = docOf(full);
    const after: Doc = { ...before, ...patch } as Doc;
    after.finishedAt = serverFinishedAt(before, after.status);
    const b = decideMatchUpdate(before, after, viewer);
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
  await s.db.transaction(async (trx) => {
    if (!(await trx('matches').where({ id }).forUpdate().first('id'))) throw notFound('Match not found');
    const [current] = await loadMatches(s, trx, [id], { uid: '\u0000internal', phone: null });
    const full = await withPrivateStream(trx, current);
    const before = docOf(full);
    if (before.scorerId !== viewer.uid) throw forbidden('matches.update.scorer', 'Only the assigned scorer can change the score');
    const st = computeState(before.rules, p.events, before.firstServe);
    const finished = st.finished;
    const after: Doc = {
      ...before,
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
  await s.db.transaction(async (trx) => {
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

/** matches delete: createdBy == uid() && status != 'live' */
export async function deleteMatch(s: Services, viewer: Identity, id: string) {
  const r = await s.db('matches').where({ id }).first('created_by', 'status', 'rule_set_id');
  if (!r) throw notFound('Match not found');
  if (r.status === 'live') throw forbidden('matches.delete', 'A live match cannot be deleted');
  // 1.3.0 (QA AF-50/BN-11): a finished match is history (and may carry a result/flag): only an admin deletes it.
  if (r.status === 'finished') {
    if (!isAdmin(s, viewer.uid)) throw forbidden('matches.delete.finished', 'A finished match can only be deleted by an admin');
  } else if (r.created_by !== viewer.uid && !isAdmin(s, viewer.uid)) throw forbidden('matches.delete', 'Only the creator can delete a match that is not live');
  const photos: { storage_key: string }[] = await s.db('match_photos').where({ match_id: id }).select('storage_key');
  await s.db.transaction(async (trx) => {
    await trx('matches').where({ id }).del();
    await trx('rule_sets').where({ id: r.rule_set_id }).del();
  });
  await Promise.all(photos.map((p) => s.storage.delete(p.storage_key)));
  publishMatch(s, null, id);
}

// ---------------- result confirmation and admin review (1.3.0) ----------------
const CONFIRM_STATUS: Record<string, number> = { not_completed: 409, already_reviewed: 409, not_captain: 403, scoring_side: 403, no_captains: 409 };

/** The opposing captain confirms (decision 'confirmed') or rejects ('disputed', flagged for an admin). */
export async function verifyResult(s: Services, viewer: Identity, id: string, decision: 'confirmed' | 'disputed', reason?: string) {
  await s.db.transaction(async (trx) => {
    if (!(await trx('matches').where({ id }).forUpdate().first('id'))) throw notFound('Match not found');
    const [m] = await loadMatches(s, trx, [id], { uid: '\u0000internal', phone: null });
    const v = m.verification;
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
  await s.db.transaction(async (trx) => {
    if (!(await trx('matches').where({ id }).forUpdate().first('id'))) throw notFound('Match not found');
    const [m] = await loadMatches(s, trx, [id], { uid: '\u0000internal', phone: null });
    if (!isCompleted(m)) throw new HttpError(409, 'not_completed', CONFIRM_MESSAGES.not_completed);
    const st = m.verification?.status ?? 'pending';
    if (st === 'approved' || st === 'voided') throw new HttpError(409, 'already_reviewed', 'This match was already reviewed');
    // 1.3.5 (QA E134-2): never your own match (creator, scorer, captain or player).
    if (ownMatchReview(m, viewer.uid)) throw new HttpError(403, OWN_MATCH_REVIEW, OWN_MATCH_REVIEW_MESSAGE);
    // 1.3.8 (V137-1): keep the captain's verdict explicitly (also one only recorded in the older fields)
    await trx('matches').where({ id }).update({ verification_status: decision === 'approve' ? 'approved' : 'voided', captain_verdict: captainVerdict(m), reviewed_by: viewer.uid, reviewed_at: nowDate(), updated_at: nowDate() });
  });
  const m = await getMatch(s, id, viewer);
  publishMatch(s, m, id);
  return m!;
}

/** Completed matches waiting for an admin (flagged: too short, no server times, disputed). */
export async function listFlagged(s: Services, viewer: Identity) {
  if (!isAdmin(s, viewer.uid)) throw forbidden('admin.review', 'Only an admin can list flagged matches');
  const ids: string[] = (
    await s.db('matches').where({ status: 'finished' }).whereNotNull('player_of_match_id').whereNotIn('verification_status', ['approved', 'voided']).orderBy('finished_at', 'desc').limit(200).select('id')
  ).map((r: { id: string }) => r.id);
  return (await loadMatches(s, s.db, ids, viewer)).filter(needsReview);
}

// ---------------- queries ----------------
export async function listMatchIds(db: Trx, q: { status?: string[]; participant?: string; tournament?: string; withLocation?: boolean; limit: number }) {
  const query = db('matches').select('matches.id').orderBy('matches.updated_at', 'desc').limit(q.limit);
  if (q.status?.length) query.whereIn('matches.status', q.status);
  if (q.tournament) query.where('matches.tournament_id', q.tournament);
  if (q.withLocation) query.whereNotNull('matches.location_name');
  if (q.participant) query.join('match_participants as mp', 'mp.match_id', 'matches.id').where('mp.user_id', q.participant);
  return (await query).map((r: { id: string }) => r.id);
}
