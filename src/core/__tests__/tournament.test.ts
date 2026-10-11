import { fixtureResultFromMatch } from '../results';
import { INDOOR_RULES } from '../rules';
import { MatchEvent, addPoint } from '../scoring';
import {
  FixtureResult,
  generateKnockout,
  generateRoundRobin,
  isBye,
  leagueChampion,
  matchTablePoints,
  resolveKnockout,
  roundName,
  seedOrder,
  standings,
} from '../tournament';

describe('round robin', () => {
  it.each([2, 3, 4, 5, 6, 7, 8])('every pair meets exactly once with %i teams', (n) => {
    const ids = Array.from({ length: n }, (_, i) => `t${i}`);
    const fx = generateRoundRobin(ids);
    expect(fx).toHaveLength((n * (n - 1)) / 2);
    const pairs = new Set(fx.map((f) => [f.homeId, f.awayId].sort().join('|')));
    expect(pairs.size).toBe(fx.length);
    // nobody plays twice in a round
    const rounds = new Map<number, string[]>();
    for (const f of fx) rounds.set(f.round, [...(rounds.get(f.round) ?? []), f.homeId!, f.awayId!]);
    for (const teams of rounds.values()) expect(new Set(teams).size).toBe(teams.length);
    expect(new Set(fx.map((f) => f.id)).size).toBe(fx.length);
  });

  it('double round robin swaps home and away', () => {
    const fx = generateRoundRobin(['a', 'b', 'c', 'd'], { doubleRound: true });
    expect(fx).toHaveLength(12);
  });

  it('rejects invalid input', () => {
    expect(() => generateRoundRobin(['a'])).toThrow();
    expect(() => generateRoundRobin(['a', 'a'])).toThrow();
  });
});

describe('standings', () => {
  it('awards 3/2/1/0 table points', () => {
    expect(matchTablePoints(3, 0)).toBe(3);
    expect(matchTablePoints(3, 1)).toBe(3);
    expect(matchTablePoints(3, 2)).toBe(2);
    expect(matchTablePoints(2, 3)).toBe(1);
    expect(matchTablePoints(1, 3)).toBe(0);
    expect(matchTablePoints(2, 0)).toBe(3);
    expect(matchTablePoints(2, 1)).toBe(2);
  });

  it('sorts a league table with tie-breakers', () => {
    const ids = ['a', 'b', 'c'];
    const fx = generateRoundRobin(ids);
    const find = (x: string, y: string) => fx.find((f) => (f.homeId === x && f.awayId === y) || (f.homeId === y && f.awayId === x))!;
    const res = (x: string, y: string, sx: number, sy: number, px: number, py: number): FixtureResult => {
      const f = find(x, y);
      return f.homeId === x
        ? { fixtureId: f.id, homeSets: sx, awaySets: sy, homePoints: px, awayPoints: py }
        : { fixtureId: f.id, homeSets: sy, awaySets: sx, homePoints: py, awayPoints: px };
    };
    const results = [res('a', 'b', 3, 2, 110, 105), res('b', 'c', 3, 0, 75, 50), res('a', 'c', 0, 3, 60, 75)];
    const table = standings(ids, fx, results);
    // a: 2+0 = 2 pts, b: 1+3 = 4 pts, c: 0+3 = 3 pts
    expect(table.map((r) => r.teamId)).toEqual(['b', 'c', 'a']);
    expect(table[0]).toMatchObject({ played: 2, won: 1, lost: 1, tablePoints: 4, setsWon: 5, setsLost: 3 });
    expect(leagueChampion(ids, fx, results)).toBe('b');
    expect(leagueChampion(ids, fx, results.slice(0, 2))).toBeNull();
  });

  it('ignores unfinished results', () => {
    const fx = generateRoundRobin(['a', 'b']);
    const t = standings(['a', 'b'], fx, [{ fixtureId: fx[0].id, homeSets: 1, awaySets: 1, homePoints: 0, awayPoints: 0 }]);
    expect(t.every((r) => r.played === 0)).toBe(true);
  });
});

describe('knockout', () => {
  it('seed order is standard', () => {
    expect(seedOrder(8)).toEqual([1, 8, 4, 5, 2, 7, 3, 6]);
  });

  it('creates a full bracket with byes for top seeds', () => {
    const fx = generateKnockout(['s1', 's2', 's3', 's4', 's5', 's6']);
    expect(fx.filter((f) => f.round === 1)).toHaveLength(4);
    expect(fx.filter((f) => f.round === 2)).toHaveLength(2);
    expect(fx.filter((f) => f.round === 3)).toHaveLength(1);
    const byes = fx.filter(isBye);
    expect(byes.map((f) => f.homeId).sort()).toEqual(['s1', 's2']);
    expect(roundName(3, 3)).toBe('Final');
    expect(roundName(2, 3)).toBe('Semi-finals');
  });

  it('advances winners and byes to a champion', () => {
    const fx = generateKnockout(['a', 'b', 'c']); // a has a bye; b vs c
    let st = resolveKnockout(fx, []);
    const final = st.fixtures.find((f) => f.round === 2)!;
    expect(final.homeId).toBe('a');
    expect(final.awayId).toBeNull();
    const semi = st.fixtures.find((f) => f.round === 1 && !isBye(f))!;
    const r1: FixtureResult = { fixtureId: semi.id, homeSets: 0, awaySets: 3, homePoints: 40, awayPoints: 75 };
    st = resolveKnockout(fx, [r1]);
    const winner = semi.awayId!;
    expect(st.fixtures.find((f) => f.round === 2)!.awayId).toBe(winner);
    expect(st.championId).toBeNull();
    st = resolveKnockout(fx, [r1, { fixtureId: final.id, homeSets: 3, awaySets: 1, homePoints: 90, awayPoints: 80 }]);
    expect(st.championId).toBe('a');
  });

  it('works for a power of two with no byes', () => {
    const fx = generateKnockout(['a', 'b', 'c', 'd']);
    expect(fx.some(isBye)).toBe(false);
    expect(fx.find((f) => f.id === 'R1-M0')).toMatchObject({ homeId: 'a', awayId: 'd' });
  });
});

describe('match -> fixture result', () => {
  it('converts a finished linked match', () => {
    let ev: MatchEvent[] = [];
    for (let i = 0; i < 75; i++) ev = addPoint(INDOOR_RULES, ev, 'A', { at: 1 });
    expect(fixtureResultFromMatch({ rules: INDOOR_RULES, events: ev, firstServe: 'A', fixtureId: 'R1-M0' })).toEqual({
      fixtureId: 'R1-M0',
      homeSets: 3,
      awaySets: 0,
      homePoints: 75,
      awayPoints: 0,
    });
    expect(fixtureResultFromMatch({ rules: INDOOR_RULES, events: ev.slice(0, 10), firstServe: 'A', fixtureId: 'x' })).toBeNull();
  });
});
