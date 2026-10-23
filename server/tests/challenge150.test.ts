/**
 * 1.5.0 Tester's full E2E 1.4.28 – F1428-1 (accepting a challenge always failed with match_no_verdict) and F1428-2
 * (the challenge ↔ match link was not checked); 1.5.1 F150-1 (only the challenged captain's Accept creates / links the
 * match: POST /challenges/:id/accept, atomically). LOCAL test database only.
 */
import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import { runAudit } from '../src/ops/dbAudit';
import { EVERYONE, SQUAD_A, SQUAD_B, makeTeam, newMatchBody, playersOf, register, startHarness, team, type Harness } from './helpers';

let h: Harness;
before(async () => (h = await startHarness()));
after(async () => h.close());
beforeEach(async () => { await h.reset(); await register(h, ...EVERYONE); });

const place = { name: 'Siri Fort', lat: 28.55, lng: 77.22 };
const rules = { preset: 'indoor', bestOf: 3, pointsPerSet: 25, decidingSetPoints: 15, winBy: 2, pointCap: null, timeoutsPerSet: 2, sideSwitchEvery: null, decidingSideSwitchEvery: 8, decidingSwitchAt: null };

/** Captain cap (QA Spikers, 6) challenges captain dan (Delhi Smashers, 6). */
async function challenge() {
  const a = await makeTeam(h, 'cap', SQUAD_A, 'QA Spikers');
  const b = await makeTeam(h, 'dan', SQUAD_B, 'Delhi Smashers');
  const r = await h.as('cap').post('/api/challenges').send({ fromTeamId: a, fromCaptainId: 'cap', toTeamId: b, toCaptainId: 'dan', when: Date.now() + 3_600_000, location: place, rules });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return { a, b, id: r.body.id as string };
}
/** The match the app builds on Accept (services/matchFactory.acceptChallenge): challenged captain creates AND scores. */
const acceptBody = (a: string, b: string, challengeId: string, over: Record<string, unknown> = {}) => newMatchBody({
  teamA: team('QA Spikers', playersOf(SQUAD_A), a), teamB: team('Delhi Smashers', playersOf(SQUAD_B), b),
  createdBy: 'dan', scorerId: 'dan', captains: { A: 'cap', B: 'dan' }, challengeId, title: 'Challenge match', ...over,
});

const accept = (who: 'cap' | 'dan' | 'bob', id: string, match: Record<string, unknown>) => h.as(who).post(`/api/challenges/${id}/accept`).send({ match });
const status = async (id: string) => (await h.db('challenges').where({ id }).first()) as { status: string; match_id: string | null };
const linked = async (id: string) => Number((await h.db('matches').where({ challenge_id: id }).count({ n: '*' }))[0].n);

describe('F1428-1: a challenge can be accepted (API)', () => {
  it('captain B accepts: a playable match, the challenger confirms, the challenge is accepted', async () => {
    const { a, b, id } = await challenge();
    // the 1.4.28 body (challenger as scorer) is the bug: nobody could confirm
    const old = await accept('dan', id, acceptBody(a, b, id, { scorerId: 'cap' }));
    assert.equal(old.status, 400);
    assert.equal(old.body.error, 'match_no_verdict');
    assert.equal((await status(id)).status, 'pending');
    const m = await accept('dan', id, acceptBody(a, b, id));
    assert.equal(m.status, 201, JSON.stringify(m.body));
    const c = await status(id);
    assert.equal(c.status, 'accepted');
    assert.equal(c.match_id, m.body.matchId);
    const match = (await h.as('dan').get(`/api/matches/${m.body.matchId}`)).body;
    assert.equal(match.scorerId, 'dan');
    assert.equal(match.challengeId, id);
    // playable: the scorer scores a rally
    const pt = await h.as('dan').patch(`/api/matches/${m.body.matchId}`).send({ events: [{ type: 'point', side: 'A', at: Date.now() }] });
    assert.equal(pt.status, 200, JSON.stringify(pt.body));
  });
});

describe('F150-1: only the challenged captain\'s Accept creates the match (API)', () => {
  it('Tester repro: the challenger pre-creating the match of a pending challenge → 409 challenge_pending; B then accepts; no declined link', async () => {
    const { a, b, id } = await challenge();
    const pre = await h.as('cap').post('/api/matches').send(acceptBody(a, b, id, { createdBy: 'cap', scorerId: 'cap' }));
    assert.equal(pre.status, 409);
    assert.equal(pre.body.error, 'challenge_pending');
    // the challenged captain can't use a plain create either (the old 1.5.0 two-step flow)
    assert.equal((await h.as('dan').post('/api/matches').send(acceptBody(a, b, id))).body.error, 'challenge_pending');
    assert.equal(await linked(id), 0);
    // the challenger can't accept their own challenge
    const self = await accept('cap', id, acceptBody(a, b, id, { createdBy: 'cap', scorerId: 'cap' }));
    assert.equal(self.status, 403);
    assert.equal(self.body.error, 'challenge_not_captain');
    // an accept without its match (PATCH) is refused, and a PATCH never links a match
    assert.equal((await h.as('dan').patch(`/api/challenges/${id}`).send({ status: 'accepted' })).body.error, 'challenge_accept_match');
    assert.equal((await status(id)).status, 'pending');
    const ok = await accept('dan', id, acceptBody(a, b, id));
    assert.equal(ok.status, 201, JSON.stringify(ok.body));
    assert.deepEqual(await status(id), { ...(await status(id)), status: 'accepted', match_id: ok.body.matchId });
    // accepted: no decline / cancel any more, no second accept, no second match
    assert.equal((await h.as('dan').patch(`/api/challenges/${id}`).send({ status: 'declined' })).status, 403);
    assert.equal((await h.as('cap').patch(`/api/challenges/${id}`).send({ status: 'cancelled' })).status, 403);
    assert.equal((await accept('dan', id, acceptBody(a, b, id))).body.error, 'challenge_used');
    assert.equal((await h.as('cap').post('/api/matches').send(acceptBody(a, b, id, { createdBy: 'cap', scorerId: 'cap' }))).body.error, 'challenge_used');
    assert.equal(await linked(id), 1);
  });
  it('a decline leaves no match, and a declined / cancelled challenge can\'t be accepted or claimed', async () => {
    const { a, b, id } = await challenge();
    assert.equal((await h.as('dan').patch(`/api/challenges/${id}`).send({ status: 'declined' })).status, 200);
    assert.equal((await accept('dan', id, acceptBody(a, b, id))).body.error, 'challenge_closed');
    assert.equal((await h.as('dan').post('/api/matches').send(acceptBody(a, b, id))).body.error, 'challenge_closed');
    assert.equal(await linked(id), 0);
    const c2 = await h.as('cap').post('/api/challenges').send({ fromTeamId: a, fromCaptainId: 'cap', toTeamId: b, toCaptainId: 'dan', when: Date.now() + 7_200_000, location: place, rules });
    assert.equal((await h.as('cap').patch(`/api/challenges/${c2.body.id}`).send({ status: 'cancelled' })).status, 200);
    assert.equal((await accept('dan', c2.body.id, acceptBody(a, b, c2.body.id))).body.error, 'challenge_closed');
    assert.equal(await linked(c2.body.id), 0);
    // DB audit: no match linked to a challenge that isn't accepted
    assert.equal((await runAudit(h.db)).find((r) => r.id === 'challenge.match_accepted')!.ok, true);
  });
  it('parallel accepts (double tap) → one match; a retried accept with the same Idempotency-Key returns it', async () => {
    const { a, b, id } = await challenge();
    const rs = await Promise.all([0, 1, 2, 3].map(() => accept('dan', id, acceptBody(a, b, id))));
    assert.deepEqual(rs.map((r) => r.status).sort(), [201, 409, 409, 409]);
    assert.equal(await linked(id), 1);
    const { a: a2, b: b2, id: id2 } = { a, b, id: (await h.as('cap').post('/api/challenges').send({ fromTeamId: a, fromCaptainId: 'cap', toTeamId: b, toCaptainId: 'dan', when: Date.now() + 7_200_000, location: place, rules })).body.id as string };
    const k = { 'Idempotency-Key': 'acc-key-0001' };
    const r1 = await h.as('dan').post(`/api/challenges/${id2}/accept`).set(k).send({ match: acceptBody(a2, b2, id2) });
    const r2 = await h.as('dan').post(`/api/challenges/${id2}/accept`).set(k).send({ match: acceptBody(a2, b2, id2) });
    assert.equal(r1.status, 201);
    assert.equal(r2.body.matchId, r1.body.matchId);
    assert.equal(await linked(id2), 1);
  });
});

describe('F1428-2: the challenge ↔ match link is checked (API)', () => {
  it('(a) linking an unrelated match id → 400 challenge_match_invalid; the challenge stays pending', async () => {
    const { id } = await challenge();
    const stranger = await h.as('eve').post('/api/matches').send(newMatchBody({
      teamA: team('Pickup A', playersOf(['eve', 'a3', 'a4', 'a5', 'a6', 'bob'])), teamB: team('Pickup B', playersOf(['b3', 'b4', 'b5', 'b6', 'aarav', 'dan'])),
      createdBy: 'eve', scorerId: 'eve', participantIds: ['eve', 'a3', 'a4', 'a5', 'a6', 'bob', 'b3', 'b4', 'b5', 'b6', 'aarav', 'dan'], captains: { A: 'eve', B: 'aarav' },
    }));
    assert.equal(stranger.status, 201, JSON.stringify(stranger.body));
    const r = await h.as('dan').patch(`/api/challenges/${id}`).send({ status: 'accepted', matchId: stranger.body.id });
    assert.equal(r.status, 400);
    assert.equal(r.body.error, 'challenge_match_invalid');
    assert.deepEqual([(await status(id)).status, (await status(id)).match_id], ['pending', null]);
    // a decline never carries a match
    assert.equal((await h.as('dan').patch(`/api/challenges/${id}`).send({ status: 'declined', matchId: stranger.body.id })).body.error, 'challenge_match_invalid');
  });
  it('(b) someone who captains neither team cannot claim a (declined) challenge → 403 challenge_not_captain', async () => {
    const { a, b, id } = await challenge();
    assert.equal((await h.as('dan').patch(`/api/challenges/${id}`).send({ status: 'declined' })).status, 200);
    // bob plays for QA Spikers but is not a captain
    const r = await h.as('bob').post('/api/matches').send(acceptBody(a, b, id, { createdBy: 'bob', scorerId: 'bob', captains: { A: 'cap', B: 'dan' } }));
    assert.equal(r.status, 403);
    assert.equal(r.body.error, 'challenge_not_captain');
    assert.equal((await accept('bob', id, acceptBody(a, b, id, { createdBy: 'bob', scorerId: 'bob' }))).body.error, 'challenge_not_captain');
    assert.equal(await linked(id), 0);
  });
  it('wrong teams, an unknown id, another challenge id in the body and moving the link are refused', async () => {
    const { a, b, id } = await challenge();
    const wrong = await accept('dan', id, acceptBody(a, b, id, { teamA: team('QA Spikers', playersOf(SQUAD_A)) }));
    assert.equal(wrong.status, 400);
    assert.equal(wrong.body.error, 'challenge_teams');
    assert.equal((await accept('dan', 'no-such-challenge', acceptBody(a, b, 'no-such-challenge'))).body.error, 'challenge_unknown');
    assert.equal((await h.as('dan').post('/api/matches').send(acceptBody(a, b, 'no-such-challenge'))).body.error, 'challenge_unknown');
    assert.equal((await accept('dan', id, acceptBody(a, b, 'other-id'))).body.error, 'challenge_match_invalid');
    const m = await accept('dan', id, acceptBody(a, b, id));
    assert.equal(m.status, 201);
    const move = await h.as('dan').patch(`/api/matches/${m.body.matchId}`).send({ challengeId: null });
    assert.equal(move.status, 400);
    assert.equal(move.body.error, 'challenge_link_frozen');
  });
});
