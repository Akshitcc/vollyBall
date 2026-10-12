/**
 * 1.4.7 API (QA V146): V146-2 (the scorer is never on the verdict captain's team: an admin reassigns only to the
 * scorer's own side or a neutral admin; the handoff-admin list matches), V146-3 (before the first rally the creator
 * can't hand scoring to the opposing captain or their team) and V146-5 (a match with wasWon is reinstated to finished
 * only, never to live). V146-1 (delete vs save) is in concurrency147.test.ts.
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

const side = (s: 'A' | 'B', n: number, t0 = 1000) => Array.from({ length: n }, (_, i) => pt(s, t0 + i));
const get = async (id: string) => (await h.as('cap').get(`/api/matches/${id}`)).body;
async function liveWith(n: number, s: 'A' | 'B' = 'B') {
  const id = await createMatch(h, { title: 'V146', location: null });
  if (n) assert.equal((await h.as('cap').put(`/api/matches/${id}/progress`).send({ events: side(s, n) })).status, 200);
  return id;
}
const SQUAD_B = ['aarav', 'dan', 'b3', 'b4', 'b5', 'b6'];
const SQUAD_A = ['bob', 'a3', 'a4', 'a5', 'a6'];

describe('V146-2: never to the verdict captain\'s team', () => {
  it('admin reassign: every B player refused (403 reassign_verdict_captain), every A player allowed', async () => {
    for (const b of SQUAD_B) {
      const id = await liveWith(1);
      const r = await h.as(ADMIN).post(`/api/admin/matches/${id}/scorer`).send({ scorerId: b });
      assert.deepEqual([b, r.status, r.body.error], [b, 403, 'reassign_verdict_captain']);
      assert.equal((await get(id)).scorerId, 'cap');
    }
    for (const a of SQUAD_A) {
      const id = await liveWith(1);
      const r = await h.as(ADMIN).post(`/api/admin/matches/${id}/scorer`).send({ scorerId: a });
      assert.equal(r.status, 200, `${a}: ${JSON.stringify(r.body)}`);
    }
  });
  it('the creator\'s own handoff after the first rally: own side yes, the other team no', async () => {
    const id = await liveWith(2);
    assert.equal((await h.as('cap').patch(`/api/matches/${id}`).send({ scorerId: 'dan' })).status, 403);
    assert.equal((await h.as('cap').patch(`/api/matches/${id}`).send({ scorerId: 'a4' })).status, 200);
  });
  it('the handoff-admin list never offers an admin on the verdict team', async () => {
    const id = await liveWith(1);
    const list = (await h.as('cap').get(`/api/matches/${id}/handoff-admins`)).body as { id: string }[];
    for (const a of list) assert.ok(!SQUAD_B.includes(a.id), a.id);
  });
});

describe('V146-3: before the first rally', () => {
  it('the creator cannot hand scoring to the opposing captain or anyone on their team (403 handover_no_verdict)', async () => {
    for (const b of SQUAD_B) {
      const id = await liveWith(0);
      const r = await h.as('cap').patch(`/api/matches/${id}`).send({ scorerId: b });
      assert.deepEqual([b, r.status, r.body.error], [b, 403, 'handover_no_verdict']);
    }
    const id = await liveWith(0);
    assert.equal((await h.as('cap').patch(`/api/matches/${id}`).send({ scorerId: 'a5' })).status, 200);
    // nor can an admin do it
    const id2 = await liveWith(0);
    const r = await h.as(ADMIN).post(`/api/admin/matches/${id2}/scorer`).send({ scorerId: 'aarav' });
    assert.equal(r.status, 403);
  });
});

describe('V146-5: wasWon never goes back to live', () => {
  async function abandonedWon() {
    // bo1 to 5 (helpers' default rules): A wins 5–0 → finished; then an admin-side abandon is simulated in SQL
    const id = await liveWith(5, 'A');
    assert.equal((await get(id)).status, 'finished');
    await h.db('matches').where({ id }).update({
      status: 'abandoned', was_won: 1,
      abandon_info: JSON.stringify({ by: 'cap', at: Date.now(), events: 5, mode: 'review', review: 'pending', behind: false, score: { setsA: 1, setsB: 0, currentA: 0, currentB: 0 } }),
    });
    return id;
  }
  it('reinstate of an abandoned won match ends finished (wasWon kept)', async () => {
    const id = await abandonedWon();
    const r = await h.as(ADMIN).post(`/api/admin/matches/${id}/resolve`).send({ action: 'reinstate' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const m = await get(id);
    assert.deepEqual([m.status, m.wasWon], ['finished', true]);
  });
  it('wasWon set but the log has no winner: reinstate refused (it may not go live)', async () => {
    const id = await abandonedWon();
    await h.db('points').where({ match_id: id }).andWhere('seq', '>=', 3).del();
    assert.equal((await get(id)).events.length, 3);
    const r = await h.as(ADMIN).post(`/api/admin/matches/${id}/resolve`).send({ action: 'reinstate' });
    assert.equal(r.status, 409, JSON.stringify(r.body));
    assert.equal((await get(id)).status, 'abandoned');
  });
});

describe('V146-8: abandon time is the instant (epoch ms, DATETIME read as UTC)', () => {
  it('finishedAt of an abandon is within seconds of now, whatever the process zone', async () => {
    const id = await liveWith(2);
    const t0 = Date.now();
    assert.equal((await h.as('cap').post(`/api/matches/${id}/abandon`).send({})).status, 200);
    const m = await get(id);
    assert.equal(typeof m.finishedAt, 'number');
    assert.ok(Math.abs(m.finishedAt - t0) < 10_000, `${m.finishedAt} vs ${t0}`);
    assert.ok(Math.abs(m.abandon.at - t0) < 10_000, `${m.abandon.at} vs ${t0}`);
  });
});
