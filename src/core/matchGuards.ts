/**
 * Client-side mirror of the API server's match write checks (server/src/domain/matches.ts writeMatch,
 * deleteMatch) and of firestore.rules (1.3.0), used by the Firebase and demo backends so all three
 * backends refuse the same writes with the same codes (QA N121-1..3, AF-14, AF-18, AF-50).
 */
import { CodedError } from './codedError';
import { captainsProblem, CAPTAIN_MESSAGES, isTerminal, MATCH_NO_VERDICT, MATCH_NO_VERDICT_MESSAGE, statusMoveOk, verdictSetupProblem } from './antifraud';
export { MATCH_NO_VERDICT };
import type { Match, MatchCaptains } from './types';
import { computeState, type MatchEvent } from './scoring';
import { checkNotPast, MAX_SCHEDULE_AHEAD_MS, scheduleMsOk, TIME_INVALID_CODE, ValidationError } from './validate';
import { lifecycleProblem, maxEventsOf, minWinEvents, type LcMatch } from './lifecycle';
export { minWinEvents };

export const MATCH_BAD_STATUS = 'match_bad_status';
export const MATCH_TERMINAL = 'match_terminal';
export const MATCH_STATUS_MOVE = 'match_status_move';
export const SERVER_TIME = 'server_time';
export const SERVER_FIELD = 'server_field';
export const MATCH_DELETE_FORBIDDEN = 'match_delete_forbidden';
export const MATCH_FINISHED = 'match_finished';
/** 1.4.4 (Firebase, QA V143-2/3): see firebaseUpdateProblem. */
export const ABANDON_NEEDS_ADMIN = 'abandon_needs_admin';
export const MATCH_SETUP_LOCKED = 'match_setup_locked';
/** 1.4.4 (QA V143-8): a rules / first-serve change that would end a live match (API, demo; Firebase freezes both). */
export const MATCH_RULES_END = 'match_rules_end';
/** 1.4.5 (consent policy, src/core/abandon.ts): scoring is paused while an abandon request waits. */
export const ABANDON_PENDING = 'abandon_pending';

export const GUARD_MESSAGES: Record<string, string> = {
  [MATCH_BAD_STATUS]: 'A new match must be scheduled or live',
  [MATCH_TERMINAL]: 'This match is closed and can no longer be changed',
  [MATCH_STATUS_MOVE]: "This match can't change to that status",
  [SERVER_TIME]: 'Start and finish times are set by the server',
  [SERVER_FIELD]: 'This field is set by the server only',
  [MATCH_FINISHED]: 'The match is over – its score, result and settings can no longer change',
  [MATCH_DELETE_FORBIDDEN]: 'Only a match that never had a rally and has no abandon or review record can be deleted – by its creator or an admin who isn’t part of it',
  [ABANDON_NEEDS_ADMIN]: 'Only an admin can abandon this match now – it may already have a result, or an admin already reviewed an abandon',
  [MATCH_SETUP_LOCKED]: 'After the first rally the rules, first server, teams, players, captains, team size and the lineups already used can’t change – also after undo',
  [MATCH_RULES_END]: 'With these rules the match would already be over – the rules can’t end a live match',
  [ABANDON_PENDING]: 'An abandon request is waiting for an answer – scoring is paused',
  [MATCH_NO_VERDICT]: MATCH_NO_VERDICT_MESSAGE,
};
const fail = (code: string): never => {
  throw new CodedError(code, GUARD_MESSAGES[code] ?? CAPTAIN_MESSAGES[code as keyof typeof CAPTAIN_MESSAGES] ?? code);
};

/** Fields no client may write on a match (server/rules-set). */
export const MATCH_SERVER_FIELDS = ['verification', 'startedServerAt', 'finishedServerAt', 'confirmedAt'] as const; // confirmedAt: 1.3.9 (V138-11)
/**
 * 1.4.5 (QA V144-1/2): written only by the abandon / request / admin-resolve actions (src/core/abandon.ts) and by
 * the scoring writes (maxEvents, wasWon) – never through a metadata update or a create.
 */
export const MATCH_ACTION_FIELDS = ['maxEvents', 'wasWon', 'abandon', 'abandonRequest', 'resolution', 'scorerReassign', 'verdictRepair'] as const;

type CreateInput = Pick<Match, 'status' | 'teamA' | 'teamB'> & { captains?: MatchCaptains | null } & Partial<Pick<Match, 'playerOfMatchId' | 'finishedAt'>> & Record<string, unknown>;

/**
 * A new match: scheduled or live only (AF-18 / N121-2), no POTM, no finish time, no server fields,
 * and valid captains (`teamCaptains` = the registered teams' captains).
 */
export function guardCreate(m: CreateInput, teamCaptains: { A?: string | null; B?: string | null }): void {
  if (m.status !== 'scheduled' && m.status !== 'live') fail(MATCH_BAD_STATUS);
  if (m.playerOfMatchId != null || m.finishedAt != null) fail(MATCH_BAD_STATUS);
  if (MATCH_SERVER_FIELDS.some((k) => m[k] != null)) fail(SERVER_FIELD);
  if (MATCH_ACTION_FIELDS.some((k) => m[k] != null)) fail(SERVER_FIELD);
  const c = captainsProblem(m, teamCaptains);
  if (c) throw new CodedError(c, CAPTAIN_MESSAGES[c]);
  // 1.4.8 (QA V147-1): someone must be able to confirm the result, and the scorer is never on that side
  if (verdictSetupProblem(m as unknown as Parameters<typeof verdictSetupProblem>[0])) fail(MATCH_NO_VERDICT);
}
/** 1.4.8 (QA V147-1): the roster / captain / participant keys after which the verdict invariant is re-checked. */
export const VERDICT_SETUP_KEYS = ['teamA', 'teamB', 'participantIds', 'captains', 'teamSizeMode', 'createdBy'] as const;

/**
 * A metadata update (PATCH): no client times or server fields (N121-3, INFO), nothing on a terminal
 * match except "I want to play", no handover after the end, and one-way statuses (N121-1).
 */
export function guardUpdate(before: Match, patch: Partial<Match>, now = Date.now()): void {
  const keys = Object.keys(patch).filter((k) => k !== 'updatedAt');
  if (keys.includes('startedAt') || keys.includes('finishedAt')) fail(SERVER_TIME);
  if (keys.some((k) => (MATCH_SERVER_FIELDS as readonly string[]).includes(k))) fail(SERVER_FIELD);
  if (keys.some((k) => (MATCH_ACTION_FIELDS as readonly string[]).includes(k))) fail(SERVER_FIELD);
  if (keys.includes('playerOfMatchId')) fail('potm_use_endpoint');
  const changed = keys.filter((k) => JSON.stringify((patch as Record<string, unknown>)[k]) !== JSON.stringify((before as unknown as Record<string, unknown>)[k]));
  if (isTerminal(before) && changed.some((k) => k !== 'interestedIds')) fail(MATCH_TERMINAL);
  if ((before.status === 'finished' || before.status === 'abandoned') && changed.includes('scorerId')) fail(MATCH_TERMINAL);
  // 1.4.3 (QA V142-1/V142-3): once the winning rally is in, nothing about the match changes any more (rules,
  // summary, roster, title, times…) – only a credit on one of the last 3 rallies (finishedFreezeProblem)
  const fz = finishedFreezeProblem(before, changed, patch.events ?? before.events, patch.status ?? before.status);
  if (fz) fail(fz);
  if (patch.status && !statusMoveOk(before, patch.status)) fail(MATCH_STATUS_MOVE);
  // 1.4.5 (QA V144-4) / 1.4.6 (QA V145-3): the match set-up – rules, first server, teams, participants, captains and
  // team size – is frozen once the first rally EVER existed (maxEvents; undo to 0 doesn't reopen it) on every backend
  // (core/lifecycle.ts 'editSetup'): a scorer can't wipe the log, swap in a friendly "opposing captain" and re-score
  if (changed.some((k) => (SETUP_FIELDS as readonly string[]).includes(k)) && maxEventsOf(before) > 0) fail(MATCH_SETUP_LOCKED);
  // 1.4.8 (QA V147-1): a roster / captain edit keeps the verdict invariant (a scorer-only change is the handoff's)
  if (changed.some((k) => (VERDICT_SETUP_KEYS as readonly string[]).includes(k)) && verdictSetupProblem({ ...before, ...patch } as Match)) fail(MATCH_NO_VERDICT);
  // 1.4.0 (QA V139-5): the creation time and id are the server's; a new time for a scheduled match can't be
  // in the past (API patchMatch: changed scheduledAt + resulting status scheduled → checkNotPast).
  if (changed.includes('createdAt') || changed.includes('id')) fail(SERVER_FIELD);
  // 1.4.2 (QA V141-7): an invalid value (not a safe epoch-ms integer, or > 2 years ahead) is time_invalid, answered
  // before time_in_past (it was "in the past" for -1 on a scheduled match)
  if (changed.includes('scheduledAt') && patch.scheduledAt != null && (!scheduleMsOk(patch.scheduledAt) || patch.scheduledAt > now + MAX_SCHEDULE_AHEAD_MS))
    throw new ValidationError(TIME_INVALID_CODE, 'scheduledAt');
  if (changed.includes('scheduledAt') && (patch.status ?? before.status) === 'scheduled') checkNotPast('scheduledAt', patch.scheduledAt, now);
}

/** Scoring progress: never on a terminal match; the status move must be allowed. */
export function guardProgress(before: Match, nextStatus: Match['status'], nextEvents?: readonly MatchEvent[]): void {
  if (isTerminal(before)) fail(MATCH_TERMINAL);
  // 1.4.5 (consent policy): a pending abandon request freezes the score until it is answered
  if (before.status === 'live' && before.abandonRequest) fail(ABANDON_PENDING);
  // 1.4.5 (QA V144-1): abandoning goes through the abandon action (src/core/abandon.ts), never a scoring write
  if (nextStatus === 'abandoned' && before.status !== 'abandoned') fail(MATCH_STATUS_MOVE);
  // 1.4.4 (QA V143-8, API parity): a 'live' document whose events already have a winner is over too (matchOver) –
  // no undo of the winning rally, no abandon; only the finishing write (which repairs it, V143-7) or a re-credit.
  const over = matchOver(before);
  if (over && nextStatus !== 'finished' && nextStatus !== before.status) fail(MATCH_FINISHED);
  const f = finishedScoreProblem(over ? { status: 'finished', events: before.events } : before, nextEvents ?? before.events, nextStatus);
  if (f) fail(f);
  if (!statusMoveOk(before, nextStatus)) fail(MATCH_STATUS_MOVE);
}

/** Server start/finish stamps for a status change (server time only; `now` = the server clock where there is one). */
export function stampTimes(before: Pick<Match, 'status' | 'startedAt' | 'finishedAt'> | null, next: Match['status'], now: number) {
  const out: { startedAt?: number | null; startedServerAt?: number | null; finishedAt?: number | null; finishedServerAt?: number | null } = {};
  const from = before?.status ?? null;
  if (next === 'live' && (from === null || from === 'scheduled') && before?.startedAt == null) {
    out.startedAt = now;
    out.startedServerAt = now;
  }
  if (next === 'scheduled' && from === 'live') {
    out.startedAt = null;
    out.startedServerAt = null;
  }
  if (next === 'finished' && from !== 'finished') {
    out.finishedAt = now;
    out.finishedServerAt = now;
  }
  if (next === 'live' && from === 'finished') {
    out.finishedAt = null;
    out.finishedServerAt = null;
  }
  return out;
}

/** 1.4.6 (QA V145-3): the set-up fields frozen after the first rally (core/lifecycle.ts 'editSetup'). */
export const SETUP_FIELDS = ['rules', 'firstServe', 'teamA', 'teamB', 'participantIds', 'captains', 'teamSizeMode'] as const;

/**
 * Delete – 1.4.6 (QA V145-1, core/lifecycle.ts 'delete'): only a match that never had a rally (maxEvents == 0) and
 * has no abandon record, request or admin re-open, by its creator or an admin who isn't part of it; never live.
 */
export function deleteProblem(m: LcMatch, uid: string | null | undefined, admin: boolean): string | null {
  return lifecycleProblem('delete', m, uid ?? '', admin) ? MATCH_DELETE_FORBIDDEN : null;
}

/** The parts of an event that make the score (a re-credit may change only playerId / kind). */
const rallyKey = (e: MatchEvent) => `${e.type}|${e.side}|${e.at}`;
const eventKey = (e: MatchEvent) => `${rallyKey(e)}|${(e as { playerId?: string | null }).playerId ?? ''}|${(e as { kind?: string | null }).kind ?? ''}`;

/**
 * 1.4.2 (QA V141-8): once a match is FINISHED (the winning rally is in), its score can't change on any
 * backend – no undo, no rally added, never back to "live" – even before the Player of the Match is picked
 * (1.4.1 still allowed undo until then, so closing the result sheet left an active Undo on a finished match).
 * The only change left is the player credit / shot type of one of the last 3 rallies (same rally: type, side
 * and time unchanged – crediting the match-winning rally from the "Who scored?" sheet), exactly what
 * firestore.rules recreditOk allows. Returns MATCH_FINISHED or null.
 */
export function finishedScoreProblem(before: { status?: Match['status']; events?: readonly MatchEvent[] | null }, nextEvents: readonly MatchEvent[], nextStatus?: Match['status']): string | null {
  if (before.status !== 'finished') return null;
  if (nextStatus === 'live' || nextStatus === 'scheduled') return MATCH_FINISHED; // other moves: statusMoveOk
  const o = before.events ?? [];
  const n = nextEvents;
  if (n.length !== o.length) return MATCH_FINISHED;
  for (let i = 0; i < n.length; i++) {
    if (eventKey(n[i]) === eventKey(o[i])) continue;
    if (i < n.length - 3 || rallyKey(n[i]) !== rallyKey(o[i])) return MATCH_FINISHED;
  }
  return null;
}

/**
 * 1.4.3 (QA V142-1..3): every field of a match document, grouped by what may still change once the match is
 * over (the winning rally is in). The principle: a finished match is FINAL on every backend – before the Player
 * of the Match is picked too. Still writable:
 *  - `events`: only the player credit / shot type of one of the last 3 rallies (finishedScoreProblem);
 *  - `playerOfMatchId`: once, through the POTM action (potmProblem; never through an update);
 *  - `verification` / `confirmedAt`: the opposing captain's verdict and the admin review (server/rules actions);
 *  - `updatedAt` (and Firebase's `serverUpdatedAt`): bookkeeping.
 * Everything else is frozen – including the rules (points per set, deciding-set points, sets, win-by, team
 * size…), the summary (score / winner), the status (finished → anything), the rosters, captains, lineups,
 * first serve, title, place, times, links, stream and "I want to play" (only offered on scheduled matches).
 * Tests: src/core/__tests__/fixes143.test.ts enumerates MATCH_FIELDS and tries every frozen one on every backend.
 */
export const MATCH_FIELDS = [
  'id', 'title', 'teamA', 'teamB', 'rules', 'firstServe', 'events', 'summary', 'status', 'createdBy', 'scorerId', 'participantIds',
  'location', 'scheduledAt', 'startedAt', 'finishedAt', 'tournamentId', 'fixtureId', 'challengeId', 'stream', 'interestedIds',
  'teamSizeMode', 'lineups', 'playerOfMatchId', 'captains', 'verification', 'startedServerAt', 'finishedServerAt', 'createdAt',
  'updatedAt', 'confirmedAt',
] as const satisfies readonly (keyof Match)[];
export const FINISHED_MATCH_WRITABLE: readonly string[] = ['events', 'playerOfMatchId', 'verification', 'confirmedAt', 'updatedAt', 'serverUpdatedAt'];
export const FINISHED_MATCH_FROZEN: readonly string[] = MATCH_FIELDS.filter((k) => !FINISHED_MATCH_WRITABLE.includes(k));

/** The match is over: stored as finished, or (an inconsistent older document) its event log already has a winner. */
export function matchOver(m: { status?: Match['status']; events?: readonly MatchEvent[] | null; rules?: Match['rules']; firstServe?: Match['firstServe'] }): boolean {
  if (m.status === 'finished') return true;
  if (m.status !== 'live' || !m.events?.length || !m.rules) return false;
  return computeState(m.rules, m.events, m.firstServe ?? 'A').finished;
}

/**
 * 1.4.3: the freeze for one write. `changed` = the keys whose value changes (any key, also unknown ones).
 * Any status move (back to live/scheduled, or abandoned – QA V142-7: the scorer's ⋮ Abandon on a finished match)
 * and every other changed key except the writable ones → match_finished. Only an admin can void a result
 * (the review, verification.status = 'voided').
 */
export function finishedFreezeProblem(
  before: { status?: Match['status']; events?: readonly MatchEvent[] | null; rules?: Match['rules']; firstServe?: Match['firstServe'] },
  changed: readonly string[],
  nextEvents: readonly MatchEvent[],
  nextStatus?: Match['status'],
): string | null {
  if (!matchOver(before)) return null;
  if (nextStatus != null && nextStatus !== 'finished' && nextStatus !== before.status) return MATCH_FINISHED;
  // 1.4.4 (QA V143-7): a 'live' document whose events already have a winner (an older or seeded row) is
  // REPAIRED by the finishing write – status 'finished' plus the server's finish time – instead of staying live
  // for ever. Nothing else changes with it (same events, or a re-credit of the last rallies).
  const repair = before.status === 'live' && nextStatus === 'finished';
  if (changed.some((k) => k !== 'status' && !(repair && k === 'finishedAt') && !FINISHED_MATCH_WRITABLE.includes(k))) return MATCH_FINISHED;
  return finishedScoreProblem({ status: 'finished', events: before.events }, nextEvents, nextStatus);
}


/**
 * 1.4.4 (Firebase only, QA V143-2/V143-3), mirroring firestore.rules so the scorer gets a clear message instead of
 * "permission denied": the rules can't replay a match, so
 *  - the scorer may abandon only while the log is shorter than the shortest possible win (an admin abandons a
 *    longer unfinished match after checking the replay);
 *  - the rules, the first server, the rosters and a set lineup already stored are frozen once the first rally exists.
 * (The API server and the demo replay the match on every write, so they don't need these limits.)
 */
export function firebaseUpdateProblem(before: Pick<Match, 'events' | 'rules' | 'lineups'> & { maxEvents?: number | null }, patch: Partial<Match>): string | null {
  const n = before.events?.length ?? 0;
  if (patch.status === 'abandoned' && maxEventsOf(before) >= minWinEvents(before.rules)) return ABANDON_NEEDS_ADMIN;
  if (maxEventsOf(before) === 0) return null;
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  for (const k of SETUP_FIELDS) {
    if (k in patch && !same(patch[k], (before as Record<string, unknown>)[k])) return MATCH_SETUP_LOCKED;
  }
  if (n > 0 && patch.lineups !== undefined && before.lineups) {
    const next = patch.lineups ?? {};
    for (const [set, l] of Object.entries(before.lineups)) if (!same(next[set], l)) return MATCH_SETUP_LOCKED;
  }
  return null;
}

/**
 * 1.4.4 (QA V143-8): a rules or first-serve change may not END a live match (the replay under the new rules has a
 * winner while the status stays live – a won-but-live match). The API refuses it with 400 (events after the end, or
 * this code when the last rally becomes the winning one); the demo now does the same. Firebase freezes the rules
 * and the first serve once the first rally exists (firebaseUpdateProblem / firestore.rules).
 */
export function rulesEndProblem(before: Pick<Match, 'rules' | 'firstServe' | 'events' | 'status'>, patch: Partial<Match>): string | null {
  if (patch.rules === undefined && patch.firstServe === undefined) return null;
  const status = patch.status ?? before.status;
  const events = patch.events ?? before.events ?? [];
  if (status !== 'live' || !events.length) return null;
  return computeState(patch.rules ?? before.rules, events, patch.firstServe ?? before.firstServe ?? 'A').finished ? MATCH_RULES_END : null;
}
