/**
 * 1.4.5 API: V144-1 (abandon – interim 'review' policy: recorded for an admin's review; maxEvents / wasWon latches;
 * the opposing captain's report; 'consent' requests and their answers), V144-2 (finished without a winner: reopen /
 * abandon / void), V144-3 (no admin action on an admin's own match), V144-4 (match_setup_locked), V144-8 (interim
 * scorer handoff), and migration 0016 (additive, re-runnable).
 */
import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import { migrate, MIGRATIONS_DIR } from '../src/db/migrate';
import { ADMIN, EVERYONE, createMatch, pt, register, startHarness, type Harness } from './helpers';

let h: Harness;
before(async () => (h = await startHarness()));
after(async () => h.close());
beforeEach(async () => {
  await h.reset();
  await register(h, ...EVERYONE);
});

const B = (n: number, t0 = 1000) => Array.from({ length: n }, (_, i) => pt('B', t0 + i));
const get = async (id: string) => (await h.as('cap').get(`/api/matches/${id}`)).body;
async function liveWith(n: number) {
  const id = await createMatch(h, { title: 'Abandon', location: null });
  if (n) assert.equal((await h.as('cap').put(`/api/matches/${id}/progress`).send({ events: B(n) })).status, 200);
  return id;
}

describe('V144-1: the abandon (interim review policy)', () => {
  it("Tester's 0:4 (bo1 to 5): abandoned, recorded (who, score, side behind) and listed for admin review", async () => {
    const id = await liveWith(4);
    const r = await h.as('cap').post(`/api/matches/${id}/abandon`).send({});
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.result, 'abandoned');
    const m = await get(id);
    assert.equal(m.status, 'abandoned');
    assert.equal(m.abandon.by, 'cap');
    assert.equal(m.abandon.events, 4);
    assert.equal(m.abandon.mode, 'review');
    assert.equal(m.abandon.review, 'pending');
    assert.equal(m.abandon.behind, true);
    assert.deepEqual([m.abandon.score.currentA, m.abandon.score.currentB], [0, 4]);
    const flagged = (await h.as(ADMIN).get('/api/admin/matches/flagged')).body as { id: string }[];
    assert.ok(flagged.some((x) => x.id === id));
  });
  it('PATCH status abandoned is the same action; a scoring write never abandons; not the other side', async () => {
    const id = await liveWith(2);
    assert.equal((await h.as('aarav').post(`/api/matches/${id}/abandon`).send({})).status, 403);
    // the progress write derives the status from the events: 'abandoned' in it is ignored, the match stays live
    const pr = await h.as('cap').put(`/api/matches/${id}/progress`).send({ events: B(2), status: 'abandoned' });
    assert.deepEqual([pr.status, pr.body.status], [200, 'live']);
    assert.equal((await h.as('cap').patch(`/api/matches/${id}`).send({ status: 'abandoned' })).status, 200);
    assert.equal((await get(id)).abandon.review, 'pending');
  });
  it("the undo bypass: maxEvents keeps the shortest win reached; wasWon latches; clients can't write either", async () => {
    const id = await liveWith(4);
    // the 5th rally finishes it (bo1 to 5, B wins) – undo is refused on a won match, so: 4 B + 1 A, undo 2, abandon
    await h.as('cap').put(`/api/matches/${id}/progress`).send({ events: [...B(4), pt('A', 2000)] });
    await h.as('cap').put(`/api/matches/${id}/progress`).send({ events: B(3) });
    assert.equal((await get(id)).maxEvents, 5);
    const r = await h.as('cap').post(`/api/matches/${id}/abandon`).send({});
    assert.deepEqual([r.status, r.body.error], [409, 'abandon_needs_admin']);
    for (const f of [{ maxEvents: 0 }, { wasWon: false }, { abandon: null }, { abandonRequest: null }, { scorerReassign: null }])
      assert.equal((await h.as('cap').patch(`/api/matches/${id}`).send(f)).status, 400, JSON.stringify(f));
    await h.db('matches').where({ id }).update({ was_won: 1 });
    const id2 = await liveWith(1);
    await h.db('matches').where({ id: id2 }).update({ was_won: 1 });
    assert.equal((await h.as('cap').post(`/api/matches/${id2}/abandon`).send({})).body.error, 'match_finished');
  });
  it('a finishing write latches wasWon', async () => {
    const id = await liveWith(5);
    const m = await get(id);
    assert.deepEqual([m.status, m.wasWon, m.maxEvents], ['finished', true, 5]);
  });
});

describe('report and admin resolutions (V144-1/2/3)', () => {
  it("B's captain reports (once); A's side can't; an admin reinstates or confirms; an admin in the match can't", async () => {
    const id = await liveWith(3);
    await h.as('cap').post(`/api/matches/${id}/abandon`).send({});
    assert.equal((await h.as('bob').post(`/api/matches/${id}/abandon-report`).send({})).status, 403);
    const r = await h.as('aarav').post(`/api/matches/${id}/abandon-report`).send({});
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal((await get(id)).abandon.reportedBy, 'aarav');
    assert.equal((await h.as('aarav').post(`/api/matches/${id}/abandon-report`).send({})).status, 403);
    // non-admin
    assert.equal((await h.as('aarav').post(`/api/admin/matches/${id}/resolve`).send({ action: 'reinstate' })).status, 403);
    // reinstate → live again (no winner in the log)
    const ok = await h.as(ADMIN).post(`/api/admin/matches/${id}/resolve`).send({ action: 'reinstate' });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    let m = await get(id);
    assert.deepEqual([m.status, m.abandon.review, m.abandon.reviewedBy], ['live', 'reinstated', ADMIN.uid]);
    // 1.4.6 (QA V145-5): the scorer can't abandon a reinstated match again; an admin can (the old record goes to history)
    const again = await h.as('cap').post(`/api/matches/${id}/abandon`).send({});
    assert.equal(again.status >= 400, true, JSON.stringify(again.body));
    assert.equal((await h.as(ADMIN).post(`/api/admin/matches/${id}/resolve`).send({ action: 'abandon' })).status, 200);
    m = await get(id);
    assert.equal(m.status, 'abandoned');
    assert.deepEqual(m.abandonHistory.map((x: { review: string }) => x.review), ['reinstated']);
    // a fresh scorer abandon, then the admin confirms
    const id3 = await liveWith(3);
    await h.as('cap').post(`/api/matches/${id3}/abandon`).send({});
    assert.equal((await h.as(ADMIN).post(`/api/admin/matches/${id3}/resolve`).send({ action: 'confirm_abandon' })).status, 200);
    m = await get(id3);
    assert.deepEqual([m.status, m.abandon.review], ['abandoned', 'confirmed']);
    // V144-3: the admin as this match's scorer gets 403 own_match
    const id2 = await liveWith(2);
    await h.as('cap').post(`/api/matches/${id2}/abandon`).send({});
    // (fixture: the admin gets a profile and plays in it)
    await h.db('users').insert({ id: ADMIN.uid, name: 'Admin Player', phone: '+919000000099', created_at: new Date(), updated_at: new Date() }).onConflict('id').merge();
    await h.db('match_participants').insert({ match_id: id2, user_id: ADMIN.uid });
    const own = await h.as(ADMIN).post(`/api/admin/matches/${id2}/resolve`).send({ action: 'confirm_abandon' });
    assert.deepEqual([own.status, own.body.error], [403, 'own_match']);
  });
  it('V144-2: finished without a winner → flagged; reopen / abandon / void', async () => {
    const fin = async () => {
      const id = await liveWith(3);
      await h.db('matches').where({ id }).update({ status: 'finished', finished_at: new Date(), was_won: 1 });
      return id;
    };
    const a = await fin();
    assert.ok(((await h.as(ADMIN).get('/api/admin/matches/flagged')).body as { id: string }[]).some((x) => x.id === a));
    const r = await h.as(ADMIN).post(`/api/admin/matches/${a}/resolve`).send({ action: 'reopen' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    let m = await get(a);
    assert.deepEqual([m.status, m.wasWon, m.resolution?.action], ['live', false, 'reopened']);
    const b = await fin();
    assert.equal((await h.as(ADMIN).post(`/api/admin/matches/${b}/resolve`).send({ action: 'abandon' })).status, 200);
    m = await get(b);
    assert.deepEqual([m.status, m.abandon.mode, m.abandon.review], ['abandoned', 'admin', 'confirmed']);
    const c = await fin();
    assert.equal((await h.as(ADMIN).post(`/api/admin/matches/${c}/review`).send({ decision: 'void' })).status, 200);
    assert.equal((await get(c)).verification.status, 'voided');
    assert.ok(!((await h.as(ADMIN).get('/api/admin/matches/flagged')).body as { id: string }[]).some((x) => x.id === c));
    // an unknown action
    assert.equal((await h.as(ADMIN).post(`/api/admin/matches/${a}/resolve`).send({ action: 'nuke' })).status, 400);
  });
  it("'consent' request (seeded – the policy is 'review'): scoring paused; B's captain agrees → abandoned; an admin rejects one", async () => {
    const id = await liveWith(2);
    await h.db('matches').where({ id }).update({ abandon_request: JSON.stringify({ by: 'cap', at: Date.now(), side: 'A', agreedBy: [] }) });
    const paused = await h.as('cap').put(`/api/matches/${id}/progress`).send({ events: [...B(2), pt('A', 3000)] });
    assert.deepEqual([paused.status, paused.body.error], [409, 'abandon_pending']);
    assert.equal((await h.as('bob').post(`/api/matches/${id}/abandon-request`).send({ action: 'agree' })).status, 403);
    const ok = await h.as('aarav').post(`/api/matches/${id}/abandon-request`).send({ action: 'agree' });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    const m = await get(id);
    assert.deepEqual([m.status, m.abandon.mode, m.abandon.review, m.abandon.agreedBy], ['abandoned', 'consent', 'confirmed', ['aarav']]);
    // no report after an agreed abandon
    assert.equal((await h.as('aarav').post(`/api/matches/${id}/abandon-report`).send({})).status, 403);
    const id2 = await liveWith(2);
    await h.db('matches').where({ id: id2 }).update({ abandon_request: JSON.stringify({ by: 'cap', at: Date.now(), side: 'A', agreedBy: [] }) });
    assert.equal((await h.as(ADMIN).post(`/api/admin/matches/${id2}/resolve`).send({ action: 'reject_request' })).status, 200);
    assert.equal((await get(id2)).abandonRequest ?? null, null);
    assert.equal((await h.as('cap').put(`/api/matches/${id2}/progress`).send({ events: [...B(2), pt('A', 3000)] })).status, 200);
  });
});

describe('V144-4 / V144-8', () => {
  it('rules and first serve are locked once a rally ever existed (409 match_setup_locked), also after undo to 0', async () => {
    const id = await liveWith(1);
    const m = await get(id);
    assert.equal((await h.as('cap').patch(`/api/matches/${id}`).send({ firstServe: 'B' })).body.error, 'match_setup_locked');
    await h.as('cap').put(`/api/matches/${id}/progress`).send({ events: [] });
    assert.equal((await h.as('cap').patch(`/api/matches/${id}`).send({ rules: { ...m.rules, bestOf: 3 } })).body.error, 'match_setup_locked');
    const id0 = await liveWith(0);
    assert.equal((await h.as('cap').patch(`/api/matches/${id0}`).send({ firstServe: 'B' })).status, 200);
  });
  it('handoff after the first rally: own side only (403 handover_side); an admin reassigns off the verdict team, recorded', async () => {
    const id = await liveWith(1);
    const r = await h.as('cap').patch(`/api/matches/${id}`).send({ scorerId: 'aarav' });
    assert.deepEqual([r.status, r.body.error], [403, 'handover_side']);
    assert.equal((await h.as('cap').patch(`/api/matches/${id}`).send({ scorerId: 'bob' })).status, 200);
    assert.equal((await h.as('bob').post(`/api/admin/matches/${id}/scorer`).send({ scorerId: 'aarav' })).status, 403);
    // 1.4.6 (QA V145-6): never to the captain who gives the verdict
    const cap = await h.as(ADMIN).post(`/api/admin/matches/${id}/scorer`).send({ scorerId: 'aarav' });
    assert.deepEqual([cap.status, cap.body.error], [403, 'reassign_verdict_captain']);
    // 1.4.7 (QA V146-2): nor to anyone on the verdict captain's team – the scorer's own side is fine
    const d = await h.as(ADMIN).post(`/api/admin/matches/${id}/scorer`).send({ scorerId: 'dan' });
    assert.deepEqual([d.status, d.body.error], [403, 'reassign_verdict_captain']);
    const a = await h.as(ADMIN).post(`/api/admin/matches/${id}/scorer`).send({ scorerId: 'a3' });
    assert.equal(a.status, 200, JSON.stringify(a.body));
    const m = await get(id);
    assert.equal(m.scorerId, 'a3');
    assert.deepEqual([m.scorerReassign.from, m.scorerReassign.to, m.scorerReassign.by], ['bob', 'a3', ADMIN.uid]);
    assert.equal(m.maxEvents, 1);
    assert.equal((await h.as(ADMIN).post(`/api/admin/matches/${id}/scorer`).send({ scorerId: 'eve' })).body.error, 'handover_side');
    // before the first rally anyone in the match – 1.4.7 (QA V146-3): except the other team (nobody would confirm)
    const id0 = await liveWith(0);
    const r0 = await h.as('cap').patch(`/api/matches/${id0}`).send({ scorerId: 'aarav' });
    assert.deepEqual([r0.status, r0.body.error], [403, 'handover_no_verdict']);
    assert.equal((await h.as('cap').patch(`/api/matches/${id0}`).send({ scorerId: 'bob' })).status, 200);
  });
});

describe('migration 0016', () => {
  it('is additive and re-runnable (its guarded statements run again without error)', async () => {
    const cols = async () => (await h.db.raw("SELECT column_name AS c FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'matches'"))[0].map((r: { c: string }) => r.c);
    for (const c of ['max_events', 'was_won', 'abandon_info', 'abandon_request', 'resolution', 'scorer_reassign']) assert.ok((await cols()).includes(c), c);
    await h.db('schema_migrations').where({ version: '0016_match_abandon.sql' }).del();
    assert.deepEqual(await migrate(h.db, MIGRATIONS_DIR, { onWarn: () => undefined }), ['0016_match_abandon.sql']);
    assert.deepEqual(await migrate(h.db, MIGRATIONS_DIR, { onWarn: () => undefined }), []);
  });
});
