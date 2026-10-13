/**
 * 1.4.5 (QA V144-1/2/3): abandoning a match, the consent request, and the admin's resolutions. One implementation for
 * the API server (server/src/domain/matches.ts), the demo and the Firebase client; firestore.rules repeat it
 * (abandonPolicy(), scorerAbandonOk, abandonRequestOk, adminResolveOk). The policy switch is src/core/abandonPolicy.ts.
 */
import { CodedError } from './codedError';
import { computeState, type Side } from './scoring';
import { ABANDON_NEEDS_ADMIN, ABANDON_PENDING, MATCH_FINISHED, MATCH_TERMINAL, matchOver } from './matchGuards';
import { matchWinner, OWN_MATCH_REVIEW, OWN_MATCH_REVIEW_MESSAGE, sideOfPlayer, verificationStatus } from './antifraud';
import { ABANDON_REQUEST_LIMIT, lifecycleProblem, lifecycleStateProblem, lcRoles, maxEventsOf, type LcAction } from './lifecycle';
import { ABANDON_POLICY, type AbandonPolicy } from './abandonPolicy';
import type { AbandonRecord, AbandonRequest, AbandonScore, Match } from './types';

export { ABANDON_POLICY, type AbandonPolicy };

export { ABANDON_PENDING };
export const ABANDON_NO_REQUEST = 'abandon_no_request';
export const ABANDON_NOT_ALLOWED = 'abandon_not_allowed';
export const RESOLVE_NOT_ALLOWED = 'resolve_not_allowed';
export const ADMIN_ONLY = 'admin_only';
/** 1.4.6 (QA V145-12, consent policy): too many abandon requests on this match, or too soon after the last one. */
export const ABANDON_RATE_LIMITED = 'abandon_rate_limited';
export { ABANDON_REQUEST_LIMIT, maxEventsOf };
export const ABANDON_MESSAGES: Record<string, string> = {
  [ABANDON_PENDING]: 'An abandon request is waiting for an answer – scoring is paused',
  [ABANDON_NO_REQUEST]: 'There is no abandon request to answer',
  [ABANDON_NOT_ALLOWED]: 'You can’t do that on this match',
  [RESOLVE_NOT_ALLOWED]: 'That action doesn’t apply to this match any more',
  [ADMIN_ONLY]: 'Only an admin can do this',
  [ABANDON_RATE_LIMITED]: 'Too many abandon requests on this match – try again later or ask an admin',
  [ABANDON_NEEDS_ADMIN]: 'Only an admin can abandon this match now – it may already have a result, or an admin already reviewed an abandon',
  [MATCH_FINISHED]: 'The match is over – its score, result and settings can no longer change',
  [MATCH_TERMINAL]: 'This match is closed and can no longer be changed',
  [OWN_MATCH_REVIEW]: OWN_MATCH_REVIEW_MESSAGE,
};
const fail = (code: string): never => {
  throw new CodedError(code, ABANDON_MESSAGES[code] ?? code);
};

type M = Pick<Match, 'status' | 'events' | 'rules' | 'firstServe' | 'scorerId' | 'teamA' | 'teamB' | 'createdBy' | 'participantIds'> &
  Partial<Pick<Match, 'captains' | 'maxEvents' | 'wasWon' | 'abandon' | 'abandonRequest' | 'playerOfMatchId' | 'verification' | 'resolution' | 'reopenEpoch' | 'scorerReassign' | 'abandonHistory' | 'abandonRequests' | 'abandonRequestAt'>>;
/** maxEvents after a write that stores `events` (never lower than before). */
export const nextMaxEvents = (before: { maxEvents?: number | null; events?: readonly unknown[] | null }, events: readonly unknown[]): number =>
  Math.max(maxEventsOf(before), events.length);
/** The match is, or once was, won (finished at some point, or its events have a winner now). */
export const everWon = (m: Pick<M, 'status' | 'events' | 'rules' | 'firstServe' | 'wasWon'>): boolean => !!m.wasWon || matchOver(m);

export function abandonScore(m: Pick<M, 'rules' | 'events' | 'firstServe'>): AbandonScore {
  const s = computeState(m.rules, m.events ?? [], m.firstServe ?? 'A');
  return { setsA: s.setsWon.A, setsB: s.setsWon.B, currentA: s.current.a, currentB: s.current.b };
}
/** Behind = fewer sets, or level on sets and fewer points in the current set. Neutral (null) is never behind. */
export function isBehind(score: AbandonScore, side: Side | null): boolean {
  if (!side) return false;
  const own = side === 'A' ? score.setsA : score.setsB;
  const opp = side === 'A' ? score.setsB : score.setsA;
  const co = side === 'A' ? score.currentA : score.currentB;
  const cp = side === 'A' ? score.currentB : score.currentA;
  return own < opp || (own === opp && co < cp);
}
/** Who must agree to a request: the other side's captain, or both captains when the requester plays on neither side. */
export function requiredAgreers(m: Pick<M, 'captains'>, req: Pick<AbandonRequest, 'side'>): string[] {
  const c = m.captains;
  if (!c) return [];
  return req.side === 'A' ? [c.B] : req.side === 'B' ? [c.A] : [c.A, c.B];
}
/** A request is waiting (consent policy): the match is frozen for scoring. */
export const abandonPending = (m: Pick<M, 'status' | 'abandonRequest'>): boolean => m.status === 'live' && !!m.abandonRequest;

export type AbandonPlan =
  /** Before the first rally: abandoned, nothing to review. */
  | { kind: 'direct' }
  /** 'review' (interim default) / 'flag': abandoned, waiting for an admin's review. */
  | { kind: 'flag'; record: AbandonRecord }
  /** 'consent': a request; the match stays live (scoring paused). `count` = requests made on the match with this one. */
  | { kind: 'request'; request: AbandonRequest; count: number };

/**
 * What the scorer's ⋮ Abandon does (throws a CodedError when it isn't allowed). Allowed-ness is core/lifecycle.ts
 * 'abandon' (status, wasWon, request pending, shortest win, 1.4.6: no earlier record – after a reinstate only an admin
 * abandons (V145-5) – and the consent request limits (V145-12)).
 */
export function planAbandon(m: M, uid: string, now: number, policy: AbandonPolicy = ABANDON_POLICY): AbandonPlan {
  const problem = lifecycleProblem('abandon', m, uid, false, { now, policy });
  if (problem) fail(problem);
  return abandonPlanFor(m, uid, now, policy);
}
/** The plan WITHOUT the checks (for the lifecycle walk tests: what an app would send). */
export function abandonPlanFor(m: M, uid: string, now: number, policy: AbandonPolicy = ABANDON_POLICY): AbandonPlan {
  const mx = maxEventsOf(m);
  if (mx === 0) return { kind: 'direct' };
  if (policy === 'consent') {
    return { kind: 'request', request: { by: uid, at: now, side: sideOfPlayer(m, uid) ?? 'N', agreedBy: [] }, count: (m.abandonRequests ?? 0) + 1 };
  }
  const score = abandonScore(m);
  // 'review': `behind` is information for the admin; 'flag': it is the reason shown ("abandoned while behind")
  return { kind: 'flag', record: { by: uid, at: now, events: m.events.length, mode: policy, review: 'pending', score, behind: isBehind(score, sideOfPlayer(m, uid)) } };
}

/** The fields an abandon plan writes (status + record, or the request). */
export function abandonPatch(plan: AbandonPlan, now: number): Partial<Match> {
  if (plan.kind === 'request') return { abandonRequest: plan.request, abandonRequests: plan.count, abandonRequestAt: now };
  return { status: 'abandoned', finishedAt: now, ...(plan.kind === 'flag' ? { abandon: plan.record } : {}) };
}

export type AbandonAnswer = 'agree' | 'decline' | 'cancel';
/** An answer to a pending request (consent policy). Returns the patch. */
export function answerAbandon(m: M, uid: string, action: AbandonAnswer, now: number): Partial<Match> {
  const req = m.abandonRequest;
  if (!req || m.status !== 'live') fail(ABANDON_NO_REQUEST);
  const need = requiredAgreers(m, req!);
  if (action === 'cancel') {
    if (uid !== req!.by) fail(ABANDON_NOT_ALLOWED);
    return { abandonRequest: null };
  }
  if (!need.includes(uid)) fail(ABANDON_NOT_ALLOWED);
  if (action === 'decline') return { abandonRequest: null };
  if (req!.agreedBy.includes(uid)) fail(ABANDON_NOT_ALLOWED);
  // 1.4.13 (QA V1412-1 audit): an agreeing captain never plays on the requester's side (captain mix: that request then
  // waits for a withdrawal or an admin)
  if (req!.side !== 'N' && sideOfPlayer(m, uid) === req!.side) fail(ABANDON_NOT_ALLOWED);
  const agreedBy = [...req!.agreedBy, uid];
  const next: AbandonRequest = { ...req!, agreedBy };
  if (!need.every((x) => agreedBy.includes(x))) return { abandonRequest: next };
  const score = abandonScore(m);
  return {
    abandonRequest: next,
    status: 'abandoned',
    finishedAt: now,
    abandon: { by: req!.by, at: now, events: m.events.length, mode: 'consent', review: 'confirmed', score, behind: isBehind(score, req!.side === 'N' ? null : req!.side), agreedBy },
  };
}

/**
 * 1.4.5: who may report an abandoned match to admin review – a captain of the side opposing whoever abandoned it (the
 * record's `by`, else the scorer; both captains when that person plays on neither side). core/lifecycle.ts 'report':
 * 1.4.6 (V145-11) only when the abandon record exists and the match had a rally; not once an admin decided, after a
 * report, or after a 'consent' abandon (the opposing captain agreed to it).
 */
export function reportersOf(m: M): string[] {
  if (m.status !== 'abandoned' || !m.captains) return [];
  if (lifecycleStateProblem('report', m)) return [];
  return [...new Set([m.captains.A, m.captains.B])].filter((c) => lcRoles(m, c, false).has('reporter'));
}
/** The opposing captain's "Report" on an abandoned match: back to admin review (pending), naming the reporter. */
export function reportAbandon(m: M, uid: string, now: number): Partial<Match> {
  if (!reportersOf(m).includes(uid)) fail(ABANDON_NOT_ALLOWED);
  return { abandon: { ...m.abandon!, review: 'pending', reportedBy: uid, reportedAt: now } };
}

/**
 * 1.4.6 (QA V145-4): the score and "side behind" of an abandon record, REPLAYED from the events it covers (the first
 * `record.events` events) – the stored `score` / `behind` are never shown (a forged record can't hide "behind").
 */
export function abandonFacts(m: Pick<M, 'rules' | 'events' | 'firstServe' | 'teamA' | 'teamB' | 'scorerId'> & { abandon?: AbandonRecord | null }): { score: AbandonScore; behind: boolean } | null {
  const a = m.abandon;
  if (!a) return null;
  const n = Math.max(0, Math.min(a.events ?? 0, m.events?.length ?? 0));
  const score = abandonScore({ rules: m.rules, events: (m.events ?? []).slice(0, n), firstServe: m.firstServe });
  const by = a.by ?? null;
  const side = by && a.mode !== 'admin' ? sideOfPlayer(m, by) : null;
  return { score, behind: isBehind(score, side) };
}

/**
 * 1.4.6 (QA V145-14): the replayed score an abandoned match stopped at – sets won and each set's points (the set in
 * progress included when it has points), from the events up to the abandon record (all events without a record).
 */
export type AbandonedAt = {
  /** sets won */
  setsA: number;
  setsB: number;
  /** every set with points (completed sets, then the current one if it has points) – kept for older callers */
  sets: { a: number; b: number }[];
  /** 1.4.7 (QA V146-7): the completed sets, the current set's number and its points */
  done: { a: number; b: number }[];
  setNo: number;
  current: { a: number; b: number };
};
export function abandonedAt(m: Pick<M, 'rules' | 'events' | 'firstServe'> & { abandon?: AbandonRecord | null }): AbandonedAt {
  const all = m.events ?? [];
  const n = m.abandon ? Math.max(0, Math.min(m.abandon.events ?? 0, all.length)) : all.length;
  const st = computeState(m.rules, all.slice(0, n), m.firstServe ?? 'A');
  const done = st.sets.map((x) => ({ a: x.a, b: x.b }));
  const sets = [...done];
  const current = st.finished ? { a: 0, b: 0 } : { a: st.current.a, b: st.current.b };
  if (current.a + current.b > 0) sets.push(current);
  return { setsA: st.setsWon.A, setsB: st.setsWon.B, sets, done, setNo: done.length + 1, current };
}

/** Abandoned and waiting for an admin: a flagged abandon, or an older abandoned match with rallies and no review. */
export function abandonNeedsReview(m: Pick<M, 'status' | 'abandon' | 'events'>): boolean {
  if (m.status !== 'abandoned') return false;
  return m.abandon ? m.abandon.review === 'pending' : (m.events?.length ?? 0) > 0;
}
/** QA V144-2: stored as finished, but the events have no winner (and no admin closed it yet). */
export function finishedWithoutWinner(m: Pick<M, 'status' | 'events' | 'rules' | 'firstServe' | 'verification'>): boolean {
  if (m.status !== 'finished') return false;
  const v = verificationStatus(m);
  if (v === 'voided') return false;
  try {
    return matchWinner({ rules: m.rules, events: m.events ?? [], firstServe: m.firstServe }) === null;
  } catch {
    return true;
  }
}
/** Everything an admin can resolve (in the review list next to the flagged results). */
export function needsAdminAction(m: M): boolean {
  // 1.4.8 (QA V147-2): and a match nobody can confirm (lifecycle 'repairVerdict': the admin sets a scorer / confirmer)
  return abandonNeedsReview(m) || finishedWithoutWinner(m) || abandonPending(m) || lifecycleStateProblem('repairVerdict', m) === null;
}

export type ResolveAction = 'reinstate' | 'confirm_abandon' | 'reopen' | 'abandon' | 'reject_request';
export const RESOLVE_ACTIONS: readonly ResolveAction[] = ['reinstate', 'confirm_abandon', 'reopen', 'abandon', 'reject_request'];

/** The lifecycle action behind each resolve action (core/lifecycle.ts). */
const RESOLVE_LC: Record<ResolveAction, LcAction | null> = { reinstate: 'reinstate', confirm_abandon: 'confirmAbandon', reopen: 'reopen', abandon: 'adminAbandon', reject_request: null };
/** Actions that apply to a match now (the admin screen offers these; void is the review's). From core/lifecycle.ts. */
export function resolveActions(m: M): ResolveAction[] {
  return RESOLVE_ACTIONS.filter((a) => {
    const lc = RESOLVE_LC[a];
    if (!lc) return abandonPending(m);
    // an admin abandon of a live match whose events already have a winner (an older stuck row): void it instead
    if (a === 'abandon' && m.status === 'live' && matchOver(m)) return false;
    return lifecycleStateProblem(lc, m) === null;
  });
}

/**
 * An admin's resolution (QA V144-1/2): never on a match the admin is part of (V144-3). `finished` patches carry
 * finishedAt = now (the backend adds its server finish time). Returns the patch.
 */
export function resolvePatch(m: M, adminUid: string, isAdmin: boolean, action: ResolveAction, now: number): Partial<Match> {
  if (!isAdmin) fail(ADMIN_ONLY);
  if (!lcRoles(m, adminUid, true).has('admin')) fail(OWN_MATCH_REVIEW);
  if (!resolveActions(m).includes(action)) fail(RESOLVE_NOT_ALLOWED);
  return resolveBody(m, adminUid, action, now);
}
/**
 * The patch of a resolve action WITHOUT the checks (resolvePatch = checks + this). Exported for the lifecycle walk
 * tests, which send exactly what an app would send to see each backend refuse it on its own.
 */
export function resolveBody(m: M, adminUid: string, action: ResolveAction, now: number): Partial<Match> {
  const reviewed = (review: AbandonRecord['review']): AbandonRecord =>
    m.abandon
      ? { ...m.abandon, review, reviewedBy: adminUid, reviewedAt: now }
      : { mode: 'legacy', events: m.events.length, review, reviewedBy: adminUid, reviewedAt: now };
  switch (action) {
    case 'confirm_abandon':
      return { abandon: reviewed('confirmed') };
    case 'reinstate': {
      // 1.4.7 (QA V146-5): a match that was ever won goes back to finished only (the guard requires its winner)
      const won = computeState(m.rules, m.events, m.firstServe ?? 'A').finished || !!m.wasWon;
      // 1.4.6 (QA V145-10): back to finished latches wasWon (every backend)
      return won ? { status: 'finished', finishedAt: now, wasWon: true, abandon: reviewed('reinstated') } : { status: 'live', finishedAt: null, abandon: reviewed('reinstated') };
    }
    case 'reopen': {
      // 1.4.6 (QA V145-2): a re-open starts a new verdict epoch – the captain verdict, the POTM, the confirmation and any
      // admin review of the old result are cleared, and a verdict counts only if given in the new epoch
      const epoch = (m.reopenEpoch ?? 0) + 1;
      return { status: 'live', finishedAt: null, finishedServerAt: null, playerOfMatchId: null, wasWon: false, verification: null, confirmedAt: null, reopenEpoch: epoch, resolution: { action: 'reopened', by: adminUid, at: now, epoch } };
    }
    case 'abandon': {
      const score = abandonScore(m);
      return {
        status: 'abandoned',
        finishedAt: now,
        finishedServerAt: null,
        playerOfMatchId: null,
        abandon: { by: adminUid, at: now, events: m.events.length, mode: 'admin', review: 'confirmed', score, behind: null, reviewedBy: adminUid, reviewedAt: now },
        // 1.4.6 (QA V145-5): an earlier record (e.g. reinstated) is kept – appended to the history, never overwritten
        ...(m.abandon ? { abandonHistory: [...(m.abandonHistory ?? []), m.abandon] } : {}),
        // a pending 'consent' request is settled by the admin's decision
        ...(m.abandonRequest ? { abandonRequest: null } : {}),
      };
    }
    case 'reject_request':
      return { abandonRequest: null };
  }
}

/** Scoring is refused while a request is pending (every backend). */
export function scoringPausedProblem(m: Pick<M, 'status' | 'abandonRequest'>): string | null {
  return abandonPending(m) ? ABANDON_PENDING : null;
}
