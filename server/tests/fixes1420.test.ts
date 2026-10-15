/**
 * 1.4.20 on the API: V1419-1 (create with someone else's organizerId → not_tournament_admin), V1419-4 (0020 re-run
 * safe, allowlisted edit), Help Center Lows (non-string fields, validation before the rate limit, one rate rule),
 * and Ask VolleyLive (RAG phase 1): MySQL index, grounded answers / I don't know, validation, per-user rate limit,
 * logs without the question, pluggable providers (fake fetch – no network, no real key).
 */
import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import { EVERYONE, SQUAD_A, SQUAD_B, makeTeam, register, startHarness, type Harness } from './helpers';
import { CHECKSUM_ALLOWLIST, migrate, migrationChecksum, MIGRATIONS_DIR } from '../src/db/migrate';
import { askIndex, resetAskIndex, syncAskIndex, warmAskIndex } from '../src/domain/ask';
import { askProviderName, createAskProvider } from '../src/ask/providers';
import { Logger, log, setLogger } from '../src/ops/logger';
import { ASK_RATE, buildChunks, FIVB_RULES_URL, IDK_TOKEN } from '../../src/core/ask';
import { SUPPORT_RATE } from '../../src/core/support';
import fs from 'node:fs';
import path from 'node:path';

let h: Harness;
before(async () => (h = await startHarness()));
after(async () => h.close());
beforeEach(async () => {
  await h.reset();
  resetAskIndex(h.s);
  delete h.s.ask;
  await register(h, ...EVERYONE);
});
const place = { name: 'Siri Fort', lat: 28.55, lng: 77.22 };
const rules = { preset: 'indoor', bestOf: 3, pointsPerSet: 25, decidingSetPoints: 15, winBy: 2, pointCap: null, timeoutsPerSet: 2, sideSwitchEvery: null, decidingSideSwitchEvery: null, decidingSwitchAt: 8 };

describe('V1419-1 tournaments create', () => {
  it("someone else's organizerId → 403 not_tournament_admin; own → 201", async () => {
    const a = await makeTeam(h, 'cap', SQUAD_A, 'QA Spikers');
    const b = await makeTeam(h, 'dan', SQUAD_B, 'Delhi Smashers');
    const body = { name: 'QA Cup 1420', organizerId: 'dan', format: 'league', rules, startDate: Date.now() + 86400000, endDate: Date.now() + 2 * 86400000, location: place, status: 'registration', teams: [{ id: a, name: 'One', color: '#111111' }, { id: b, name: 'Two', color: '#222222' }], fixtures: [] };
    const r = await h.as('cap').post('/api/tournaments').send(body);
    assert.equal(r.status, 403);
    assert.equal(r.body.code ?? r.body.error, 'not_tournament_admin', JSON.stringify(r.body));
    assert.equal((await h.as('cap').post('/api/tournaments').send({ ...body, organizerId: 'cap' })).status, 201);
  });
});

describe('V1419-4 migration 0020 re-run safe', () => {
  it('IF NOT EXISTS; allowlisted against the 1.4.19 checksum; removing its row and migrating again works', async () => {
    const f = '0020_support_tickets.sql';
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8');
    assert.match(sql, /CREATE TABLE IF NOT EXISTS support_tickets/);
    assert.equal(CHECKSUM_ALLOWLIST[f].current, migrationChecksum(sql));
    assert.equal(CHECKSUM_ALLOWLIST[f].earlier[0], '5a5ae45554122ccd0d5ee6acd42fa2d02960501eabe58f9821da992fbccbc44a');
    await h.as('cap').post('/api/support/tickets').send({ topic: 'bug', message: 'Something is broken here.' });
    await h.db('schema_migrations').where({ version: f }).del();
    assert.deepEqual(await migrate(h.db, MIGRATIONS_DIR, { onWarn: () => undefined }), [f]);
    assert.equal((await h.db('support_tickets').count({ n: '*' }))[0].n, 1); // data kept
  });
  it('a database that applied the 1.4.19 file only gets a one-time warning', async () => {
    const f = '0020_support_tickets.sql';
    await h.db('schema_migrations').where({ version: f }).update({ checksum: CHECKSUM_ALLOWLIST[f].earlier[0] });
    const warnings: string[] = [];
    assert.deepEqual(await migrate(h.db, MIGRATIONS_DIR, { onWarn: (m) => warnings.push(m) }), []);
    assert.ok(warnings.some((w) => /0020_support_tickets\.sql was applied as an earlier version/.test(w)), warnings.join('\n'));
  });
  it('0021 ask_chunks is additive and re-run safe', () => {
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, '0021_ask_chunks.sql'), 'utf8');
    assert.match(sql, /CREATE TABLE IF NOT EXISTS ask_chunks/);
    assert.doesNotMatch(sql.replace(/^--.*$/gm, ''), /\b(DROP|ALTER|DELETE|UPDATE|TRUNCATE)\b/i);
  });
});

describe('Help Center Lows on the API', () => {
  const post = (body: object, who: 'cap' | 'eve' = 'cap') => h.as(who).post('/api/support/tickets').send(body);
  it('number / array message or topic refused (never coerced)', async () => {
    for (const [body, code] of [
      [{ topic: 'bug', message: 12345678901234 }, 'support_message_type'],
      [{ topic: 'bug', message: ['Something is broken here.'] }, 'support_message_type'],
      [{ topic: ['bug'], message: 'Something is broken here.' }, 'support_topic'],
    ] as const) {
      const r = await post(body);
      assert.equal(r.status, 400);
      assert.equal(r.body.code ?? r.body.error, code, JSON.stringify(r.body));
    }
  });
  it('failed attempts do not count; the 6th valid ticket waits ~12 min (SUPPORT_RATE, same as the demo)', async () => {
    assert.deepEqual(SUPPORT_RATE, { burst: 5, perMinute: 1 / 12 });
    for (let i = 0; i < 10; i++) assert.equal((await post({ topic: 'bug', message: 'short' })).status, 400);
    for (let i = 0; i < 5; i++) assert.equal((await post({ topic: 'bug', message: 'Something is broken here.' })).status, 201);
    const r = await post({ topic: 'bug', message: 'Something is broken here.' });
    assert.equal(r.status, 429);
    assert.ok(r.body.retryAfter >= 700 && r.body.retryAfter <= 720, String(r.body.retryAfter));
  });
});

describe('Ask VolleyLive API', () => {
  const ask = (body: object, who: 'cap' | 'eve' = 'cap') => h.as(who).post('/api/ask').send(body);
  it('grounded answer with sources; vectors stored in MySQL (ask_chunks)', async () => {
    const r = await ask({ question: 'How many points win a set?', lang: 'en' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.idk, false);
    assert.match(r.body.answer, /25 points/);
    assert.equal(r.body.sources[0].id, 'rules:rule-set-points');
    assert.equal(r.body.sources[0].url, FIVB_RULES_URL);
    assert.equal(r.body.provider, 'mock');
    const rows = await h.db('ask_chunks').select('id', 'vec');
    assert.equal(rows.length, buildChunks().length);
    assert.equal(JSON.parse(rows[0].vec).length, 512);
  });
  it('Hindi question → Hindi FAQ answer', async () => {
    const r = await ask({ question: 'स्कोर कौन रखता है', lang: 'hi' });
    assert.equal(r.body.idk, false);
    assert.match(r.body.answer, /[\u0900-\u097F]/);
    assert.equal(r.body.sources[0].id, 'faq:score-how');
  });
  it("I don't know for off-topic questions (no sources)", async () => {
    const r = await ask({ question: 'bitcoin price today', lang: 'en' });
    assert.deepEqual(r.body, { answer: '', sources: [], idk: true, provider: 'mock' });
  });
  it('validation: text only, length; unauthenticated refused', async () => {
    for (const [q, code] of [[42, 'ask_question_type'], [['how'], 'ask_question_type'], ['a', 'ask_question_short'], ['x'.repeat(501), 'ask_question_long']] as const) {
      const r = await ask({ question: q });
      assert.equal(r.status, 400);
      assert.equal(r.body.code ?? r.body.error, code);
    }
    assert.equal((await h.api.post('/api/ask').send({ question: 'what is a libero' })).status, 401);
  });
  it('per-user rate limit (ASK_RATE); invalid questions do not count; other users unaffected', async () => {
    for (let i = 0; i < 15; i++) await ask({ question: 'x' });
    for (let i = 0; i < ASK_RATE.burst; i++) assert.equal((await ask({ question: 'what is a libero' })).status, 200);
    const r = await ask({ question: 'what is a libero' });
    assert.equal(r.status, 429);
    assert.ok(r.body.retryAfter >= 1 && r.body.retryAfter <= 30);
    assert.equal((await ask({ question: 'what is a libero' }, 'eve')).status, 200);
  });
  it('1.4.24: warmAskIndex builds the index up front (start-up), and the first question reuses it', async () => {
    resetAskIndex(h.s);
    await h.db('ask_chunks').del();
    assert.equal(await warmAskIndex(h.s), true);
    assert.equal(Number((await h.db('ask_chunks').count({ n: '*' }))[0].n), buildChunks().length);
    const p1 = askIndex(h.s); const p2 = askIndex(h.s);
    assert.equal(p1, p2); // cached promise: no second sync
  });
  it('the index re-syncs only changed rows and drops stale ones', async () => {
    await syncAskIndex(h.s);
    await h.db('ask_chunks').insert({ id: 'faq:gone:en', kind: 'faq', lang: 'en', title: 't', body: 'b', url: 'u', vec: '[]', content_sha: 'x'.repeat(64), updated_at: new Date() });
    await h.db('ask_chunks').where({ id: 'faq:reg-signin:en' }).update({ content_sha: 'y'.repeat(64), title: 'tampered' });
    const ix = await syncAskIndex(h.s);
    assert.equal(ix.chunks.some((c) => c.id === 'faq:gone:en'), false);
    assert.equal(ix.chunks.find((c) => c.id === 'faq:reg-signin:en')!.title, 'How do I sign in?');
  });
  it('a provider answer is used with the same sources; IDK_TOKEN → idk; provider failure → 503 ask_unavailable', async () => {
    let seen = '';
    h.s.ask = { name: 'fake', complete: async (p) => { seen = p.user; return 'Twenty-five, with a two-point lead.'; } };
    let r = await ask({ question: 'How many points win a set?' });
    assert.equal(r.body.answer, 'Twenty-five, with a two-point lead.');
    assert.equal(r.body.provider, 'fake');
    assert.match(seen, /^Sources:\n\[1\] How many points win a set\?/);
    h.s.ask = { name: 'fake', complete: async () => IDK_TOKEN };
    r = await ask({ question: 'How many points win a set?' });
    assert.equal(r.body.idk, true);
    h.s.ask = createAskProvider({ ASK_PROVIDER: 'openai', ASK_API_KEY: 'sk-test-not-real' }, async () => ({ ok: false, status: 500, json: async () => ({ error: 'sk-test-not-real' }) }));
    r = await ask({ question: 'How many points win a set?' });
    assert.equal(r.status, 503);
    assert.equal(r.body.code ?? r.body.error, 'ask_unavailable');
    assert.doesNotMatch(JSON.stringify(r.body), /sk-test/);
  });
  it('logs: provider, language, length and outcome – never the question or a key', async () => {
    const lines: string[] = [];
    const prev = log;
    setLogger(new Logger('info', (l) => lines.push(l)));
    try {
      await ask({ question: 'What is a libero, my number is 9876543210?' });
    } finally {
      setLogger(prev);
    }
    const askLine = lines.find((l) => /"msg":"ask"/.test(l));
    assert.ok(askLine, lines.join('\n'));
    assert.match(askLine!, /"provider":"mock"/);
    assert.match(askLine!, /"qlen":\d+/);
    assert.doesNotMatch(lines.join('\n'), /libero|9876543210/i);
  });
});

describe('Ask providers (fake fetch – no network, no real key)', () => {
  type Call = { url: string; headers: Record<string, string>; body: any };
  const fake = (reply: unknown, calls: Call[]) => async (url: string, init: { headers: Record<string, string>; body: string }) => {
    calls.push({ url, headers: init.headers, body: JSON.parse(init.body) });
    return { ok: true, status: 200, json: async () => reply };
  };
  const prompt = { system: 'SYS', user: 'USER' };
  const ctx = { lang: 'en' as const, hits: [] };
  it('ASK_PROVIDER: default mock; unknown refused; a real one needs ASK_API_KEY', () => {
    assert.equal(askProviderName({}), 'mock');
    assert.equal(createAskProvider({}).name, 'mock');
    assert.throws(() => askProviderName({ ASK_PROVIDER: 'llama' }), /ASK_PROVIDER must be one of/);
    for (const p of ['openai', 'gemini', 'anthropic']) assert.throws(() => createAskProvider({ ASK_PROVIDER: p }), /needs ASK_API_KEY/);
  });
  it('openai: chat completions, bearer key, temperature 0', async () => {
    const calls: Call[] = [];
    const p = createAskProvider({ ASK_PROVIDER: 'openai', ASK_API_KEY: 'k1' }, fake({ choices: [{ message: { content: 'A' } }] }, calls));
    assert.equal(await p.complete(prompt, ctx), 'A');
    assert.equal(calls[0].url, 'https://api.openai.com/v1/chat/completions');
    assert.equal(calls[0].headers.authorization, 'Bearer k1');
    assert.deepEqual(calls[0].body.messages, [{ role: 'system', content: 'SYS' }, { role: 'user', content: 'USER' }]);
    assert.equal(calls[0].body.temperature, 0);
  });
  it('gemini: generateContent, key in header (not the URL)', async () => {
    const calls: Call[] = [];
    const p = createAskProvider({ ASK_PROVIDER: 'gemini', ASK_API_KEY: 'k2', ASK_MODEL: 'gemini-x' }, fake({ candidates: [{ content: { parts: [{ text: 'B' }, { text: 'C' }] } }] }, calls));
    assert.equal(await p.complete(prompt, ctx), 'BC');
    assert.equal(calls[0].url, 'https://generativelanguage.googleapis.com/v1beta/models/gemini-x:generateContent');
    assert.doesNotMatch(calls[0].url, /k2/);
    assert.equal(calls[0].headers['x-goog-api-key'], 'k2');
    assert.equal(calls[0].body.systemInstruction.parts[0].text, 'SYS');
  });
  it('anthropic: messages API, x-api-key + version', async () => {
    const calls: Call[] = [];
    const p = createAskProvider({ ASK_PROVIDER: 'anthropic', ASK_API_KEY: 'k3' }, fake({ content: [{ type: 'text', text: 'D' }] }, calls));
    assert.equal(await p.complete(prompt, ctx), 'D');
    assert.equal(calls[0].url, 'https://api.anthropic.com/v1/messages');
    assert.equal(calls[0].headers['x-api-key'], 'k3');
    assert.equal(calls[0].headers['anthropic-version'], '2023-06-01');
    assert.equal(calls[0].body.system, 'SYS');
  });
  it('network error / bad reply shape → ask_unavailable or empty (→ idk), never the key', async () => {
    const p = createAskProvider({ ASK_PROVIDER: 'openai', ASK_API_KEY: 'secret-k' }, async () => { throw new Error('ECONNRESET secret-k'); });
    await assert.rejects(p.complete(prompt, ctx), (e: any) => e.code === 'ask_unavailable' && !/secret-k/.test(String(e.message)));
    const q = createAskProvider({ ASK_PROVIDER: 'openai', ASK_API_KEY: 'k' }, fake({ nope: 1 }, []));
    assert.equal(await q.complete(prompt, ctx), '');
  });
});
