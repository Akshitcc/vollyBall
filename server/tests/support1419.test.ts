/** 1.4.19 Help Center > Contact us: support tickets on the API (own tickets only; admin inbox + status; validation). */
import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import { ADMIN, EVERYONE, register, startHarness, type Harness } from './helpers';

let h: Harness;
before(async () => (h = await startHarness()));
after(async () => h.close());
beforeEach(async () => {
  await h.reset();
  await register(h, ...EVERYONE);
});
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a6d10000000049454e44ae426082', 'hex');
const ok = { topic: 'scoring', message: 'The score did not update after a rally.', appVersion: '1.4.19 (35)' };
const make = async (who: 'cap' | 'eve' = 'cap', body: object = ok) => {
  const r = await h.as(who).post('/api/support/tickets').send(body);
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body.id as string;
};

describe('1.4.19 support tickets', () => {
  it('create saves user id + app version; owner lists only their own', async () => {
    const a = await make('cap');
    await make('eve');
    const mine = (await h.as('cap').get('/api/support/tickets')).body;
    assert.equal(mine.length, 1);
    assert.equal(mine[0].id, a);
    assert.equal(mine[0].userId, 'cap');
    assert.equal(mine[0].appVersion, '1.4.19 (35)');
    assert.equal(mine[0].status, 'open');
    assert.equal(mine[0].topic, 'scoring');
  });
  it('validation: topic, message length, hidden characters stripped', async () => {
    for (const [body, code] of [
      [{ ...ok, topic: 'nope' }, 'support_topic'],
      [{ ...ok, message: 'short' }, 'support_message_short'],
      [{ ...ok, message: '\u200b\u200b   x \u200b' }, 'support_message_short'],
      [{ ...ok, message: 'x'.repeat(2001) }, 'support_message_long'],
    ] as const) {
      const r = await h.as('cap').post('/api/support/tickets').send(body);
      assert.equal(r.status, 400);
      assert.equal(r.body.error, code);
    }
    await make('cap', { ...ok, message: 'x'.repeat(2000) });
  });
  it('admin only: list all and set status; users get 403', async () => {
    const a = await make('cap');
    await make('eve');
    for (const who of ['cap', 'eve'] as const) {
      assert.equal((await h.as(who).get('/api/admin/support/tickets')).status, 403);
      assert.equal((await h.as(who).patch(`/api/admin/support/tickets/${a}`).send({ status: 'closed' })).status, 403);
    }
    assert.equal((await h.as(ADMIN).get('/api/admin/support/tickets')).body.length, 2);
    for (const st of ['replied', 'closed', 'open']) {
      const r = await h.as(ADMIN).patch(`/api/admin/support/tickets/${a}`).send({ status: st });
      assert.equal(r.status, 200);
      assert.equal(r.body.status, st);
    }
    assert.equal((await h.as(ADMIN).patch(`/api/admin/support/tickets/${a}`).send({ status: 'deleted' })).body.error, 'support_status');
    assert.equal((await h.as(ADMIN).patch('/api/admin/support/tickets/none').send({ status: 'closed' })).status, 404);
  });
  it('screenshot: owner only, image types and size; once', async () => {
    const a = await make('cap');
    const up = (who: 'cap' | 'eve', type: string, b: Buffer) => h.as(who).post(`/api/support/tickets/${a}/screenshot`).set('Content-Type', type).send(b);
    assert.equal((await up('eve', 'image/png', PNG)).status, 404);
    assert.equal((await up('cap', 'image/gif', PNG)).body.error, 'support_image_type');
    assert.equal((await up('cap', 'text/html', Buffer.from('<script>'))).body.error, 'support_image_type');
    assert.equal((await up('cap', 'image/png', Buffer.alloc(5 * 1024 * 1024))).status, 413);
    const r = await up('cap', 'image/png', PNG);
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal((await up('cap', 'image/png', PNG)).status, 409);
    const mine = (await h.as('cap').get('/api/support/tickets')).body;
    assert.match(mine[0].screenshotUrl, /support/);
  });
});
