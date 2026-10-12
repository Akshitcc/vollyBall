/**
 * 1.4.8 API (QA V147-1 / V147-2): the verdict invariant at create and on roster edits (400 match_no_verdict), and the
 * admin repair of a match nobody can confirm (POST /api/admin/matches/:id/repair-verdict, audited in verdict_repair).
 */
import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import { ADMIN, EVERYONE, createMatch, newMatchBody, playersOf, pt, register, startHarness, team, type Harness } from './helpers';

let h: Harness;
before(async () => (h = await startHarness()));
after(async () => h.close());
beforeEach(async () => {
  await h.reset();
  await register(h, ...EVERYONE);
});
const SQUAD_A = ['cap', 'bob', 'a3', 'a4', 'a5', 'a6'];
const SQUAD_B = ['aarav', 'dan', 'b3', 'b4', 'b5', 'b6'];
const get = async (id: string) => (await h.as('cap').get(`/api/matches/${id}`)).body;

describe('V147-1 (API): someone can always confirm', () => {
  it('create with the scorer on the other team: 400 match_no_verdict; nothing stored', async () => {
    const r = await h.as('cap').post('/api/matches').send(newMatchBody({ scorerId: 'dan' }));
    assert.deepEqual([r.status, r.body.error], [400, 'match_no_verdict']);
    assert.equal((await h.db('matches').count({ n: '*' }))[0].n, 0);
  });
  it('a roster edit that moves the scorer to team B (the creator stays on A): 400; the match is unchanged', async () => {
    const id = await createMatch(h, { scorerId: 'bob', status: 'scheduled', startedAt: null, scheduledAt: Date.now() + 86_400_000 });
    const a = SQUAD_A.filter((x) => x !== 'bob').concat('b6');
    const b = SQUAD_B.filter((x) => x !== 'b6').concat('bob');
    const r = await h.as('bob').patch(`/api/matches/${id}`).send({ teamA: team('QA Spikers', playersOf(a)), teamB: team('Delhi Smashers', playersOf(b)), participantIds: [...a, ...b] });
    assert.deepEqual([r.status, r.body.error], [400, 'match_no_verdict']);
    assert.ok((await get(id)).teamA.players.some((p: { id: string }) => p.id === 'bob'));
  });
  it('a roster edit that keeps a confirmer is accepted', async () => {
    const id = await createMatch(h, { status: 'scheduled', startedAt: null, scheduledAt: Date.now() + 86_400_000 });
    const r = await h.as('cap').patch(`/api/matches/${id}`).send({ captains: { A: 'cap', B: 'dan' } });
    assert.equal(r.status, 200, JSON.stringify(r.body));
  });
});

describe('V147-2 (API): admin repair', () => {
  async function brokenFinished() {
    const id = await createMatch(h, { title: 'V147', location: null });
    assert.equal((await h.as('cap').put(`/api/matches/${id}/progress`).send({ events: Array.from({ length: 5 }, (_, i) => pt('A', 1000 + i)) })).status, 200);
    await h.db('matches').where({ id }).update({ status: 'finished', player_of_match_id: 'bob', was_won: 1, finished_at: new Date(), scorer_id: 'dan' }); // older data
    return id;
  }
  it('listed for the admin; non-admin 403; invalid 400; valid 200 with the audit record; then not needed (409)', async () => {
    const id = await brokenFinished();
    const flagged = (await h.as(ADMIN).get('/api/admin/matches/flagged')).body as { id: string }[];
    assert.ok(flagged.some((m) => m.id === id));
    const url = `/api/admin/matches/${id}/repair-verdict`;
    assert.equal((await h.as('aarav').post(url).send({ scorerId: 'cap' })).status, 403);
    let r = await h.as(ADMIN).post(url).send({ scorerId: 'b3' });
    assert.deepEqual([r.status, r.body.error], [400, 'repair_invalid']);
    r = await h.as(ADMIN).post(url).send({ captain: { side: 'B', id: 'cap' } });
    assert.deepEqual([r.status, r.body.error], [400, 'repair_invalid']);
    r = await h.as(ADMIN).post(url).send({ scorerId: 'cap', extra: 1 });
    assert.equal(r.status, 400);
    r = await h.as(ADMIN).post(url).send({ scorerId: 'cap' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.scorerId, 'cap');
    const row = await h.db('matches').where({ id }).first('verdict_repair', 'scorer_id');
    const rec = typeof row.verdict_repair === 'string' ? JSON.parse(row.verdict_repair) : row.verdict_repair;
    assert.deepEqual({ ...rec, at: typeof rec.at }, { by: (ADMIN as unknown as { uid: string }).uid ?? ADMIN, at: 'number', kind: 'scorer', to: 'cap', side: null, prevScorer: 'dan', prevFrom: null, prevCaptainA: 'cap', prevCaptainB: 'aarav' });
    assert.equal(row.scorer_id, 'cap');
    r = await h.as(ADMIN).post(url).send({ scorerId: 'bob' });
    assert.deepEqual([r.status, r.body.error], [409, 'repair_not_needed']);
    // the opposing captain can now confirm
    assert.equal((await h.as('aarav').post(`/api/matches/${id}/confirm`).send({})).status, 200);
  });
  it('a working match: 409 repair_not_needed; existing rows are not touched by the migration', async () => {
    const id = await createMatch(h);
    const r = await h.as(ADMIN).post(`/api/admin/matches/${id}/repair-verdict`).send({ scorerId: 'bob' });
    assert.deepEqual([r.status, r.body.error], [409, 'repair_not_needed']);
    assert.equal((await h.db('matches').where({ id }).first('verdict_repair')).verdict_repair, null);
  });
});
