/** 1.3.6: with more than 6 players (Custom), 6 are on court and the rest on the bench; rotation still works. */
import { INDOOR_RULES } from '../rules';
import { addPoint } from '../scoring';
import { rotationTimeline, startingLineup } from '../rotation';

const A = Array.from({ length: 12 }, (_, i) => `a${i}`);
const B = Array.from({ length: 9 }, (_, i) => `b${i}`);
describe('rotation with 12 v 9 players', () => {
  it('starting lineups have 6 on court; bench players are not on court', () => {
    const la = startingLineup(null, 1, 'A', A);
    expect(la).toHaveLength(6);
    expect(la).toEqual(A.slice(0, 6));
    expect(startingLineup(null, 1, 'B', B)).toEqual(B.slice(0, 6));
  });
  it('side-outs rotate the 6 on court only; a bench player can be subbed in via the set lineup', () => {
    let ev = addPoint(INDOOR_RULES, [], 'B', { at: 1 }); // B wins serve → B rotates
    ev = addPoint(INDOOR_RULES, ev, 'A', { at: 2 }); // side out → A rotates
    const tl = rotationTimeline(INDOOR_RULES, ev, 'A', { A, B });
    expect(tl.final.positions.A).toHaveLength(6);
    expect(tl.final.positions.B).toHaveLength(6);
    expect(tl.final.positions.A.every((p: string | null) => A.slice(0, 6).includes(p as string))).toBe(true);
    expect(tl.final.positions.A).not.toContain('a7');
    const lineups = { '1': { A: ['a6', 'a1', 'a2', 'a3', 'a4', 'a5'], B: B.slice(0, 6) } };
    const withSub = rotationTimeline(INDOOR_RULES, [], 'A', { A, B }, lineups);
    expect(withSub.final.positions.A).toContain('a6');
    expect(withSub.final.positions.A).not.toContain('a0');
  });
});
