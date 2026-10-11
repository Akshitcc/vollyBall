/**
 * 1.3.8: tester's 1.3.7 findings on the API server – V137-1 (legacy captain confirmation + 0012 backfill),
 * V137-2 (createMatch needs a complete profile), V137-8 (unique normalised email, 0013, 409 on a race),
 * V137-4 (the Date header the app reads for the server clock).
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, beforeEach, describe, it } from 'node:test';
import { ADMIN, EVERYONE, acceptTermsFor, createMatch, newMatchBody, pt, register, startHarness, type Harness } from './helpers';

let h: Harness;
before(async () => (h = await startHarness()));
after(async () => h.close());
beforeEach(async () => {
  await h.reset();
  await register(h, ...EVERYONE);
});

const code = (r: { status: number; body: { error?: string } }, status: number, err?: string) => {
  assert.equal(r.status, status, JSON.stringify(r.body));
  if (err) assert.equal(r.body.error, err, JSON.stringify(r.body));
};
const WIN_A = ['bob', 'bob', 'bob', 'cap', 'cap'].map((c, i) => pt('A', 1000 + i, c));
async function completed() {
  const id = await createMatch(h);
  code(await h.as('cap').put(`/api/matches/${id}/progress`).send({ events: WIN_A }), 200);
  code(await h.as('cap').put(`/api/matches/${id}/player-of-match`).send({ playerId: 'bob' }), 200);
  // a normal-length match (not flagged for being short)
  const now = Date.now();
  await h.db('matches').where({ id }).update({ started_server_at: new Date(now - 30 * 60_000), finished_at: new Date(now) });
  return id;
}
const statements = (file: string, keep: RegExp) =>
  fs
    .readFileSync(path.join(__dirname, '../migrations', file), 'utf8')
    .split('-- ;;')
    .map((q) => q.replace(/^--.*$/gm, '').trim())
    .filter((q) => q && keep.test(q));
/** A 1.3.6-era row: the captain answered, the admin then approved; 0010 left captain_verdict NULL. */
async function legacyApproved(id: string) {
  await h.db('matches').where({ id }).update({ verification_status: 'approved', captain_verdict: null, reviewed_by: ADMIN.uid, reviewed_at: new Date() });
}

describe('V137-1: a captain confirmation recorded before 1.3.7 survives the admin approval', () => {
  it("without the backfill, the API already reads the older fields: it counts, and can't be re-answered", async () => {
    const id = await completed();
    code(await h.as('aarav').post(`/api/matches/${id}/confirm`), 200);
    await legacyApproved(id);
    const m = (await h.as('bob').get(`/api/matches/${id}`)).body;
    assert.equal(m.verification.status, 'approved');
    assert.equal((await h.as('bob').get('/api/me/wallet')).body.countedMatches, 1);
    code(await h.as('aarav').post(`/api/matches/${id}/confirm`), 200); // idempotent replay
    code(await h.as('aarav').post(`/api/matches/${id}/reject`).send({ reason: 'changed my mind' }), 409, 'already_reviewed');
  });
  it('0012 backfills confirmed / rejected from the older columns, only where still NULL, and is re-runnable', async () => {
    const conf = await completed();
    code(await h.as('aarav').post(`/api/matches/${conf}/confirm`), 200);
    const rej = await completed();
    code(await h.as('aarav').post(`/api/matches/${rej}/reject`).send({ reason: 'wrong score' }), 200);
    const none = await completed(); // nobody answered, admin approved
    const done = await completed(); // 1.3.7 already wrote a verdict
    code(await h.as('aarav').post(`/api/matches/${done}/confirm`), 200);
    await h.db('matches').where({ id: done }).update({ verification_status: 'approved', captain_verdict: 'rejected' });
    for (const id of [conf, rej, none]) await legacyApproved(id);
    await h.db('matches').where({ id: none }).update({ verified_by: null, verified_at: null });
    const sql = statements('0012_captain_verdict_backfill.sql', /^UPDATE/);
    assert.equal(sql.length, 2);
    for (let run = 0; run < 2; run++) for (const q of sql) await h.db.raw(q);
    const verdict = async (id: string) => (await h.db('matches').where({ id }).first('captain_verdict')).captain_verdict;
    assert.deepEqual([await verdict(conf), await verdict(rej), await verdict(none), await verdict(done)], ['confirmed', 'rejected', null, 'rejected']);
    assert.equal((await h.as('bob').get('/api/me/wallet')).body.countedMatches, 1); // only `conf`
  });
  it('an admin approving an already-confirmed match keeps the confirmation (captain_verdict stamped)', async () => {
    const id = await completed();
    code(await h.as('aarav').post(`/api/matches/${id}/confirm`), 200);
    await h.db('matches').where({ id }).update({ captain_verdict: null }); // as left by 0010 on a 1.3.6 row
    code(await h.as(ADMIN).post(`/api/admin/matches/${id}/review`).send({ decision: 'approve' }), 200);
    assert.equal((await h.db('matches').where({ id }).first('captain_verdict')).captain_verdict, 'confirmed');
  });
});

describe('V137-2: creating a match needs a complete profile (name, date of birth, pincode)', () => {
  it('a legacy profile_complete row without the registration fields gets 403 profile_incomplete', async () => {
    await h.db('users').where({ id: 'cap' }).update({ dob: null, pincode: null });
    code(await h.as('cap').post('/api/matches').send(newMatchBody()), 403, 'profile_incomplete');
    await h.db('users').where({ id: 'cap' }).update({ dob: '1995-06-15', pincode: '110001', first_name: null });
    code(await h.as('cap').post('/api/matches').send(newMatchBody()), 403, 'profile_incomplete');
    await h.db('users').where({ id: 'cap' }).update({ first_name: 'Cap' });
    code(await h.as('cap').post('/api/matches').send(newMatchBody()), 201);
  });
});

describe('V137-8: one account per (normalised) email, enforced by the database', () => {
  const u1 = { uid: 'e138a', phone: '+916000001381' };
  const u2 = { uid: 'e138b', phone: '+916000001382' };
  const base = (u: { phone: string }) => ({ phone: u.phone, firstName: 'Asha', lastName: 'Rao', dob: '2000-05-20', pincode: '110001' });
  const put = (u: { uid: string; phone: string }, body: object) => h.as(u).put(`/api/users/${u.uid}`).send(body);
  it('two saves of the same address at the same time: one 200, one 409 email_taken', async () => {
    await acceptTermsFor(h.db, [u1.uid, u2.uid]);
    assert.equal((await put(u1, base(u1))).status, 200);
    assert.equal((await put(u2, base(u2))).status, 200);
    const [a, b] = await Promise.all([put(u1, { ...base(u1), email: 'Race@Mail.in' }), put(u2, { ...base(u2), email: 'race@mail.IN' })]);
    assert.deepEqual([a.status, b.status].sort(), [200, 409]);
    assert.equal([a, b].find((r) => r.status === 409)!.body.error, 'email_taken');
  });
  it('the unique index rejects a direct duplicate (case / spaces ignored); empty strings and NULLs are fine', async () => {
    await h.db('users').where({ id: 'cap' }).update({ email: 'dup@x.in' });
    await assert.rejects(h.db('users').where({ id: 'bob' }).update({ email: ' DUP@x.in ' }), /ux_users_email_norm|Duplicate/);
    await h.db('users').whereIn('id', ['bob', 'dan']).update({ email: '' });
    await h.db('users').whereIn('id', ['aarav', 'eve']).update({ email: null });
  });
  it('0013 on existing duplicates: the oldest account keeps the address, the others are cleared and listed – nobody is deleted', async () => {
    await h.db.raw('DROP INDEX ux_users_email_norm ON users');
    try {
      const before = (await h.db('users').count({ n: '*' }).first())!.n;
      const t0 = Date.now();
      await h.db('users').where({ id: 'cap' }).update({ email: 'same@x.in', created_at: new Date(t0 - 3000) });
      await h.db('users').where({ id: 'bob' }).update({ email: 'SAME@x.in', created_at: new Date(t0 - 2000) });
      await h.db('users').where({ id: 'dan' }).update({ email: ' same@x.in', created_at: new Date(t0 - 1000) });
      await h.db('users').where({ id: 'aarav' }).update({ email: 'solo@x.in' });
      for (const q of statements('0013_users_email_unique.sql', /^(INSERT|UPDATE|CREATE UNIQUE)/)) await h.db.raw(q);
      assert.equal((await h.db('users').count({ n: '*' }).first())!.n, before);
      const email = async (id: string) => (await h.db('users').where({ id }).first('email')).email;
      assert.deepEqual([await email('cap'), await email('bob'), await email('dan'), await email('aarav')], ['same@x.in', null, null, 'solo@x.in']);
      const listed = await h.db('email_duplicates_0013').orderBy('user_id').select('user_id', 'email', 'kept_user_id');
      assert.deepEqual(listed.map((r: { user_id: string; email: string; kept_user_id: string }) => [r.user_id, r.email, r.kept_user_id]), [['bob', 'SAME@x.in', 'cap'], ['dan', ' same@x.in', 'cap']]);
    } finally {
      await h.db.raw("CREATE UNIQUE INDEX ux_users_email_norm ON users ((NULLIF(LOWER(TRIM(email)), '')))").catch(() => {});
      await h.db('email_duplicates_0013').del();
    }
  });
});

describe('V137-4: the server clock is readable by the app', () => {
  it('responses carry a Date header, exposed to the browser (CORS)', async () => {
    const r = await h.as('cap').get('/api/me').set('Origin', 'http://localhost:8081');
    assert.ok(Number.isFinite(Date.parse(r.headers.date)));
    assert.match(String(r.headers['access-control-expose-headers'] ?? ''), /Date/);
  });
});
