/** Indian mobile numbers only: ^\+91[6-9]\d{9}$ on every write and lookup, 400 invalid_phone otherwise (QA G6). */
import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import { acceptTermsFor, makeTeam, PEOPLE, register, startHarness, type Harness } from './helpers';

let h: Harness;
before(async () => (h = await startHarness()));
after(async () => h.close());
beforeEach(async () => h.reset());

const BAD = [
  '+9198765432101', // 11 digits after +91
  '+91987654321', // 9 digits
  '+915876543210', // starts with 5
  '+910876543210', // starts with 0
  '+9112345',
  '+16505551234', // another country
  '+447911123456',
  '9876543210', // no +91
  '+91 9876543210', // not E.164
  '+91९८७६५४३२१०', // Devanagari digits are converted in the app, never stored
];
const isInvalidPhone = (r: { status: number; body: { code?: string; error?: string } }) => {
  assert.equal(r.status, 400, JSON.stringify(r.body));
  assert.equal(r.body.code ?? r.body.error, 'invalid_phone', JSON.stringify(r.body));
};

describe('phone validation', () => {
  it('profiles: 400 invalid_phone for a malformed number, 200 for a valid one', async () => {
    await acceptTermsFor(h.db, [...BAD.map((_, i) => `u_${i}`), 'good']);
    for (const phone of BAD) {
      const who = { uid: `u_${BAD.indexOf(phone)}`, phone };
      isInvalidPhone(await h.as(who).put(`/api/users/${who.uid}`).send({ name: 'Probe', phone }));
    }
    const good = { uid: 'good', phone: '+916000000001' };
    assert.equal((await h.as(good).put('/api/users/good').send({ name: 'Good', phone: good.phone })).status, 200);
  });

  it('lookups: 400 (not 404) for a malformed number; 404 / 200 for valid ones', async () => {
    await register(h, 'cap', 'bob');
    for (const phone of BAD) isInvalidPhone(await h.as('bob').get(`/api/users/by-phone/${encodeURIComponent(phone)}`));
    assert.equal((await h.as('bob').get(`/api/users/by-phone/${encodeURIComponent('+919999999999')}`)).status, 404);
    assert.equal((await h.as('bob').get(`/api/users/by-phone/${encodeURIComponent(PEOPLE.cap.phone)}`)).status, 200);
    isInvalidPhone(await h.as('bob').get(`/api/teams?invitedPhone=${encodeURIComponent('+9198765')}`));
    assert.equal((await h.as('bob').get(`/api/teams?invitedPhone=${encodeURIComponent(PEOPLE.bob.phone)}`)).status, 200);
  });

  it('invites: 400 invalid_phone on create and patch; a valid registered number is ok', async () => {
    await register(h, 'cap', 'bob');
    const id = await makeTeam(h, 'cap', []);
    for (const phone of BAD) isInvalidPhone(await h.as('cap').patch(`/api/teams/${id}`).send({ pendingPhones: [phone] }));
    isInvalidPhone(await h.as('cap').post('/api/teams').send({ name: 'Tigers', color: '#E53935', captainId: 'cap', memberIds: ['cap'], subIds: [], pendingPhones: ['+91123'] }));
    assert.equal((await h.as('cap').patch(`/api/teams/${id}`).send({ pendingPhones: [PEOPLE.bob.phone] })).status, 200);
  });
});
