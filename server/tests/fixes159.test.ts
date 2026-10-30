/**
 * 1.5.9 – Tester fixes-retest.md "1.5.8" section.
 *  - F158-1: the deciding-set target is >= 5 (API schema; the Firestore rules mirror it in rules-tests).
 *  - F158-2: inviting by phone (PATCH /teams/:id pendingPhones) shares the by-phone per-user + per-IP limits, and the
 *    response is the same whether the number is registered or not (no enumeration through invites).
 *  - F158-11: the admin review list holds played matches only (never a scheduled one); approve / void on a match that
 *    isn't finished is 409.
 */
import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import { INDOOR_RULES } from '../../src/core/rules';
import { ADMIN, EVERYONE, PEOPLE, createMatch, newMatchBody, register, startHarness, type Harness } from './helpers';
import { PHONE_LOOKUP_RATE } from '../src/routes/api';

let h: Harness;
before(async () => (h = await startHarness()));
after(async () => h.close());
beforeEach(async () => {
  await h.reset();
  h.s.rateLimiter?.reset();
  await register(h, ...EVERYONE, 'zed');
});

const rules3 = (decidingSetPoints: number) => ({ ...INDOOR_RULES, bestOf: 3, pointsPerSet: 25, decidingSetPoints, decidingSwitchAt: Math.max(1, Math.ceil(Math.min(decidingSetPoints, 99) / 2)) });

describe('F158-1: deciding-set target >= 5', () => {
  for (const d of [0, 1, 4]) {
    it(`decidingSetPoints ${d} is refused (400)`, async () => {
      const r = await h.as('cap').post('/api/matches').send(newMatchBody({ rules: rules3(d) }));
      assert.equal(r.status, 400, JSON.stringify(r.body));
    });
  }
  for (const d of [5, 15, 99]) {
    it(`decidingSetPoints ${d} is accepted`, async () => {
      const r = await h.as('cap').post('/api/matches').send(newMatchBody({ rules: rules3(d) }));
      assert.equal(r.status, 201, JSON.stringify(r.body));
    });
  }
  it('100 is refused', async () => {
    assert.equal((await h.as('cap').post('/api/matches').send(newMatchBody({ rules: rules3(100) }))).status, 400);
  });
  void createMatch;
});

const newTeam = async (captain: 'cap' | 'aarav' = 'cap', name = 'Invite Test') => {
  const r = await h.as(captain).post('/api/teams').send({ name, color: '#E53935', captainId: captain, memberIds: [captain], subIds: [], pendingPhones: [] });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body.id as string;
};
const UNREG = (n: number) => `+9197${String(60000000 + n).padStart(8, '0')}`;

describe('F158-2: invite-by-phone shares the by-phone limits; same response registered or not', () => {
  it('registered and unregistered numbers get the same status and the same response shape', async () => {
    const t1 = await newTeam('cap', 'Reg');
    const t2 = await newTeam('cap', 'Unreg');
    const a = await h.as('cap').patch(`/api/teams/${t1}`).send({ pendingPhones: [PEOPLE.zed.phone] });
    const b = await h.as('cap').patch(`/api/teams/${t2}`).send({ pendingPhones: [UNREG(1)] });
    assert.equal(a.status, 200, JSON.stringify(a.body));
    assert.equal(b.status, 200, JSON.stringify(b.body));
    assert.deepEqual(Object.keys(a.body).sort(), Object.keys(b.body).sort());
    assert.deepEqual(a.body.pendingPhones, [PEOPLE.zed.phone]);
    assert.deepEqual(b.body.pendingPhones, [UNREG(1)]);
    assert.deepEqual(a.body.memberIds, b.body.memberIds);
  });

  it('per user: invites and by-phone lookups drain the same bucket -> 429 rate_limited with Retry-After', async () => {
    const burst = PHONE_LOOKUP_RATE.user.burst;
    for (let i = 0; i < burst; i++) {
      const r = await h.as('cap').get(`/api/users/by-phone/${encodeURIComponent(UNREG(100 + i))}`);
      assert.notEqual(r.status, 429, `lookup ${i + 1} of ${burst}`);
    }
    const t = await newTeam();
    const r = await h.as('cap').patch(`/api/teams/${t}`).send({ pendingPhones: [UNREG(500)] });
    assert.equal(r.status, 429, JSON.stringify(r.body));
    assert.equal(r.body.error, 'rate_limited');
    assert.ok(Number(r.headers['retry-after']) >= 1);
    // the refused invite was not stored
    assert.deepEqual((await h.as('cap').get(`/api/teams/${t}`)).body.pendingPhones, []);
  });

  it('per user: inviting alone hits the limit too (a registered number costs the same as an unregistered one)', async () => {
    const t = await newTeam();
    let first429 = 0;
    const phones: string[] = [];
    for (let i = 0; i < PHONE_LOOKUP_RATE.user.burst + 5 && !first429; i++) {
      // swap one pending number for another each time so the team never fills up
      const p = i % 2 ? PEOPLE.zed.phone : UNREG(700 + i);
      const r = await h.as('cap').patch(`/api/teams/${t}`).send({ pendingPhones: [p] });
      if (r.status === 429) first429 = i + 1;
      else assert.equal(r.status, 200, JSON.stringify(r.body));
      phones.push(p);
    }
    assert.ok(first429 > 0 && first429 <= PHONE_LOOKUP_RATE.user.burst + 1, `429 by the burst (+1), got ${first429}`);
  });

  it('only newly added numbers cost a lookup: re-saving the same pending list is free', async () => {
    const t = await newTeam();
    assert.equal((await h.as('cap').patch(`/api/teams/${t}`).send({ pendingPhones: [UNREG(900)] })).status, 200);
    for (let i = 0; i < PHONE_LOOKUP_RATE.user.burst + 5; i++) {
      const r = await h.as('cap').patch(`/api/teams/${t}`).send({ pendingPhones: [UNREG(900)], name: `Invite Test ${i}` });
      assert.equal(r.status, 200, `save ${i}: ${JSON.stringify(r.body)}`);
    }
  });

  it('per IP: many users from one address hit the shared IP backstop', async () => {
    let limited = false;
    const users = ['cap', 'bob', 'eve', 'dan', 'aarav', 'a3', 'a4', 'a5'] as const;
    for (const w of users) {
      if (limited) break;
      for (let n = 0; n < PHONE_LOOKUP_RATE.user.burst && !limited; n++) {
        const r = await h.as(w).get(`/api/users/by-phone/${encodeURIComponent(UNREG(2000 + users.indexOf(w) * 100 + n))}`);
        if (r.status === 429) limited = true;
      }
    }
    assert.ok(limited, 'per-IP backstop');
    const t = await newTeam('aarav');
    const r = await h.as('aarav').patch(`/api/teams/${t}`).send({ pendingPhones: [UNREG(3)] });
    assert.equal(r.status, 429, 'invites share the per-IP bucket');
  });
});

describe('F158-11: admin review = played matches only; approve / void on a non-finished match is 409', () => {
  it('scheduled and live matches: approve and void are 409 not_completed; neither is on the list', async () => {
    const sch = await createMatch(h, { status: 'scheduled', startedAt: null, scheduledAt: Date.now() + 86_400_000 });
    const live = await createMatch(h);
    for (const id of [sch, live]) {
      for (const decision of ['approve', 'void'] as const) {
        const r = await h.as(ADMIN).post(`/api/admin/matches/${id}/review`).send({ decision });
        assert.equal(r.status, 409, `${id} ${decision}: ${JSON.stringify(r.body)}`);
        assert.equal(r.body.error, 'not_completed');
      }
    }
    // even a scheduled row that looks flagged / unconfirmable in the DB stays off the list
    await h.db('matches').where({ id: sch }).update({ verification_status: 'pending', player_of_match_id: 'bob' });
    const list = (await h.as(ADMIN).get('/api/admin/matches/flagged')).body as { id: string; status: string }[];
    assert.ok(!list.some((m) => m.id === sch || m.id === live), JSON.stringify(list.map((m) => [m.id, m.status])));
    assert.ok(list.every((m) => m.status === 'finished' || m.status === 'abandoned' || m.status === 'live'));
  });
});

describe('F158-12: never more than 6 starters', () => {
  it('a captain can\'t make a 7th starter (subs -> []), can move players to subs', async () => {
    const t = await newTeam('cap', 'Starters');
    // 7 members: cap + 6 invited and accepted; the 7th joined as a sub (6 starters already)
    const who = ['bob', 'eve', 'dan', 'a3', 'a4', 'a5'] as const;
    assert.equal((await h.as('cap').patch(`/api/teams/${t}`).send({ pendingPhones: who.map((w) => PEOPLE[w].phone) })).status, 200);
    for (const w of who) assert.equal((await h.as(w).post(`/api/teams/${t}/accept`)).status, 200, w);
    const team = (await h.as('cap').get(`/api/teams/${t}`)).body as { memberIds: string[]; subIds: string[] };
    assert.equal(team.memberIds.length, 7);
    assert.equal(team.memberIds.filter((m) => !team.subIds.includes(m)).length, 6, 'the 7th joined as a sub');
    const r = await h.as('cap').patch(`/api/teams/${t}`).send({ subIds: [] });
    assert.equal(r.status, 403, JSON.stringify(r.body));
    assert.match(r.body.message, /At most 6 starters/);
    assert.equal((await h.as('cap').patch(`/api/teams/${t}`).send({ subIds: [...team.subIds, 'bob'] })).status, 200);
  });
});
