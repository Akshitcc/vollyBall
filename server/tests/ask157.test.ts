/**
 * 1.5.7 Tester "1.5.6 retest" on the API: F156-1 (one-digit groupings masked in the POST response, ask_history,
 * ask_audit and GET /ask/history – the shown text equals the stored one), F156-2 (team lookup by name-match quality,
 * "which team?" when several match), F156-5 (window ordered by finished_at; a team outside the window queried directly),
 * F156-6 (captain changes refused, captain questions → the captain guide). LOCAL test database only.
 */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { startHarness, type Harness } from './helpers';
import { setupAskWorld, AARAV } from './askFixtures';
import { serverToolHost } from '../src/ask/host';
import { runTool } from '../../src/core/ask/tools';

let h: Harness;
before(async () => { h = await startHarness(); await setupAskWorld(h); });
after(async () => { await h?.close(); });

const chat = async (question: string, lang = 'en') => { h.s.rateLimiter?.reset(); return h.as(AARAV).post('/api/ask/chat').send({ question, lang }); };
const lastRows = async () => ({
  hist: await h.db('ask_history').where({ user_id: AARAV.uid }).orderBy('id', 'desc').first(),
  audit: await h.db('ask_audit').where({ user_id: AARAV.uid }).orderBy('id', 'desc').first(),
});
const when = (m: { finishedAt?: number | null; startedAt?: number | null; createdAt?: number | null }) => Number(m.finishedAt ?? m.startedAt ?? m.createdAt ?? 0);

describe('F156-1: one-digit groupings – shown exactly as stored', () => {
  for (const [q, want] of [
    ['call me 9-876543210 what are my teams?', 'call me [phone hidden] what are my teams?'],
    ['whatsapp 9-876-543-210 what are my teams?', 'whatsapp [phone hidden] what are my teams?'],
    ['9.876.543.210 what are my teams?', '[phone hidden] what are my teams?'],
    ['987654321-0 what are my teams?', '[phone hidden] what are my teams?'],
    ['+91 9-876543210 what are my teams?', '[phone hidden] what are my teams?'],
    ['9 876543210 what are my teams?', '[phone hidden] what are my teams?'],
    ['Jersey 98 | 76 | 54 | 32 | 10 is my number, my teams?', 'Jersey [phone hidden] is my number, my teams?'],
  ] as const) {
    it(`POST response = ask_history = ask_audit = GET history: ${JSON.stringify(q)}`, async () => {
      const r = await chat(q);
      assert.equal(r.status, 200);
      assert.equal(r.body.question, want);
      const { hist, audit } = await lastRows();
      assert.equal(hist.question, want);
      assert.equal(audit.question, want);
      const g = await h.as(AARAV).get('/api/ask/history');
      assert.equal(g.body.items[g.body.items.length - 1].question, want);
      assert.doesNotMatch(JSON.stringify({ a: r.body.answer, p: hist.payload }), /876543210|876-543|543\.210/);
    });
  }
});

describe('F156-5: the recent window is ordered by finished_at, not updated_at', () => {
  it('touching an old match (updated_at = now) does not move it up the window', async () => {
    const host = serverToolHost(h.s, AARAV);
    const before = await host.recentMatches!();
    assert.ok(before.length >= 3);
    const oldest = before[before.length - 1];
    if (await h.db.schema.hasColumn('matches', 'updated_at')) await h.db('matches').where({ id: oldest.id }).update({ updated_at: new Date() });
    const after = await serverToolHost(h.s, AARAV).recentMatches!();
    for (let i = 1; i < after.length; i++) assert.ok(when(after[i - 1]) >= when(after[i]), `window order at ${i}`);
    assert.equal(after[after.length - 1].id, oldest.id);
  });
  it('teamMatches returns only that team\'s finished matches, newest first', async () => {
    const ms = await serverToolHost(h.s, AARAV).teamMatches!('Juhu T01');
    assert.ok(ms.length >= 1);
    for (const m of ms) assert.equal(m.status, 'finished');
    assert.ok(ms.some((m) => [m.teamA.name, m.teamB.name].includes('Juhu T01')));
    for (let i = 1; i < ms.length; i++) assert.ok(when(ms[i - 1]) >= when(ms[i]));
  });
  it('a team missing from the window is found through teamMatches', async () => {
    const host = { ...serverToolHost(h.s, AARAV), recentMatches: async () => [] };
    const o = await runTool(host, 'live_score', { team: 'juhu t01' }, 'en');
    const latest = (o.data as unknown as { latest?: { teamA: string; teamB: string } }).latest;
    assert.ok(latest && [latest.teamA, latest.teamB].includes('Juhu T01'), JSON.stringify(o.data));
  });
});

describe('F156-2: "Juhu" matches several teams → which team?', () => {
  it('the API answer lists the candidates instead of guessing', async () => {
    const r = await chat('what was the final set score of Juhu');
    assert.equal(r.status, 200);
    assert.match(r.body.answer, /Several teams match: .*Juhu T0\d.*Which one do you mean\?/, r.body.answer);
  });
  it('an exact team name still answers that team', async () => {
    const r = await chat('what was the final set score of juhu t01');
    assert.match(r.body.answer, /Latest match: .*Juhu T01/i, r.body.answer);
  });
});

describe('F156-6: captain', () => {
  for (const q of ['switch captain to Rohan?', 'Meera = captain', 'captain -> Rohan', 'is it possible to make Meera captain now? do it']) {
    it(`${JSON.stringify(q)} → read-only refusal`, async () => {
      const r = await chat(q);
      assert.equal(r.status, 200);
      assert.equal(r.body.refusal, 'write');
      assert.deepEqual(r.body.tools ?? [], []);
    });
  }
  for (const q of ['steps to change captain', 'change captain how?', 'how do I change captain?', 'captain kaun hai?']) {
    it(`${JSON.stringify(q)} → the captain guide`, async () => {
      const r = await chat(q);
      assert.equal(r.status, 200);
      assert.equal(r.body.refusal ?? null, null);
      assert.match(r.body.answer, /creates a team is its captain.*New match/);
      assert.deepEqual(r.body.sources.map((s: { id: string }) => s.id), ['guide-captain']);
    });
  }
});
