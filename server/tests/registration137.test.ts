/**
 * 1.3.7: Tester's 1.3.6 findings on the API server (R136-1/2/6/9/12/13), team size (exact/custom,
 * lock after the first rally). Pincode lookups are mocked; nothing calls out.
 */
// R136-1: run this file west of UTC (the DOB used to move back a day here). Set before any Date use.
process.env.TZ = 'America/Los_Angeles';
import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import request from 'supertest';
import { createApp } from '../src/app';
import { PincodeLookup } from '../src/pincode';
import { PINCODE_RATE } from '../src/routes/api';
import { dobString } from '../src/domain/users';
import { acceptTermsFor, EVERYONE, newMatchBody, playersOf, pt, register, regFor, SQUAD_A, SQUAD_B, startHarness, team, type Harness } from './helpers';

let h: Harness;
before(async () => (h = await startHarness()));
after(async () => h.close());
beforeEach(async () => {
  await h.reset();
});
const me = { uid: 'r137', phone: '+916000000137' };
const other = { uid: 'r137b', phone: '+916000000138' };
const base = { phone: me.phone, firstName: 'Akshit', lastName: 'Kumar', dob: '2000-05-20', pincode: '110001' };
type F = ConstructorParameters<typeof PincodeLookup>[1];
const fake = (body: unknown | Error, calls: string[] = []): F => (async (url: string) => {
  calls.push(url);
  if (body instanceof Error) throw body;
  return { ok: true, status: 200, json: async () => body };
}) as unknown as F;
const FOUND = [{ Status: 'Success', Message: 'ok', PostOffice: [{ Name: 'CP', District: 'Central\u0007 Delhi\u200B', State: 'Delhi', Block: 'New Delhi' }] }];
const put = (who: { uid: string; phone: string }, body: object) => h.as(who).put(`/api/users/${who.uid}`).send(body);

describe('1.3.7 registration on the server (R136)', () => {
  it('R136-1: DOB round-trips unchanged in a time zone west of UTC; re-saves never drift', async () => {
    assert.equal(new Date('2000-05-20T00:00:00Z').getDate(), 19); // really west of UTC
    await acceptTermsFor(h.db, [me.uid]);
    for (let i = 0; i < 3; i++) {
      const r = await put(me, { ...base, ...(i ? { city: `C${i}` } : {}) });
      assert.equal(r.status, 200, JSON.stringify(r.body));
      assert.equal(r.body.dob, '2000-05-20');
      assert.equal((await h.as(me).get('/api/me')).body.profile.dob, '2000-05-20');
    }
    // an old-shape save (dob from the DB, not the client) also keeps it
    assert.equal((await put(me, { name: 'x', phone: me.phone, city: 'Agra' })).body.dob, '2000-05-20');
    assert.equal(dobString(new Date(Date.UTC(1990, 0, 1))), '1990-01-01');
  });
  it('R136-2: no profile_complete without name, DOB and pincode; the age range is enforced', async () => {
    await acceptTermsFor(h.db, [me.uid]);
    for (const [patch, field] of [[{ dob: undefined }, 'dob'], [{ pincode: undefined }, 'pincode'], [{ firstName: undefined }, 'firstName'], [{ dob: '2020-01-01' }, 'dob'], [{ dob: '1900-01-01' }, 'dob']] as const) {
      const r = await put(me, { ...base, ...patch });
      assert.equal(r.status, 400, JSON.stringify(patch));
      assert.equal(r.body.field, field);
    }
    assert.equal((await h.db('users').where({ id: me.uid }).first())?.profile_complete ?? 0, 0);
    assert.equal((await put(me, base)).status, 200);
  });
  it('R136-3 parity: a partial save is validated with the stored fields (email-only, district-only)', async () => {
    await acceptTermsFor(h.db, [me.uid]);
    assert.equal((await put(me, base)).status, 200);
    const bad = await put(me, { phone: me.phone, email: 'nope' });
    assert.deepEqual([bad.status, bad.body.error], [400, 'email_invalid']);
    const ok = await put(me, { phone: me.phone, email: 'Me@Example.IN' });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.email, 'me@example.in');
    assert.equal(ok.body.firstName, 'Akshit');
    const zw = await put(me, { phone: me.phone, email: 'a\u200B@b.in' });
    assert.equal(zw.body.error, 'email_invalid');
    // a client-sent district is never stored (lookup off / unknown here)
    const d = await put(me, { phone: me.phone, district: '<b>x</b>', state: 'Nowhere', pincode: '400001' });
    assert.equal(d.status, 200);
    assert.deepEqual([d.body.district, d.body.state], [null, null]);
  });
  it('R136-9: one email per account, case-insensitive', async () => {
    await acceptTermsFor(h.db, [me.uid, other.uid]);
    assert.equal((await put(me, { ...base, email: 'Same@Mail.in' })).status, 200);
    const r = await put(other, { ...base, phone: other.phone, email: 'same@MAIL.in' });
    assert.deepEqual([r.status, r.body.error], [409, 'email_taken']);
    assert.equal((await put(me, { ...base, email: 'same@mail.in' })).status, 200); // own address again
  });
  it('R136-8: a stored DOB that left the range can be re-saved; a new out-of-range DOB is refused', async () => {
    await acceptTermsFor(h.db, [me.uid]);
    assert.equal((await put(me, base)).status, 200);
    await h.db('users').where({ id: me.uid }).update({ dob: '1920-01-01' }); // now over 100
    assert.equal((await put(me, { ...base, dob: '1920-01-01', city: 'Pune' })).status, 200);
    assert.equal((await put(me, { phone: me.phone, city: 'Agra' })).status, 200);
    assert.equal((await put(me, { ...base, dob: '1919-01-01' })).body.error, 'age_too_old');
  });
  it('R136-13: upstream district/state are stripped of control and zero-width characters; same pin = no new lookup', async () => {
    await acceptTermsFor(h.db, [me.uid]);
    const calls: string[] = [];
    const app = createApp({ ...h.s, pincode: new PincodeLookup(true, fake(FOUND, calls)) });
    h.as(me);
    const r = await request(app).put(`/api/users/${me.uid}`).set('Authorization', `Bearer t-custom-${me.uid}`).send(base);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.district, 'Central Delhi');
    await request(app).put(`/api/users/${me.uid}`).set('Authorization', `Bearer t-custom-${me.uid}`).send({ ...base, city: 'X' });
    assert.equal(calls.length, 1);
  });
});

describe('1.3.7 /api/pincode (R136-6)', () => {
  it('signed-in only (before T&C is fine); per-user rate limit with Retry-After', async () => {
    assert.equal((await h.api.get('/api/pincode/110001')).status, 401);
    const calls: string[] = [];
    const app = createApp({ ...h.s, pincode: new PincodeLookup(true, fake(FOUND, calls)) });
    h.as(me);
    const get = () => request(app).get('/api/pincode/110001').set('Authorization', `Bearer t-custom-${me.uid}`);
    const first = await get();
    assert.equal(first.status, 200);
    assert.equal(first.body.status, 'ok');
    let limited = null;
    for (let i = 1; i < PINCODE_RATE.user.burst + 2 && !limited; i++) {
      const r = await get();
      if (r.status === 429) limited = r;
    }
    assert.ok(limited, 'rate limited');
    assert.equal(limited!.body.error, 'rate_limited');
    assert.ok(Number(limited!.headers['retry-after']) >= 1);
    assert.equal(calls.length, 1); // cached
  });
  it('unknown answers are cached briefly; concurrent lookups share one call; the cache is capped', async () => {
    let t = 0;
    const calls: string[] = [];
    const lk = new PincodeLookup(true, fake(new Error('down'), calls), 3000, 24 * 3600_000, () => t, undefined, 10 * 60_000, 3);
    await Promise.all([lk.lookup('110001'), lk.lookup('110001'), lk.lookup('110001')]);
    assert.equal(calls.length, 1);
    await lk.lookup('110001');
    assert.equal(calls.length, 1); // negative cache
    t += 10 * 60_000 + 1;
    await lk.lookup('110001');
    assert.equal(calls.length, 2);
    for (const pin of ['200001', '300001', '400001', '500001']) await lk.lookup(pin);
    assert.ok(lk.size <= 3);
  });
});

describe('1.3.7 team size on the server', () => {
  const extra = Array.from({ length: 7 }, (_, i) => ({ uid: `x${i + 1}`, phone: `+91700000000${i}`, name: `Extra Player${String.fromCharCode(65 + i)}` }));
  const regExtras = async () => {
    await acceptTermsFor(h.db, extra.map((x) => x.uid));
    for (const x of extra) {
      const r = await put(x, { phone: x.phone, ...regFor(x.name) });
      assert.equal(r.status, 200, JSON.stringify(r.body));
    }
  };
  const side = (ids: string[], name: string) => team(name, ids.map((id) => ({ id, name: id })));
  const body = (a: string[], b: string[], over: Record<string, unknown> = {}) =>
    newMatchBody({ teamA: side(a, 'QA Spikers'), teamB: side(b, 'Delhi Smashers'), participantIds: [...a, ...b], status: 'scheduled', ...over });
  it('exact: at most 6 (7 refused); custom 6..12 (13 refused); bogus mode refused; 5 can not start', async () => {
    await register(h, ...EVERYONE);
    await regExtras();
    const A = [...SQUAD_A];
    const B = [...SQUAD_B];
    const X = extra.map((x) => x.uid);
    const post = (b: object) => h.as('cap').post('/api/matches').send(b);
    assert.equal((await post(body(A, B, { teamSizeMode: 'exact' }))).status, 201);
    assert.equal((await post(body([...A, X[0]], B, { teamSizeMode: 'exact' }))).status, 400);
    const twelve = [...A, ...X.slice(0, 6)];
    assert.equal((await post(body(twelve, B, { teamSizeMode: 'custom' }))).status, 201);
    assert.equal((await post(body([...twelve, X[6]], B, { teamSizeMode: 'custom' }))).status, 400);
    assert.equal((await post(body(A, B, { teamSizeMode: 'bogus' }))).status, 400);
    assert.equal((await post(body(A.slice(0, 5), B, { teamSizeMode: 'exact', status: 'live' }))).status, 403);
  });
  it('the mode and the players are locked after the first rally', async () => {
    await register(h, ...EVERYONE);
    const r = await h.as('cap').post('/api/matches').send(newMatchBody({ teamSizeMode: 'custom' }));
    assert.equal(r.status, 201, JSON.stringify(r.body));
    const id = r.body.id;
    assert.equal((await h.as('cap').put(`/api/matches/${id}/progress`).send({ events: [pt('A', Date.now())], status: 'live' })).status, 200);
    assert.equal((await h.as('cap').patch(`/api/matches/${id}`).send({ teamSizeMode: 'exact' })).status, 403);
    assert.equal((await h.as('cap').patch(`/api/matches/${id}`).send({ teamA: team('QA Spikers', playersOf([...SQUAD_A, 'eve'])), participantIds: [...SQUAD_A, 'eve', ...SQUAD_B] })).status, 403);
  });
});
