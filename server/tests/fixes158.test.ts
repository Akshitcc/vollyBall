/**
 * 1.5.8 – Tester's full from-scratch E2E of 1.5.7 (fixes-retest.md "1.5.7 full from-scratch E2E (29 Oct)").
 *  - F157x-1 (Medium): a match created / scored by someone on NEITHER roster counts only after BOTH captains confirm
 *    (replays the Tester's X-1 / Z-1 steps); a repeated answer is 409 (Info).
 *  - F157x-3 (Medium): GET /api/users/by-phone is rate limited (per user + per-IP backstop, 429) and returns only
 *    id, name and photo.
 *  - F157x-2 (Low): absurd match rules are refused with 400; the presets still pass.
 */
import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import { BEACH_RULES, INDOOR_RULES } from '../../src/core/rules';
import { EVERYONE, PEOPLE, SQUAD_A, SQUAD_B, createMatch, newMatchBody, pt, register, startHarness, type Harness } from './helpers';
import { PHONE_LOOKUP_RATE } from '../src/routes/api';

let h: Harness;
before(async () => (h = await startHarness()));
after(async () => h.close());
beforeEach(async () => {
  await h.reset();
  await register(h, ...EVERYONE);
});

type Who = Parameters<Harness['as']>[0];
const code = (r: { status: number; body: { error?: string } }, status: number, err?: string) => {
  assert.equal(r.status, status, JSON.stringify(r.body));
  if (err) assert.equal(r.body.error, err, JSON.stringify(r.body));
};
const sweep = (credits: string[], side: 'A' | 'B') => credits.map((c, i) => pt(side, 1000 + i, c));
const WIN_B = sweep(['dan', 'dan', 'dan', 'aarav', 'aarav'], 'B');
const WIN_A = sweep(['bob', 'bob', 'bob', 'cap', 'cap'], 'A');
const counted = async (who: Who) => (await h.as(who).get('/api/me/wallet')).body.countedMatches as number;
const view = async (id: string, who: Who = 'eve') => (await h.as(who).get(`/api/matches/${id}`)).body;
const realLength = (id: string) => h.db('matches').where({ id }).update({ started_server_at: new Date(Date.now() - 40 * 60_000), finished_at: new Date(Date.now() - 60_000) });

/** eve (a participant on neither roster) creates and scores QA Spikers (captain cap) vs Delhi Smashers (captain aarav). */
async function neutralDone() {
  const r = await h.as('eve').post('/api/matches').send(newMatchBody({ createdBy: 'eve', scorerId: 'eve', participantIds: [...SQUAD_A, ...SQUAD_B, 'eve'] }));
  code(r, 201);
  const id = r.body.id as string;
  code(await h.as('eve').put(`/api/matches/${id}/progress`).send({ events: WIN_B }), 200);
  code(await h.as('eve').put(`/api/matches/${id}/player-of-match`).send({ playerId: 'dan' }), 200);
  await realLength(id);
  return id;
}

describe('F157x-1: neutral creator / scorer -> both captains confirm', () => {
  it('Z-1 replay: B confirms -> still pending, not counted; A can still reject (200 disputed, never counted)', async () => {
    const id = await neutralDone();
    const before = { a: await counted('bob'), b: await counted('dan') };
    const one = await h.as('aarav').post(`/api/matches/${id}/confirm`);
    code(one, 200);
    assert.equal(one.body.verification.status, 'pending');
    assert.equal(one.body.verification.captain, null);
    assert.equal(one.body.verification.first.by, 'aarav');
    assert.equal(await counted('dan'), before.b, 'one captain alone must not make it count');
    assert.equal(await counted('bob'), before.a);
    code(await h.as('aarav').post(`/api/matches/${id}/confirm`), 409, 'already_reviewed');
    code(await h.as('aarav').post(`/api/matches/${id}/reject`).send({ reason: 'oops' }), 409, 'already_reviewed');
    const rej = await h.as('cap').post(`/api/matches/${id}/reject`).send({ reason: 'We never played this' });
    code(rej, 200); // was 409 already_reviewed in 1.5.7
    assert.equal(rej.body.verification.status, 'disputed');
    assert.equal(rej.body.verification.captain, 'rejected');
    assert.equal(await counted('dan'), before.b);
    assert.equal(await counted('bob'), before.a);
    code(await h.as('cap').post(`/api/matches/${id}/confirm`), 409, 'already_reviewed');
  });
  it('X-1 replay: both captains confirm -> counted for both sides; a second confirm is 409 (Info)', async () => {
    const id = await neutralDone();
    code(await h.as('cap').post(`/api/matches/${id}/confirm`), 200);
    assert.equal((await view(id)).verification.status, 'pending');
    assert.equal(await counted('dan'), 0);
    const two = await h.as('aarav').post(`/api/matches/${id}/confirm`);
    code(two, 200);
    assert.equal(two.body.verification.status, 'confirmed');
    assert.equal(two.body.verification.captain, 'confirmed');
    assert.equal(two.body.verification.by, 'aarav');
    assert.equal(two.body.verification.first.by, 'cap');
    assert.equal(await counted('dan'), 1);
    assert.equal(await counted('bob'), 1);
    code(await h.as('aarav').post(`/api/matches/${id}/confirm`), 409, 'already_reviewed');
    code(await h.as('cap').post(`/api/matches/${id}/confirm`), 409, 'already_reviewed');
  });
  it('a reject straight away still works; the scorer and players can not answer', async () => {
    const id = await neutralDone();
    code(await h.as('eve').post(`/api/matches/${id}/confirm`), 403);
    code(await h.as('bob').post(`/api/matches/${id}/confirm`), 403, 'not_captain');
    code(await h.as('dan').post(`/api/matches/${id}/confirm`), 403, 'not_captain');
    code(await h.as('aarav').post(`/api/matches/${id}/reject`).send({}), 200);
    assert.equal((await view(id)).verification.status, 'disputed');
  });
  it('creator on one team: unchanged – the opposing captain alone confirms and it counts', async () => {
    const id = await createMatch(h);
    code(await h.as('cap').put(`/api/matches/${id}/progress`).send({ events: WIN_A }), 200);
    code(await h.as('cap').put(`/api/matches/${id}/player-of-match`).send({ playerId: 'bob' }), 200);
    await realLength(id);
    const r = await h.as('aarav').post(`/api/matches/${id}/confirm`);
    code(r, 200);
    assert.equal(r.body.verification.status, 'confirmed');
    assert.equal(r.body.verification.first ?? null, null);
    assert.equal(await counted('bob'), 1);
    code(await h.as('aarav').post(`/api/matches/${id}/confirm`), 409, 'already_reviewed');
  });
  it('the first confirm is stored in matches.first_confirm (migration 0029); the other captain then decides', async () => {
    const id = await neutralDone();
    code(await h.as('aarav').post(`/api/matches/${id}/confirm`), 200);
    const row = await h.db('matches').where({ id }).first('first_confirm', 'verification_status', 'captain_verdict');
    assert.ok(row.first_confirm);
    assert.deepEqual([row.verification_status, row.captain_verdict], ['pending', null]);
    code(await h.as('cap').post(`/api/matches/${id}/confirm`), 200);
    assert.equal(await counted('dan'), 1);
  });
});

describe('F157x-3: by-phone lookup – rate limit and minimal fields', () => {
  const PHONE_OF = (n: number) => `+9198${String(70000000 + n).padStart(8, '0')}`;
  it('returns only id, name and photo (no phone, position, city …)', async () => {
    const r = await h.as('cap').get(`/api/users/by-phone/${encodeURIComponent(PEOPLE.dan.phone)}`);
    code(r, 200);
    assert.deepEqual(Object.keys(r.body).sort(), ['id', 'name', 'photoURL']);
    assert.equal(r.body.id, 'dan');
  });
  it('a 300-number sweep by one user hits 429 quickly (with Retry-After)', async () => {
    let first429 = 0;
    for (let i = 0; i < 300; i++) {
      const r = await h.as('cap').get(`/api/users/by-phone/${encodeURIComponent(PHONE_OF(i))}`);
      if (r.status === 429) {
        first429 = i + 1;
        assert.equal(r.body.error, 'rate_limited');
        assert.ok(Number(r.headers['retry-after']) > 0);
        break;
      }
      assert.equal(r.status, 404);
    }
    assert.ok(first429 > 0 && first429 <= PHONE_LOOKUP_RATE.user.burst + 2, `429 after ${first429} lookups`);
  });
  it('per-IP backstop: several users from one address are stopped too', async () => {
    const who: Who[] = ['cap', 'bob', 'aarav', 'dan', 'eve'];
    let n = 0, limited = false;
    for (const w of who) {
      for (let i = 0; i < PHONE_LOOKUP_RATE.user.burst - 1 && !limited; i++, n++) {
        const r = await h.as(w).get(`/api/users/by-phone/${encodeURIComponent(PHONE_OF(1000 + n))}`);
        if (r.status === 429) limited = true;
      }
    }
    assert.ok(limited, `no 429 after ${n} lookups from one IP`);
    assert.ok(n <= PHONE_LOOKUP_RATE.ip.burst + 2);
  });
});

describe('F157x-2: absurd match rules are refused (400); presets pass', () => {
  it('points per set >= 5, win by 1 or 2, best of 1/3/5', async () => {
    for (const bad of [{ pointsPerSet: 1 }, { pointsPerSet: 4 }, { winBy: 0 }, { winBy: 3 }, { winBy: 5 }, { bestOf: 2 }, { bestOf: 7 }]) {
      const r = await h.as('cap').post('/api/matches').send(newMatchBody({ rules: { ...INDOOR_RULES, preset: 'custom', ...bad } }));
      assert.equal(r.status, 400, JSON.stringify(bad));
    }
    for (const ok of [INDOOR_RULES, BEACH_RULES, { ...INDOOR_RULES, bestOf: 1, pointsPerSet: 5, winBy: 1 }, { ...INDOOR_RULES, preset: 'custom', bestOf: 3, pointsPerSet: 11, winBy: 2 }]) {
      code(await h.as('cap').post('/api/matches').send(newMatchBody({ rules: ok })), 201);
    }
  });
});
