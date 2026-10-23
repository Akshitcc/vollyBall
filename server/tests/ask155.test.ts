/**
 * 1.5.5 Tester "1.5.4 retest" on the API: F154-1 (10+ single digits joined by ANY non-alphanumeric run – | # * ~ + ; • ·
 * \ ' [9][8] {9}{8}, mixes – masked in the POST response, ask_history, ask_audit, GET /ask/history and team names),
 * F154-2 (five score pairs that spell a phone), F154-3 (set / score words never a team; a trailing team is looked up),
 * F154-4 (captain-change paraphrases → read-only refusal). LOCAL test database only.
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

describe('F154-1 / F154-2: masked everywhere the question is kept or shown', () => {
  for (const [q, want] of [
    ['my number is 9|8|7|6|5|4|3|2|1|0, what are my teams?', 'my number is [phone hidden], what are my teams?'],
    ['call 9#8#7#6#5#4#3#2#1#0 what are my teams?', 'call [phone hidden] what are my teams?'],
    ['call [9][8][7][6][5][4][3][2][1][0] what are my teams?', 'call [phone hidden] what are my teams?'],
    ['call {9}{8}{7}{6}{5}{4}{3}{2}{1}{0} what are my teams?', 'call [phone hidden] what are my teams?'],
    ['call 9–8|7:6#5—4_3/2.1-0 what are my teams?', 'call [phone hidden] what are my teams?'],
    ['call 9•8·7*6~5+4;3\\2\'1|0 what are my teams?', 'call [phone hidden] what are my teams?'],
    ['my number is 9-8 7-6 5-4 3-2 1-0, what are my teams?', 'my number is [phone hidden], what are my teams?'],
    ['ref 1|2|3|4|5|6|7|8|9|0 what are my teams?', 'ref [phone hidden] what are my teams?'], // stored copy: any 10+ run
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
      assert.doesNotMatch(JSON.stringify({ a: r.body.answer, c: r.body.cards, p: hist.payload, t: audit.tools }), /9\|8\|7|9#8#7|\[9\]\[8\]|\{9\}\{8\}|9-8 7-6 5-4|1\|2\|3\|4/);
    });
  }
  it('set scores stay as typed (reachable score line, multi-digit, short)', async () => {
    for (const q of ['sets 8-6 5-7 9-7 6-8 8-6 who won?', 'what was the score 25-23 set', 'scores 1-0 2-1 3-2, my results?']) {
      const r = await chat(AARAV, q);
      assert.equal(r.status, 200);
      assert.equal(r.body.question, q);
      assert.equal((await lastRows(AARAV.uid)).hist.question, q);
    }
  });
  it('an old raw pipe row reads back masked from GET /ask/history', async () => {
    const [hid] = await h.db('ask_history').insert({ user_id: AARAV.uid, lang: 'en', question: 'old: call 9|8|7|6|5|4|3|2|1|0', payload: '{}', created_at: new Date() });
    const g = await h.as(AARAV).get('/api/ask/history');
    assert.equal(g.body.items.find((i: { id: string }) => i.id === String(hid)).question, 'old: call [phone hidden]');
  });
  for (const name of ['Pipe 9|8|7|6|5|4|3|2|1|0', 'Hash 9#8#7#6#5#4#3#2#1#0']) {
    it(`team ${JSON.stringify(name)} is masked in answers and cards; its id is untouched`, async () => {
      const cap = idOf('seed26');
      const tid = `team_${crypto.randomUUID()}`;
      await teams.createTeam(h.s, cap, { name, color: '#225588', captainId: cap.uid, memberIds: [cap.uid], subIds: [], pendingPhones: [] }, tid);
      const r = await chat(cap, 'my teams');
      assert.equal(r.status, 200);
      const blob = JSON.stringify({ a: r.body.answer, c: r.body.cards });
      assert.doesNotMatch(blob, /9[|#]8[|#]7/, blob);
      assert.match(blob, /\[phone hidden\]/);
      assert.ok(blob.includes(tid), 'team id kept');
    });
  }
});

describe('F154-3 / F154-4', () => {
  for (const [q, lang] of [['set ka score kya tha', 'hi'], ['तीसरे सेट का स्कोर क्या था?', 'hi'], ['what was the score 25-23 set', 'en']] as const) {
    it(`${JSON.stringify(q)} → live scores, no made-up team`, async () => {
      const r = await chat(AARAV, q, lang);
      assert.equal(r.status, 200);
      assert.doesNotMatch(r.body.answer, /^(?:set|तीसरे|set tha)\b/i, r.body.answer);
      assert.doesNotMatch(r.body.answer, /set tha|सेट था|set holdout/i, r.body.answer);
    });
  }
  it('"what was the score 25-23 set <team>" looks up that team', async () => {
    const cap = idOf('seed26');
    await teams.createTeam(h.s, cap, { name: 'Holdout Hawks', color: '#225588', captainId: cap.uid, memberIds: [cap.uid], subIds: [], pendingPhones: [] }, `team_${crypto.randomUUID()}`);
    const r = await chat(AARAV, 'what was the score 25-23 set Holdout Hawks');
    assert.equal(r.status, 200);
    assert.doesNotMatch(r.body.answer, /set holdout hawks/i, r.body.answer);
    assert.match(r.body.answer, /holdout hawks/i, r.body.answer);
  });
  for (const [q, lang] of [['please appoint Meera as captain', 'en'], ['Rohan ko team ka captain set karo', 'hi'], ['मीरा को टीम का कप्तान चुनो', 'hi']] as const) {
    it(`${JSON.stringify(q)} → read-only refusal, no tools`, async () => {
      const r = await chat(AARAV, q, lang);
      assert.equal(r.status, 200);
      assert.equal(r.body.refusal, 'write', JSON.stringify(r.body).slice(0, 300));
      const { audit } = await lastRows(AARAV.uid);
      assert.deepEqual(JSON.parse(audit.tools || '[]'), []);
    });
  }
});
