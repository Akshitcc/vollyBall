/**
 * 1.5.6 Tester "1.5.5 retest" on the API: F155-1 (grouped phones with ANY separator – "98765|43210", "+91|98765|43210",
 * "987#654#3210", "98765 • 43210", "+91·98765·43210", "98|76|54|32|10" – masked in the POST response, ask_history,
 * ask_audit, GET /ask/history and team names), F155-2 (impossible score lines, new cues), F155-3 (set-type words never a
 * team; "final set score of <team>" → that team's latest match), F155-4 (captaincy changes → read-only refusal).
 * LOCAL test database only.
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import { startHarness, type Harness } from './helpers';
import { setupAskWorld, AARAV, idOf } from './askFixtures';
import * as teams from '../src/domain/teams';

let h: Harness;
before(async () => { h = await startHarness(); await setupAskWorld(h); });
after(async () => { await h?.close(); });

const chat = async (who: Parameters<Harness['as']>[0], question: string, lang = 'en') => {
  h.s.rateLimiter?.reset();
  return h.as(who).post('/api/ask/chat').send({ question, lang });
};
const lastRows = async (uid: string) => ({
  hist: await h.db('ask_history').where({ user_id: uid }).orderBy('id', 'desc').first(),
  audit: await h.db('ask_audit').where({ user_id: uid }).orderBy('id', 'desc').first(),
});
const RAW = /98765|43210|987#654|3210|9876\*/;

describe('F155-1 / F155-2: masked everywhere the question is kept or shown', () => {
  for (const [q, want] of [
    ['call 98765|43210, what are my teams?', 'call [phone hidden], what are my teams?'],
    ['+91|98765|43210 what are my teams?', '[phone hidden] what are my teams?'],
    ['ring 987#654#3210 what are my teams?', 'ring [phone hidden] what are my teams?'],
    ['my no 98765 • 43210 what are my teams?', 'my no [phone hidden] what are my teams?'],
    ['+91·98765·43210 what are my teams?', '[phone hidden] what are my teams?'],
    ['98|76|54|32|10 what are my teams?', '[phone hidden] what are my teams?'],
    ['call 9876*543*210 what are my teams?', 'call [phone hidden] what are my teams?'],
    ['sets 9-7 9-6 6-9 9-5 5-3 what are my teams?', 'sets [phone hidden] what are my teams?'],
    ['ph 9-7 6-9 9-5 7-9 5-3 what are my teams?', 'ph [phone hidden] what are my teams?'],
  ] as const) {
    it(`POST response, ask_history, ask_audit, GET history: ${JSON.stringify(q)}`, async () => {
      const r = await chat(AARAV, q);
      assert.equal(r.status, 200);
      assert.equal(r.body.question, want);
      const { hist, audit } = await lastRows(AARAV.uid);
      assert.equal(hist.question, want);
      assert.equal(audit.question, want);
      const g = await h.as(AARAV).get('/api/ask/history');
      assert.equal(g.body.items[g.body.items.length - 1].question, want);
      assert.doesNotMatch(JSON.stringify({ a: r.body.answer, c: r.body.cards, p: hist.payload, t: audit.tools }), RAW);
    });
  }
  it('set scores, times, dates and IP lists stay as typed', async () => {
    for (const q of ['sets 9-7 6-9 9-5 7-9 5-3 who won?', 'sets 8-6 5-7 9-7 6-8 8-6 who won?', 'matches at 06:30, 07:45, 09:00?', 'matches on 09/10/2026, 07/11/2026?', 'what was the score 25-23 set']) {
      const r = await chat(AARAV, q);
      assert.equal(r.status, 200);
      assert.equal(r.body.question, q);
      assert.equal((await lastRows(AARAV.uid)).hist.question, q);
    }
  });
  it('an old raw grouped row reads back masked from GET /ask/history', async () => {
    const [hid] = await h.db('ask_history').insert({ user_id: AARAV.uid, lang: 'en', question: 'old: call 98765|43210', payload: '{}', created_at: new Date() });
    const g = await h.as(AARAV).get('/api/ask/history');
    assert.equal(g.body.items.find((i: { id: string }) => i.id === String(hid)).question, 'old: call [phone hidden]');
  });
  for (const name of ['Pipe 98765|43210', 'Dot +91·98765·43210']) {
    it(`team ${JSON.stringify(name)} is masked in answers and cards; its id is untouched`, async () => {
      const cap = idOf('seed26');
      const tid = `team_${crypto.randomUUID()}`;
      await teams.createTeam(h.s, cap, { name, color: '#225588', captainId: cap.uid, memberIds: [cap.uid], subIds: [], pendingPhones: [] }, tid);
      const r = await chat(cap, 'my teams');
      assert.equal(r.status, 200);
      const blob = JSON.stringify({ a: r.body.answer, c: r.body.cards });
      assert.doesNotMatch(blob, RAW, blob);
      assert.match(blob, /\[phone hidden\]/);
      assert.ok(blob.includes(tid), 'team id kept');
    });
  }
});

describe('F155-3 / F155-4', () => {
  for (const [q, lang] of [['tie-break set score?', 'en'], ['golden set ka score', 'hi'], ['टाई ब्रेक सेट का स्कोर?', 'hi']] as const) {
    it(`${JSON.stringify(q)} → live scores, no made-up team`, async () => {
      const r = await chat(AARAV, q, lang);
      assert.equal(r.status, 200);
      assert.doesNotMatch(r.body.answer, /tie break|tiebreak|golden|टाई ब्रेक/i, r.body.answer);
      const { audit } = await lastRows(AARAV.uid);
      assert.deepEqual(JSON.parse(audit.tools).map((t: { name: string }) => t.name), ['live_score']);
    });
  }
  it('"what was the final set score of <team>" → that team\'s latest finished match (not a tournament lookup)', async () => {
    const r = await chat(AARAV, 'what was the final set score of Juhu T01');
    assert.equal(r.status, 200);
    const { audit } = await lastRows(AARAV.uid);
    assert.deepEqual(JSON.parse(audit.tools).map((t: { name: string }) => t.name), ['live_score']);
    assert.match(r.body.answer, /not playing live right now\. Latest match: .*Juhu T01.*final set \d+-\d+/i, r.body.answer);
    assert.doesNotMatch(r.body.answer, /couldn't find that tournament/i);
    assert.ok(r.body.cards.some((c: { type: string; status: string }) => c.type === 'scoreboard' && c.status === 'finished'));
  });
  for (const [q, lang] of [['hand over captaincy to Meera', 'en'], ['let Meera be the captain', 'en'], ['switch captain to Rohan', 'en'], ['Rohan ko captaincy de do', 'hi'],
    ['कप्तानी मीरा को सौंप दो', 'hi'], ['CAPTAIN = Meera', 'en'], ['set captain: Rohan', 'en']] as const) {
    it(`${JSON.stringify(q)} → read-only refusal, no tools`, async () => {
      const r = await chat(AARAV, q, lang);
      assert.equal(r.status, 200);
      assert.equal(r.body.refusal, 'write', JSON.stringify(r.body).slice(0, 300));
      const { audit } = await lastRows(AARAV.uid);
      assert.deepEqual(JSON.parse(audit.tools || '[]'), []);
    });
  }
  for (const q of ['Who is the captain of Juhu T01?', 'how does captaincy handover work?', 'who can promote a player to captain?']) {
    it(`${JSON.stringify(q)} is answered, not refused`, async () => {
      const r = await chat(AARAV, q);
      assert.equal(r.status, 200);
      assert.notEqual(r.body.refusal, 'write');
    });
  }
});
