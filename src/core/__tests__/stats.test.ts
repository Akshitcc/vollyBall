import { INDOOR_RULES, BEACH_RULES } from '../rules';
import { MatchEvent, Side, addPoint, attributeLastPoint } from '../scoring';
import { careerStats, longestRun, playerStats, shareText, teamTotals } from '../stats';

const pt = (ev: MatchEvent[], side: Side, playerId?: string, kind?: 'kill' | 'block' | 'ace' | 'tip') =>
  addPoint(INDOOR_RULES, ev, side, { at: 1, playerId, kind });

describe('player stat counting', () => {
  it('counts points by player and kind', () => {
    let ev: MatchEvent[] = [];
    ev = pt(ev, 'A', 'p1', 'kill');
    ev = pt(ev, 'A', 'p1', 'ace');
    ev = pt(ev, 'B', 'q1', 'block');
    ev = pt(ev, 'A'); // unattributed
    ev = pt(ev, 'A', 'p2', 'tip');
    const s = playerStats(INDOOR_RULES, ev);
    expect(s.p1).toEqual({ playerId: 'p1', points: 2, kill: 1, block: 0, ace: 1, tip: 0 });
    expect(s.q1.block).toBe(1);
    expect(s.p2.tip).toBe(1);
    expect(Object.keys(s)).toHaveLength(3);
    const t = teamTotals(ev);
    expect(t.points).toEqual({ A: 4, B: 1 });
    expect(t.unattributed.A).toBe(1);
  });

  it('attribution added after the tap is counted, and undo removes it', () => {
    let ev = pt([], 'A');
    ev = attributeLastPoint(ev, 'p9', 'block');
    expect(playerStats(INDOOR_RULES, ev).p9.block).toBe(1);
    expect(playerStats(INDOOR_RULES, ev.slice(0, -1)).p9).toBeUndefined();
  });

  it('longest run ignores timeouts', () => {
    const ev: MatchEvent[] = [
      { type: 'point', side: 'A', at: 0 },
      { type: 'point', side: 'A', at: 0 },
      { type: 'timeout', side: 'B', at: 0 },
      { type: 'point', side: 'A', at: 0 },
      { type: 'point', side: 'B', at: 0 },
    ];
    expect(longestRun(ev)).toEqual({ A: 3, B: 1, best: { side: 'A', length: 3 } });
  });
});

describe('career stats', () => {
  const players = (...ids: string[]) => ids.map((id) => ({ id }));
  const win = (playerId: string): MatchEvent[] => {
    let ev: MatchEvent[] = [];
    for (let i = 0; i < 42; i++) ev = addPoint(BEACH_RULES, ev, 'A', { at: 1, playerId, kind: i % 2 ? 'kill' : 'ace' });
    return ev;
  };
  it('aggregates wins, losses and points across matches', () => {
    const m1 = { rules: BEACH_RULES, events: win('u1'), teamA: { players: players('u1', 'u2') }, teamB: { players: players('u3') } };
    const m2 = { rules: BEACH_RULES, events: win('u3'), teamA: { players: players('u3') }, teamB: { players: players('u1') } };
    const c = careerStats('u1', [m1, m2]);
    expect(c.matches).toBe(2);
    expect(c.wins).toBe(1);
    expect(c.losses).toBe(1);
    expect(c.points).toBe(42);
    expect(c.kill + c.ace).toBe(42);
    expect(c.winRate).toBe(0.5);
    expect(careerStats('nobody', [m1, m2]).matches).toBe(0);
  });
});

describe('share text', () => {
  it('describes a finished match', () => {
    let ev: MatchEvent[] = [];
    for (let i = 0; i < 75; i++) ev = addPoint(INDOOR_RULES, ev, 'B', { at: 1 });
    const txt = shareText('Spikers', 'Blockers', INDOOR_RULES, ev);
    expect(txt).toContain('Blockers beat Spikers 3-0');
    expect(txt).toContain('Sets: 0-25, 0-25, 0-25');
  });
});

// QA bug E: career stats must only count completed matches.
describe('career stats ignore unfinished matches (QA bug E)', () => {
  const players = (...ids: string[]) => ids.map((id) => ({ id }));
  const done = { status: 'finished', rules: BEACH_RULES, events: Array.from({ length: 42 }, () => ({ type: 'point' as const, side: 'A' as Side, at: 1 })), teamA: { players: players('u1') }, teamB: { players: players('u3') } };

  it('a live tournament fixture with no points does not count as a match', () => {
    const live = { status: 'live', rules: BEACH_RULES, events: [], teamA: { players: players('u1') }, teamB: { players: players('u9') } };
    const c = careerStats('u1', [done, live]);
    expect(c).toMatchObject({ matches: 1, finished: 1, wins: 1, losses: 0, winRate: 1 });
  });

  it('points scored in live, scheduled or abandoned matches are not counted', () => {
    const partial = addPoint(BEACH_RULES, [], 'A', { at: 1, playerId: 'u1', kind: 'kill' });
    const mk = (status: string) => ({ status, rules: BEACH_RULES, events: partial, teamA: { players: players('u1') }, teamB: { players: players('u3') } });
    const c = careerStats('u1', [mk('live'), mk('scheduled'), mk('abandoned')]);
    expect(c).toMatchObject({ matches: 0, points: 0, kill: 0, wins: 0, losses: 0, winRate: 0 });
  });

  it('a match marked finished whose log is not actually complete is ignored', () => {
    const c = careerStats('u1', [{ ...done, events: done.events.slice(0, 5) }]);
    expect(c.matches).toBe(0);
  });
});
