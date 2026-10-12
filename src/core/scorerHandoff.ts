/**
 * 1.4.5 (QA V144-8, INTERIM default pending Akshit's decision): handing scoring to someone else.
 *  - Before the first rally: to anyone, by the creator or the scorer (as before).
 *  - After the first rally (maxEvents > 0): only to a participant on the current scorer's own side (a scorer who plays
 *    on neither side: to another participant on neither side), or to an admin (API / demo – firestore.rules can't see
 *    another user's admin claim). An admin who isn't part of the match may reassign it to any participant; that
 *    reassignment is recorded (scorerReassign, `from` = the scorer before the first one).
 *  - A handoff changes only the scorer: never maxEvents, wasWon, the abandon record / request or the verdict.
 *  - The captain verdict comes from the captain opposing the scoring side as it was at the first rally
 *    (verdictScorer), whoever scores now.
 * Enforced by the API server (patchMatch / reassignScorer), the demo, the Firebase client and firestore.rules
 * (handoverOk / reassignOk).
 */
import { maxEventsOf } from './abandon';
import { ownMatchReview, sideOfPlayer, verdictCaptains } from './antifraud';
import type { Match, ScorerReassign } from './types';

export const HANDOVER_SIDE = 'handover_side';
/** 1.4.6 (QA V145-6): scoring never goes to the captain who gives the verdict (they'd confirm their own scoring). */
export const REASSIGN_VERDICT_CAPTAIN = 'reassign_verdict_captain';
/** 1.4.7 (QA V146-3): a handoff that would leave nobody to confirm the result (before the first rally). */
export const HANDOVER_NO_VERDICT = 'handover_no_verdict';
export const HANDOVER_MESSAGES: Record<string, string> = {
  [HANDOVER_SIDE]: 'After the first rally, scoring can only go to a player of the scorer’s own team (or an admin)',
  [REASSIGN_VERDICT_CAPTAIN]: 'Scoring can’t go to the captain who confirms the result, or to their team',
  [HANDOVER_NO_VERDICT]: 'Scoring can’t go to that player: then nobody could confirm the result',
};

/**
 * 1.4.7 (QA V146-2/3): the invariant every scorer change keeps (core, API, demo, firestore.rules scorerTargetOk):
 *  - a match with captains always keeps at least one verdict captain (verdictCaptains computed on the match AFTER the
 *    change – before the first rally the new scorer becomes the reference, after it the scorer at the first rally
 *    stays the reference via scorerReassign.from / the own-side rule);
 *  - the scorer is never a verdict captain and never plays on a verdict captain's side.
 * `withRecord`: the change is an admin reassignment after the first rally (scorerReassign.from stays the original).
 */
export function scorerTargetProblem(m: M, next: string, withRecord = false): string | null {
  if (!m.captains) return null;
  const from = withRecord ? (m.scorerReassign?.from ?? m.scorerId) : undefined;
  const after = { ...m, scorerId: next, scorerReassign: from ? { from, to: next, by: '', at: 0 } : maxEventsOf(m) > 0 ? m.scorerReassign ?? null : null };
  const caps = verdictCaptains(after);
  if (!caps.length) return HANDOVER_NO_VERDICT;
  const nextSide = sideOfPlayer(m, next);
  if (caps.includes(next) || caps.some((c) => nextSide !== null && sideOfPlayer(m, c) === nextSide)) return REASSIGN_VERDICT_CAPTAIN;
  return null;
}

type M = Pick<Match, 'status' | 'scorerId' | 'teamA' | 'teamB' | 'createdBy' | 'participantIds' | 'events'> & Partial<Pick<Match, 'maxEvents' | 'captains' | 'scorerReassign'>>;

/** null = allowed. `targetIsAdmin`: the new scorer is an admin (API / demo only). */
export function handoverProblem(m: M, next: string, opts: { targetIsAdmin?: boolean } = {}): string | null {
  if (next === m.scorerId) return null;
  const vp = scorerTargetProblem(m, next);
  if (maxEventsOf(m) === 0) return vp;
  if (opts.targetIsAdmin) return vp;
  const from = sideOfPlayer(m, m.scorerId);
  const to = sideOfPlayer(m, next);
  if (from) return from === to ? vp : HANDOVER_SIDE;
  return !to && m.participantIds.includes(next) ? vp : HANDOVER_SIDE;
}

/** An admin's reassignment (any participant; never the admin's own match). Returns the record to store, if any. */
export function reassignRecord(m: M, admin: string, next: string, now: number): ScorerReassign | null {
  if (maxEventsOf(m) === 0) return null;
  return { from: m.scorerReassign?.from ?? m.scorerId, to: next, by: admin, at: now };
}
/**
 * 1.4.6 (QA V145-6, the simplest of the two options): an admin can't hand scoring to the captain who gives the verdict
 * (the captain opposing the scoring side as at the first rally). Together with confirmProblem refusing whoever scores
 * now, the scorer – whoever it is – never gives the captain verdict on any backend (firestore.rules reassignOk /
 * confirmOk).
 */
export const reassignProblem = (m: M, admin: string, isAdmin: boolean, next: string): string | null =>
  !isAdmin ? 'admin_only'
  : ownMatchReview(m, admin) ? 'own_match'
  : m.status !== 'scheduled' && m.status !== 'live' ? 'match_terminal'
  : !m.participantIds.includes(next) ? HANDOVER_SIDE
  : verdictCaptains(m).includes(next) ? REASSIGN_VERDICT_CAPTAIN
  : next === m.scorerId ? null
  // 1.4.7 (QA V146-2/3): never to the verdict captain's team, and always someone left to confirm
  : scorerTargetProblem(m, next, maxEventsOf(m) > 0);

/**
 * 1.4.6 (QA V145-17): the admins a creator / scorer may hand scoring to after the first rally (API / demo): any admin
 * except the current scorer and the captains who give the verdict. Firebase can't (the rules can't see another user's
 * admin claim) – the app offers "Ask an admin to take over" there instead.
 */
export function eligibleHandoffAdmins<T extends { id: string }>(m: M, admins: readonly T[]): T[] {
  const caps = verdictCaptains(m);
  return admins.filter((a) => a.id !== m.scorerId && !caps.includes(a.id) && !scorerTargetProblem(m, a.id));
}

/** The scorer the verdict is measured against: the one before any admin reassignment. */
export const verdictScorer = (m: { scorerId: string; scorerReassign?: ScorerReassign | null }): string => m.scorerReassign?.from ?? m.scorerId;
