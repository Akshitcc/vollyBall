/**
 * 1.4.28 – Tester's 1.4.27 E2E (fixes-retest.md 'E2E scenario 1.4.27'):
 * V1427-1 (High) a full tie on the qualifying line is broken by NAME on the API like in the app (one shared tiebreak:
 *   core/groups tiebreakNames). Tester's repro: 15 teams, 4 groups, top 2; a 3-way full tie for A2–A4 between
 *   Goregaon Giants, Thane Titans and Vashi Volleys, with team ids in the opposite order to the names.
 * V1427-2 (Low) the API refuses groups the app can't build (fewer than 4 teams; a group not bigger than `advance`).
 */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { buildMatch } from '../../src/core/buildMatch';
import { INDOOR_RULES, type RuleSet } from '../../src/core/rules';
import { generateGroupsKnockout, groupId, resolveFixtures, seedLabel } from '../../src/core/groups';
import type { Fixture } from '../../src/core/tournament';
import { makeTeam, makeUsers, matchTeam, playSets, registerUser, type ClientFor, type SimUser } from '../scripts/auditSim';
import { fixtureTeamsNow } from '../src/domain/tournaments';
import { migrate } from '../src/db/migrate';
import { groupsDataInUse, rollback0024, ROLLBACK_0024_REFUSED } from '../src/db/rollback/rollback0024';
import { clientFor, liftLimits } from './auditHelpers';
import { startHarness, type Harness } from './helpers';

let h: Harness;
let c: ClientFor;
before(async () => {
  h = await startHarness();
  liftLimits(h.s.rateLimiter!);
  c = clientFor(h);
});
after(async () => { await h.close(); });

const rules: RuleSet = { ...INDOOR_RULES, bestOf: 3, pointsPerSet: 15, decidingSetPoints: 15 };
const day = 86_400_000;

describe('V1427-1: full tie on the qualifying line – name, not id, on the API', () => {
  let org: SimUser;
  let as: (u: SimUser) => ReturnType<ClientFor>;
  let tid: string;
  let ids: Record<string, string>;
  let t: { fixtures: Fixture[]; teams: { id: string; name: string }[] };
  before(async () => {
    const users = makeUsers('f28', 15 * 6 + 1, 9350000000);
    for (const [i, u] of users.entries()) await registerUser(c, u, i);
    as = (u) => c(u.uid, u.phone);
    org = users[90];
    const made: string[] = [];
    for (let i = 0; i < 15; i++) made.push(await makeTeam(c, `f28 Team ${String(i + 1).padStart(2, '0')}`, users.slice(i * 6, i * 6 + 6)));
    // the three tied teams: ids sorted the OPPOSITE way to their names (Goregaon gets the largest id)
    const tied = made.slice(1, 4).sort();
    const tiedNames = ['Vashi Volleys', 'Thane Titans', 'Goregaon Giants'];
    const other = ['Juhu Spikers', 'Bandra Blockers', 'Malad Smashers', 'Worli Waves', 'Borivali Bumpers', 'Chembur Chargers', 'Andheri Liberos', 'Kurla Kings', 'Colaba Aces', 'Dadar Diggers', 'Powai Setters', 'Sion Servers'];
    const rest = [made[0], ...made.slice(4)];
    const nameOf = new Map<string, string>([...tied.map((id, i) => [id, tiedNames[i]] as [string, string]), ...rest.map((id, i) => [id, other[i]] as [string, string])]);
    ids = Object.fromEntries([...nameOf].map(([id, n]) => [n, id]));
    const groups = [
      [ids['Juhu Spikers'], ids['Goregaon Giants'], ids['Thane Titans'], ids['Vashi Volleys']],
      [ids['Bandra Blockers'], ids['Malad Smashers'], ids['Worli Waves'], ids['Borivali Bumpers']],
      [ids['Chembur Chargers'], ids['Andheri Liberos'], ids['Kurla Kings'], ids['Colaba Aces']],
      [ids['Dadar Diggers'], ids['Powai Setters'], ids['Sion Servers']],
    ];
    assert.ok(ids['Goregaon Giants'] > ids['Thane Titans'] && ids['Thane Titans'] > ids['Vashi Volleys']); // id order ≠ name order
    const res = await as(org)('POST', '/api/tournaments', {
      name: 'Mumbai Groups Cup', organizerId: org.uid, rules, startDate: Date.now() + day, endDate: Date.now() + 3 * day, status: 'running',
      location: { name: 'NSCI Dome', lat: 18.99, lng: 72.82 }, format: 'groups', advance: 2,
      teams: groups.flatMap((g, gi) => g.map((id) => ({ id, name: nameOf.get(id)!, color: '#E53935', group: groupId(gi) }))),
      fixtures: generateGroupsKnockout(groups, 2),
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    tid = res.body.id;
    t = (await as(org)('GET', `/api/tournaments/${tid}`)).body;
    // results: Juhu wins every match; G beats T, T beats V, V beats G (all 2-0, same scores) -> full 3-way tie; others: the first-listed team wins
    const beats = new Set([`${ids['Goregaon Giants']}>${ids['Thane Titans']}`, `${ids['Thane Titans']}>${ids['Vashi Volleys']}`, `${ids['Vashi Volleys']}>${ids['Goregaon Giants']}`]);
    const order = groups.flat();
    for (const f of t.fixtures.filter((x) => x.group)) {
      const homeWins = f.homeId === ids['Juhu Spikers'] || (f.awayId !== ids['Juhu Spikers'] && (beats.has(`${f.homeId}>${f.awayId}`) || (!beats.has(`${f.awayId}>${f.homeId}`) && order.indexOf(f.homeId!) < order.indexOf(f.awayId!))));
      const [hm, aw] = [await matchTeam(c, org, f.homeId!), await matchTeam(c, org, f.awayId!)];
      const md = buildMatch({ teamA: hm.mt, teamB: aw.mt, rules, createdBy: org.uid, scorerId: org.uid, startNow: true, tournamentId: tid, fixtureId: f.id, captains: { A: hm.captainId, B: aw.captainId } });
      const mid = (await as(org)('POST', '/api/matches', md)).body.id;
      assert.ok(mid, f.id);
      const ev = playSets(rules, homeWins ? ['A', 'A'] : ['B', 'B'], { A: hm.mt.players.map((p) => p.id), B: aw.mt.players.map((p) => p.id) });
      assert.equal((await as(org)('PUT', `/api/matches/${mid}/progress`, { events: ev })).body.status, 'finished');
    }
  });
  it('the server resolves A2 = Goregaon Giants (name), the same as the app / core resolver', async () => {
    const now = await fixtureTeamsNow(h.db, tid);
    const slot = t.fixtures.find((f) => f.homeSeed === seedLabel('A', 2) || f.awaySeed === seedLabel('A', 2))!;
    const side = slot.homeSeed === 'A2' ? now.get(slot.id)!.home : now.get(slot.id)!.away;
    assert.equal(side, ids['Goregaon Giants']);
    // the app's view (core resolver with the tournament's names) agrees
    const appView = resolveFixtures({ format: 'groups', teams: t.teams, fixtures: t.fixtures }, []).fixtures;
    assert.ok(appView);
  });
  it('fixture_teams: starting that QF with Goregaon is accepted, with Thane (id-first) refused; the bracket shows Goregaon after it is played', async () => {
    const slot = t.fixtures.find((f) => f.homeSeed === 'A2' || f.awaySeed === 'A2')!;
    const now = (await fixtureTeamsNow(h.db, tid)).get(slot.id)!;
    const mk = async (home: string, away: string) => {
      const [hm, aw] = [await matchTeam(c, org, home), await matchTeam(c, org, away)];
      return buildMatch({ teamA: hm.mt, teamB: aw.mt, rules, createdBy: org.uid, scorerId: org.uid, startNow: true, tournamentId: tid, fixtureId: slot.id, captains: { A: hm.captainId, B: aw.captainId } });
    };
    const wrong = slot.homeSeed === 'A2' ? await mk(ids['Thane Titans'], now.away!) : await mk(now.home!, ids['Thane Titans']);
    const w = await as(org)('POST', '/api/matches', wrong);
    assert.deepEqual([w.status, w.body.error], [400, 'fixture_teams']);
    const right = await mk(now.home!, now.away!);
    const r = await as(org)('POST', '/api/matches', right);
    assert.equal(r.status, 201, JSON.stringify(r.body));
    const [hm, aw] = [right.teamA, right.teamB];
    const ev = playSets(rules, ['A', 'A'], { A: hm.players.map((p) => p.id), B: aw.players.map((p) => p.id) });
    assert.equal((await as(org)('PUT', `/api/matches/${r.body.id}/progress`, { events: ev })).body.status, 'finished');
    const after = (await fixtureTeamsNow(h.db, tid)).get(slot.id)!;
    assert.ok(after.home === ids['Goregaon Giants'] || after.away === ids['Goregaon Giants']);
  });
});

describe('V1427-2: group sizes like the app', () => {
  it('3 teams (groups of 2 and 1, top 1) -> 400 groups_too_few; a group of 2 with top 2 -> 400 groups_too_small', async () => {
    const users = makeUsers('g28', 6 * 6 + 1, 9360000000);
    for (const [i, u] of users.entries()) await registerUser(c, u, i);
    const org = users[36];
    const teams: string[] = [];
    for (let i = 0; i < 6; i++) teams.push(await makeTeam(c, `g28 Team ${i + 1}`, users.slice(i * 6, i * 6 + 6)));
    const post = (groups: string[][], advance: number) => c(org.uid, org.phone)('POST', '/api/tournaments', {
      name: 'Tiny Cup', organizerId: org.uid, rules, startDate: Date.now() + day, endDate: Date.now() + 2 * day, status: 'registration',
      location: { name: 'Ground', lat: 28.5, lng: 77.2 }, format: 'groups', advance,
      teams: groups.flatMap((g, gi) => g.map((id) => ({ id, name: id, color: '#E53935', group: groupId(gi) }))), fixtures: [],
    });
    const few = await post([[teams[0], teams[1]], [teams[2]]], 1);
    assert.deepEqual([few.status, few.body.error], [400, 'groups_too_few']);
    const small = await post([[teams[0], teams[1], teams[2], teams[3]], [teams[4], teams[5]]], 2);
    assert.deepEqual([small.status, small.body.error], [400, 'groups_too_small']);
    const ok = await post([[teams[0], teams[1], teams[2]], [teams[3], teams[4], teams[5]]], 2);
    assert.equal(ok.status, 201, JSON.stringify(ok.body));
  });
});

describe('V1427-3 (Info): 0024 down step', () => {
  it('refuses with a clear message while groups data exists (nothing changed); reverts cleanly once there is none; migrate re-applies', async () => {
    assert.ok((await groupsDataInUse(h.db)).length > 0); // the Mumbai Groups Cup above
    await assert.rejects(rollback0024(h.db), (e: Error & { code?: string }) => e.code === ROLLBACK_0024_REFUSED && /Refusing to roll back 0024_tournament_groups: groups data exists/.test(e.message));
    assert.ok(await h.db('schema_migrations').where({ version: '0024_tournament_groups.sql' }).first());
    // clear the groups data (test DB only), then the down step works and is re-runnable
    const gt = (await h.db('tournaments').where({ format: 'groups' }).select('id')).map((r: { id: string }) => r.id);
    await h.db('matches').whereIn('tournament_id', gt).update({ tournament_id: null, fixture_key: null });
    await h.db('tournaments').whereIn('id', gt).del();
    await h.db('tournaments').update({ advance: null });
    await h.db('tournament_teams').update({ group_key: null });
    await h.db('fixtures').update({ group_key: null, home_seed: null, away_seed: null });
    const r = await rollback0024(h.db);
    assert.equal(r.dropped.length, 5);
    assert.equal((await rollback0024(h.db)).dropped.length, 0); // re-runnable
    assert.deepEqual(await migrate(h.db), ['0024_tournament_groups.sql']); // roll forward
  });
});
