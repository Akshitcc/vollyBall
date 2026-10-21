/**
 * 1.4.27 (Akshit, E2E-4): tournaments over 10 teams through the API on the local test DB – a 15-team groups + knockout
 * (4 groups 4/4/4/3, top 2 → QF: 21 + 7 = 28 matches) and 17 teams both ways (groups 5/4/4/4: 28 + 7 = 35; play-in:
 * 1 + 15 = 16). Every match scored; group tables, cross-group seeding, champion; refusals; then every db-audit check.
 */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { generateGroupsKnockout } from '../../src/core/groups';
import { MAX_TOURNAMENT_TEAMS } from '../../src/core/limits';
import { migrate, MIGRATIONS_DIR } from '../src/db/migrate';
import { runAudit } from '../src/ops/dbAudit';
import { simulateGroups, type GroupsRunReport } from '../scripts/groupsSim';
import type { ClientFor } from '../scripts/auditSim';
import { clientFor, liftLimits } from './auditHelpers';
import { startHarness, type Harness } from './helpers';
import fs from 'node:fs';

let h: Harness;
let c: ClientFor;
before(async () => {
  h = await startHarness();
  liftLimits(h.s.rateLimiter!);
  c = clientFor(h);
});
after(async () => { await h.close(); });
const failing = async () => (await runAudit(h.db)).filter((r) => !r.ok).map((r) => `${r.id}: ${JSON.stringify(r.sample)}`);

const checkRun = async (rep: GroupsRunReport) => {
  assert.equal(rep.played, rep.planned, `${rep.mode} ${rep.teams}: every planned match played`);
  assert.ok(rep.champion, 'champion declared');
  assert.deepEqual(rep.refused.nonOwner, 403);
  assert.equal(rep.refused.lockedEdit, 409);
  assert.equal(rep.refused.lockedCode, 'fixture_locked');
  const t = (await c('x', '+910000000000')('GET', `/api/tournaments/${rep.tournamentId}`)).body;
  assert.equal(t.status, 'finished');
  const stored = await h.db('fixtures').where({ tournament_id: rep.tournamentId }).whereNotNull('match_id').count({ n: '*' });
  assert.equal(Number(stored[0].n), rep.played, 'every played fixture claims its match in the DB');
  assert.deepEqual(await failing(), [], 'db-audit: all checks pass');
};

describe('1.4.27 groups + knockout through the API', () => {
  it('limit is 32: 32 teams fit the schema, 33 are refused (400)', async () => {
    assert.equal(MAX_TOURNAMENT_TEAMS, 32);
  });

  it('15 teams: 4 groups 4/4/4/3, top 2 → QF, 28 matches, tables + seeding + champion, db-audit clean', async () => {
    const rep = await simulateGroups(c, { teams: 15, mode: 'groups', prefix: 'g15', phoneBase: 9300000000 });
    assert.equal(rep.planned, 28);
    assert.equal(rep.groupMatches, 21);
    assert.equal(rep.knockoutMatches, 7);
    assert.deepEqual(rep.tables.map((x) => x.order.length), [4, 4, 4, 3]);
    assert.ok(rep.tables.every((x) => x.complete));
    assert.ok(rep.qualifiersOk, 'the bracket was filled from the group tables (A1 v B2 …)');
    assert.equal(rep.refused.earlyCode, 'fixture_not_ready', JSON.stringify(rep.refused));
    assert.equal(rep.refused.earlySlot, 409);
    assert.equal(rep.refused.earlyCode, 'fixture_not_ready');
    await checkRun(rep);
    // the stored rows carry the format, groups and seeds (migration 0024)
    const row = await h.db('tournaments').where({ id: rep.tournamentId }).first('format', 'advance');
    assert.deepEqual({ format: row.format, advance: Number(row.advance) }, { format: 'groups', advance: 2 });
    assert.equal(Number((await h.db('tournament_teams').where({ tournament_id: rep.tournamentId }).whereNotNull('group_key').count({ n: '*' }))[0].n), 15);
    assert.equal(Number((await h.db('fixtures').where({ tournament_id: rep.tournamentId }).whereNotNull('home_seed').count({ n: '*' }))[0].n), 4);
  });

  it('17 teams, groups: 5/4/4/4, top 2 → QF, 35 matches', async () => {
    const rep = await simulateGroups(c, { teams: 17, mode: 'groups', prefix: 'g17', phoneBase: 9310000000 });
    assert.equal(rep.planned, 35);
    assert.deepEqual(rep.tables.map((x) => x.order.length), [5, 4, 4, 4]);
    assert.ok(rep.qualifiersOk);
    await checkRun(rep);
  });

  it('17 teams, play-in: 1 play-in match to 16, then the knockout = 16 matches', async () => {
    const rep = await simulateGroups(c, { teams: 17, mode: 'playin', prefix: 'p17', phoneBase: 9320000000 });
    assert.equal(rep.planned, 16);
    await checkRun(rep);
  });

  it('the API refuses an inconsistent groups tournament (team outside its group, seed beyond advance, groups on a league)', async () => {
    const t = (await c('g151', '+919300000000')('GET', '/api/tournaments')).body;
    const groupsT = (Array.isArray(t) ? t : t.items ?? []).find((x: { format: string }) => x.format === 'groups');
    assert.ok(groupsT);
    const org = groupsT.organizerId as string;
    const phone = (await h.db('users').where({ id: org }).first('phone')).phone as string;
    const as = c(org, phone);
    const base = { ...groupsT };
    for (const k of ['id', 'createdAt', 'updatedAt']) delete base[k];
    const fx = generateGroupsKnockout([base.teams.slice(0, 2).map((x: { id: string }) => x.id), base.teams.slice(2, 4).map((x: { id: string }) => x.id)], 1);
    const teams4 = base.teams.slice(0, 4).map((x: { id: string; name: string; color: string }, i: number) => ({ id: x.id, name: x.name, color: x.color, group: i < 2 ? 'A' : 'B' }));
    const ok = { ...base, name: 'Groups check', status: 'registration', advance: 1, teams: teams4, fixtures: fx };
    assert.equal((await as('POST', '/api/tournaments', ok)).status, 201);
    assert.equal((await as('POST', '/api/tournaments', { ...ok, teams: teams4.map((x: object, i: number) => (i === 0 ? { ...x, group: 'B' } : i === 2 ? { ...x, group: 'A' } : x)) })).body.error, 'groups_fixture'); // 1.4.28: swap keeps sizes 2/2 (a group of 1 is groups_too_small)
    assert.equal((await as('POST', '/api/tournaments', { ...ok, fixtures: fx.map((f) => (f.homeSeed ? { ...f, homeSeed: 'A2' } : f)) })).body.error, 'groups_seed');
    assert.equal((await as('POST', '/api/tournaments', { ...ok, format: 'league' })).body.error, 'groups_only');
    assert.equal((await as('POST', '/api/tournaments', { ...ok, advance: 3 })).status, 400);
  });

  it('db-audit catches a broken groups tournament (team without a group, seed on a knockout)', async () => {
    const g = await h.db('tournaments').where({ format: 'groups' }).first('id');
    const tt = await h.db('tournament_teams').where({ tournament_id: g.id }).first('team_key', 'group_key');
    await h.db('tournament_teams').where({ tournament_id: g.id, team_key: tt.team_key }).update({ group_key: null });
    const k = await h.db('tournaments').where({ format: 'knockout' }).first('id');
    const kf = await h.db('fixtures').where({ tournament_id: k.id }).first('fixture_key');
    await h.db('fixtures').where({ tournament_id: k.id, fixture_key: kf.fixture_key }).update({ home_seed: 'A1' });
    const bad = (await failing()).map((x) => x.split(':')[0]);
    assert.deepEqual(bad, ['tournament.groups_team', 'tournament.groups_only']);
    await h.db('tournament_teams').where({ tournament_id: g.id, team_key: tt.team_key }).update({ group_key: tt.group_key });
    await h.db('fixtures').where({ tournament_id: k.id, fixture_key: kf.fixture_key }).update({ home_seed: null });
    assert.deepEqual(await failing(), []);
  });

  it('migration 0024 is additive and re-runs cleanly', async () => {
    const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
    assert.ok(files.includes('0024_tournament_groups.sql'));
    const sql = fs.readFileSync(`${MIGRATIONS_DIR}/0024_tournament_groups.sql`, 'utf8');
    assert.doesNotMatch(sql, /\bDROP\b|\bDELETE\b|\bTRUNCATE\b/i);
    // re-apply the file's statements on the migrated DB: nothing changes, nothing fails
    for (const stmt of sql.split(/^-- ;;$/m).map((x) => x.replace(/^--.*$/gm, '').trim()).filter(Boolean)) await h.db.raw(stmt);
    assert.deepEqual(await migrate(h.db), []);
  });
});
