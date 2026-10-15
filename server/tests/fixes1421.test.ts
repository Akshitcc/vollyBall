/** 1.4.21 regression tests on the API: Hindi support message limit in visible characters (V1420-4, migration 0022),
 * Ask parity EN/HI + delete account (V1420-1/2), libero → FAQ link (V1420-6). */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, beforeEach, describe, it } from 'node:test';
import { EVERYONE, register, startHarness, type Harness } from './helpers';
import { MIGRATIONS_DIR } from '../src/db/migrate';

let h: Harness;
before(async () => (h = await startHarness()));
after(async () => h.close());
beforeEach(async () => { await h.reset(); await register(h, ...EVERYONE); });
const ok = { topic: 'scoring', appVersion: '1.4.21 (37)' };

describe('1.4.21 fixes', () => {
  it('0022 only widens the message column', () => {
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, '0022_support_message_visible.sql'), 'utf8');
    assert.match(sql, /MODIFY COLUMN message VARCHAR\(8000\) NOT NULL/);
    assert.doesNotMatch(sql, /\b(DROP|TRUNCATE|DELETE)\b/i);
  });
  it('V1420-4: 2000 visible Hindi characters (8000 code points) are saved whole; 2001 are refused', async () => {
    const msg = 'क्षि'.repeat(2000);
    const r = await h.as('cap').post('/api/support/tickets').send({ ...ok, message: msg });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    const mine = (await h.as('cap').get('/api/support/tickets')).body;
    assert.equal(mine[0].message, msg);
    const bad = await h.as('cap').post('/api/support/tickets').send({ ...ok, message: msg + 'क' });
    assert.equal(bad.status, 400);
    assert.equal(bad.body.error, 'support_message_long');
  });
  it('V1420-1/2/6: same sources EN and HI, each in its language; delete account; libero links the FAQ', async () => {
    const ask = async (question: string, lang: string, who: 'cap' | 'eve' = 'cap') => {
      const r = await h.as(who).post('/api/ask').send({ question, lang });
      assert.equal(r.status, 200, JSON.stringify(r.body));
      return r.body as { answer: string; idk: boolean; sources: { id: string; title: string; url: string }[] };
    };
    for (const q of ['how do I delete my account', 'what is a libero', 'लिबेरो क्या है', 'How many points win a set?']) {
      const e = await ask(q, 'en'), hi = await ask(q, 'hi');
      assert.deepEqual(hi.sources.map((s) => s.id), e.sources.map((s) => s.id), q);
      assert.match(hi.answer, /[\u0900-\u097F]/, q);
    }
    const d = await ask('how do I delete my account', 'hi', 'eve');
    assert.equal(d.sources[0].id, 'faq:account-delete');
    assert.ok(!d.sources.some((s) => s.id.startsWith('faq:tour')));
    const l = await ask('what is a libero', 'hi', 'eve');
    assert.equal(l.sources[0].url, 'volleylive://help?faq=team-positions');
  });
});
