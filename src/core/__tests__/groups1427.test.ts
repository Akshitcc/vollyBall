/** 1.4.27 (E2E-4): groups + knockout generator, 4–32 teams; play-in knockout; group tables and seeding. */
import { assignGroups, defaultGroupPlan, generateGroupsKnockout, groupId, groupPlans, groupsProblem, playIn, qualifierSeeds, resolveGroupsKnockout, seededRandom } from '../groups';
import { FIXTURE_NOT_READY, fixtureStartProblem } from '../fixtureLock';
import { generateKnockout, resolveKnockout, type Fixture, type FixtureResult } from '../tournament';
import { MAX_TOURNAMENT_TEAMS } from '../limits';

const ids = (n: number) => Array.from({ length: n }, (_, i) => `t${String(i + 1).padStart(2, '0')}`);
const strength = (id: string) => -Number(id.slice(1)); // t01 strongest
const play = (f: Fixture): FixtureResult => {
  const homeWins = strength(f.homeId!) > strength(f.awayId!);
  return { fixtureId: f.id, homeSets: homeWins ? 2 : 1, awaySets: homeWins ? 1 : 2, homePoints: homeWins ? 60 : 55, awayPoints: homeWins ? 55 : 60 };
};

/** Plays every playable fixture until nothing is left; returns the results and the number of matches played. */
function playAll(t: { teams: { id: string; group?: string }[]; fixtures: Fixture[] }) {
  const results: FixtureResult[] = [];
  for (;;) {
    const r = resolveGroupsKnockout(t, results);
    const done = new Set(results.map((x) => x.fixtureId));
    const ready = r.fixtures.filter((f) => !done.has(f.id) && f.homeId && f.awayId);
    if (!ready.length) return { results, champion: r.championId, tables: r.tables, fixtures: r.fixtures };
    results.push(...ready.map(play));
  }
}

const build = (n: number, mode: 'seeded' | 'random' = 'seeded') => {
  const plan = defaultGroupPlan(n)!;
  const groups = assignGroups(ids(n), plan.groups, mode, seededRandom(42));
  const teams = ids(n).map((id) => ({ id, group: groupId(groups.findIndex((g) => g.includes(id))) }));
  return { plan, groups, t: { format: 'groups', advance: plan.advance, teams, fixtures: generateGroupsKnockout(groups, plan.advance) } };
};

describe('generator for every size 4..32', () => {
  test('MAX_TOURNAMENT_TEAMS is 32', () => expect(MAX_TOURNAMENT_TEAMS).toBe(32));
  for (let n = 4; n <= 32; n++) {
    test(`${n} teams`, () => {
      const { plan, groups, t } = build(n);
      expect(groups.map((g) => g.length)).toEqual(plan.sizes);
      expect(plan.sizes.reduce((a, b) => a + b, 0)).toBe(n);
      expect(Math.max(...plan.sizes) - Math.min(...plan.sizes)).toBeLessThanOrEqual(1);
      expect(Math.min(...plan.sizes)).toBeGreaterThanOrEqual(plan.advance + 1);
      expect(plan.bracket & (plan.bracket - 1)).toBe(0); // power of two
      expect(plan.bracket - plan.qualifiers).toBe(plan.byes);
      expect(new Set(groups.flat()).size).toBe(n);
      expect(new Set(t.fixtures.map((f) => f.id)).size).toBe(t.fixtures.length);
      expect(new Set(t.fixtures.map((f) => `${f.round}:${f.index}`)).size).toBe(t.fixtures.length); // DB slot key
      expect(t.fixtures.filter((f) => f.group).length).toBe(plan.groupMatches);
      expect(t.fixtures.filter((f) => !f.group).length).toBe(plan.bracket - 1);
      expect(groupsProblem(t)).toBeNull();
      const random = build(n, 'random');
      expect(random.groups.map((g) => g.length)).toEqual(plan.sizes);
      expect(groupsProblem(random.t)).toBeNull();
      // play everything: every group match + qualifiers − 1 knockout matches, and a champion
      const run = playAll(t);
      expect(run.results.length).toBe(plan.total);
      expect(run.champion).toBe('t01'); // the strongest team wins every match
      expect(run.tables.every((g) => g.complete)).toBe(true);
    });
  }
});

describe('15 teams: Akshit\'s example', () => {
  test('4 groups 4/4/4/3, top 2 to the quarter-finals: 21 + 4 + 2 + 1 = 28 matches (the brief\'s 23 / 18 group matches undercount)', () => {
    const p = defaultGroupPlan(15)!;
    expect([p.groups, p.advance, p.sizes, p.bracket, p.byes]).toEqual([4, 2, [4, 4, 4, 3], 8, 0]);
    expect([p.groupMatches, p.knockoutMatches, p.total]).toEqual([21, 7, 28]); // C(4,2)·3 + C(3,2) = 6+6+6+3
  });
  test('cross-group quarter-finals A1 v B2, D1 v C2, B1 v A2, C1 v D2', () => {
    const { t } = build(15);
    const qf = t.fixtures.filter((f) => f.homeSeed || f.awaySeed).map((f) => `${f.homeSeed} v ${f.awaySeed}`);
    expect(qf.sort()).toEqual(['A1 v B2', 'B1 v A2', 'C1 v D2', 'D1 v C2']);
    expect(qualifierSeeds(4, 2)).toEqual(['A1', 'B1', 'C1', 'D1', 'C2', 'D2', 'A2', 'B2']);
  });
  test('seeded draw: the top 4 seeds are in 4 different groups; the random draw is repeatable per seed', () => {
    const g = assignGroups(ids(15), 4, 'seeded');
    expect(g.map((x) => x[0])).toEqual(['t01', 't02', 't03', 't04']);
    expect(assignGroups(ids(15), 4, 'random', seededRandom(7))).toEqual(assignGroups(ids(15), 4, 'random', seededRandom(7)));
  });
  test('a knockout slot is not ready until both of its groups are complete', () => {
    const { t } = build(15);
    const qf = t.fixtures.find((f) => f.homeSeed === 'A1')!;
    expect(fixtureStartProblem(t, [], qf.id, {}, false)).toBe(FIXTURE_NOT_READY);
    const groupA = t.fixtures.filter((f) => f.group === 'A').map(play);
    const half = resolveGroupsKnockout(t, groupA).fixtures.find((f) => f.id === qf.id)!;
    expect([half.homeId, half.awayId]).toEqual([null, null]); // B not complete yet: no half-filled slot (never a bye)
  });
  test('group table ties: points, wins, set ratio, point ratio, then name', () => {
    const teams = [{ id: 'z', group: 'A' }, { id: 'y', group: 'A' }, { id: 'x', group: 'B' }, { id: 'w', group: 'B' }];
    const fixtures = generateGroupsKnockout([['z', 'y'], ['x', 'w']], 1);
    const names = { z: 'Alpha', y: 'Bravo', x: 'Xray', w: 'Whiskey' };
    const r = resolveGroupsKnockout({ teams, fixtures }, [], names);
    expect(r.tables[0].rows.map((x) => x.teamId)).toEqual(['z', 'y']); // all level → by name
    expect(r.tables[1].rows.map((x) => x.teamId)).toEqual(['w', 'x']);
  });
});

describe('17 teams: groups or a play-in', () => {
  test('groups: 4 groups 5/4/4/4, top 2 to the QFs = 10+6+6+6 + 7 = 35 matches', () => {
    const p = defaultGroupPlan(17)!;
    expect([p.groups, p.advance, p.sizes, p.total]).toEqual([4, 2, [5, 4, 4, 4], 35]);
    expect(playAll(build(17).t).results.length).toBe(35);
  });
  test('play-in: 1 match (seeds 16 v 17) brings the field to 16, then a 16-team knockout = 16 matches', () => {
    expect(playIn(17)).toEqual({ bracket: 32, byes: 15, playInMatches: 1, field: 16, total: 16 });
    const fx = generateKnockout(ids(17));
    const r1real = fx.filter((f) => f.round === 1 && f.homeId && f.awayId);
    expect(r1real.map((f) => [f.homeId, f.awayId])).toEqual([['t16', 't17']]);
    let results: FixtureResult[] = [];
    for (;;) {
      const st = resolveKnockout(fx, results);
      const done = new Set(results.map((x) => x.fixtureId));
      const ready = st.fixtures.filter((f) => !done.has(f.id) && f.homeId && f.awayId);
      if (!ready.length) { expect(st.championId).toBe('t01'); break; }
      results = [...results, ...ready.map(play)];
    }
    expect(results.length).toBe(16);
  });
});

describe('plans', () => {
  test('no plan under 4 teams; a power-of-two bracket always', () => {
    expect(groupPlans(3)).toEqual([]);
    for (let n = 4; n <= 32; n++) for (const p of groupPlans(n)) expect(p.bracket & (p.bracket - 1)).toBe(0);
  });
  test('validation refuses inconsistent groups', () => {
    const { t } = build(8);
    expect(groupsProblem({ ...t, advance: 3 })).toBe('groups_advance');
    expect(groupsProblem({ ...t, teams: t.teams.map((x, i) => (i ? x : { id: x.id })) })).toBe('groups_team');
    expect(groupsProblem({ ...t, fixtures: [...t.fixtures, { id: 'x', round: 99, index: 0, homeId: null, awayId: null, homeSeed: 'H1' }] })).toBe('groups_seed');
    expect(groupsProblem({ ...t, format: 'league' })).toBe('groups_only');
  });
});
