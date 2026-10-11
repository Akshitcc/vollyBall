import { BEACH_RULES, INDOOR_RULES, makeRules } from '../rules';
import { MatchEvent, Side, addPoint, attributeLastPoint, attributePoint, callTimeout, computeState, summarize, timeline, undo } from '../scoring';
import { playerStats, teamTotals } from '../stats';

const play = (rules = INDOOR_RULES, seq: string, start: MatchEvent[] = []) =>
  seq.split('').reduce<MatchEvent[]>((ev, c) => addPoint(rules, ev, c as Side, { at: 1 }), start);
const rep = (s: string, n: number) => s.repeat(n);

describe('set wins', () => {
  it('wins a set at 25-0', () => {
    const st = computeState(INDOOR_RULES, play(INDOOR_RULES, rep('A', 25)));
    expect(st.sets).toEqual([{ a: 25, b: 0, winner: 'A' }]);
    expect(st.setsWon).toEqual({ A: 1, B: 0 });
    expect(st.current).toEqual({ a: 0, b: 0 });
    expect(st.setIndex).toBe(1);
  });

  it('does not end the set at 24 points', () => {
    const st = computeState(INDOOR_RULES, play(INDOOR_RULES, rep('A', 24)));
    expect(st.sets).toHaveLength(0);
    expect(st.setPoint).toBe('A');
  });
});

describe('win by 2', () => {
  it('continues past 25 at 25-24 and ends at 27-25', () => {
    let ev = play(INDOOR_RULES, rep('AB', 24)); // 24-24
    ev = play(INDOOR_RULES, 'A', ev); // 25-24
    let st = computeState(INDOOR_RULES, ev);
    expect(st.sets).toHaveLength(0);
    expect(st.current).toEqual({ a: 25, b: 24 });
    ev = play(INDOOR_RULES, 'B', ev); // 25-25
    ev = play(INDOOR_RULES, 'B', ev); // 25-26
    expect(computeState(INDOOR_RULES, ev).sets).toHaveLength(0);
    ev = play(INDOOR_RULES, 'B', ev); // 25-27
    st = computeState(INDOOR_RULES, ev);
    expect(st.sets).toEqual([{ a: 25, b: 27, winner: 'B' }]);
  });

  it('respects a point cap when configured', () => {
    const capped = makeRules(INDOOR_RULES, { pointCap: 27 });
    expect(capped.preset).toBe('custom');
    const ev = play(capped, rep('AB', 26) + 'A'); // 27-26 -> cap reached
    expect(computeState(capped, ev).sets[0]).toEqual({ a: 27, b: 26, winner: 'A' });
  });
});

describe('deciding set', () => {
  it('plays the 5th set to 15 in indoor', () => {
    const twoAll = play(INDOOR_RULES, rep('A', 25) + rep('B', 25) + rep('A', 25) + rep('B', 25));
    let st = computeState(INDOOR_RULES, twoAll);
    expect(st.isDecidingSet).toBe(true);
    expect(st.targetPoints).toBe(15);
    const ev = play(INDOOR_RULES, rep('A', 14), twoAll);
    st = computeState(INDOOR_RULES, ev);
    expect(st.matchPoint).toBe('A');
    st = computeState(INDOOR_RULES, play(INDOOR_RULES, 'A', ev));
    expect(st.finished).toBe(true);
    expect(st.winner).toBe('A');
    expect(st.sets[4]).toEqual({ a: 15, b: 0, winner: 'A' });
  });

  it('deciding set still requires win by 2', () => {
    const oneAll = play(BEACH_RULES, rep('A', 21) + rep('B', 21));
    const ev = play(BEACH_RULES, rep('AB', 14) + 'A', oneAll); // 15-14
    expect(computeState(BEACH_RULES, ev).finished).toBe(false);
    expect(computeState(BEACH_RULES, play(BEACH_RULES, 'A', ev)).finished).toBe(true);
  });

  it('flags indoor side switch at 8 in the deciding set', () => {
    const twoAll = play(INDOOR_RULES, rep('A', 25) + rep('B', 25) + rep('A', 25) + rep('B', 25));
    const st = computeState(INDOOR_RULES, play(INDOOR_RULES, rep('B', 8), twoAll));
    expect(st.sideSwitchDue).toBe(true);
    const after = computeState(INDOOR_RULES, play(INDOOR_RULES, rep('B', 9), twoAll));
    expect(after.sideSwitchDue).toBe(false);
  });

  it('flags beach side switches every 7 points (5 in deciding set)', () => {
    expect(computeState(BEACH_RULES, play(BEACH_RULES, 'AABBABA')).sideSwitchDue).toBe(true);
    expect(computeState(BEACH_RULES, play(BEACH_RULES, 'AABBAB')).sideSwitchDue).toBe(false);
    const oneAll = play(BEACH_RULES, rep('A', 21) + rep('B', 21));
    expect(computeState(BEACH_RULES, play(BEACH_RULES, 'ABABA', oneAll)).sideSwitchDue).toBe(true);
  });
});

describe('match win', () => {
  it('best of 5 ends 3-0 and ignores further points', () => {
    const ev = play(INDOOR_RULES, rep('A', 75));
    const st = computeState(INDOOR_RULES, ev);
    expect(st.finished).toBe(true);
    expect(st.winner).toBe('A');
    expect(st.setsWon).toEqual({ A: 3, B: 0 });
    expect(addPoint(INDOOR_RULES, ev, 'B')).toHaveLength(ev.length);
    expect(summarize(st)).toMatchObject({ setsA: 3, setsB: 0, winner: 'A', currentA: 25, currentB: 0 });
  });

  it('best of 3 beach ends at 2 sets', () => {
    const st = computeState(BEACH_RULES, play(BEACH_RULES, rep('B', 42)));
    expect(st.finished).toBe(true);
    expect(st.winner).toBe('B');
    expect(st.sets).toHaveLength(2);
  });

  it('serve follows rally winner and alternates at set start', () => {
    let st = computeState(INDOOR_RULES, play(INDOOR_RULES, 'B'), 'A');
    expect(st.serving).toBe('B');
    st = computeState(INDOOR_RULES, play(INDOOR_RULES, rep('A', 25)), 'A');
    expect(st.serving).toBe('B'); // set 2 starts with the other team
  });
});

describe('undo', () => {
  it('removes the last point', () => {
    const ev = play(INDOOR_RULES, 'AAB');
    const st = computeState(INDOOR_RULES, undo(ev));
    expect(st.current).toEqual({ a: 2, b: 0 });
  });

  it('undoes a set-winning point and restores the set', () => {
    const ev = play(INDOOR_RULES, rep('A', 25));
    const st = computeState(INDOOR_RULES, undo(ev));
    expect(st.sets).toHaveLength(0);
    expect(st.current).toEqual({ a: 24, b: 0 });
  });

  it('undoes a match-winning point', () => {
    const ev = play(INDOOR_RULES, rep('A', 75));
    expect(computeState(INDOOR_RULES, undo(ev)).finished).toBe(false);
  });

  it('undo on empty log is safe', () => {
    expect(undo([])).toEqual([]);
  });
});

describe('timeouts', () => {
  it('limits timeouts per set and resets each set', () => {
    let ev: MatchEvent[] = [];
    ev = callTimeout(INDOOR_RULES, ev, 'A');
    ev = callTimeout(INDOOR_RULES, ev, 'A');
    ev = callTimeout(INDOOR_RULES, ev, 'A'); // ignored
    expect(ev).toHaveLength(2);
    expect(computeState(INDOOR_RULES, ev).timeoutsLeft).toEqual({ A: 0, B: 2 });
    ev = play(INDOOR_RULES, rep('A', 25), ev);
    expect(computeState(INDOOR_RULES, ev).timeoutsLeft).toEqual({ A: 2, B: 2 });
  });
});

describe('attribution & timeline', () => {
  it('attributes the last point to a player', () => {
    const ev = attributeLastPoint(play(INDOOR_RULES, 'A'), 'p1', 'ace');
    expect(ev[0]).toMatchObject({ side: 'A', playerId: 'p1', kind: 'ace' });
  });
  it('does not attribute a timeout', () => {
    const ev = callTimeout(INDOOR_RULES, [], 'A');
    expect(attributeLastPoint(ev, 'p1', 'ace')).toEqual(ev);
  });
  it('builds a per-set timeline', () => {
    const tl = timeline(INDOOR_RULES, play(INDOOR_RULES, rep('A', 25) + 'B'));
    expect(tl[24]).toMatchObject({ set: 1, a: 25, b: 0 });
    expect(tl[25]).toMatchObject({ set: 2, a: 0, b: 1 });
  });
});

// QA bug A: a player credit that was picked must not be lost.
describe('crediting a rally (QA bug A)', () => {
  const R = INDOOR_RULES;
  const A = ['a1', 'a2'];
  const B = ['aarav', 'b2'];

  it('credits the tapped rally even if a timeout was called before the credit', () => {
    let ev = addPoint(R, [], 'B', { at: 1 });
    const index = ev.length - 1;
    ev = callTimeout(R, ev, 'A', { at: 2 });
    expect(attributeLastPoint(ev, 'aarav', 'kill')).toEqual(ev); // old behaviour: silently dropped
    ev = attributePoint(ev, index, 'aarav', 'kill', B);
    expect(ev[index]).toMatchObject({ type: 'point', side: 'B', playerId: 'aarav', kind: 'kill' });
    expect(playerStats(R, ev).aarav).toMatchObject({ points: 1, kill: 1 });
  });

  it('never credits a point to a player of the other team', () => {
    const ev = addPoint(R, [], 'A', { at: 1 }); // team A won the rally
    expect(attributePoint(ev, 0, 'aarav', 'kill', A)).toEqual(ev);
    expect(attributePoint(ev, 0, 'a1', 'kill', A)[0]).toMatchObject({ playerId: 'a1' });
  });

  it('only credits point events', () => {
    const ev = callTimeout(R, [], 'A', { at: 1 });
    expect(attributePoint(ev, 0, 'a1', 'ace', A)).toEqual(ev);
    expect(attributePoint(ev, 5, 'a1', 'ace', A)).toEqual(ev);
  });

  it('a credit on the match-winning point survives the end of the match, and undoing later rallies keeps earlier credits', () => {
    const rules = { ...R, bestOf: 1 as const, pointsPerSet: 3, winBy: 1 };
    let ev = addPoint(rules, [], 'B', { at: 1 });
    ev = attributePoint(ev, 0, 'aarav', 'kill', B);
    ev = addPoint(rules, ev, 'B', { at: 2 });
    ev = addPoint(rules, ev, 'B', { at: 3 }); // wins the match
    expect(computeState(rules, ev).finished).toBe(true);
    ev = attributePoint(ev, 2, 'aarav', 'ace', B);
    expect(playerStats(rules, ev).aarav).toMatchObject({ points: 2, kill: 1, ace: 1 });
    expect(teamTotals(ev).byKind.B).toMatchObject({ kill: 1, ace: 1 });
    expect(timeline(rules, ev).filter((e) => e.event.type === 'point' && e.event.playerId === 'aarav')).toHaveLength(2);
    const undone = undo(ev);
    expect(playerStats(rules, undone).aarav).toMatchObject({ points: 1, kill: 1 });
  });
});
