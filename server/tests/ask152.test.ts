/**
 * 1.5.2 Tester "1.5.1 retest" on the API: F151-6 (ask_history keeps / returns the MASKED question; old rows masked on read
 * and by the local-only script) and F151-4 (masker rework through the API: admin FAQ text, team names in cards, the
 * audit; ids in cards untouched). LOCAL test database only.
 */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { startHarness, ADMIN, type Harness } from './helpers';
import { setupAskWorld, AARAV, idOf, type AskWorld } from './askFixtures';
import * as ask from '../src/domain/ask';
import * as teams from '../src/domain/teams';
import { maskAskHistory } from '../scripts/mask-ask-history';

let h: Harness;
let w: AskWorld;
before(async () => { h = await startHarness(); w = await setupAskWorld(h); });
after(async () => { await h?.close(); });

const chat = async (who: Parameters<Harness['as']>[0], question: string, lang = 'en') => {
  h.s.rateLimiter?.reset();
  return h.as(who).post('/api/ask/chat').send({ question, lang });
};
const LEAK = /98765|43210|९८७६|exämple|rahul@|＠|\d{5}/;

describe('F151-6: the chat history stores and returns the masked question', () => {
  it('POST response, ask_history row and GET /ask/history are masked', async () => {
    const q = 'My number is +91 (98765) 43210 and mail rahul@exämple.com – what is it?';
    const r = await chat(AARAV, q);
    assert.equal(r.status, 200);
    assert.match(r.body.question, /\[phone hidden\]/);
    assert.match(r.body.question, /\[email hidden\]/);
    assert.doesNotMatch(r.body.question, LEAK);
    const row = await h.db('ask_history').where({ user_id: AARAV.uid }).orderBy('id', 'desc').first();
    assert.doesNotMatch(row.question, LEAK, row.question);
    assert.match(row.question, /^My number is \[phone hidden\] and mail \[email hidden\]/);
    const g = await h.as(AARAV).get('/api/ask/history');
    const last = g.body.items[g.body.items.length - 1];
    assert.equal(last.question, row.question);
  });
  it('Devanagari / full-width digits typed in the question are masked in the history too', async () => {
    const r = await chat(AARAV, 'मेरा नंबर ९८१२३४५६०८ कैसे बदलें?', 'hi');
    assert.equal(r.status, 200);
    assert.equal(r.body.question, 'मेरा नंबर [phone hidden] कैसे बदलें?');
    const r2 = await chat(AARAV, 'call ９８１２３４５６０９ please');
    assert.equal(r2.body.question, 'call [phone hidden] please');
  });
  it('rows written before 1.5.2 are masked on read, and by the local-only script (dry run, then --apply)', async () => {
    const [id] = await h.db('ask_history').insert({ user_id: AARAV.uid, lang: 'en', question: 'old row: my number is 098123 45678', payload: '{}', created_at: new Date() });
    const g = await h.as(AARAV).get('/api/ask/history');
    assert.equal(g.body.items.find((i: { id: string }) => i.id === String(id)).question, 'old row: my number is [phone hidden]');
    const dry = await maskAskHistory(h.db, false);
    assert.ok(dry.changed >= 1);
    assert.equal((await h.db('ask_history').where({ id }).first()).question, 'old row: my number is 098123 45678'); // dry run writes nothing
    const ap = await maskAskHistory(h.db, true);
    assert.equal(ap.changed, dry.changed);
    assert.equal((await h.db('ask_history').where({ id }).first()).question, 'old row: my number is [phone hidden]');
    assert.equal((await maskAskHistory(h.db, false)).changed, 0);
  });
});

describe('F151-4: masker through the API', () => {
  it('the audit question is masked in every new format', async () => {
    for (const q of ['मेरा नंबर ९८१२३४५६०८ कैसे बदलें?', 'call +91 (98123) 45607', 'call 98123–45611 or 98123/45612', 'mail rāhul.qa@exämple.com', 'mail राहुल@उदाहरण.भारत', 'desk＠example.com']) {
      await chat(AARAV, q);
      const a = await h.db('ask_audit').where({ user_id: AARAV.uid }).orderBy('id', 'desc').first();
      assert.match(a.question, /\[(phone|email) hidden\]/, a.question);
      assert.doesNotMatch(a.question, /\d{5}|[९८]{4}|exämple|example\.com|उदाहरण/, a.question);
    }
  });
  it('admin FAQ text and titles with phones / e-mails are answered masked', async () => {
    await ask.putContent(h.s, ADMIN, 'scorer-desk', {
      lang: 'en', title: 'Scorer desk ９８１２３४५६२०',
      text: 'The scorer desk helps with court bookings. Call ９８１２３４５６２０ or ९८१२३४५६२१ or +91 (98123) 45623, mail bookings@exämple.com or desk＠example.com.',
    });
    const r = await chat(AARAV, 'how does the scorer desk help with court bookings');
    assert.equal(r.status, 200);
    const blob = JSON.stringify({ a: r.body.answer, c: r.body.cards, s: r.body.sources });
    assert.doesNotMatch(blob, /\d{5}|９８|९८|exämple|example\.com/, blob);
    assert.ok((r.body.sources as { id: string }[]).some((x) => x.id.includes('scorer-desk')), JSON.stringify(r.body.sources));
  });
  it('team names in answers and cards are masked; the team id in the card is untouched', async () => {
    const cap = idOf('seed26');
    const tid = 'team_70901100-48f2-4fbf-81f3-8196753097dd';
    await teams.createTeam(h.s, cap, { name: 'Call ९८१२३४५६३१ XI', color: '#225588', captainId: cap.uid, memberIds: [cap.uid], subIds: [], pendingPhones: [] }, tid);
    const r = await chat(cap, 'my teams');
    assert.equal(r.status, 200);
    const blob = JSON.stringify({ a: r.body.answer, c: r.body.cards });
    assert.doesNotMatch(blob, /९८१२|98123/, blob);
    assert.match(blob, /Call \[phone hidden\] XI/);
    const ids = (r.body.cards as { items?: { id: string }[] }[]).flatMap((c) => c.items ?? []).map((i) => i.id);
    assert.ok(ids.includes(tid), JSON.stringify(ids));
  });
  it('every match / team id in Ask cards is a real id (none corrupted)', async () => {
    const r = await chat(w.juhuViewer, 'What are my last results?');
    const items = r.body.cards.find((c: { type: string }) => c.type === 'fixtures').items as { id: string; matchId?: string }[];
    for (const i of items) {
      const mid = i.matchId ?? i.id;
      assert.ok(await h.db('matches').where({ id: mid }).first(), `unknown match id ${mid}`);
    }
    const t = await chat(AARAV, 'my teams');
    for (const i of (t.body.cards[0]?.items ?? []) as { id: string }[]) assert.ok(await h.db('teams').where({ id: i.id }).first(), `unknown team id ${i.id}`);
  });
});
