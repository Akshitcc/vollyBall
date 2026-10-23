/**
 * 1.5.4 Tester "1.5.3 retest" on the API: F153-1 (single digits joined by dashes / dots / slashes / commas / mixed
 * separators, "+91-" prefix, masked in the POST response, ask_history, ask_audit, GET /ask/history and team names;
 * set scores kept), F153-2 (Hinglish ath / chah / chār / no), F153-4 (captain change → read-only refusal), F153-5
 * (a set score is not a team name). LOCAL test database only.
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

describe('F153-1 / F153-2: separator-joined and Hinglish digits are masked everywhere the question is kept or shown', () => {
  for (const [q, want] of [
    ['my number is 9-8-7-6-5-4-3-2-1-0, what are my teams?', 'my number is [phone hidden], what are my teams?'],
    ['call 9.8.7.6.5.4.3.2.1.0 what are my teams?', 'call [phone hidden] what are my teams?'],
    ['call 9/8/7/6/5/4/3/2/1/0 what are my teams?', 'call [phone hidden] what are my teams?'],
    ['call 9 8-7.6 5 4 3-2.1 0 what are my teams?', 'call [phone hidden] what are my teams?'],
    ['call +91-9-8-7-6-5-4-3-2-1-0 what are my teams?', 'call [phone hidden] what are my teams?'],
    ['call 9,8,7,6,5,4,3,2,1,0 what are my teams?', 'call [phone hidden] what are my teams?'],
    ['ref 1-2-3-4-5-6-7-8-9-0 what are my teams?', 'ref [phone hidden] what are my teams?'], // stored copy: any 10+ dashed run
    ['nau ath ek do teen char paanch chhe saat aath what are my teams?', '[phone hidden] what are my teams?'],
    ['no ath ek do teen chār paanch chah saat aath what are my teams?', '[phone hidden] what are my teams?'],
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
      assert.doesNotMatch(JSON.stringify({ a: r.body.answer, c: r.body.cards, p: hist.payload, t: audit.tools }), /9-8-7|9\.8\.7|9\/8\/7|9,8,7|1-2-3-4|ath ek do/);
    });
  }
  it('set scores and short lists stay as typed', async () => {
    for (const q of ['what was the score 25-23 set', 'sets 8-6 5-7 9-7 6-8 8-6 who won?', 'match on 21/10/2026 at 18:30?']) {
      const r = await chat(AARAV, q);
      assert.equal(r.status, 200);
      assert.equal(r.body.question, q);
      assert.equal((await lastRows(AARAV.uid)).hist.question, q);
    }
  });
  it('an old raw dashed row reads back masked from GET /ask/history', async () => {
    const [hid] = await h.db('ask_history').insert({ user_id: AARAV.uid, lang: 'en', question: 'old: call 9-8-7-6-5-4-3-2-1-0', payload: '{}', created_at: new Date() });
    const g = await h.as(AARAV).get('/api/ask/history');
    assert.equal(g.body.items.find((i: { id: string }) => i.id === String(hid)).question, 'old: call [phone hidden]');
  });
  it('a team named with dashed digits is masked in answers and cards; its id is untouched', async () => {
    const cap = idOf('seed26');
    const tid = `team_${crypto.randomUUID()}`;
    await teams.createTeam(h.s, cap, { name: 'Club 9-8-7-6-5-4-3-2-1-0', color: '#225588', captainId: cap.uid, memberIds: [cap.uid], subIds: [], pendingPhones: [] }, tid);
    const r = await chat(cap, 'my teams');
    assert.equal(r.status, 200);
    const blob = JSON.stringify({ a: r.body.answer, c: r.body.cards });
    assert.doesNotMatch(blob, /9-8-7-6/, blob);
    assert.match(blob, /Club \[phone hidden\]/);
    assert.ok(blob.includes(tid), 'team id kept');
  });
});

describe('F153-4 / F153-5', () => {
  for (const q of ['pick Aarav as the team captain', 'set Rohan as team captain', 'Pick Meera as the new captain of Holdout Hawks']) {
    it(`${JSON.stringify(q)} → read-only refusal, no tools`, async () => {
      const r = await chat(AARAV, q);
      assert.equal(r.status, 200);
      assert.match(r.body.answer, /can only look things up/);
      const { audit } = await lastRows(AARAV.uid);
      assert.deepEqual(JSON.parse(audit.tools || '[]'), []);
    });
  }
  it('"what was the score 25-23 set" does not look for a team called "set"', async () => {
    const r = await chat(AARAV, 'what was the score 25-23 set');
    assert.equal(r.status, 200);
    assert.doesNotMatch(r.body.answer, /^set is not playing/i);
  });
});
