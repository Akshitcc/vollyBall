/**
 * 1.5.1 Tester's 1.5.0 retest on the API: F150-4 (phones in every format masked in the Ask audit), F150-7 (my last
 * results, with each result's state), the known misses ('show the ranking', 'is my match live'), F150-6 (confirm /
 * approve / finish requests refused with the screen), and the nits (a second Join is an idempotent 200; Ask lang en|hi).
 * LOCAL test database only.
 */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { PEOPLE, makeTeam, register, startHarness, type Harness } from './helpers';
import { setupAskWorld, AARAV, type AskWorld } from './askFixtures';

let h: Harness;
let w: AskWorld;
before(async () => { h = await startHarness(); w = await setupAskWorld(h); });
after(async () => { await h?.close(); });

const chat = async (who: Parameters<Harness['as']>[0], question: string, lang: unknown = 'en') => {
  h.s.rateLimiter?.reset();
  return h.as(who).post('/api/ask/chat').send(lang === undefined ? { question } : { question, lang });
};

describe('F150-4: phone numbers in every format are masked in the audit (and in answers)', () => {
  const formats = ['+919812345678', '919812345678', '098123 45678', '+91 98123 45678', '+91-9812345678', '9812345678', '0091 98123 45678', '98123-45678'];
  for (const f of formats)
    it(f, async () => {
      const q = `My number is ${f}, how do I change it? mail me at someone.name@example.com`;
      const r = await chat(AARAV, q);
      assert.equal(r.status, 200);
      const a = await h.db('ask_audit').where({ user_id: AARAV.uid }).orderBy('id', 'desc').first();
      assert.match(a.question, /\[phone hidden\]/);
      assert.match(a.question, /\[email hidden\]/);
      assert.doesNotMatch(a.question, /\d{5}/, a.question);
      // the answer and cards never carry it (the echoed question is the user's own text in their own history)
      assert.doesNotMatch(JSON.stringify({ a: r.body.answer, c: r.body.cards }), /98123|9812345678|example\.com/);
    });
});

describe('F150-7: my last results (EN / HI / roman) list each result with its state', () => {
  before(async () => {
    // the viewer's 3 latest results become voided (admin), disputed (other captain rejected) and pending (not answered)
    const r = await chat(w.juhuViewer, 'What are my last results?');
    const ids = (r.body.cards[0].items as { matchId: string }[]).map((i) => i.matchId);
    await h.db('matches').where({ id: ids[0] }).update({ verification_status: 'voided' });
    await h.db('matches').where({ id: ids[1] }).update({ verification_status: 'disputed', captain_verdict: 'rejected' });
    await h.db('matches').where({ id: ids[2] }).update({ verification_status: 'pending', captain_verdict: null });
  });
  for (const [q, lang] of [['What are my last results?', 'en'], ['मेरे पिछले नतीजे क्या हैं?', 'hi'], ['mere pichle result kya hain', 'hi']] as const)
    it(q, async () => {
      const r = await chat(w.juhuViewer, q, lang);
      assert.equal(r.status, 200);
      assert.deepEqual(r.body.tools, [{ name: 'my_matches' }]);
      const items = r.body.cards.find((c: { type: string }) => c.type === 'fixtures').items as { status: string; result: string | null }[];
      assert.ok(items.length >= 2);
      for (const i of items.filter((x) => x.status === 'finished')) assert.ok(['counted', 'awaiting', 'potm', 'review', 'reviewAwaiting', 'disputed', 'voided'].includes(i.result!), JSON.stringify(i));
      assert.deepEqual(items.slice(0, 3).map((i) => i.result), ['voided', 'disputed', 'awaiting']);
      assert.ok(items.slice(3).every((i) => i.result === 'counted'));
      if (lang === 'en') {
        assert.match(r.body.answer, /^Your last 5 results: .*\(voided by an admin – does not count\); .*\(disputed – rejected by the other captain, not counted\); .*\(pending – waiting for the other captain to confirm\); .*\(confirmed\)/);
        assert.doesNotMatch(r.body.answer, /Your last match/);
      } else assert.match(r.body.answer, /आपके पिछले 5 नतीजे: .*एडमिन ने रद्द किया.*विवादित.*दूसरे कप्तान की पुष्टि का इंतज़ार.*पुष्टि हो चुकी/);
    });
});

describe('known misses + F150-6 through the API', () => {
  it("'show the ranking' → leaderboard; 'is my match live' → the viewer's own live matches only", async () => {
    const r = await chat(AARAV, 'show the ranking');
    assert.deepEqual(r.body.tools, [{ name: 'leaderboard' }]);
    assert.equal(r.body.cards[0].kind, 'leaderboard');
    const l = await chat(w.juhuViewer, 'is my match live');
    assert.deepEqual(l.body.tools, [{ name: 'my_matches' }]);
    assert.equal(l.body.answer, 'None of your matches is live right now.');
  });
  it('confirm / approve / mark finished: read-only notice + the right screen, nothing changes', async () => {
    const before = Number((await h.db('matches').whereNotNull('verification_status').count({ n: '*' }))[0].n);
    const c = await chat(w.juhuViewer, 'Confirm the result of my last match');
    assert.equal(c.body.refusal, 'write');
    assert.match(c.body.answer, /can't make changes.*Confirm result/);
    assert.match((await chat(w.juhuViewer, 'Approve my match please')).body.answer, /Admin: Review flagged/);
    assert.match((await chat(w.juhuViewer, 'I want you to mark my match as finished')).body.answer, /scoring screen/);
    assert.equal(Number((await h.db('matches').whereNotNull('verification_status').count({ n: '*' }))[0].n), before);
  });
});

describe('nits', () => {
  it("Ask lang: 'en' / 'hi' / absent → 200, anything else → 400 ask_lang", async () => {
    assert.equal((await chat(AARAV, 'my teams', 'en')).status, 200);
    assert.equal((await chat(AARAV, 'मेरी टीमें', 'hi')).status, 200);
    assert.equal((await chat(AARAV, 'my teams', undefined)).status, 200);
    for (const bad of ['fr', 'EN', '', 5]) {
      const r = await chat(AARAV, 'my teams', bad);
      assert.equal(r.status, 400, String(bad));
      assert.equal(r.body.error, 'ask_lang');
    }
  });
  it('a second Join tap is an idempotent 200 (also in parallel); a non-invited player is still refused', async () => {
    await register(h, 'cap', 'bob', 'eve', 'a3');
    const id = await makeTeam(h, 'cap', ['cap'], 'Nit Spikers');
    assert.equal((await h.as('cap').patch(`/api/teams/${id}`).send({ pendingPhones: [PEOPLE.bob.phone, PEOPLE.a3.phone] })).status, 200);
    assert.equal((await h.as('bob').post(`/api/teams/${id}/accept`)).status, 200);
    const again = await h.as('bob').post(`/api/teams/${id}/accept`);
    assert.equal(again.status, 200);
    assert.equal(again.body.memberIds.filter((m: string) => m === 'bob').length, 1);
    const par = await Promise.all([0, 1, 2, 3, 4, 5].map(() => h.as('a3').post(`/api/teams/${id}/accept`)));
    assert.deepEqual(par.map((r) => r.status), [200, 200, 200, 200, 200, 200]);
    const t = await h.db('team_members').where({ team_id: id, user_id: 'a3' }).count({ n: '*' });
    assert.equal(Number(t[0].n), 1);
    assert.equal((await h.as('eve').post(`/api/teams/${id}/accept`)).status, 403);
  });
});
