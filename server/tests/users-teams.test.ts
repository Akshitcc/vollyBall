import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import { acceptTermsFor, PEOPLE, register, startHarness, type Harness } from './helpers';

let h: Harness;
before(async () => (h = await startHarness()));
after(async () => h.close());
beforeEach(async () => h.reset());

describe('auth & basics', () => {
  it('health check works without auth; API needs a valid token', async () => {
    assert.equal((await h.api.get('/health')).status, 200);
    assert.equal((await h.api.get('/api/me')).status, 401);
    assert.equal((await h.api.get('/api/me').set('Authorization', 'Bearer nope')).status, 401);
    const r = await h.as('cap').get('/api/me');
    assert.equal(r.status, 200);
    assert.deepEqual([r.body.uid, r.body.phone, r.body.profile], ['cap', PEOPLE.cap.phone, null]);
  });

  it('CORS only for configured origins', async () => {
    const ok = await h.api.options('/api/me').set('Origin', 'http://localhost:8081');
    assert.equal(ok.headers['access-control-allow-origin'], 'http://localhost:8081');
    const no = await h.api.options('/api/me').set('Origin', 'https://evil.example');
    assert.equal(no.headers['access-control-allow-origin'], undefined);
  });
});

describe('users (rules: users/{userId}, phoneIndex, pushTokens)', () => {
  it('saves only your own profile with your verified phone; name 2..60', async () => {
    await register(h, 'cap');
    assert.equal((await h.as('bob').put('/api/users/cap').send({ name: 'Hacker', phone: PEOPLE.bob.phone })).status, 403);
    assert.equal((await h.as('bob').put('/api/users/bob').send({ name: 'Bob', phone: PEOPLE.eve.phone })).status, 403);
    assert.equal((await h.as('nophone').put('/api/users/nophone').send({ name: 'Xavier', phone: '+919999999999' })).status, 403);
    assert.equal((await h.as('bob').put('/api/users/bob').send({ name: '', phone: PEOPLE.bob.phone })).status, 400);
    assert.equal((await h.as('bob').put('/api/users/bob').send({ name: 'x'.repeat(61), phone: PEOPLE.bob.phone })).status, 400);
    const ok = await h.as('cap').put('/api/users/cap').send({ name: 'Cap Renamed', phone: PEOPLE.cap.phone, position: 'setter', city: 'Delhi' });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.name, 'Cap Renamed');
    assert.equal((await h.as('cap').del('/api/users/cap')).status, 403);
  });

  it('phone privacy: others see no phone; exact lookup by phone works; no listing', async () => {
    await register(h, 'cap', 'bob');
    const other = await h.as('bob').get('/api/users/cap');
    assert.equal(other.body.phone, '');
    assert.equal((await h.as('cap').get('/api/users/cap')).body.phone, PEOPLE.cap.phone);
    const found = await h.as('bob').get(`/api/users/by-phone/${encodeURIComponent(PEOPLE.cap.phone)}`);
    assert.equal(found.body.id, 'cap');
    assert.equal((await h.as('bob').get('/api/users/by-phone/%2B919999999999')).status, 404);
    assert.equal((await h.as('bob').get('/api/users')).status, 400);
    assert.equal((await h.as('bob').get('/api/users?ids=cap,bob,guest:a0')).body.length, 2);
  });

  it('push tokens belong to the caller', async () => {
    await register(h, 'cap', 'bob');
    assert.equal((await h.as('cap').put('/api/me/push-tokens').send({ token: 'ExponentPushToken[cap-device]' })).status, 204);
    await h.as('bob').del(`/api/me/push-tokens/${encodeURIComponent('ExponentPushToken[cap-device]')}`);
    assert.equal((await h.db('device_tokens').where({ user_id: 'cap' })).length, 1); // bob could not delete it
  });
});

async function makeTeam(captain: 'cap' = 'cap') {
  const r = await h.as(captain).post('/api/teams').send({ name: 'QA Spikers', color: '#E53935', captainId: captain, memberIds: [captain], subIds: [], pendingPhones: [] });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body.id as string;
}

describe('teams (rules: teams/{teamId})', () => {
  it('create: you are the captain and the only member, no invites, name <= 40', async () => {
    await register(h, 'cap', 'bob');
    const base = { name: 'Tigers', color: '#000000', captainId: 'cap', memberIds: ['cap'], subIds: [], pendingPhones: [] };
    assert.equal((await h.as('bob').post('/api/teams').send(base)).status, 403);
    assert.equal((await h.as('cap').post('/api/teams').send({ ...base, memberIds: ['cap', 'bob'] })).status, 403);
    assert.equal((await h.as('cap').post('/api/teams').send({ ...base, pendingPhones: [PEOPLE.bob.phone] })).status, 403);
    assert.equal((await h.as('cap').post('/api/teams').send({ ...base, name: 'x'.repeat(41) })).status, 400);
    assert.equal((await h.as('cap').post('/api/teams').send(base)).status, 201);
  });

  it('captain invites registered numbers only; invited user is notified', async () => {
    await register(h, 'cap', 'bob');
    await h.as('bob').put('/api/me/push-tokens').send({ token: 'ExponentPushToken[bob]' });
    const id = await makeTeam();
    const bad = await h.as('cap').patch(`/api/teams/${id}`).send({ pendingPhones: ['+919888888888'] });
    assert.equal(bad.status, 403);
    assert.match(bad.body.message, /isn.t on VolleyLive yet\. Ask them to register first\./);
    const ok = await h.as('cap').patch(`/api/teams/${id}`).send({ pendingPhones: [PEOPLE.bob.phone] });
    assert.equal(ok.status, 200);
    assert.deepEqual(ok.body.pendingPhones, [PEOPLE.bob.phone]);
    await h.flushPush();
    assert.equal(h.push.sent.length, 1);
    assert.equal(h.push.sent[0].to, 'ExponentPushToken[bob]');
    assert.equal(h.push.sent[0].data.type, 'teamInvite');
    // only one pending invite per number (generated-column unique key)
    await assert.rejects(h.db('team_invites').insert({ team_id: id, phone: PEOPLE.bob.phone, invited_by: 'cap', status: 'pending', created_at: new Date() }));
  });

  it('non-captains cannot edit; captain cannot add members directly', async () => {
    await register(h, 'cap', 'bob', 'eve');
    const id = await makeTeam();
    assert.equal((await h.as('eve').patch(`/api/teams/${id}`).send({ name: 'Hijacked' })).status, 403);
    assert.equal((await h.as('cap').patch(`/api/teams/${id}`).send({ memberIds: ['cap', 'bob'] })).status, 403);
    assert.equal((await h.as('cap').patch(`/api/teams/${id}`).send({ captainId: 'bob' })).status, 403); // must be a member
    assert.equal((await h.as('cap').patch(`/api/teams/${id}`).send({ name: 'Renamed', city: 'Pune' })).body.name, 'Renamed');
  });

  it('invitee accepts (only their own invite), declines, leaves; captain cannot leave', async () => {
    await register(h, 'cap', 'bob', 'eve', 'dan');
    const id = await makeTeam();
    await h.as('cap').patch(`/api/teams/${id}`).send({ pendingPhones: [PEOPLE.bob.phone] });
    await h.as('cap').patch(`/api/teams/${id}`).send({ pendingPhones: [PEOPLE.bob.phone, PEOPLE.dan.phone] });
    assert.equal((await h.as('eve').post(`/api/teams/${id}/accept`)).status, 403);
    // privacy: a non-captain sees only their own pending number
    assert.deepEqual((await h.as('bob').get(`/api/teams/${id}`)).body.pendingPhones, [PEOPLE.bob.phone]);
    assert.equal((await h.as('eve').get(`/api/teams?invitedPhone=${encodeURIComponent(PEOPLE.bob.phone)}`)).status, 403);
    assert.equal((await h.as('bob').get(`/api/teams?invitedPhone=${encodeURIComponent(PEOPLE.bob.phone)}`)).body.length, 1);
    const acc = await h.as('bob').post(`/api/teams/${id}/accept`);
    assert.equal(acc.status, 200);
    assert.deepEqual(acc.body.memberIds, ['cap', 'bob']);
    const dec = await h.as('dan').post(`/api/teams/${id}/decline`);
    assert.equal(dec.status, 200);
    assert.deepEqual((await h.as('cap').get(`/api/teams/${id}`)).body.pendingPhones, []);
    assert.equal((await h.db('team_invites').where({ phone: PEOPLE.dan.phone }).first()).status, 'declined');
    // bob can't change anything else while leaving
    assert.equal((await h.as('bob').patch(`/api/teams/${id}`).send({ memberIds: ['cap'], name: 'Xy' })).status, 403);
    assert.deepEqual((await h.as('bob').post(`/api/teams/${id}/leave`)).body.memberIds, ['cap']);
    assert.equal((await h.as('cap').post(`/api/teams/${id}/leave`)).status, 403);
    assert.equal((await h.as('bob').get(`/api/teams?member=bob`)).body.length, 0);
  });

  it('generic PATCH mirrors the old Firestore writes (accept via arrays)', async () => {
    await register(h, 'cap', 'bob');
    const id = await makeTeam();
    await h.as('cap').patch(`/api/teams/${id}`).send({ pendingPhones: [PEOPLE.bob.phone] });
    const r = await h.as('bob').patch(`/api/teams/${id}`).send({ memberIds: ['cap', 'bob'], pendingPhones: [] });
    assert.equal(r.status, 200, JSON.stringify(r.body));
  });

  it('limits: 6 starters then subs, max 6 subs, members + pending <= 12', async () => {
    const phones: string[] = [];
    await register(h, 'cap');
    await acceptTermsFor(h.db, [...Array.from({ length: 11 }, (_, i) => `p${i}`), 'late']);
    const id = await makeTeam();
    for (let i = 0; i < 11; i++) {
      const who = { uid: `p${i}`, phone: `+9191000000${String(i).padStart(2, '0')}` };
      phones.push(who.phone);
      await h.as(who).put(`/api/users/${who.uid}`).send({ name: `Player ${i}`, phone: who.phone });
      const inv = await h.as('cap').patch(`/api/teams/${id}`).send({ pendingPhones: [who.phone] });
      assert.equal(inv.status, 200, JSON.stringify(inv.body));
      const acc = await h.as(who).post(`/api/teams/${id}/accept`);
      assert.equal(acc.status, 200, JSON.stringify(acc.body));
    }
    const t = (await h.as('cap').get(`/api/teams/${id}`)).body;
    assert.equal(t.memberIds.length, 12);
    assert.equal(t.subIds.length, 6); // players 6..11 joined as subs automatically
    assert.ok(t.subIds.includes('p5') && !t.subIds.includes('p4'));
    const extra = { uid: 'late', phone: '+919100000099' };
    await h.as(extra).put('/api/users/late').send({ name: 'Late', phone: extra.phone });
    assert.equal((await h.as('cap').patch(`/api/teams/${id}`).send({ pendingPhones: [extra.phone] })).status, 403);
    assert.equal((await h.as('cap').patch(`/api/teams/${id}`).send({ subIds: [...t.subIds, 'p0'] })).status, 403);
  });

  it('search by name prefix; delete only by captain', async () => {
    await register(h, 'cap', 'bob');
    const id = await makeTeam();
    assert.equal((await h.as('bob').get('/api/teams?q=qa%20sp')).body[0].id, id);
    assert.equal((await h.as('bob').get('/api/teams?q=100%25')).body.length, 0);
    assert.equal((await h.as('bob').del(`/api/teams/${id}`)).status, 403);
    assert.equal((await h.as('cap').del(`/api/teams/${id}`)).status, 204);
    assert.equal((await h.as('cap').get(`/api/teams/${id}`)).status, 404);
  });
});
