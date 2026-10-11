/** 1.3.6 registration on the API server: validation, private fields, pincode lookup (mocked, never live). */
import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import request from 'supertest';
import { createApp } from '../src/app';
import { PincodeLookup } from '../src/pincode';
import { acceptTermsFor, startHarness, type Harness } from './helpers';

let h: Harness;
before(async () => (h = await startHarness()));
after(async () => h.close());
beforeEach(async () => {
  await h.reset();
  h.as(me); // registers the test token t-custom-reg1
});
const TOKEN = 'Bearer t-custom-reg1';

const me = { uid: 'reg1', phone: '+916000000011' };
const base = { name: 'Akshit Kumar', phone: me.phone, firstName: 'Akshit', lastName: 'Kumar', dob: '2000-05-20', pincode: '110001', email: '' };
type F = ConstructorParameters<typeof PincodeLookup>[1];
const fake = (body: unknown | Error, calls: string[] = []): F => (async (url: string) => {
  calls.push(url);
  if (body instanceof Error) throw body;
  return { ok: true, status: 200, json: async () => body };
}) as unknown as F;
const FOUND = [{ Status: 'Success', Message: 'ok', PostOffice: [{ Name: 'Connaught Place', District: 'Central Delhi', State: 'Delhi', Block: 'New Delhi' }] }];
const NONE = [{ Status: 'Error', Message: 'No records found', PostOffice: null }];

describe('registration fields', () => {
  it('valid fields are stored; name = first + last; dob/email/pincode only for the owner', async () => {
    await acceptTermsFor(h.db, [me.uid, 'other']);
    const calls: string[] = [];
    const app = createApp({ ...h.s, pincode: new PincodeLookup(true, fake(FOUND, calls)) });
    const r = await request(app).put(`/api/users/${me.uid}`).set('Authorization', TOKEN).send({ ...base, email: 'a@b.in' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.name, 'Akshit Kumar');
    assert.equal(r.body.district, 'Central Delhi');
    assert.equal(r.body.dob, '2000-05-20');
    assert.deepEqual(calls, ['https://api.postalpincode.in/pincode/110001']);
    // cached
    await request(app).get('/api/pincode/110001').set('Authorization', TOKEN);
    assert.equal(calls.length, 1);
    const other = await h.as({ uid: 'other', phone: '+916000000012' }).get(`/api/users/${me.uid}`);
    assert.equal(other.body.firstName, 'Akshit');
    assert.equal(other.body.dob, undefined);
    assert.equal(other.body.email, undefined);
    assert.equal(other.body.pincode, undefined);
  });
  it('bad fields → 400 with the code and field', async () => {
    await acceptTermsFor(h.db, [me.uid]);
    const cases: [Record<string, unknown>, string][] = [
      [{ firstName: '   ' }, 'name_empty'],
      [{ lastName: 'K' }, 'name_length'],
      [{ firstName: 'R2D2' }, 'name_chars'],
      [{ dob: '2030-01-01' }, 'dob_future'],
      [{ dob: '2023-02-29' }, 'dob_invalid'],
      [{ dob: '2020-01-01' }, 'age_too_young'],
      [{ dob: '1900-01-01' }, 'age_too_old'],
      [{ email: 'nope' }, 'email_invalid'],
      [{ pincode: '012345' }, 'pincode_invalid'],
      [{ pincode: '000000' }, 'pincode_invalid'],
      [{ pincode: '1100011' }, 'pincode_invalid'],
    ];
    for (const [patch, code] of cases) {
      const r = await h.as(me).put(`/api/users/${me.uid}`).send({ ...base, ...patch });
      assert.equal(r.status, 400, code);
      assert.equal(r.body.error, code);
    }
  });
  it('pincode: definitive "no records" rejects; timeout / failure accepts on format; flag off = format only', async () => {
    await acceptTermsFor(h.db, [me.uid]);
    const put = (lookup: PincodeLookup) => request(createApp({ ...h.s, pincode: lookup })).put(`/api/users/${me.uid}`).set('Authorization', TOKEN).send(base);
    const no = await put(new PincodeLookup(true, fake(NONE)));
    assert.equal(no.body.error, 'pincode_unknown');
    const hang = (async (_u: string, init: { signal: AbortSignal }) =>
      new Promise((_, rej) => init.signal.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' }))))) as unknown as F;
    const t0 = Date.now();
    const slow = await put(new PincodeLookup(true, hang, 150));
    assert.equal(slow.status, 200);
    assert.ok(Date.now() - t0 < 2000);
    assert.equal((await put(new PincodeLookup(true, fake(new Error('ECONNRESET'))))).status, 200);
    const calls: string[] = [];
    assert.equal((await put(new PincodeLookup(false, fake(NONE, calls)))).status, 200);
    assert.deepEqual(calls, []);
  });
  it('1.3.7 (R136-2): a client from before 1.3.6 (no new fields) can save only once the profile has them', async () => {
    await acceptTermsFor(h.db, [me.uid]);
    const r = await h.as(me).put(`/api/users/${me.uid}`).send({ name: 'Old Client', phone: me.phone });
    assert.deepEqual([r.status, r.body.error], [400, 'profile_incomplete']);
    assert.equal((await h.db('users').where({ id: me.uid }).first())?.profile_complete ?? 0, 0);
    assert.equal((await h.as(me).put(`/api/users/${me.uid}`).send({ ...base })).status, 200);
    const again = await h.as(me).put(`/api/users/${me.uid}`).send({ name: 'Old Client', phone: me.phone, city: 'Agra' });
    assert.equal(again.status, 200);
    assert.equal(again.body.name, 'Akshit Kumar');
  });
});
