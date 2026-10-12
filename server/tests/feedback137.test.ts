/** 1.3.7: Profile > Send feedback and the "Fact of the day" items (public read, admin-only CRUD). */
import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import { FEEDBACK_RATE } from '../src/routes/api';
import { ADMIN, startHarness, type Harness } from './helpers';

let h: Harness;
before(async () => (h = await startHarness()));
after(async () => h.close());
beforeEach(async () => h.reset());

const quote = { type: 'quote', textEn: 'Q', textHi: 'क्यू', attribution: 'Someone', sourceUrl: 'https://example.org/q', active: true };
const fact = { type: 'fact', textEn: 'The court is 18 m × 9 m.', textHi: 'कोर्ट 18 मी × 9 मी का होता है।', attribution: 'FIVB rules', active: true };

describe('1.3.7 feedback', () => {
  it('a signed-in user sends stars + text; validation; admins only can read it', async () => {
    const ok = await h.as('cap').post('/api/feedback').send({ stars: 5, text: '  Great app\u200B  ', appVersion: '1.3.7 (13)' });
    assert.equal(ok.status, 201, JSON.stringify(ok.body));
    for (const [body, code] of [[{ stars: 0 }, 'feedback_stars'], [{ stars: 6 }, 'feedback_stars'], [{ stars: 2.5 }, 'feedback_stars'], [{ stars: 3, text: 'x'.repeat(1001) }, 'feedback_too_long']] as const) {
      const r = await h.as('cap').post('/api/feedback').send(body);
      assert.equal(r.status, 400, JSON.stringify(body));
      assert.equal(r.body.error, code);
    }
    assert.equal((await h.api.post('/api/feedback').send({ stars: 5 })).status, 401);
    assert.equal((await h.as('cap').get('/api/admin/feedback')).status, 403);
    const list = await h.as(ADMIN).get('/api/admin/feedback');
    assert.equal(list.status, 200);
    assert.equal(list.body.length, 1);
    assert.equal(list.body[0].text, 'Great app');
    assert.equal(list.body[0].stars, 5);
    assert.equal(list.body[0].userId, 'cap');
    assert.equal(list.body[0].appVersion, '1.3.7 (13)');
  });
  it('is rate limited per user', async () => {
    for (let i = 0; i < FEEDBACK_RATE.burst; i++) assert.equal((await h.as('bob').post('/api/feedback').send({ stars: 4 })).status, 201);
    const r = await h.as('bob').post('/api/feedback').send({ stars: 4 });
    assert.equal(r.status, 429);
    assert.ok(r.body.retryAfter > 0);
    assert.equal((await h.as('cap').post('/api/feedback').send({ stars: 4 })).status, 201); // other users unaffected
  });
});

describe('1.3.7 daily items', () => {
  it('admin CRUD; public read without sign-in shows active items (and tombstones)', async () => {
    const c = await h.as(ADMIN).post('/api/admin/daily-items').send(fact);
    assert.equal(c.status, 201, JSON.stringify(c.body));
    const q = await h.as(ADMIN).post('/api/admin/daily-items').send(quote);
    assert.equal(q.status, 201);
    assert.equal((await h.as(ADMIN).patch(`/api/admin/daily-items/${q.body.id}`).send({ active: false })).body.active, false);
    const pub = await h.api.get('/api/daily-items');
    assert.equal(pub.status, 200);
    type Pub = { id: string; active: boolean; textEn: string; textHi: string; removedAt: number | null };
    const active = (b: Pub[]) => b.filter((x) => x.active);
    assert.deepEqual(active(pub.body).map((x) => x.id), [c.body.id]);
    assert.equal(active(pub.body)[0].textHi, fact.textHi);
    // 1.4.1 (V140-7): the item turned off is sent as a tombstone (no text, server removedAt)
    const tomb = (pub.body as Pub[]).find((x) => x.id === q.body.id)!;
    assert.equal(tomb.textEn, '');
    assert.equal(typeof tomb.removedAt, 'number');
    assert.equal((await h.as(ADMIN).get('/api/admin/daily-items')).body.length, 2);
    assert.equal((await h.as(ADMIN).del(`/api/admin/daily-items/${c.body.id}`)).status, 204);
    assert.equal((await h.as(ADMIN).del(`/api/admin/daily-items/${c.body.id}`)).status, 404);
    assert.equal(active((await h.api.get('/api/daily-items')).body).length, 0);
    assert.deepEqual((await h.as(ADMIN).get('/api/admin/daily-items')).body.map((x: Pub) => x.id), [q.body.id]); // deleted: not listed
  });
  it('non-admins cannot write; validation (quotes need attribution + https source)', async () => {
    assert.equal((await h.as('cap').post('/api/admin/daily-items').send(fact)).status, 403);
    assert.equal((await h.as('cap').get('/api/admin/daily-items')).status, 403);
    const id = (await h.as(ADMIN).post('/api/admin/daily-items').send(fact)).body.id;
    assert.equal((await h.as('cap').patch(`/api/admin/daily-items/${id}`).send({ textEn: 'hacked' })).status, 403);
    assert.equal((await h.as('cap').del(`/api/admin/daily-items/${id}`)).status, 403);
    for (const bad of [{ ...quote, sourceUrl: null }, { ...quote, attribution: '' }, { ...quote, sourceUrl: 'http://x.org' }, { ...fact, type: 'joke' }, { ...fact, textEn: '' }, { ...fact, textHi: 'x'.repeat(401) }, { ...fact, textEn: 'a\u0000b' }]) {
      const r = await h.as(ADMIN).post('/api/admin/daily-items').send(bad);
      assert.equal(r.status, 400, JSON.stringify(bad));
      assert.equal(r.body.error, 'daily_invalid');
    }
  });
});
