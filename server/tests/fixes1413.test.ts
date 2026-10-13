/**
 * 1.4.13 server: V1412-1 (High) – on a captain-mix match (team B's captain is a team-A player) that captain can't
 * confirm or dispute, whichever team won; the admin's captain repair still works (no 409), then the new captain confirms.
 */
import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import { ADMIN, EVERYONE, createMatch, pt, register, startHarness, type Harness } from './helpers';

let h: Harness;
before(async () => (h = await startHarness()));
after(async () => h.close());
beforeEach(async () => {
  await h.reset();
  await register(h, ...EVERYONE);
});

describe('V1412-1 (API): captain mix – the confirm follows the side the captain plays for', () => {
  async function capmix(winner: 'A' | 'B') {
    const id = await createMatch(h, { title: 'V1412', location: null });
    assert.equal((await h.as('cap').put(`/api/matches/${id}/progress`).send({ events: Array.from({ length: 5 }, (_, i) => pt(winner, 1000 + i)) })).status, 200);
    await h.db('matches').where({ id }).update({ status: 'finished', player_of_match_id: winner === 'A' ? 'bob' : 'dan', was_won: 1, finished_at: new Date(), captain_b: 'bob' }); // older data
    return id;
  }
  for (const w of ['A', 'B'] as const) {
    it(`team ${w} won: bob (captain B, plays for A) gets not_captain for confirm and dispute; nothing is stored`, async () => {
      const id = await capmix(w);
      const c = await h.as('bob').post(`/api/matches/${id}/confirm`).send({});
      assert.equal(c.body.error, 'not_captain', JSON.stringify(c.body));
      const d = await h.as('bob').post(`/api/matches/${id}/confirm`).send({ decision: 'reject', reason: 'wrong score' });
      assert.equal(d.body.error, 'not_captain', JSON.stringify(d.body));
      const row = await h.db('matches').where({ id }).first('verification_status', 'captain_verdict');
      assert.deepEqual([row.verification_status ?? 'pending', row.captain_verdict ?? null], ['pending', null]);
    });
  }
  it('the repair still works (200, not 409); then dan confirms and bob is still refused', async () => {
    const id = await capmix('A');
    const r = await h.as(ADMIN).post(`/api/admin/matches/${id}/repair-verdict`).send({ captain: { side: 'B', id: 'dan' } });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal((await h.as('bob').post(`/api/matches/${id}/confirm`).send({})).body.error, 'not_captain');
    assert.equal((await h.as('dan').post(`/api/matches/${id}/confirm`).send({})).status, 200);
  });
});
