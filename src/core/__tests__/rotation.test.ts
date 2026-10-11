import { INDOOR_RULES, makeRules } from '../rules';
import {
  assignPosition,
  courtGrid,
  defaultLineup,
  normalizeLineup,
  rotateClockwise,
  rotationState,
  rotationTimeline,
  startingLineup,
} from '../rotation';
import { addPoint, callTimeout, computeState, undo, type MatchEvent, type Side } from '../scoring';

const A = ['a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7'];
const B = ['b1', 'b2', 'b3', 'b4', 'b5', 'b6'];
const rosters = { A, B };
const R = INDOOR_RULES;
const play = (sides: Side[], rules = R, start: MatchEvent[] = []) => sides.reduce((ev, s) => addPoint(rules, ev, s), start);

describe('rotation basics', () => {
  it('default lineup takes the first six players in order, empty slots are null', () => {
    expect(defaultLineup(A)).toEqual(['a1', 'a2', 'a3', 'a4', 'a5', 'a6']);
    expect(defaultLineup(['x', 'y'])).toEqual(['x', 'y', null, null, null, null]);
  });

  it('rotates clockwise: 2→1, 3→2, … 1→6', () => {
    expect(rotateClockwise(['p1', 'p2', 'p3', 'p4', 'p5', 'p6'])).toEqual(['p2', 'p3', 'p4', 'p5', 'p6', 'p1']);
    let s: (string | null)[] = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6'];
    for (let i = 0; i < 6; i++) s = rotateClockwise(s);
    expect(s).toEqual(['p1', 'p2', 'p3', 'p4', 'p5', 'p6']);
  });

  it('assignPosition swaps when the player already has a position', () => {
    const l = defaultLineup(A);
    expect(assignPosition(l, 1, 'a4')).toEqual(['a4', 'a2', 'a3', 'a1', 'a5', 'a6']);
    expect(assignPosition(l, 2, 'a7')).toEqual(['a1', 'a7', 'a3', 'a4', 'a5', 'a6']);
  });

  it('normalizeLineup drops unknown and duplicate players', () => {
    expect(normalizeLineup(['a1', 'zz', 'a1', 'a2'], A)).toEqual(['a1', null, null, 'a2', null, null]);
  });

  it('court grid: front row 4-3-2 next to the net, back row 5-6-1, mirrored per side', () => {
    const left = courtGrid('left');
    expect(left.map((r) => r[1])).toEqual([4, 3, 2]); // right column = front (net side)
    expect(left.map((r) => r[0])).toEqual([5, 6, 1]);
    const right = courtGrid('right');
    expect(right.map((r) => r[0])).toEqual([2, 3, 4]); // left column = front (net side)
    expect(right.map((r) => r[1])).toEqual([1, 6, 5]);
    // mirror image: same position sits on the same row band from each team's own view
    expect(right.map((r) => r[0]).reverse()).toEqual(left.map((r) => r[1]));
  });
});

describe('rotationState', () => {
  it('starts with the starting lineup and position 1 of the first-serving team as server', () => {
    const st = rotationState(R, [], 'A', rosters);
    expect(st.positions.A).toEqual(['a1', 'a2', 'a3', 'a4', 'a5', 'a6']);
    expect(st.server).toBe('a1');
    expect(st.atSetStart).toBe(true);
    expect(rotationState(R, [], 'B', rosters).server).toBe('b1');
  });

  it('side-out: the receiving team rotates and its new position 1 serves', () => {
    const st = rotationState(R, play(['B']), 'A', rosters);
    expect(st.positions.B).toEqual(['b2', 'b3', 'b4', 'b5', 'b6', 'b1']);
    expect(st.positions.A).toEqual(defaultLineup(A)); // serving team did not move
    expect(st.serving).toBe('B');
    expect(st.server).toBe('b2');
    expect(st.rotations).toEqual({ A: 0, B: 1 });
    expect(st.atSetStart).toBe(false);
  });

  it('no rotation when the serving team wins the rally', () => {
    const st = rotationState(R, play(['A', 'A', 'A']), 'A', rosters);
    expect(st.positions.A).toEqual(defaultLineup(A));
    expect(st.server).toBe('a1');
    expect(st.rotations).toEqual({ A: 0, B: 0 });
  });

  it('alternating side-outs rotate both teams; timeouts change nothing', () => {
    let ev = play(['B', 'A', 'B', 'A']);
    ev = callTimeout(R, ev, 'B');
    const st = rotationState(R, ev, 'A', rosters);
    expect(st.rotations).toEqual({ A: 2, B: 2 });
    expect(st.positions.A).toEqual(['a3', 'a4', 'a5', 'a6', 'a1', 'a2']);
    expect(st.server).toBe('a3');
  });

  it('undo reverses rotations exactly', () => {
    const seq: Side[] = ['A', 'B', 'B', 'A', 'B', 'A', 'A', 'B'];
    let ev: MatchEvent[] = [];
    const history = [rotationState(R, ev, 'A', rosters)];
    for (const s of seq) {
      ev = addPoint(R, ev, s);
      history.push(rotationState(R, ev, 'A', rosters));
    }
    for (let i = seq.length; i > 0; i--) {
      ev = undo(ev);
      expect(rotationState(R, ev, 'A', rosters)).toEqual(history[i - 1]);
    }
  });

  it('serving always agrees with the scoring engine', () => {
    const rules = makeRules(INDOOR_RULES, { bestOf: 3, pointsPerSet: 5, decidingSetPoints: 3 });
    let seed = 7;
    const rnd = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
    let ev: MatchEvent[] = [];
    for (let i = 0; i < 60; i++) {
      ev = addPoint(rules, ev, rnd() < 0.5 ? 'A' : 'B');
      const sc = computeState(rules, ev, 'B');
      const rt = rotationState(rules, ev, 'B', rosters);
      expect(rt.serving).toBe(sc.serving);
      expect(rt.setIndex).toBe(sc.setIndex);
    }
  });

  it('each set starts from its own lineup (or the previous one) with alternating first serve', () => {
    const rules = makeRules(INDOOR_RULES, { bestOf: 3, pointsPerSet: 2 });
    const lineups = { '1': { A: ['a6', 'a5', 'a4', 'a3', 'a2', 'a1'], B: defaultLineup(B) }, '2': { A: ['a7', 'a2', 'a3', 'a4', 'a5', 'a6'], B: ['b3', 'b1', 'b2', 'b4', 'b5', 'b6'] } };
    // set 1: A serves first; B wins a side-out then A wins two side-outs etc.
    let ev = play(['A', 'A'], rules); // A wins set 1 2-0, no rotations
    let st = rotationState(rules, ev, 'A', rosters, lineups);
    expect(st.setIndex).toBe(1);
    expect(st.atSetStart).toBe(true);
    expect(st.serving).toBe('B'); // serve alternates
    expect(st.positions.A).toEqual(lineups['2'].A);
    expect(st.server).toBe('b3');
    ev = play(['A'], rules, ev); // side-out for A in set 2
    st = rotationState(rules, ev, 'A', rosters, lineups);
    expect(st.positions.A).toEqual(['a2', 'a3', 'a4', 'a5', 'a6', 'a7']);
    expect(st.server).toBe('a2');
    ev = play(['B', 'B', 'B'], rules, ev); // B takes set 2 → set 3 (no lineup "3": reuse set 2's)
    st = rotationState(rules, ev, 'A', rosters, lineups);
    expect(st.setIndex).toBe(2);
    expect(st.positions.B).toEqual(lineups['2'].B);
    expect(st.serving).toBe('A');
    expect(startingLineup(lineups, 3, 'A', A)).toEqual(lineups['2'].A);
    expect(startingLineup(undefined, 1, 'A', A)).toEqual(defaultLineup(A));
  });

  it('works with no players (quick teams without names)', () => {
    const st = rotationState(R, play(['B']), 'A', { A: [], B: [] });
    expect(st.positions.B).toEqual([null, null, null, null, null, null]);
    expect(st.server).toBeNull();
  });
});

describe('rotationTimeline', () => {
  it('records who served every rally and the rotations per set', () => {
    const rules = makeRules(INDOOR_RULES, { bestOf: 3, pointsPerSet: 2 });
    const ev = play(['B', 'B', 'A', 'A', 'A'], rules); // set 1: B wins 2-0 after a side-out; set 2 (B serves first): A wins 2-0; set 3 starts
    const tl = rotationTimeline(rules, ev, 'A', rosters);
    expect(tl.points.map((p) => [p.setIndex, p.servingSide, p.server])).toEqual([
      [0, 'A', 'a1'],
      [0, 'B', 'b2'],
      [1, 'B', 'b1'],
      [1, 'A', 'a2'],
      [2, 'A', 'a1'], // set 3: first serve alternates back to A, new starting lineup
    ]);
    expect(tl.setRotations).toEqual([
      { A: 0, B: 1 },
      { A: 1, B: 0 },
      { A: 0, B: 0 },
    ]);
    expect(tl.final).toEqual(rotationState(rules, ev, 'A', rosters));
  });

  it('skips timeouts and ignores events after the match ends', () => {
    const rules = makeRules(INDOOR_RULES, { bestOf: 1, pointsPerSet: 2 });
    let ev = callTimeout(rules, [], 'B');
    ev = play(['A', 'A'], rules, ev);
    const tl = rotationTimeline(rules, [...ev, { type: 'point', side: 'B', at: 1 }], 'A', rosters);
    expect(tl.points.map((p) => p.eventIndex)).toEqual([1, 2]);
    expect(tl.setRotations).toEqual([{ A: 0, B: 0 }]);
  });
});
