/**
 * 1.4.19: tournament admin permissions (src/core/tournamentAdmin.ts) – the owner (organizer_id) alone edits every
 * part of a tournament and deletes it; everyone else, the app admin included, gets 403 not_tournament_admin. Only the
 * owner links a match to the tournament; a match's link is fixed. Scoring inside the tournament is unchanged.
 */
import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import { ADMIN, EVERYONE, SQUAD_A, SQUAD_B, createMatch, makeTeam, newMatchBody, pt, register, startHarness, type Harness } from './helpers';

let h: Harness;
before(async () => (h = await startHarness()));
after(async () => h.close());
let t1 = '';
let t2 = '';
beforeEach(async () => {
  await h.reset();
  await register(h, ...EVERYONE);
  t1 = await makeTeam(h, 'cap', SQUAD_A, 'QA Spikers');
  t2 = await makeTeam(h, 'dan', SQUAD_B, 'Delhi Smashers');
});
const place = { name: 'Siri Fort', lat: 28.55, lng: 77.22 };
const rules = { preset: 'indoor', bestOf: 3, pointsPerSet: 25, decidingSetPoints: 15, winBy: 2, pointCap: null, timeoutsPerSet: 2, sideSwitchEvery: null, decidingSideSwitchEvery: 8, decidingSwitchAt: null };
const body = () => ({
  name: 'Delhi Open', organizerId: 'cap', format: 'knockout', rules, startDate: Date.now(), endDate: Date.now() + 86400000, location: place, status: 'registration',
  teams: [{ id: t1, name: 'One', color: '#111111' }, { id: t2, name: 'Two', color: '#222222' }],
  fixtures: [{ id: 'f1', round: 1, index: 0, homeId: t1, awayId: t2 }],
});
const create = async () => {
  const r = await h.as('cap').post('/api/tournaments').send(body());
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body.id as string;
};
const EDITS: [string, () => Record<string, unknown>][] = [
  ['name', () => ({ name: 'Delhi Open 2' })],
  ['rules', () => ({ rules: { ...rules, bestOf: 5 } })],
  ['dates', () => ({ startDate: Date.now() + 86400000, endDate: Date.now() + 2 * 86400000 })],
  ['venue', () => ({ location: { name: 'Talkatora', lat: 28.6, lng: 77.2 } })],
  ['teams / roster', () => ({ teams: [{ id: t1, name: 'One FC', color: '#111111' }, { id: t2, name: 'Two', color: '#333333' }] })],
  ['fixtures / bracket', () => ({ fixtures: [{ id: 'f1', round: 1, index: 0, homeId: t2, awayId: t1 }] })],
  ['format (league groups)', () => ({ format: 'league' })],
  ['status', () => ({ status: 'running' })],
];

describe('1.4.19 tournament admin permissions', () => {
  for (const [name, patch] of EDITS) {
    it(`edit ${name}: player, stranger, app admin → 403 not_tournament_admin; owner → 200`, async () => {
      const id = await create();
      for (const who of ['dan', 'eve', ADMIN] as const) {
        const r = await h.as(who).patch(`/api/tournaments/${id}`).send(patch());
        assert.equal(r.status, 403, `${name} as ${typeof who === 'string' ? who : who.uid}`);
        assert.equal(r.body.error, 'not_tournament_admin');
      }
      const ok = await h.as('cap').patch(`/api/tournaments/${id}`).send(patch());
      assert.equal(ok.status, 200, JSON.stringify(ok.body));
    });
  }
  it('no hand-over: organizerId change → 403 not_tournament_admin (owner too)', async () => {
    const id = await create();
    for (const who of ['cap', 'dan'] as const) {
      const r = await h.as(who).patch(`/api/tournaments/${id}`).send({ organizerId: 'dan' });
      assert.equal(r.status, 403);
      assert.equal(r.body.error, 'not_tournament_admin');
    }
  });
  it('delete: owner only; everyone may still read', async () => {
    const id = await create();
    for (const who of ['dan', 'eve', ADMIN] as const) {
      assert.equal((await h.as(who).get(`/api/tournaments/${id}`)).status, 200);
      const r = await h.as(who).del(`/api/tournaments/${id}`);
      assert.equal(r.status, 403);
      assert.equal(r.body.error, 'not_tournament_admin');
    }
    assert.equal((await h.as('cap').del(`/api/tournaments/${id}`)).status, 204);
    assert.equal((await h.as('eve').get(`/api/tournaments/${id}`)).status, 404);
  });
  it('match link: owner only at create; fixed afterwards; scoring unchanged', async () => {
    const id = await create();
    const dan = await h.as('dan').post('/api/matches').send(newMatchBody({ createdBy: 'dan', scorerId: 'dan', tournamentId: id, fixtureId: 'f1' }));
    assert.equal(dan.status, 403, JSON.stringify(dan.body));
    assert.equal(dan.body.error, 'not_tournament_admin');
    const orphan = await h.as('cap').post('/api/matches').send(newMatchBody({ fixtureId: 'f1' }));
    assert.equal(orphan.body.error, 'not_tournament_admin');
    const m = await createMatch(h, { tournamentId: id, fixtureId: 'f1' });
    const re = await h.as('cap').patch(`/api/matches/${m}`).send({ fixtureId: 'f2' });
    assert.equal(re.status, 403);
    assert.equal(re.body.error, 'not_tournament_admin');
    const free = await createMatch(h);
    assert.equal((await h.as('cap').patch(`/api/matches/${free}`).send({ tournamentId: id })).body.error, 'not_tournament_admin');
    // the scorer still scores the tournament match
    const s = await h.as('cap').patch(`/api/matches/${m}`).send({ events: [pt('A', Date.now(), SQUAD_A[1], 'kill')] });
    assert.equal(s.status, 200, JSON.stringify(s.body));
  });
});
