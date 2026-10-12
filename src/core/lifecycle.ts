/**
 * 1.4.6 (QA V145, "stop finding these one at a time"): THE match lifecycle – one state machine for every backend.
 *
 * A match is in one of four statuses (scheduled / live / finished / abandoned) and carries latches that never go
 * back: maxEvents (the log once had a rally), wasWon (it was won once), the abandon record and its review, the
 * captain verdict (per re-open epoch), the admin review (approved / voided), the re-open counter. Every action
 * below is allowed only for some ROLES, from some STATUSES and while some GUARDS hold; anything else is refused with
 * the action's code. LIFECYCLE is the table; lifecycleProblem() evaluates it.
 *
 * Who conforms:
 *  - the API server, the demo and the Firebase client call the core functions built on this table
 *    (matchGuards.deleteProblem / guardUpdate / statusMoveOk, abandon.planAbandon / reportersOf / resolveActions /
 *    resolvePatch, antifraud.confirmProblem, scorerHandoff.reassignProblem);
 *  - firestore.rules MIRROR it by hand (rules can't import code). The mirror is checked by walking the table:
 *    src/core/__tests__/lifecycle.test.ts (core + demo), server/tests/lifecycle.test.ts (API) and rules-tests
 *    "1.4.6 lifecycle walk" (Firebase) build every state in LC_STATES, try every action in LC_WALK as every role
 *    and expect exactly what lifecycleProblem() says. The table as text: docs/LIFECYCLE.md
 *    (`node scripts/gen-lifecycle-doc.js`, `--check` in the suites).
 *
 * Where the rules can't follow (they can't replay a match) the table is written so they don't need to: e.g. an
 * admin re-opens / abandons a finished match only while its log is SHORTER than the shortest possible win (so it
 * can't have a winner) and nobody gave a verdict or picked a POTM. The few client-only checks left are listed in
 * LC_CLIENT_ONLY (and in docs/LIFECYCLE.md); the walk doesn't build those states.
 */
import { computeState } from './scoring';
import { currentVerification, ownMatchReview, sideOfPlayer, verdictCaptains, verdictSetupProblem } from './antifraud';
export { currentVerification };
import { ABANDON_POLICY, type AbandonPolicy } from './abandonPolicy';
import type { AbandonRecord, Match, MatchStatus } from './types';

// ---------------- facts ----------------
/** The most events the log ever had (stored maxEvents; older matches: the current length). */
export const maxEventsOf = (m: { maxEvents?: number | null; events?: readonly unknown[] | null }): number =>
  Math.max(typeof m.maxEvents === 'number' ? m.maxEvents : 0, m.events?.length ?? 0);
/** The fewest events any win takes: (bestOf + 1) / 2 sets of pointsPerSet points (same formula as firestore.rules). */
export function minWinEvents(rules: Pick<Match['rules'], 'bestOf' | 'pointsPerSet'>): number {
  return ((rules.bestOf + 1) / 2) * rules.pointsPerSet;
}

/** 1.4.6 (QA V145-12, consent policy): at most this many abandon requests per match, at least this far apart. */
export const ABANDON_REQUEST_LIMIT = Object.freeze({ MAX_PER_MATCH: 3, COOLDOWN_MS: 2 * 60_000 });

export type LcMatch = Pick<Match, 'status' | 'events' | 'rules' | 'firstServe' | 'scorerId' | 'createdBy' | 'teamA' | 'teamB' | 'participantIds'> &
  Partial<Pick<Match, 'maxEvents' | 'wasWon' | 'abandon' | 'abandonRequest' | 'resolution' | 'captains' | 'playerOfMatchId' | 'verification' | 'reopenEpoch' | 'scorerReassign' | 'abandonRequests' | 'abandonRequestAt'>>;

export interface LcFacts {
  status: MatchStatus;
  /** maxEvents > 0: a rally existed at some point (undo to 0 doesn't change it). */
  played: boolean;
  /** maxEvents >= the shortest possible win. */
  reachedMinWin: boolean;
  /** The wasWon latch, or the current events have a winner. */
  wasWon: boolean;
  /** The current events have a winner. */
  winnerNow: boolean;
  /** 1.4.7 (QA V146-5): the stored wasWon latch alone (not the replay). */
  wasWonLatch: boolean;
  potm: boolean;
  /** A captain verdict (confirmed / rejected) in the current epoch. */
  verdict: boolean;
  reviewed: 'none' | 'approved' | 'voided';
  record: 'none' | AbandonRecord['review'];
  recordMode: AbandonRecord['mode'] | null;
  /** The record was reported by the opposing captain / decided by an admin. */
  reported: boolean;
  recordReviewed: boolean;
  /** A consent request is pending. */
  request: boolean;
  /** consent policy: requests made so far / ms since the last one (Infinity = never). */
  requestsMade: number;
  sinceLastRequest: number;
  /** An admin re-opened it at some point. */
  reopened: boolean;
  /** 1.4.8 (QA V147-1/2): it has captains and nobody can confirm it (verdict invariant broken). */
  noConfirmer: boolean;
}

export function lcFacts(m: LcMatch, now = Date.now()): LcFacts {
  const mx = maxEventsOf(m);
  let winnerNow = false;
  try {
    winnerNow = !!m.events?.length && !!m.rules && computeState(m.rules, m.events, m.firstServe ?? 'A').winner !== null;
  } catch {
    winnerNow = false;
  }
  const v = currentVerification(m);
  const st = v?.status ?? 'pending';
  const a = m.abandon ?? null;
  return {
    status: m.status,
    played: mx > 0,
    reachedMinWin: !!m.rules && mx >= minWinEvents(m.rules),
    wasWon: !!m.wasWon || winnerNow,
    winnerNow,
    wasWonLatch: !!m.wasWon,
    potm: !!m.playerOfMatchId,
    verdict: !!v?.captain || st === 'confirmed' || st === 'disputed',
    reviewed: st === 'approved' ? 'approved' : st === 'voided' ? 'voided' : 'none',
    record: a ? a.review : 'none',
    recordMode: a ? a.mode : null,
    reported: !!a?.reportedBy,
    recordReviewed: !!a?.reviewedBy || a?.mode === 'admin',
    request: m.status === 'live' && !!m.abandonRequest,
    requestsMade: m.abandonRequests ?? 0,
    sinceLastRequest: m.abandonRequestAt != null ? now - m.abandonRequestAt : Infinity,
    reopened: !!m.resolution || (m.reopenEpoch ?? 0) > 0,
    noConfirmer: !!m.captains && verdictSetupProblem(m as Match) !== null,
  };
}

// ---------------- roles ----------------
/**
 * creator / scorer: of this match. verdictCaptain: the captain opposing the scoring side as at the first rally
 * (verdictCaptains) – never the CURRENT scorer (V145-6). reporter: a captain of the side the abandoner doesn't play
 * on (both captains when the abandoner plays on neither side). admin: an admin who is NOT part of the match (an admin
 * who is gets 'participant' and their other roles only, V144-3). participant: anyone in the match. other: anyone else.
 */
export type LcRole = 'creator' | 'scorer' | 'verdictCaptain' | 'reporter' | 'admin' | 'participant' | 'other';
export const LC_ROLES: readonly LcRole[] = ['creator', 'scorer', 'verdictCaptain', 'reporter', 'admin', 'participant', 'other'];

export function lcRoles(m: LcMatch, uid: string, isAdmin: boolean): Set<LcRole> {
  const out = new Set<LcRole>();
  if (!uid) return new Set(['other']);
  if (uid === m.createdBy) out.add('creator');
  if (uid === m.scorerId) out.add('scorer');
  if (uid !== m.scorerId && verdictCaptains(m).includes(uid)) out.add('verdictCaptain');
  if (m.captains && (uid === m.captains.A || uid === m.captains.B)) {
    const by = m.abandon?.by ?? m.scorerId;
    const side = sideOfPlayer(m, by);
    const mine = uid === m.captains.A ? 'A' : 'B';
    if (side !== mine) out.add('reporter');
  }
  const own = ownMatchReview(m, uid);
  if (isAdmin && !own) out.add('admin');
  if (own) out.add('participant');
  if (!out.size) out.add('other');
  return out;
}

// ---------------- the table ----------------
export type LcAction =
  | 'delete' | 'unschedule' | 'editSetup' | 'score' | 'potm' | 'handover'
  | 'abandon' | 'report' | 'confirmAbandon' | 'reinstate' | 'reopen' | 'adminAbandon' | 'void' | 'approve' | 'verdict' | 'reassign' | 'repairVerdict';

interface Guard {
  /** Shown in docs/LIFECYCLE.md. */
  text: string;
  ok: (f: LcFacts, policy: AbandonPolicy) => boolean;
  code: string;
}
export interface LcRule {
  action: LcAction;
  text: string;
  roles: readonly LcRole[];
  /** Refusal for a caller without one of the roles (admin actions: admin_only / own_match, see roleCode). */
  roleCode: string;
  from: readonly MatchStatus[];
  /** Refusal per status the action doesn't apply to (default: the rule's statusCode). */
  statusCodes?: Partial<Record<MatchStatus, string>>;
  statusCode: string;
  guards: readonly Guard[];
  /** What a successful action leads to (docs). */
  to: string;
}

const never = (f: LcFacts) => !f.played;
const noRecordEver = (f: LcFacts) => f.record === 'none' && !f.request && !f.reopened;
const shortOfAnyWin: Guard = { text: 'log shorter than the shortest possible win (so no winner – rules can check it)', ok: (f) => !f.reachedMinWin && !f.winnerNow, code: 'resolve_not_allowed' };
const noPotm: Guard = { text: 'no Player of the Match', ok: (f) => !f.potm, code: 'resolve_not_allowed' };
const noVerdict: Guard = { text: 'no captain verdict in this epoch, not approved / voided', ok: (f) => !f.verdict && f.reviewed === 'none', code: 'resolve_not_allowed' };
// 1.4.7 (QA V146-5): a match that was ever won is reinstated to finished only, so its log must still hold the win
const wonBackToFinished: Guard = { text: 'wasWon: back to finished only – the log must still have its winner (V146-5)', ok: (f) => !f.wasWonLatch || f.winnerNow, code: 'resolve_not_allowed' };
const reviewable: Guard = { text: 'record pending review, or an older abandoned match with rallies and no record', ok: (f) => f.record === 'pending' || (f.record === 'none' && f.played), code: 'resolve_not_allowed' };

export const LIFECYCLE: readonly LcRule[] = [
  {
    action: 'delete', text: 'delete the match', roles: ['creator', 'admin'], roleCode: 'match_delete_forbidden',
    from: ['scheduled', 'abandoned'], statusCode: 'match_delete_forbidden',
    guards: [
      { text: 'never had a rally (maxEvents == 0 – undo to 0 does not reopen delete)', ok: never, code: 'match_delete_forbidden' },
      { text: 'no abandon record, request or admin re-open', ok: noRecordEver, code: 'match_delete_forbidden' },
    ],
    to: 'gone',
  },
  {
    action: 'unschedule', text: 'move a live match back to scheduled', roles: ['scorer'], roleCode: 'forbidden',
    from: ['live'], statusCode: 'match_status_move',
    guards: [{ text: 'never had a rally', ok: never, code: 'match_status_move' }],
    to: 'scheduled',
  },
  {
    action: 'editSetup', text: 'change teams, participants, captains, team size, rules or first serve', roles: ['scorer'], roleCode: 'forbidden',
    from: ['scheduled', 'live'], statusCodes: { finished: 'match_finished', abandoned: 'match_terminal' }, statusCode: 'match_terminal',
    guards: [{ text: 'never had a rally (match_setup_locked, also after undo to 0)', ok: never, code: 'match_setup_locked' }],
    to: 'same status',
  },
  {
    action: 'score', text: 'add / undo a rally', roles: ['scorer'], roleCode: 'forbidden',
    from: ['scheduled', 'live'], statusCodes: { finished: 'match_finished', abandoned: 'match_terminal' }, statusCode: 'match_terminal',
    guards: [
      { text: 'no consent request pending', ok: (f) => !f.request, code: 'abandon_pending' },
      { text: 'the events have no winner yet', ok: (f) => !f.winnerNow, code: 'match_finished' },
    ],
    to: 'live (finished by the winning rally)',
  },
  {
    action: 'potm', text: 'pick the Player of the Match', roles: ['scorer'], roleCode: 'potm_not_scorer',
    from: ['finished'], statusCode: 'potm_not_finished',
    guards: [
      { text: 'the events have a winner', ok: (f) => f.winnerNow, code: 'potm_not_finished' },
      { text: 'not picked yet', ok: (f) => !f.potm, code: 'potm_already_set' },
    ],
    to: 'finished + POTM',
  },
  {
    action: 'handover', text: 'hand scoring to someone else (targets: before the first rally anyone who leaves a verdict captain – never the opposing captain or their team; after it the scorer\'s own side or an admin; never the verdict captain\'s team – core/scorerHandoff.ts, V146-2/3)', roles: ['creator', 'scorer'], roleCode: 'forbidden',
    from: ['scheduled', 'live'], statusCode: 'match_terminal', guards: [], to: 'same status, new scorer',
  },
  {
    action: 'abandon', text: "the scorer's ⋮ Abandon", roles: ['scorer'], roleCode: 'abandon_not_allowed',
    from: ['scheduled', 'live'], statusCodes: { finished: 'match_finished', abandoned: 'match_terminal' }, statusCode: 'match_terminal',
    guards: [
      { text: 'never won (wasWon latch)', ok: (f) => !f.wasWon, code: 'match_finished' },
      { text: 'no consent request pending', ok: (f) => !f.request, code: 'abandon_pending' },
      { text: 'the log never reached the shortest possible win', ok: (f) => !f.reachedMinWin, code: 'abandon_needs_admin' },
      { text: 'no abandon record yet (after a reinstate only an admin abandons – V145-5)', ok: (f) => f.record === 'none', code: 'abandon_needs_admin' },
      { text: "consent policy after the first rally: live, at most 3 requests per match, 2 min apart", ok: (f, p) => p !== 'consent' || !f.played || f.status === 'live', code: 'abandon_not_allowed' },
      { text: '(consent) request limit', ok: (f, p) => p !== 'consent' || !f.played || f.requestsMade < ABANDON_REQUEST_LIMIT.MAX_PER_MATCH, code: 'abandon_rate_limited' },
      { text: '(consent) request cooldown', ok: (f, p) => p !== 'consent' || !f.played || f.sinceLastRequest >= ABANDON_REQUEST_LIMIT.COOLDOWN_MS, code: 'abandon_rate_limited' },
    ],
    to: 'abandoned (no rally: directly; review/flag: record pending review; consent: a request, still live)',
  },
  {
    action: 'report', text: "the opposing captain's Report", roles: ['reporter'], roleCode: 'abandon_not_allowed',
    from: ['abandoned'], statusCode: 'abandon_not_allowed',
    guards: [
      { text: 'an abandon record exists and the match had a rally (V145-11)', ok: (f) => f.record !== 'none' && f.played, code: 'abandon_not_allowed' },
      { text: "not an admin's or an agreed (consent) abandon", ok: (f) => f.recordMode !== 'admin' && f.recordMode !== 'consent', code: 'abandon_not_allowed' },
      { text: 'not reported or decided yet, not reinstated', ok: (f) => !f.reported && !f.recordReviewed && f.record !== 'reinstated', code: 'abandon_not_allowed' },
    ],
    to: 'abandoned, record pending + reportedBy',
  },
  {
    action: 'confirmAbandon', text: 'admin confirms the abandon', roles: ['admin'], roleCode: 'admin_only',
    from: ['abandoned'], statusCode: 'resolve_not_allowed', guards: [reviewable], to: 'abandoned, record confirmed',
  },
  {
    action: 'reinstate', text: 'admin reinstates an abandoned match', roles: ['admin'], roleCode: 'admin_only',
    from: ['abandoned'], statusCode: 'resolve_not_allowed', guards: [reviewable, wonBackToFinished],
    to: 'live when the log has no winner and wasWon was never set; otherwise finished + wasWon (V145-10, V146-5); record reinstated',
  },
  {
    action: 'reopen', text: 'admin re-opens a finished match without a winner', roles: ['admin'], roleCode: 'admin_only',
    from: ['finished'], statusCode: 'resolve_not_allowed', guards: [shortOfAnyWin, noPotm, noVerdict],
    to: 'live; verdict / POTM / confirmed state cleared, reopenEpoch + 1 (V145-2)',
  },
  {
    action: 'adminAbandon', text: 'admin abandons', roles: ['admin'], roleCode: 'admin_only',
    from: ['scheduled', 'live', 'finished'], statusCode: 'resolve_not_allowed',
    guards: [
      { text: 'never won (scheduled / live)', ok: (f) => f.status === 'finished' || !f.wasWon, code: 'resolve_not_allowed' },
      { ...shortOfAnyWin, text: 'finished: ' + shortOfAnyWin.text, ok: (f, p) => f.status !== 'finished' || shortOfAnyWin.ok(f, p) },
      { ...noPotm, text: 'finished: ' + noPotm.text, ok: (f, p) => f.status !== 'finished' || noPotm.ok(f, p) },
      { ...noVerdict, text: 'finished: ' + noVerdict.text, ok: (f, p) => f.status !== 'finished' || noVerdict.ok(f, p) },
    ],
    to: 'abandoned, admin record (an earlier record moves to abandonHistory – V145-5)',
  },
  {
    action: 'void', text: 'admin voids the result', roles: ['admin'], roleCode: 'admin_only',
    from: ['finished'], statusCode: 'not_completed',
    guards: [
      { text: 'completed (POTM) or without a winner', ok: (f) => f.potm || !f.winnerNow, code: 'not_completed' },
      { text: 'not approved / voided yet', ok: (f) => f.reviewed === 'none', code: 'already_reviewed' },
    ],
    to: 'finished, voided (never counts)',
  },
  {
    action: 'approve', text: 'admin clears the fraud flag', roles: ['admin'], roleCode: 'admin_only',
    from: ['finished'], statusCode: 'not_completed',
    guards: [
      { text: 'completed (winner + POTM)', ok: (f) => f.potm && f.winnerNow, code: 'not_completed' },
      { text: 'not approved / voided yet', ok: (f) => f.reviewed === 'none', code: 'already_reviewed' },
    ],
    to: 'finished, approved',
  },
  {
    action: 'verdict', text: 'the opposing captain confirms / rejects', roles: ['verdictCaptain'], roleCode: 'not_captain',
    from: ['finished'], statusCode: 'not_completed',
    guards: [
      { text: 'completed (winner + POTM)', ok: (f) => f.potm && f.winnerNow, code: 'not_completed' },
      { text: 'no verdict yet in this epoch (or approved without one)', ok: (f) => !f.verdict && f.reviewed !== 'voided', code: 'already_reviewed' },
    ],
    to: 'finished, confirmed / disputed (epoch = reopenEpoch)',
  },
  {
    action: 'reassign', text: 'admin moves scoring (never to the verdict captain – V145-6)', roles: ['admin'], roleCode: 'admin_only',
    from: ['scheduled', 'live'], statusCode: 'match_terminal', guards: [], to: 'same status, new scorer (recorded after the first rally)',
  },
  {
    action: 'repairVerdict', text: 'admin repairs a match nobody can confirm: sets a valid scorer, or (1.4.10, V149-3) a captain for a side whose captain plays for the other team (V147-2, core/verdictRepair.ts)', roles: ['admin'], roleCode: 'admin_only',
    from: ['scheduled', 'live', 'finished', 'abandoned'], statusCode: 'repair_not_needed',
    guards: [
      { text: 'nobody can confirm it now (no verdict captain, or the scorer on the verdict side)', ok: (f) => f.noConfirmer, code: 'repair_not_needed' },
      { text: 'no captain verdict in this epoch, not approved / voided', ok: (f) => !f.verdict && f.reviewed === 'none', code: 'repair_not_needed' },
    ],
    to: 'same status; a valid scorer (verdict reference reset) or the side\u2019s new captain; recorded in verdictRepair',
  },
];

export const LC_RULE: Readonly<Record<LcAction, LcRule>> = Object.freeze(Object.fromEntries(LIFECYCLE.map((r) => [r.action, r])) as Record<LcAction, LcRule>);

/** Codes a role refusal maps to for the admin actions: a non-admin gets admin_only, an admin in the match own_match. */
function roleRefusal(rule: LcRule, roles: Set<LcRole>, isAdmin: boolean): string {
  if (rule.roles.includes('admin') && rule.roles.length === 1) return isAdmin && roles.has('participant') ? 'own_match' : 'admin_only';
  if (rule.action === 'verdict') {
    if (roles.has('scorer') || roles.has('creator')) return 'scoring_side';
    return 'not_captain';
  }
  return rule.roleCode;
}

/**
 * null = allowed. Order: role, status, guards (first failing guard's code). `isAdmin` = the caller has the admin claim
 * (whether they count as 'admin' depends on being part of the match).
 */
export function lifecycleProblem(action: LcAction, m: LcMatch, uid: string, isAdmin: boolean, opts: { now?: number; policy?: AbandonPolicy } = {}): string | null {
  const rule = LC_RULE[action];
  const roles = lcRoles(m, uid, isAdmin);
  if (!rule.roles.some((r) => roles.has(r))) return roleRefusal(rule, roles, isAdmin);
  return lifecycleStateProblem(action, m, opts);
}
/** The status / guard part only (the caller's role already checked). */
export function lifecycleStateProblem(action: LcAction, m: LcMatch, opts: { now?: number; policy?: AbandonPolicy } = {}): string | null {
  const rule = LC_RULE[action];
  const f = lcFacts(m, opts.now ?? Date.now());
  if (!rule.from.includes(f.status)) return rule.statusCodes?.[f.status] ?? rule.statusCode;
  const policy = opts.policy ?? ABANDON_POLICY;
  for (const g of rule.guards) if (!g.ok(f, policy)) return g.code;
  return null;
}

// ---------------- the walk (tests on every backend) ----------------
/** States every backend's walk builds (bo1 to 5, win by 1: the shortest win is 5 events). */
export type LcStateName =
  | 'sched0' | 'live0' | 'live3' | 'undo0' | 'long8' | 'wonPending' | 'wonConfirmed' | 'nowin3'
  | 'abDirect' | 'abPending' | 'abConfirmed' | 'abLegacy' | 'reinstated' | 'abWonLog' | 'noConfirm' | 'noConfirmLive';
export interface LcStateSpec {
  name: LcStateName;
  text: string;
  status: MatchStatus;
  /** events: 'B' x n, or the 4-4 tie for long8 */
  events: 'none' | 'B3' | 'B5' | 'tie8';
  maxEvents: number;
  wasWon?: boolean;
  potm?: boolean;
  verdict?: 'confirmed';
  record?: AbandonRecord['review'];
  recordMode?: AbandonRecord['mode'];
  /** 1.4.8 (QA V147-2): older data nobody can confirm – the scorer plays for B (the creator for A) */
  noConfirmer?: boolean;
}
export const LC_STATES: readonly LcStateSpec[] = [
  { name: 'sched0', text: 'scheduled, never played', status: 'scheduled', events: 'none', maxEvents: 0 },
  { name: 'live0', text: 'live, no rally yet', status: 'live', events: 'none', maxEvents: 0 },
  { name: 'live3', text: 'live, 3 rallies', status: 'live', events: 'B3', maxEvents: 3 },
  { name: 'undo0', text: 'live, undone to 0 after 3 rallies', status: 'live', events: 'none', maxEvents: 3 },
  { name: 'long8', text: 'live, 4–4 (log past the shortest win, no winner)', status: 'live', events: 'tie8', maxEvents: 8 },
  { name: 'wonPending', text: 'finished, won, POTM, verdict pending', status: 'finished', events: 'B5', maxEvents: 5, wasWon: true, potm: true },
  { name: 'wonConfirmed', text: 'finished, won, POTM, confirmed by the opposing captain', status: 'finished', events: 'B5', maxEvents: 5, wasWon: true, potm: true, verdict: 'confirmed' },
  { name: 'nowin3', text: 'stored as finished after 3 rallies (no winner)', status: 'finished', events: 'B3', maxEvents: 3, wasWon: true },
  { name: 'abDirect', text: 'abandoned before the first rally', status: 'abandoned', events: 'none', maxEvents: 0 },
  { name: 'abPending', text: 'abandoned after 3 rallies, review pending', status: 'abandoned', events: 'B3', maxEvents: 3, record: 'pending', recordMode: 'review' },
  { name: 'abConfirmed', text: 'abandoned, an admin confirmed it', status: 'abandoned', events: 'B3', maxEvents: 3, record: 'confirmed', recordMode: 'review' },
  { name: 'abLegacy', text: 'abandoned after 3 rallies by an older app (no record)', status: 'abandoned', events: 'B3', maxEvents: 3 },
  { name: 'reinstated', text: 'live again after an admin reinstated it', status: 'live', events: 'B3', maxEvents: 3, record: 'reinstated', recordMode: 'review' },
  // 1.4.7 (QA V146-5): an abandoned match whose log holds a win (wasWon set) – reinstated to finished only
  { name: 'abWonLog', text: 'abandoned with a won log (wasWon), review pending', status: 'abandoned', events: 'B5', maxEvents: 5, wasWon: true, record: 'pending', recordMode: 'review' },
  // 1.4.8 (QA V147-2): older data nobody can confirm (scorer on B, creator on A) – only the admin repair helps
  { name: 'noConfirm', text: 'finished, won, POTM, nobody can confirm (scorer on B, creator on A – older data)', status: 'finished', events: 'B5', maxEvents: 5, wasWon: true, potm: true, noConfirmer: true },
  { name: 'noConfirmLive', text: 'live, 3 rallies, nobody can confirm (older data)', status: 'live', events: 'B3', maxEvents: 3, noConfirmer: true },
];
/** Who the walk fixtures name (each backend maps them to its own users). */
export interface LcWalkCast {
  scorer: string;
  oppCaptain: string;
  /** a player of side B (the POTM of the won states) */
  bPlayer: string;
  /** the admin who decided the confirmed / reinstated records (not a walker) */
  pastAdmin: string;
}
/** The events of a walk state (bo1 to 5, win by 1). */
export function walkEvents(kind: LcStateSpec['events'], t0: number): Match['events'] {
  const ev = (side: 'A' | 'B', i: number) => ({ type: 'point' as const, side, at: t0 + i * 1000 });
  if (kind === 'none') return [];
  if (kind === 'B3') return [0, 1, 2].map((i) => ev('B', i));
  if (kind === 'B5') return [0, 1, 2, 3, 4].map((i) => ev('B', i));
  return [0, 1, 2, 3, 4, 5, 6, 7].map((i) => ev(i % 2 ? 'B' : 'A', i));
}
/** The lifecycle fields of a walk state (status, events, latches, verdict, record); times are ms. */
export function walkFields(spec: LcStateSpec, cast: LcWalkCast, t0: number): Partial<Match> {
  const events = walkEvents(spec.events, t0);
  const end = t0 + 60_000;
  const out: Partial<Match> = { status: spec.status, events, maxEvents: spec.maxEvents, wasWon: !!spec.wasWon };
  if (spec.potm) out.playerOfMatchId = cast.bPlayer;
  if (spec.noConfirmer) out.scorerId = cast.bPlayer;
  if (spec.verdict) out.verification = { status: 'confirmed', captain: 'confirmed', by: cast.oppCaptain, at: end };
  if (spec.record) {
    out.abandon = {
      by: cast.scorer, at: end, events: events.length, mode: spec.recordMode ?? 'review', review: spec.record,
      score: { setsA: 0, setsB: 0, currentA: 0, currentB: events.length }, behind: true,
      ...(spec.record !== 'pending' ? { reviewedBy: cast.pastAdmin, reviewedAt: end + 1000 } : {}),
    };
  }
  return out;
}
/** Actions every backend's walk tries in every state, as every walk role. */
export const LC_WALK: readonly LcAction[] = ['delete', 'unschedule', 'editSetup', 'abandon', 'report', 'confirmAbandon', 'reinstate', 'reopen', 'adminAbandon', 'void', 'verdict', 'repairVerdict'];
/**
 * Walk roles: who tries (fixtures: the scorer created the match and plays on A as A's captain; B's captain opposes;
 * a teammate of the scorer; an admin outside the match; a stranger).
 */
export type LcWalker = 'scorer' | 'oppCaptain' | 'teammate' | 'admin' | 'stranger';
export const LC_WALKERS: readonly LcWalker[] = ['scorer', 'oppCaptain', 'teammate', 'admin', 'stranger'];
/**
 * Walk cells that are not transitions: writing the status a match already has (unschedule on a scheduled match)
 * changes nothing, and each backend treats a no-op write as it treats any no-op. The walks skip these cells.
 */
export const walkSkip = (spec: Pick<LcStateSpec, 'status'>, action: LcAction): boolean => action === 'unschedule' && spec.status === 'scheduled';
/** Actions a backend doesn't have at all (e.g. the demo / Firebase app never deletes a match – the API and the rules do). */
export const LC_NOT_ON: Readonly<Record<'api' | 'demo' | 'firebase', readonly LcAction[]>> = { api: [], demo: ['delete'], firebase: [] };

/**
 * Checks only the clients can make (the rules can't replay a match); the walk doesn't build these states:
 *  - an admin abandon of a LIVE match whose events already have a winner (a stuck older row): refused by core
 *    (void it instead); the rules allow an admin abandon of any live match that was never won (wasWon).
 *  - void of a finished match that has a winner but no POTM yet: core says not_completed (wait for the POTM); the
 *    rules allow voiding any finished match not reviewed yet.
 */
export const LC_CLIENT_ONLY: readonly string[] = [
  'reinstate to live of an abandoned match whose log has a winner but no wasWon latch (older docs; rules: live allowed unless wasWon)',
  'adminAbandon of a live match whose events already have a winner (rules: allowed unless wasWon)',
  'void of a won finished match before its POTM (rules: allowed)',
];

/** The expected outcome of one walk cell (null = allowed). */
export function walkExpect(action: LcAction, m: LcMatch, uid: string, isAdmin: boolean, policy: AbandonPolicy = ABANDON_POLICY, now = Date.now()): string | null {
  return lifecycleProblem(action, m, uid, isAdmin, { policy, now });
}

/** docs/LIFECYCLE.md (scripts/gen-lifecycle-doc.js). */
export function lifecycleMarkdown(): string {
  const lines: string[] = [
    '# VolleyLive match lifecycle (generated – do not edit)',
    '',
    'Generated from `src/core/lifecycle.ts` by `node scripts/gen-lifecycle-doc.js`. One table for every backend: the API',
    'server, the demo and the Firebase client call core functions built on it; `firestore.rules` mirror it and the',
    'lifecycle walk tests (core/demo, API, rules) try every action in every state as every role on each backend.',
    '',
    '**Roles:** creator, scorer (current), verdictCaptain (a captain who is not the creator or the scorer as at the first',
    'rally, and plays on neither one\'s side; never the current scorer), reporter (a captain of the side the abandoner does',
    'not play on), admin (an admin who is NOT part of the match – an admin in the match is just a participant), participant,',
    'other.',
    '',
    '**Verdict invariant (V146-2/3):** a match with captains always has at least one verdict captain, and the scorer is',
    'never a verdict captain or on one\'s team. Every scorer change keeps it (`scorerTargetProblem`, rules',
    '`scorerTargetOk`): before the first rally the creator / scorer cannot hand scoring to the opposing captain or their team',
    '(nobody would be left to confirm); after it handoffs stay on the scorer\'s side (or go to an admin on API / demo), and',
    'an admin reassigns only to a participant off the verdict captain\'s team. The walk tests assert it in every state.',
    '',
    '**Admin paths:** confirmAbandon / reinstate (abandoned, record pending or an older record-less abandon with rallies);',
    'reinstate goes back to live only when the log has no winner and wasWon was never set, else to finished + wasWon',
    '(V146-5; rules: live only when wasWon is not set – a won log without the latch is a client-only check); reopen /',
    'adminAbandon of a finished match only below the shortest win, without POTM and without a verdict of this epoch (an',
    'earlier epoch\'s verdict does not block); void / approve of a finished match; reassign the scorer (live / scheduled).',
    '',
    '**Latches** (never go back): maxEvents > 0 ("played"), wasWon, the abandon record and its review (older records',
    'kept in abandonHistory), the captain verdict of the current re-open epoch, approved / voided, reopenEpoch.',
    '',
    '| Action | Who | From | Requires (in order) | Leads to |',
    '|---|---|---|---|---|',
  ];
  for (const r of LIFECYCLE) {
    const req = r.guards.length ? r.guards.map((g) => `${g.text} (\`${g.code}\`)`).join('<br>') : '–';
    lines.push(`| **${r.action}** – ${r.text} | ${r.roles.join(', ')} | ${r.from.join(', ')} | ${req} | ${r.to} |`);
  }
  lines.push('', '## Walk states', '', '| State | Meaning |', '|---|---|');
  for (const s of LC_STATES) lines.push(`| ${s.name} | ${s.text} |`);
  lines.push('', `Walked actions: ${LC_WALK.join(', ')}. Walkers: ${LC_WALKERS.join(', ')}.`, '');
  lines.push('## Client-only checks (rules cannot replay a match)', '');
  for (const c of LC_CLIENT_ONLY) lines.push(`- ${c}`);
  lines.push('');
  return lines.join('\n');
}
