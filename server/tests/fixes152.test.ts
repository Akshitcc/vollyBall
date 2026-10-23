/**
 * 1.5.2 Tester "1.5.1 retest" F151-1: the team's CURRENT captain acts on a challenge (accept / decline / cancel); after a
 * captaincy transfer the former captain gets 403 and the new captain is allowed. LOCAL test database only.
 */
import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import { EVERYONE, SQUAD_A, SQUAD_B, makeTeam, newMatchBody, playersOf, register, startHarness, team, type Harness } from './helpers';

let h: Harness;
before(async () => (h = await startHarness()));
after(async () => h.close());
beforeEach(async () => { await h.reset(); await register(h, ...EVERYONE); });

const place = { name: 'Siri Fort', lat: 28.55, lng: 77.22 };
const rules = { preset: 'indoor', bestOf: 3, pointsPerSet: 25, decidingSetPoints: 15, winBy: 2, pointCap: null, timeoutsPerSet: 2, sideSwitchEvery: null, decidingSideSwitchEvery: 8, decidingSwitchAt: null };

async function challenge() {
  const a = await makeTeam(h, 'cap', SQUAD_A, 'QA Spikers');
  const b = await makeTeam(h, 'dan', SQUAD_B, 'Delhi Smashers');
  const r = await h.as('cap').post('/api/challenges').send({ fromTeamId: a, fromCaptainId: 'cap', toTeamId: b, toCaptainId: 'dan', when: Date.now() + 3_600_000, location: place, rules });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return { a, b, id: r.body.id as string };
}
const transfer = async (teamId: string, from: 'cap' | 'dan', to: string) => {
  const r = await h.as(from).patch(`/api/teams/${teamId}`).send({ captainId: to });
  assert.equal(r.status, 200, JSON.stringify(r.body));
};
const acceptBody = (a: string, b: string, id: string, by: string, capA = 'cap') => newMatchBody({
  teamA: team('QA Spikers', playersOf(SQUAD_A), a), teamB: team('Delhi Smashers', playersOf(SQUAD_B), b),
  createdBy: by, scorerId: by, captains: { A: capA, B: by }, challengeId: id, title: 'Challenge match',
});

describe('F151-1: the current captain acts on a challenge', () => {
  it('accept: former challenged captain 403, the new captain 201 (API)', async () => {
    const { a, b, id } = await challenge();
    await transfer(b, 'dan', 'b3');
    const old = await h.as('dan').post(`/api/challenges/${id}/accept`).send({ match: acceptBody(a, b, id, 'dan') });
    assert.equal(old.status, 403, JSON.stringify(old.body));
    assert.equal(old.body.error, 'challenge_not_captain');
    assert.equal(Number((await h.db('matches').where({ challenge_id: id }).count({ n: '*' }))[0].n), 0);
    const now = await h.as('b3').post(`/api/challenges/${id}/accept`).send({ match: acceptBody(a, b, id, 'b3') });
    assert.equal(now.status, 201, JSON.stringify(now.body));
    const row = await h.db('challenges').where({ id }).first();
    assert.equal(row.status, 'accepted');
    assert.equal(row.match_id, now.body.matchId);
    assert.equal(row.to_captain_id, 'b3'); // the row records who answered
  });

  it('decline: former captain 403, new captain 200', async () => {
    const { b, id } = await challenge();
    await transfer(b, 'dan', 'b4');
    const old = await h.as('dan').patch(`/api/challenges/${id}`).send({ status: 'declined' });
    assert.equal(old.status, 403);
    assert.equal((await h.db('challenges').where({ id }).first()).status, 'pending');
    const now = await h.as('b4').patch(`/api/challenges/${id}`).send({ status: 'declined' });
    assert.equal(now.status, 200, JSON.stringify(now.body));
    assert.equal((await h.db('challenges').where({ id }).first()).status, 'declined');
  });

  it('cancel: former challenger captain 403, new challenger captain 200', async () => {
    const { a, id } = await challenge();
    await transfer(a, 'cap', 'bob');
    const old = await h.as('cap').patch(`/api/challenges/${id}`).send({ status: 'cancelled' });
    assert.equal(old.status, 403);
    const now = await h.as('bob').patch(`/api/challenges/${id}`).send({ status: 'cancelled' });
    assert.equal(now.status, 200, JSON.stringify(now.body));
    assert.equal((await h.db('challenges').where({ id }).first()).status, 'cancelled');
  });

  it('the challenge lists show the current captains (the new captain sees Accept / Decline)', async () => {
    const { b, id } = await challenge();
    await transfer(b, 'dan', 'b3');
    const r = await h.as('b3').get('/api/challenges').query({ teams: b });
    assert.equal(r.status, 200);
    const c = (r.body as { id: string; toCaptainId: string; fromCaptainId: string }[]).find((x) => x.id === id)!;
    assert.equal(c.toCaptainId, 'b3');
    assert.equal(c.fromCaptainId, 'cap');
  });

  it('a former captain cannot claim the challenge through POST /matches either; the new captain gets challenge_pending', async () => {
    const { a, b, id } = await challenge();
    await transfer(b, 'dan', 'b3');
    const old = await h.as('dan').post('/api/matches').send(acceptBody(a, b, id, 'dan'));
    assert.equal(old.status, 403, JSON.stringify(old.body));
    const now = await h.as('b3').post('/api/matches').send(acceptBody(a, b, id, 'b3'));
    assert.equal(now.status, 409, JSON.stringify(now.body));
    assert.equal(now.body.error, 'challenge_pending');
  });
});
