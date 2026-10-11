/** QA C130-2 / X-07 (1.3.1): per-user in-memory rate limits on accept T&C, confirm/reject and match writes. */
import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import { EVERYONE, createMatch, pt, register, startHarness, type Harness } from './helpers';
import { TERMS_VERSION } from '../../src/core/terms';
import { DEFAULT_RATE_LIMITS, RATE_LIMITED, RateLimiter } from '../src/rateLimit';

let h: Harness;
before(async () => (h = await startHarness()));
after(async () => h.close());
beforeEach(async () => {
  await h.reset();
  await register(h, ...EVERYONE);
  // restore the defaults a test may have lowered
  Object.assign(h.s.rateLimiter!.limits, { terms: { ...DEFAULT_RATE_LIMITS.terms }, verify: { ...DEFAULT_RATE_LIMITS.verify }, matchWrite: { ...DEFAULT_RATE_LIMITS.matchWrite } });
});

describe('RateLimiter (unit)', () => {
  it('allows the burst, then refuses with the seconds to wait, and refills over time; buckets are per user and per action', () => {
    let now = 0;
    const l = new RateLimiter({ terms: { burst: 2, perMinute: 6 }, verify: { burst: 1, perMinute: 1 }, matchWrite: { burst: 3, perMinute: 60 } }, () => now);
    assert.equal(l.take('u1', 'terms'), 0);
    assert.equal(l.take('u1', 'terms'), 0);
    assert.equal(l.take('u1', 'terms'), 10); // 6/min -> one token every 10 s
    assert.equal(l.take('u2', 'terms'), 0); // another user has their own bucket
    assert.equal(l.take('u1', 'verify'), 0); // another action too
    now += 10_000;
    assert.equal(l.take('u1', 'terms'), 0);
    assert.equal(l.take('u1', 'terms'), 10);
    now += 10 * 60_000;
    l.take('zz', 'matchWrite'); // sweep: full buckets are dropped
    assert.ok(l.size <= 1);
  });
  it('defaults: rare actions are tight, match writes allow fast scoring', () => {
    assert.ok(DEFAULT_RATE_LIMITS.terms.burst <= 10 && DEFAULT_RATE_LIMITS.verify.burst <= 20);
    assert.ok(DEFAULT_RATE_LIMITS.matchWrite.perMinute >= 60);
    assert.ok(Object.isFrozen(DEFAULT_RATE_LIMITS));
  });
});

describe('API answers 429 rate_limited', () => {
  it('accept T&C: a burst past the limit is 429 with Retry-After; other users are not affected', async () => {
    h.s.rateLimiter!.limits.terms = { burst: 3, perMinute: 1 };
    for (let i = 0; i < 3; i++) assert.equal((await h.as('cap').post('/api/me/terms/accept').send({ version: TERMS_VERSION })).status, 200);
    const r = await h.as('cap').post('/api/me/terms/accept').send({ version: TERMS_VERSION });
    assert.equal(r.status, 429);
    assert.equal(r.body.error, RATE_LIMITED);
    assert.ok(r.body.retryAfter >= 1);
    assert.equal(r.headers['retry-after'], String(r.body.retryAfter));
    assert.equal((await h.as('bob').post('/api/me/terms/accept').send({ version: TERMS_VERSION })).status, 200);
  });
  it('confirm and reject share the verify bucket', async () => {
    h.s.rateLimiter!.limits.verify = { burst: 2, perMinute: 1 };
    assert.notEqual((await h.as('eve').post('/api/matches/nope/confirm')).status, 429);
    assert.notEqual((await h.as('eve').post('/api/matches/nope/reject').send({ reason: 'x' })).status, 429);
    const r = await h.as('eve').post('/api/matches/nope/confirm');
    assert.equal(r.status, 429);
    assert.equal(r.body.error, RATE_LIMITED);
  });
  it('match writes (create, progress, patch, POTM, delete, photos) are limited per user', async () => {
    const id = await createMatch(h);
    h.s.rateLimiter!.limits.matchWrite = { burst: 2, perMinute: 1 };
    h.s.rateLimiter!.reset();
    assert.equal((await h.as('cap').put(`/api/matches/${id}/progress`).send({ events: [pt('A', 1000)] })).status, 200);
    assert.equal((await h.as('cap').patch(`/api/matches/${id}`).send({ title: 'Evening' })).status, 200);
    for (const req of [
      h.as('cap').put(`/api/matches/${id}/progress`).send({ events: [pt('A', 1000), pt('B', 2000)] }),
      h.as('cap').post('/api/matches').send({}),
      h.as('cap').put(`/api/matches/${id}/player-of-match`).send({ playerId: 'bob' }),
      h.as('cap').del(`/api/matches/${id}`),
      h.as('cap').post(`/api/matches/${id}/photos`).send('x'),
    ]) {
      const r = await req;
      assert.equal(r.status, 429, JSON.stringify(r.body));
    }
    // reads are never limited
    assert.equal((await h.as('cap').get(`/api/matches/${id}`)).status, 200);
  });
});
