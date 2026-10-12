/**
 * 1.4.9 (QA V148-2): one decision for the verdict repair in core, the demo, the API and the rules – scorer only (the
 * confirmer/captain repair is refused everywhere) – and the set-up check counts an older doc's scorerReassign.from.
 */
import { MATCH_NO_VERDICT, verdictSetupProblem } from '../antifraud';
import { REPAIR_INVALID, repairOptions, repairPatch, repairProblem, verdictBroken } from '../verdictRepair';
import { presetRules } from '../rules';
import type { Match } from '../types';

const WR = { ...presetRules('indoor'), bestOf: 1 as const, pointsPerSet: 5, decidingSetPoints: 5, winBy: 1 };
const A = ['cap', 'a1', 'a2', 'a3', 'a4', 'a5'];
const B = ['b0', 'b1', 'b2', 'b3', 'b4', 'b5'];
const team = (ids: string[], name: string) => ({ teamId: null, name, color: '#123456', players: ids.map((id) => ({ id, name: id })) });
const mk = (over: Partial<Match> = {}): Match =>
  ({
    id: 'v', rules: WR, firstServe: 'A', summary: null, teamA: team(A, 'Alpha'), teamB: team(B, 'Beta'), captains: { A: 'cap', B: 'b0' },
    createdBy: 'cap', scorerId: 'cap', participantIds: [...A, ...B], status: 'finished', playerOfMatchId: 'a1', scheduledAt: null, startedAt: 1, finishedAt: 2,
    interestedIds: [], updatedAt: 1, createdAt: 1, events: [], maxEvents: 0, ...over,
  }) as unknown as Match;

describe('V148-2 (RP9): captain B is a team-A player (older doc)', () => {
  const legacy = mk({ captains: { A: 'cap', B: 'a1' } });
  // 1.4.10 (QA V149-3): no scorer can fix this one – a captain of B (a team-B player) is the safe, only fix
  it('nobody can confirm; no scorer fixes it; a team-B captain does – only for side B, only a B player', () => {
    expect(verdictBroken(legacy)).toBe(true);
    expect(repairOptions(legacy).scorers).toEqual([]);
    expect(repairOptions(legacy).confirmers).toEqual(B.map((id) => ({ side: 'B', id })));
    expect(repairProblem(legacy, 'adm', true, { captain: { side: 'B', id: 'b1' } })).toBeNull();
    expect(repairProblem(legacy, 'adm', true, { captain: { side: 'A', id: 'a2' } })).toBe(REPAIR_INVALID); // A's captain is an A player
    expect(repairProblem(legacy, 'adm', true, { captain: { side: 'B', id: 'a2' } })).toBe(REPAIR_INVALID); // not a B player
    expect(repairProblem(legacy, 'b0', false, { captain: { side: 'B', id: 'b1' } })).not.toBeNull(); // admins only
    const p = repairPatch(legacy, 'adm', true, { captain: { side: 'B', id: 'b1' } }, 5);
    expect(p.captains).toEqual({ A: 'cap', B: 'b1' });
    expect(p.verdictRepair).toMatchObject({ kind: 'confirmer', side: 'B', to: 'b1', prevCaptainB: 'a1' });
    expect(verdictBroken({ ...legacy, ...p } as Match)).toBe(false);
  });
  it('a broken match whose captains play for their own sides: never a captain option (a scorer is the fix)', () => {
    for (const m of [mk({ scorerId: 'b1' }), mk({ scorerReassign: { from: 'b1', by: 'x', at: 1 } as never })]) {
      expect(repairOptions(m).confirmers).toEqual([]);
      expect(repairProblem(m, 'adm', true, { captain: { side: 'B', id: 'b2' } })).toBe(REPAIR_INVALID);
    }
  });
});

describe('V148-2 (GU11): scorerReassign.from counts in the set-up check', () => {
  it('reference on B (scorer and creator on A): nobody can confirm – a roster edit there is refused in core and the rules', () => {
    const m = mk({ status: 'scheduled', scorerReassign: { from: 'b1', by: 'x', at: 1 } as never });
    expect(verdictSetupProblem(m)).toBe(MATCH_NO_VERDICT);
    expect(verdictSetupProblem(mk({ status: 'scheduled' }))).toBeNull();
  });
});
