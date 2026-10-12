/**
 * 1.4.5 core: Tester's 1.4.4 findings V144-1..4 and the parent's V144-8 (interim scorer handoff).
 * The abandon policy is NOT decided – 'review' is the interim default (src/core/abandonPolicy.ts); 'flag' and
 * 'consent' are implemented and tested here through planAbandon's policy argument.
 */
import { ABANDON_POLICY } from '../abandonPolicy';
import {
  abandonNeedsReview, abandonPatch, answerAbandon, finishedWithoutWinner, maxEventsOf, needsAdminAction, nextMaxEvents,
  planAbandon, reportAbandon, reportersOf, resolveActions, resolvePatch,
} from '../abandon';
import { handoverProblem, reassignProblem, reassignRecord, verdictScorer } from '../scorerHandoff';
import { guardProgress, guardUpdate } from '../matchGuards';
import { countMatches, expectedConfirmer, matchFlags } from '../antifraud';
import { presetRules } from '../rules';
import type { Match } from '../types';

const BO1 = { ...presetRules('indoor'), bestOf: 1 as const, decidingSetPoints: 25 };
const ply = (ids: string[]) => ids.map((id) => ({ id, name: id.toUpperCase() }));
const A = ['cap', 'a1', 'a2', 'a3', 'a4', 'a5'];
const B = ['b0', 'b1', 'b2', 'b3', 'b4', 'b5'];
let T = 1_000_000;
const pts = (s: 'A' | 'B', n: number) => Array.from({ length: n }, () => ({ type: 'point' as const, side: s, at: (T += 1000) }));
const mk = (over: Partial<Match> = {}): Match =>
  ({
    id: 'm1', status: 'live', rules: BO1, firstServe: 'A', events: [], summary: null,
    teamA: { teamId: null, name: 'Delhi', color: '#123456', players: ply(A) },
    teamB: { teamId: null, name: 'Pune', color: '#654321', players: ply(B) },
    captains: { A: 'cap', B: 'b0' }, createdBy: 'cap', scorerId: 'cap', participantIds: [...A, ...B, 'ref'],
    scheduledAt: 1, startedAt: 1, finishedAt: null, interestedIds: [], updatedAt: 1,
    ...over,
  }) as unknown as Match;
const codeOf = (f: () => unknown) => {
  try {
    f();
    return null;
  } catch (e) {
    return (e as { code?: string }).code ?? String(e);
  }
};

describe('policy', () => {
  it('ships the interim "review" policy (pending decision)', () => expect(ABANDON_POLICY).toBe('review'));
});

describe('V144-1: maxEvents / wasWon / record', () => {
  it('maxEvents never goes down (undo), and older docs count their current log', () => {
    expect(maxEventsOf({ events: pts('A', 3) })).toBe(3);
    expect(maxEventsOf({ maxEvents: 10, events: pts('A', 3) })).toBe(10);
    expect(nextMaxEvents({ maxEvents: 10, events: [] }, pts('A', 4))).toBe(10);
    expect(nextMaxEvents({ maxEvents: 10, events: [] }, pts('A', 12))).toBe(12);
  });
  it("Tester's bo1 0:24: the scorer's abandon is recorded for admin review (who, score, side behind as information)", () => {
    const m = mk({ events: pts('B', 24), maxEvents: 24 });
    const plan = planAbandon(m, 'cap', 5);
    expect(plan.kind).toBe('flag');
    const p = abandonPatch(plan, 5);
    expect(p).toMatchObject({ status: 'abandoned', finishedAt: 5, abandon: { by: 'cap', at: 5, events: 24, mode: 'review', review: 'pending', behind: true, score: { setsA: 0, setsB: 0, currentA: 0, currentB: 24 } } });
    expect(abandonNeedsReview({ ...m, ...p } as Match)).toBe(true);
  });
  it("'flag' records the same, with the mode that shows 'behind' as the reason; leading side: behind false", () => {
    const m = mk({ events: pts('A', 10), maxEvents: 10 });
    const plan = planAbandon(m, 'cap', 5, 'flag');
    expect(plan).toMatchObject({ kind: 'flag', record: { mode: 'flag', behind: false } });
  });
  it('the undo bypass: below the shortest win again, but maxEvents reached it → only an admin', () => {
    expect(codeOf(() => planAbandon(mk({ events: pts('A', 10), maxEvents: 25 }), 'cap', 5))).toBe('abandon_needs_admin');
  });
  it('wasWon latches: a match that was ever won is never abandoned by its scorer', () => {
    expect(codeOf(() => planAbandon(mk({ events: pts('A', 3), maxEvents: 3, wasWon: true }), 'cap', 5))).toBe('match_finished');
  });
  it('no rally yet: abandoned directly; only the scorer', () => {
    expect(planAbandon(mk(), 'cap', 5)).toEqual({ kind: 'direct' });
    expect(abandonPatch({ kind: 'direct' }, 5)).toEqual({ status: 'abandoned', finishedAt: 5 });
    expect(codeOf(() => planAbandon(mk(), 'b0', 5))).toBe('abandon_not_allowed');
  });
});

describe("V144-1 'consent' (implemented, not the default)", () => {
  const live = mk({ events: pts('B', 5), maxEvents: 5 });
  const req = (planAbandon(live, 'cap', 5, 'consent') as { kind: 'request'; request: NonNullable<Match['abandonRequest']> }).request;
  const pending = { ...live, abandonRequest: req } as Match;
  it('asks; the match stays live and scoring is frozen', () => {
    expect(req).toEqual({ by: 'cap', at: 5, side: 'A', agreedBy: [] });
    expect(codeOf(() => guardProgress(pending, 'live', [...pending.events, ...pts('A', 1)]))).toBe('abandon_pending');
    expect(codeOf(() => planAbandon(pending, 'cap', 6, 'consent'))).toBe('abandon_pending');
  });
  it("the opposing captain agrees (abandoned, 'consent' record) or declines; the requester can withdraw", () => {
    const done = answerAbandon(pending, 'b0', 'agree', 9);
    expect(done).toMatchObject({ status: 'abandoned', abandon: { by: 'cap', mode: 'consent', review: 'confirmed', agreedBy: ['b0'] } });
    expect(answerAbandon(pending, 'b0', 'decline', 9)).toEqual({ abandonRequest: null });
    expect(answerAbandon(pending, 'cap', 'cancel', 9)).toEqual({ abandonRequest: null });
    expect(codeOf(() => answerAbandon(pending, 'a1', 'agree', 9))).toBe('abandon_not_allowed');
    expect(codeOf(() => answerAbandon(live, 'b0', 'agree', 9))).toBe('abandon_no_request');
    // a consent abandon was agreed to: no report afterwards
    expect(reportersOf({ ...pending, ...done } as Match)).toEqual([]);
  });
  it('a neutral requester needs both captains', () => {
    const n = mk({ events: pts('B', 5), maxEvents: 5, scorerId: 'ref' });
    const r = (planAbandon(n, 'ref', 5, 'consent') as { request: NonNullable<Match['abandonRequest']> }).request;
    expect(r.side).toBe('N');
    const p1 = answerAbandon({ ...n, abandonRequest: r } as Match, 'b0', 'agree', 6);
    expect(p1.status).toBeUndefined();
    const p2 = answerAbandon({ ...n, abandonRequest: p1.abandonRequest } as Match, 'cap', 'agree', 7);
    expect(p2.status).toBe('abandoned');
  });
});

describe('report (opposing captain) and admin resolutions (V144-1/2/3)', () => {
  const abandoned = mk({ status: 'abandoned', events: pts('B', 10), maxEvents: 10, finishedAt: 9, abandon: { by: 'cap', at: 9, events: 10, mode: 'review', review: 'pending', behind: true } });
  it('only the captain opposite the abandoner reports, once', () => {
    expect(reportersOf(abandoned)).toEqual(['b0']);
    const r = reportAbandon(abandoned, 'b0', 11);
    expect(r.abandon).toMatchObject({ review: 'pending', reportedBy: 'b0', reportedAt: 11, by: 'cap' });
    expect(reportersOf({ ...abandoned, ...r } as Match)).toEqual([]);
    expect(codeOf(() => reportAbandon(abandoned, 'a1', 11))).toBe('abandon_not_allowed');
    // 1.4.6 (V145-11): a report needs an abandon record (an older abandoned match without one goes to admin review instead)
    const legacy = mk({ status: 'abandoned', events: pts('B', 10), finishedAt: 9 });
    expect(codeOf(() => reportAbandon(legacy, 'b0', 11))).toBe('abandon_not_allowed');
  });
  it('an admin reinstates (live: no winner yet) or confirms; never on their own match; non-admins never', () => {
    expect(resolveActions(abandoned)).toEqual(['reinstate', 'confirm_abandon']);
    expect(resolvePatch(abandoned, 'adm', true, 'reinstate', 12)).toMatchObject({ status: 'live', finishedAt: null, abandon: { review: 'reinstated', reviewedBy: 'adm' } });
    expect(resolvePatch(abandoned, 'adm', true, 'confirm_abandon', 12)).toMatchObject({ abandon: { review: 'confirmed', reviewedBy: 'adm', by: 'cap' } });
    expect(codeOf(() => resolvePatch(abandoned, 'b0', true, 'confirm_abandon', 12))).toBe('own_match');
    expect(codeOf(() => resolvePatch(abandoned, 'zz', false, 'confirm_abandon', 12))).toBe('admin_only');
    expect(codeOf(() => resolvePatch(abandoned, 'adm', true, 'reopen', 12))).toBe('resolve_not_allowed');
  });
  it('V144-2: finished without a winner → reopen as live / mark abandoned (and void, via the review)', () => {
    const fin = mk({ status: 'finished', events: pts('A', 10), maxEvents: 10, wasWon: true, finishedAt: 9, finishedServerAt: 9 });
    expect(finishedWithoutWinner(fin)).toBe(true);
    expect(needsAdminAction(fin)).toBe(true);
    expect(resolveActions(fin)).toEqual(['reopen', 'abandon']);
    // 1.4.6 (V145-2): with a POTM picked only void is left
    expect(resolveActions({ ...fin, playerOfMatchId: 'a1' } as Match)).toEqual([]);
    expect(resolvePatch(fin, 'adm', true, 'reopen', 12)).toEqual({ status: 'live', finishedAt: null, finishedServerAt: null, playerOfMatchId: null, wasWon: false, verification: null, confirmedAt: null, reopenEpoch: 1, resolution: { action: 'reopened', by: 'adm', at: 12, epoch: 1 } });
    expect(resolvePatch(fin, 'adm', true, 'abandon', 12)).toMatchObject({ status: 'abandoned', playerOfMatchId: null, abandon: { mode: 'admin', review: 'confirmed', by: 'adm', reviewedBy: 'adm', events: 10 } });
    expect(finishedWithoutWinner({ ...fin, verification: { status: 'voided' } } as Match)).toBe(false);
    const won = mk({ status: 'finished', events: pts('A', 25), finishedAt: 9 });
    expect(finishedWithoutWinner(won)).toBe(false);
  });
  it("an admin's abandon settles a pending request", () => {
    const p = mk({ events: pts('B', 5), maxEvents: 5, abandonRequest: { by: 'cap', at: 1, side: 'A', agreedBy: [] } });
    expect(resolveActions(p)).toEqual(['abandon', 'reject_request']);
    expect(resolvePatch(p, 'adm', true, 'abandon', 12).abandonRequest).toBeNull();
    expect(resolvePatch(p, 'adm', true, 'reject_request', 12)).toEqual({ abandonRequest: null });
  });
});

describe('V144-4: rules / first serve freeze after the first rally', () => {
  it('match_setup_locked once a rally exists (also after undo to 0: maxEvents)', () => {
    const m = mk({ events: pts('A', 1), maxEvents: 1 });
    expect(codeOf(() => guardUpdate(m, { rules: { ...BO1, pointsPerSet: 21 } }))).toBe('match_setup_locked');
    expect(codeOf(() => guardUpdate(m, { firstServe: 'B' }))).toBe('match_setup_locked');
    expect(codeOf(() => guardUpdate(mk({ events: [], maxEvents: 1 }), { firstServe: 'B' }))).toBe('match_setup_locked');
    expect(codeOf(() => guardUpdate(mk(), { firstServe: 'B' }))).toBeNull();
  });
  it('a scoring write never abandons (the abandon action does)', () => {
    expect(codeOf(() => guardProgress(mk({ events: pts('A', 1) }), 'abandoned'))).toBe('match_status_move');
  });
});

describe('V144-8 (interim): scorer handoff', () => {
  it('before the first rally: anyone; after it: the scorer\'s own side only, or an admin target', () => {
    // 1.4.7 (QA V146-3/10): before the first rally anyone but the other (verdict) team
    expect(handoverProblem(mk(), 'b1')).toBe('handover_no_verdict');
    expect(handoverProblem(mk(), 'a2')).toBeNull();
    const m = mk({ events: pts('A', 1), maxEvents: 1 });
    expect(handoverProblem(m, 'a1')).toBeNull();
    expect(handoverProblem(m, 'b1')).toBe('handover_side');
    expect(handoverProblem(m, 'ref')).toBe('handover_side');
    expect(handoverProblem(m, 'zz', { targetIsAdmin: true })).toBeNull();
    // undo back to 0 doesn't re-open it
    expect(handoverProblem(mk({ events: [], maxEvents: 1 }), 'b1')).toBe('handover_side');
    // a neutral scorer: another neutral participant only
    const n = mk({ events: pts('A', 1), maxEvents: 1, scorerId: 'ref', participantIds: [...A, ...B, 'ref', 'ref2'] });
    expect(handoverProblem(n, 'ref2')).toBeNull();
    expect(handoverProblem(n, 'a1')).toBe('handover_side');
  });
  it('an admin reassigns to any participant, never on their own match; the verdict stays with the original scorer', () => {
    const m = mk({ events: pts('A', 1), maxEvents: 1 });
    // 1.4.7 (QA V146-2): never to the verdict captain's team
    expect(reassignProblem(m, 'adm', true, 'b1')).toBe('reassign_verdict_captain');
    expect(reassignProblem(m, 'adm', true, 'a2')).toBeNull();
    expect(reassignProblem(m, 'b0', true, 'b1')).toBe('own_match');
    expect(reassignProblem(m, 'zz', false, 'b1')).toBe('admin_only');
    expect(reassignProblem(m, 'adm', true, 'nobody')).toBe('handover_side');
    const r1 = reassignRecord(m, 'adm', 'a1', 5)!;
    expect(r1).toEqual({ from: 'cap', to: 'a1', by: 'adm', at: 5 });
    const m2 = { ...m, scorerId: 'a1', scorerReassign: r1 } as Match;
    expect(reassignRecord(m2, 'adm', 'a2', 6)).toEqual({ from: 'cap', to: 'a2', by: 'adm', at: 6 });
    expect(verdictScorer(m2)).toBe('cap');
    expect(expectedConfirmer(m2 as never)).toBe('b0');
    expect(reassignRecord(mk(), 'adm', 'b1', 5)).toBeNull(); // before the first rally nothing to record
  });
});

describe('PRD gap: unknown players', () => {
  it('a match naming ids without a profile is flagged and never counted', () => {
    const won = mk({ status: 'finished', events: pts('A', 25), finishedAt: 2, finishedServerAt: 2, startedServerAt: 1, playerOfMatchId: 'a1', unknownPlayerIds: ['a5'] });
    expect(matchFlags(won as never)).toContain('unknown_players');
    const r = countMatches([won as never]);
    for (const s of r.counted.values()) expect(s.has('a5')).toBe(false);
  });
});
