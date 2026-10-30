/**
 * 1.5.8 Tester "1.5.7 retest" on the API: F157-1 (direct team lookup: exact / prefix names first, before any
 * word-match window; short second words such as "Filler F3"), F157-2 ("which team?" for every team phrasing, also for
 * teams with no matches), F157-3 (captain help paraphrases; the dispute regression). LOCAL test database only.
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import { startHarness, type Harness } from './helpers';
import { setupAskWorld, AARAV } from './askFixtures';
import { serverToolHost } from '../src/ask/host';
import * as matches from '../src/domain/matches';
import * as teams from '../src/domain/teams';
import { runTool } from '../../src/core/ask/tools';

let h: Harness;
let template = '';
const T0 = Date.now() - 400 * 86_400_000;
/** A copy of an existing finished match with new side names and finish time (raw rows, local test DB only). */
async function cloneMatch(a: string, b: string, finishedAt: Date): Promise<string> {
  const m = await h.db('matches').where({ id: template }).first();
  const id = crypto.randomUUID().replace(/-/g, '').slice(0, 20);
  const row: Record<string, unknown> = { ...m, id, finished_at: finishedAt };
  for (const k of Object.keys(row)) if (/^(client_id|idempotency_key|share_code)$/.test(k)) row[k] = null;
  if ('tournament_id' in row) row.tournament_id = null;
  if ('fixture_id' in row) row.fixture_id = null;
  await h.db('matches').insert(row);
  const sides = await h.db('match_sides').where({ match_id: template });
  for (const s of sides) {
    const r: Record<string, unknown> = { ...s, match_id: id, name: s.side === 'B' || s.side === 'b' || s === sides[1] ? b : a };
    if ('id' in r && typeof s.id === 'number') delete r.id;
    await h.db('match_sides').insert(r);
  }
  return id;
}
before(async () => {
  h = await startHarness(); await setupAskWorld(h);
  template = (await h.db('matches').where({ status: 'finished' }).orderBy('id').first('id')).id;
  // F157-1: one old "Powai Pelicans" match crowded by 120 newer "Powai P…" matches, and an old "Filler F3"
  await cloneMatch('Powai Pelicans', 'Bandra Bulls', new Date(T0));
  for (let i = 0; i < 120; i++) await cloneMatch(`Powai P${String(i).padStart(3, '0')}`, 'Bandra Bulls', new Date(T0 + (i + 1) * 3_600_000));
  await cloneMatch('Filler F3', 'Bandra Bulls', new Date(T0 - 86_400_000));
  for (let i = 0; i < 110; i++) await cloneMatch(`Filler F${10 + i}`, 'Bandra Bulls', new Date(T0 + (i + 1) * 3_600_000));
});
after(async () => { await h?.close(); });
const chat = async (question: string, lang = 'en') => { h.s.rateLimiter?.reset(); return h.as(AARAV).post('/api/ask/chat').send({ question, lang }); };

describe('F157-1: exact / prefix names first', () => {
  it('finishedSideNames: exact, then prefix, then all words, then any word', async () => {
    assert.deepEqual(await matches.finishedSideNames(h.db, 'powai pelicans'), { kind: 'exact', names: ['Powai Pelicans'] });
    assert.deepEqual(await matches.finishedSideNames(h.db, 'FILLER F3'), { kind: 'exact', names: ['Filler F3'] });
    const p = await matches.finishedSideNames(h.db, 'powai pel');
    assert.equal(p.kind, 'prefix');
    assert.deepEqual(p.names, ['Powai Pelicans']);
    const w = await matches.finishedSideNames(h.db, 'pelicans powai');
    assert.equal(w.kind, 'all');
    assert.deepEqual(w.names, ['Powai Pelicans']);
  });
  it('an exact name crowded by 120 newer matches sharing a word is found (window empty)', async () => {
    const host = { ...serverToolHost(h.s, AARAV), recentMatches: async () => [] };
    for (const [q, name] of [['powai pelicans', 'Powai Pelicans'], ['filler f3', 'Filler F3']]) {
      const o = await runTool(host, 'live_score', { team: q }, 'en');
      const latest = (o.data as unknown as { latest?: { teamA: string; teamB: string } }).latest;
      assert.ok(latest && [latest.teamA, latest.teamB].includes(name), `${q}: ${JSON.stringify(o.data).slice(0, 300)}`);
    }
  });
  it('the API answers the exact team, not a list of others', async () => {
    const r = await chat('final set score of Filler F3');
    assert.match(r.body.answer, /Latest match: .*Filler F3/, r.body.answer);
  });
});

describe('F157-2: "which team?" for teams with no matches, every phrasing', () => {
  before(async () => {
    for (const name of ['Kurla Kites', 'Kurla Kings']) {
      const tid = crypto.randomUUID();
      await teams.createTeam(h.s, AARAV, { name, color: '#225588', captainId: AARAV.uid, memberIds: [AARAV.uid], subIds: [], pendingPhones: [] }, tid);
    }
  });
  for (const q of ['Kurla', 'Kurla score', 'Kurla last result', 'how did Kurla do', 'is Kurla playing', 'show Kurla', 'tell me about Kurla team']) {
    it(`${JSON.stringify(q)} → asks which team`, async () => {
      const r = await chat(q);
      assert.equal(r.status, 200);
      assert.match(r.body.answer, /Several teams match: Kurla (Kites|Kings), Kurla (Kites|Kings)\..*Which one do you mean\?/, r.body.answer);
    });
  }
});

describe('F157-3: captain help; dispute regression', () => {
  for (const q of ['What does a captain do?', 'how do I step down as captain?', 'can the captain confirm the score?']) {
    it(`${JSON.stringify(q)} → captain guide`, async () => {
      const r = await chat(q);
      assert.deepEqual(r.body.sources.map((s: { id: string }) => s.id), ['guide-captain']);
    });
  }
  it('"Other captain rejected our result, can admin make it count?" → dispute answer, not refused', async () => {
    const r = await chat('Other captain rejected our result, can admin make it count?');
    assert.equal(r.body.refusal ?? null, null);
    assert.match(r.body.answer, /disputed|admin/i);
    assert.doesNotMatch(r.body.answer, /creates a team is its captain/);
  });
});
