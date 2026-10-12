/**
 * 1.4.8 (QA V147-1 / V147-2): the verdict invariant at create and on every roster edit (the scorer is never on the
 * verdict side, someone can always confirm), and the admin repair of a match nobody can confirm.
 */
import { MATCH_NO_VERDICT, verdictCaptains, verdictSetupProblem } from '../antifraud';
import { guardCreate, guardUpdate } from '../matchGuards';
import { lcFacts, lifecycleProblem, lifecycleStateProblem } from '../lifecycle';
import { REPAIR_INVALID, repairOptions, repairPatch, repairProblem, verdictBroken } from '../verdictRepair';
import { needsAdminAction } from '../abandon';
import { presetRules } from '../rules';
import type { Match } from '../types';

const WR = { ...presetRules('indoor'), bestOf: 1 as const, pointsPerSet: 5, decidingSetPoints: 5, winBy: 1 };
const A = ['cap', 'a1', 'a2', 'a3', 'a4', 'a5'];
const B = ['b0', 'b1', 'b2', 'b3', 'b4', 'b5'];
const team = (ids: string[], name: string) => ({ teamId: null, name, color: '#123456', players: ids.map((id) => ({ id, name: id })) });
const mk = (over: Partial<Match> = {}): Match =>
  ({
    id: 'v', rules: WR, firstServe: 'A', summary: null, teamA: team(A, 'Alpha'), teamB: team(B, 'Beta'), captains: { A: 'cap', B: 'b0' },
    createdBy: 'cap', scorerId: 'cap', participantIds: [...A, ...B], status: 'scheduled', scheduledAt: null, startedAt: null, finishedAt: null,
    interestedIds: [], updatedAt: 1, createdAt: 1, events: [], maxEvents: 0, ...over,
  }) as unknown as Match;
const code = (f: () => void) => {
  try {
    f();
    return null;
  } catch (e) {
    return (e as { code?: string }).code ?? String(e);
  }
};

describe('V147-1: verdict invariant', () => {
  it('a normal match is fine; no captains = nothing to check', () => {
    expect(verdictSetupProblem(mk())).toBeNull();
    expect(verdictSetupProblem(mk({ captains: null }))).toBeNull();
  });
  it('scorer on B (creator on A): nobody can confirm', () => {
    expect(verdictCaptains(mk({ scorerId: 'b1' }))).toEqual([]);
    expect(verdictSetupProblem(mk({ scorerId: 'b1' }))).toBe(MATCH_NO_VERDICT);
  });
  it('a neutral scorer is fine when the creator plays; the creator\'s side never confirms', () => {
    expect(verdictSetupProblem(mk({ scorerId: 'zz', participantIds: [...A, ...B, 'zz'] }))).toBeNull();
  });
  it('create refuses a set-up without a confirmer (scorer on the other side)', () => {
    const create = (over: Partial<Match>) => {
      const { maxEvents: _mx, ...m } = mk(over) as Match & { maxEvents?: number };
      return m;
    };
    expect(code(() => guardCreate(create({ scorerId: 'b1' }) as never, {}))).toBe(MATCH_NO_VERDICT);
    expect(code(() => guardCreate(create({}) as never, {}))).toBeNull();
  });
  it('a roster edit that moves the scorer to team B (the creator stays on A) is refused', () => {
    const before = mk({ createdBy: 'a1' });
    const patch = { teamA: team(['a1', 'a2', 'a3', 'a4', 'a5', 'b5'], 'Alpha'), teamB: team(['cap', 'b0', 'b1', 'b2', 'b3', 'b4'], 'Beta'), captains: { A: 'a1', B: 'b0' } };
    expect(code(() => guardUpdate(before, patch))).toBe(MATCH_NO_VERDICT);
  });
  it('a roster edit that keeps a confirmer passes; an unrelated edit is not checked', () => {
    const before = mk();
    expect(code(() => guardUpdate(before, { teamB: team([...B.slice(0, 5), 'b9'], 'Beta'), participantIds: [...A, ...B.slice(0, 5), 'b9'] }))).toBeNull();
    expect(code(() => guardUpdate(mk({ scorerId: 'b1' }), { firstServe: 'B' }))).toBeNull(); // older data: not blocked
  });
  it('moving the scorer and the creator together to B is fine: A\'s captain then confirms', () => {
    const patch = { teamA: team(['a1', 'a2', 'a3', 'a4', 'a5', 'b5'], 'Alpha'), teamB: team(['cap', 'b0', 'b1', 'b2', 'b3', 'b4'], 'Beta'), captains: { A: 'a1', B: 'b0' } };
    expect(code(() => guardUpdate(mk(), patch))).toBeNull();
  });
  it('a captain edit on a set-up that has no confirmer is refused (creator on B, scorer on A)', () => {
    expect(code(() => guardUpdate(mk({ createdBy: 'b2' }), { captains: { A: 'a1', B: 'b0' } }))).toBe(MATCH_NO_VERDICT);
  });
});

describe('V147-2: admin repair', () => {
  const broken = (over: Partial<Match> = {}) => mk({ status: 'finished', scorerId: 'b1', startedAt: 1, finishedAt: 2, ...over });
  it('noConfirmer fact and the lifecycle row', () => {
    expect(lcFacts(broken()).noConfirmer).toBe(true);
    expect(lcFacts(mk()).noConfirmer).toBe(false);
    expect(lifecycleStateProblem('repairVerdict', broken())).toBeNull();
    expect(lifecycleStateProblem('repairVerdict', mk())).toBe('repair_not_needed');
    expect(lifecycleProblem('repairVerdict', broken(), 'cap', false)).toBe('admin_only');
    expect(lifecycleProblem('repairVerdict', broken(), 'cap', true)).toBe('own_match');
    expect(lifecycleProblem('repairVerdict', broken(), 'adm', true)).toBeNull();
    expect(needsAdminAction(broken())).toBe(true);
    expect(needsAdminAction(mk({ status: 'live', startedAt: 1 }))).toBe(false);
  });
  it('options: a scorer on A, or a confirmer on B who is not the scorer', () => {
    const o = repairOptions(broken());
    expect(o.scorers).toEqual(A);
    expect(o.confirmers).toEqual([]);
    // creator neutral, scorer on B: B's side is the scorer's → A's captain confirms once the scorer moves
    const m2 = broken({ createdBy: 'zz', participantIds: [...A, ...B, 'zz'], captains: { A: 'cap', B: 'b0' }, scorerId: 'b1', teamA: team(A, 'Alpha') });
    expect(verdictBroken(m2)).toBe(false); // A's captain confirms already
  });
  it('a confirmer fix: the creator is A\'s captain and the scorer on B → B has no verdict; make a new A captain when the creator plays for B', () => {
    const m = broken({ createdBy: 'b2', scorerId: 'b2', captains: { A: 'cap', B: 'b2' }, teamA: team(A, 'Alpha') });
    // creator / scorer on B; captain A = cap confirms → not broken
    expect(verdictBroken(m)).toBe(false);
    const m3 = broken({ createdBy: 'b2', scorerId: 'a1' }); // creator on B, scorer on A: nobody
    expect(verdictBroken(m3)).toBe(true);
    const o = repairOptions(m3);
    expect(o.scorers).toEqual(B); // a scorer on B (the creator's side) → A's captain confirms
    expect(o.confirmers).toEqual([]);
  });
  it('the patch is audited and passes the invariant; refused choices', () => {
    const m = broken();
    const p = repairPatch(m, 'adm', true, { scorerId: 'a1' }, 123);
    expect(p).toEqual({ scorerId: 'a1', scorerReassign: null, verdictRepair: { by: 'adm', at: 123, kind: 'scorer', to: 'a1', side: null, prevScorer: 'b1', prevFrom: null, prevCaptainA: 'cap', prevCaptainB: 'b0' } });
    expect(verdictSetupProblem({ ...m, ...p } as Match)).toBeNull();
    expect(repairProblem(m, 'adm', true, { scorerId: 'b2' })).toBe(REPAIR_INVALID);
    expect(repairProblem(m, 'adm', true, { scorerId: 'nobody' })).toBe(REPAIR_INVALID);
    expect(repairProblem(m, 'adm', true, { captain: { side: 'B', id: 'a1' } })).toBe(REPAIR_INVALID); // not on that side
    expect(repairProblem(m, 'adm', true, { captain: { side: 'B', id: 'b2' } })).toBe(REPAIR_INVALID); // still nobody
    expect(code(() => repairPatch(mk({ status: 'finished' }), 'adm', true, { scorerId: 'a1' }, 1))).toBe('repair_not_needed');
    expect(code(() => repairPatch(m, 'b0', false, { scorerId: 'a1' }, 1))).toBe('admin_only');
  });
  it('not after a verdict or a review', () => {
    const v = broken({ verification: { status: 'confirmed', captain: 'confirmed', by: 'b0', at: 3 } as never });
    expect(repairProblem(v, 'adm', true, { scorerId: 'a1' })).toBe('repair_not_needed');
    const r = broken({ verification: { status: 'voided', reviewedBy: 'adm2', reviewedAt: 3 } as never });
    expect(repairProblem(r, 'adm', true, { scorerId: 'a1' })).toBe('repair_not_needed');
  });
  it('a confirmer fix when a scorer reassignment pinned the reference to B', () => {
    // reference scorer b1 (B) via scorerReassign.from; current scorer a1; creator cap (A) → nobody
    const m = broken({ scorerId: 'a1', scorerReassign: { from: 'b1', to: 'a1', by: 'adm2', at: 1 } });
    expect(verdictBroken(m)).toBe(true);
    const o = repairOptions(m);
    expect(o.scorers).toContain('a2');
    const p = repairPatch(m, 'adm', true, { scorerId: 'a1' }, 5); // same scorer, reference reset
    expect(p.scorerReassign).toBeNull();
    expect(p.verdictRepair?.prevFrom).toBe('b1');
  });
});
