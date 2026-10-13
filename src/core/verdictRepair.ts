/**
 * 1.4.8 (QA V147-2): an admin repairs a match nobody can confirm (older data, or a V147-1 match made before 1.4.8):
 * either a valid scorer (any participant – the verdict reference becomes that scorer, scorerReassign is cleared) or a
 * valid confirmer (a captain of one side replaced by a player of that side). The result must satisfy the verdict
 * invariant (verdictSetupProblem). Goes through the lifecycle table ('repairVerdict': an admin outside the match,
 * nobody can confirm now, no verdict / review yet) and is recorded in `verdictRepair` (who, when, what was there) like
 * the other admin actions (resolution, scorerReassign). Same on the API, the demo, the Firebase client and the rules
 * (verdictRepairOk). Existing data is never changed by a migration – only by this explicit admin action.
 */
import { sideOfPlayer, verdictSetupProblem } from './antifraud';
import { CodedError } from './codedError';
import { lifecycleProblem, type LcMatch } from './lifecycle';
import type { Match, VerdictRepair } from './types';

export const REPAIR_INVALID = 'repair_invalid';
export const REPAIR_NOT_NEEDED = 'repair_not_needed';
export const REPAIR_MESSAGES: Record<string, string> = {
  [REPAIR_INVALID]: 'That choice still leaves nobody who can confirm the result',
  [REPAIR_NOT_NEEDED]: 'This match can already be confirmed (or it already has a verdict or a review)',
};
export type RepairFix = { scorerId: string } | { captain: { side: 'A' | 'B'; id: string } };
type M = LcMatch & Pick<Match, 'participantIds'> & Partial<Pick<Match, 'captains' | 'scorerReassign' | 'verdictRepair'>>;

/** 1.4.10 (QA V149-3): a captain fix is only for a side whose stored captain isn't one of its players. */
export function captainFixAllowed(m: M, side: 'A' | 'B', id: string): boolean {
  if (side !== 'A' && side !== 'B') return false;
  const cur = m.captains?.[side];
  return !!cur && sideOfPlayer(m as never, cur) !== side && sideOfPlayer(m as never, id) === side;
}
/** Nobody can confirm this match now (it has captains and breaks the verdict invariant). */
export const verdictBroken = (m: Pick<Match, 'captains' | 'teamA' | 'teamB' | 'scorerId' | 'createdBy'> & Partial<Pick<Match, 'scorerReassign'>>): boolean =>
  !!m.captains && verdictSetupProblem(m as Match) !== null;

/** The match after a fix (no validation). */
export function applyFix(m: M, fix: RepairFix): M {
  if ('scorerId' in fix) return { ...m, scorerId: fix.scorerId, scorerReassign: null };
  return { ...m, captains: { ...(m.captains as NonNullable<Match['captains']>), [fix.captain.side]: fix.captain.id } };
}
/** Why this fix is refused (null = allowed). */
export function repairProblem(m: M, admin: string, isAdmin: boolean, fix: RepairFix): string | null {
  const lc = lifecycleProblem('repairVerdict', m, admin, isAdmin);
  if (lc) return lc;
  // 1.4.9 (QA V148-2): a scorer, or – 1.4.10 (QA V149-3) – a captain, but ONLY for a side whose stored captain doesn't
  // play for that side (older data: team B's captain is a team-A player; no scorer can fix that). The new captain is a
  // player of that side. Same check in the demo / API (here) and the rules (verdictRepairOk).
  if ('scorerId' in fix) {
    if (!m.participantIds.includes(fix.scorerId)) return REPAIR_INVALID;
  } else if (!captainFixAllowed(m, fix.captain.side, fix.captain.id)) return REPAIR_INVALID;
  return verdictSetupProblem(applyFix(m, fix) as Match) ? REPAIR_INVALID : null;
}
/** The patch to store (throws CodedError when refused). */
export function repairPatch(m: M, admin: string, isAdmin: boolean, fix: RepairFix, now: number): Partial<Match> {
  const p = repairProblem(m, admin, isAdmin, fix);
  if (p) throw new CodedError(p, REPAIR_MESSAGES[p] ?? p);
  return repairBody(m, admin, fix, now);
}
/** The patch of a fix without the checks (the rules walk sends it in every cell; the backends use repairPatch). */
export function repairBody(m: M, admin: string, fix: RepairFix, now: number): Partial<Match> {
  const rec: VerdictRepair = {
    by: admin, at: now, kind: 'scorerId' in fix ? 'scorer' : 'confirmer', to: 'scorerId' in fix ? fix.scorerId : fix.captain.id,
    side: 'scorerId' in fix ? null : fix.captain.side, prevScorer: m.scorerId, prevFrom: m.scorerReassign?.from ?? null,
    prevCaptainA: m.captains?.A ?? null, prevCaptainB: m.captains?.B ?? null,
  };
  const after = applyFix(m, fix);
  return 'scorerId' in fix ? { scorerId: after.scorerId, scorerReassign: null, verdictRepair: rec } : { captains: after.captains, verdictRepair: rec };
}
/** The valid fixes, for the admin screen: scorers (participants), then confirmers per side. */
export function repairOptions(m: M): { scorers: string[]; confirmers: { side: 'A' | 'B'; id: string }[] } {
  if (!verdictBroken(m)) return { scorers: [], confirmers: [] };
  const ok = (fix: RepairFix) => !verdictSetupProblem(applyFix(m, fix) as Match);
  const scorers = [...new Set(m.participantIds)].filter((id) => (id !== m.scorerId || !!m.scorerReassign) && ok({ scorerId: id }));
  // 1.4.10 (QA V149-3): captains only for a side whose captain plays for the other team (older data)
  const confirmers: { side: 'A' | 'B'; id: string }[] = [];
  for (const side of ['A', 'B'] as const) {
    for (const p of (side === 'A' ? m.teamA : m.teamB).players) {
      if (captainFixAllowed(m, side, p.id) && ok({ captain: { side, id: p.id } })) confirmers.push({ side, id: p.id });
    }
  }
  return { scorers, confirmers };
}

/**
 * 1.4.13 (walk tests): the repair the lifecycle walk tries – a captain for a side whose captain plays for the other team
 * (captain mix: no scorer can fix that), else the given scorer.
 */
export function walkRepairFix(m: M, scorer: string): RepairFix {
  for (const side of ['A', 'B'] as const) {
    const p = (side === 'A' ? m.teamA : m.teamB).players.find((x) => captainFixAllowed(m, side, x.id) && x.id !== m.createdBy && x.id !== m.scorerId);
    if (p) return { captain: { side, id: p.id } };
  }
  return { scorerId: scorer };
}
