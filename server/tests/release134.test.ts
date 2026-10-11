/**
 * 1.3.4 on the API server: sign-up rows from the first /me (hardening c), per-match photo cap (D133-2)
 * and content-hash de-duplication (D133-3), and the on-court check for credited points (D133-5).
 */
import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import { EVERYONE, createMatch, pt, register, startHarness, type Harness, SQUAD_A, SQUAD_B, playersOf, team, regFor } from './helpers';
import { MAX_PHOTOS_PER_MATCH } from '../../src/core/limits';

let h: Harness;
before(async () => (h = await startHarness()));
after(async () => h.close());
beforeEach(async () => {
  await h.reset();
  await register(h, ...EVERYONE, 'zed');
});

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a6d10000000049454e44ae426082', 'hex');
const png = (n: number) => {
  const b = Buffer.from(PNG);
  b.writeUInt16BE(n, 22);
  return b;
};
const up = (id: string, body: Buffer, who: 'cap' | 'bob' = 'cap') => h.as(who).post(`/api/matches/${id}/photos`).set('Content-Type', 'image/png').send(body);

describe('sign-up rows from the first /me', () => {
  const newbie = { uid: 'dev_919015797436', phone: '+919015797436' };
  it('creates a minimal users row (id + E.164 phone) once; it is not a profile until PUT saves one', async () => {
    const r1 = await h.as(newbie).get('/api/me');
    assert.equal(r1.status, 200);
    assert.equal(r1.body.profile, null);
    const rows = await h.db('users').where({ id: newbie.uid });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].phone, '+919015797436');
    assert.equal(rows[0].profile_complete, 0);
    // idempotent
    await h.as(newbie).get('/api/me');
    assert.equal(Number((await h.db('users').where({ phone: '+919015797436' }).count({ n: '*' }))[0].n), 1);
    // not findable / addable as a registered player yet
    assert.equal((await h.as('cap').get('/api/users/by-phone/%2B919015797436')).status, 404);
    assert.equal((await h.as('cap').get(`/api/users/${newbie.uid}`)).status, 404);
    // the existing PUT upsert completes it
    await h.db('terms_acceptances').insert({ user_id: newbie.uid, version: (await h.as(newbie).get('/api/me')).body.currentTermsVersion, accepted_at: new Date() });
    const put = await h.as(newbie).put(`/api/users/${newbie.uid}`).send({ name: 'New Person', phone: newbie.phone, position: 'any', ...regFor('New Person') });
    assert.equal(put.status, 200, JSON.stringify(put.body));
    const row = await h.db('users').where({ id: newbie.uid }).first();
    assert.deepEqual([row.name, row.profile_complete], ['New Person', 1]);
    assert.equal((await h.as(newbie).get('/api/me')).body.profile.name, 'New Person');
    assert.equal((await h.as('cap').get('/api/users/by-phone/%2B919015797436')).status, 200);
  });
  it('leaves existing profiles alone and skips identities without a phone or with a taken number', async () => {
    await h.as('cap').get('/api/me');
    const cap = await h.db('users').where({ id: 'cap' }).first();
    assert.deepEqual([cap.name, cap.profile_complete], ['Captain Cool', 1]);
    assert.equal((await h.as('nophone').get('/api/me')).status, 200);
    assert.equal(await h.db('users').where({ id: 'nophone' }).first(), undefined);
    // another uid claiming cap's number gets no row (and /me still works)
    assert.equal((await h.as({ uid: 'imposter', phone: '+919000000001' }).get('/api/me')).status, 200);
    assert.equal(await h.db('users').where({ id: 'imposter' }).first(), undefined);
  });
});

describe('match photos: per-match cap and duplicate refusal', () => {
  it('refuses the same image twice in a match (photo_duplicate) but allows it in another match', async () => {
    const id = await createMatch(h);
    assert.equal((await up(id, png(1))).status, 201);
    const again = await up(id, png(1), 'bob');
    assert.equal(again.status, 409);
    assert.equal(again.body.error, 'photo_duplicate');
    const row = await h.db('match_photos').where({ match_id: id }).first();
    assert.match(row.content_hash, /^[0-9a-f]{64}$/);
    const other = await createMatch(h);
    assert.equal((await up(other, png(1))).status, 201);
  });
  it(`stops at ${MAX_PHOTOS_PER_MATCH} photos per match (photo_limit)`, async () => {
    const id = await createMatch(h);
    for (let i = 0; i < MAX_PHOTOS_PER_MATCH; i++) {
      const r = await up(id, png(100 + i));
      assert.equal(r.status, 201, `photo ${i + 1}: ${r.status}`);
    }
    const over = await up(id, png(999));
    assert.equal(over.status, 409);
    assert.equal(over.body.error, 'photo_limit');
    assert.equal(over.body.max, MAX_PHOTOS_PER_MATCH);
  });
  it('photos added before 0007 (NULL hash) never block anything', async () => {
    const id = await createMatch(h);
    await up(id, png(7));
    await h.db('match_photos').where({ match_id: id }).update({ content_hash: null });
    assert.equal((await up(id, png(8))).status, 201);
  });
});

describe('credited points: only players on court', () => {
  // 7-player team A: the 7th (zed) starts on the bench (default lineup = first six)
  const sevenA = () => ({ teamA: team('QA Spikers', playersOf([...SQUAD_A, 'zed'])), teamB: team('Delhi Smashers', playersOf(SQUAD_B)), participantIds: [...SQUAD_A, 'zed', ...SQUAD_B] });
  it('refuses a bench player (not_on_court); an on-court player is fine', async () => {
    const id = await createMatch(h, sevenA());
    const bench = await h.as('cap').put(`/api/matches/${id}/progress`).send({ events: [pt('A', 1, 'zed')] });
    assert.equal(bench.status, 400, JSON.stringify(bench.body));
    assert.equal(bench.body.error, 'not_on_court');
    const ok = await h.as('cap').put(`/api/matches/${id}/progress`).send({ events: [pt('A', 1, 'a3')] });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
  });
  it('follows the set lineup (a substitution at the start of the set puts the 7th player on court)', async () => {
    const id = await createMatch(h, { ...sevenA(), lineups: { '1': { A: ['zed', 'bob', 'a3', 'a4', 'a5', 'a6'], B: [...SQUAD_B] } } });
    const r = await h.as('cap').put(`/api/matches/${id}/progress`).send({ events: [pt('A', 1, 'zed')] });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const capNow = await h.as('cap').put(`/api/matches/${id}/progress`).send({ events: [pt('A', 1, 'zed'), pt('A', 2, 'cap')] });
    assert.equal(capNow.status, 400); // cap was subbed out for set 1
    assert.equal(capNow.body.error, 'not_on_court');
  });
});
