/** 1.4.28 (QA V1427-1): one shared tiebreak – app, API and demo resolve a full tie on the qualifying line by NAME.
 * Tester's repro: 15 teams, 4 groups, top 2, a 3-way full tie for A2–A4 with ids in the opposite order to names. */
import { generateGroupsKnockout, groupTables, resolveFixtures, tiebreakNames } from '../groups';
import { FIXTURE_TEAMS, fixtureStartProblem } from '../fixtureLock';
import type { FixtureResult } from '../tournament';

const NAMES: Record<string, string> = { a9: 'Juhu Spikers', z1: 'Goregaon Giants', m1: 'Thane Titans', b1: 'Vashi Volleys' };
const groups = [['a9', 'z1', 'm1', 'b1'], ['B1', 'B2', 'B3', 'B4'], ['C1', 'C2', 'C3', 'C4'], ['D1', 'D2', 'D3']];
const teams = groups.flatMap((g, gi) => g.map((id) => ({ id, name: NAMES[id] ?? `Team ${id}`, group: 'ABCD'[gi] })));
const fixtures = generateGroupsKnockout(groups, 2);
const beats = new Set(['z1>m1', 'm1>b1', 'b1>z1']);
const results: FixtureResult[] = fixtures.filter((f) => f.group).map((f) => {
  const home = f.homeId === 'a9' || (f.awayId !== 'a9' && (beats.has(`${f.homeId}>${f.awayId}`) || (!beats.has(`${f.awayId}>${f.homeId}`) && f.homeId! < f.awayId!)));
  return { fixtureId: f.id, homeSets: home ? 2 : 0, awaySets: home ? 0 : 2, homePoints: home ? 30 : 24, awayPoints: home ? 24 : 30 };
});
const t = { format: 'groups', teams, fixtures, advance: 2 };

it('group A order: Juhu, then the tie by name – Goregaon, Thane, Vashi (ids sort the other way)', () => {
  expect(groupTables(t, results)[0].rows.map((r) => NAMES[r.teamId])).toEqual(['Juhu Spikers', 'Goregaon Giants', 'Thane Titans', 'Vashi Volleys']);
  expect(['z1', 'm1', 'b1'].sort()).toEqual(['b1', 'm1', 'z1']); // id order: Vashi, Thane, Goregaon
});
it('the bracket (no names passed: API / demo path) and the app (names passed) both put Goregaon in the A2 slot', () => {
  const slot = fixtures.find((f) => f.homeSeed === 'A2' || f.awaySeed === 'A2')!;
  const side = (fx: ReturnType<typeof resolveFixtures>['fixtures']) => { const f = fx.find((x) => x.id === slot.id)!; return slot.homeSeed === 'A2' ? f.homeId : f.awayId; };
  expect(side(resolveFixtures(t, results).fixtures)).toBe('z1');
  expect(side(resolveFixtures(t, results, tiebreakNames(t)).fixtures)).toBe('z1');
});
it('demo / core fixture_teams: Goregaon accepted, Thane refused', () => {
  const slot = resolveFixtures(t, results).fixtures.find((f) => f.homeSeed === 'A2' || f.awaySeed === 'A2')!;
  const ok = { A: slot.homeId, B: slot.awayId };
  expect(fixtureStartProblem(t, results, slot.id, ok, false)).toBeNull();
  const wrong = slot.homeSeed === 'A2' ? { A: 'm1', B: slot.awayId } : { A: slot.homeId, B: 'm1' };
  expect(fixtureStartProblem(t, results, slot.id, wrong, false)).toBe(FIXTURE_TEAMS);
});
it('V1427-2: groupsProblem matches the app – fewer than 4 teams / a group not bigger than advance', () => {
  const { groupsProblem } = require('../groups');
  expect(groupsProblem({ format: 'groups', advance: 1, teams: [{ id: 'a', group: 'A' }, { id: 'b', group: 'A' }, { id: 'c', group: 'B' }], fixtures: [] })).toBe('groups_too_few');
  expect(groupsProblem({ format: 'groups', advance: 2, teams: ['a', 'b', 'c', 'd'].map((id) => ({ id, group: 'A' })).concat([{ id: 'e', group: 'B' }, { id: 'f', group: 'B' }]), fixtures: [] })).toBe('groups_too_small');
  expect(groupsProblem({ format: 'groups', advance: 1, teams: ['a', 'b', 'c'].map((id) => ({ id, group: 'A' })).concat([{ id: 'e', group: 'B' }, { id: 'f', group: 'B' }]), fixtures: [] })).toBeNull();
});
