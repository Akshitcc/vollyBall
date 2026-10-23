/**
 * 1.5.3 Tester "1.5.2 retest" on the API: F152-1 (spaced single-digit phones masked in the POST response, ask_history,
 * ask_audit and GET /ask/history; phone-shaped team names masked in answers / cards, ids intact) and F152-2 (glued
 * "plus91…", spelled-out digits in history / audit; ask_audit.question_sha = HMAC with ASK_AUDIT_HMAC_KEY or NULL;
 * the local-only scripts for old rows; config handling of the key). LOCAL test database only. The HMAC keys below are
 * random per run, made in-process, never printed or stored.
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import { startHarness, type Harness } from './helpers';
import { setupAskWorld, AARAV, idOf } from './askFixtures';
import * as teams from '../src/domain/teams';
import { auditQuestionHash } from '../src/domain/ask';
import { loadConfig } from '../src/config';
import { maskAskHistory } from '../scripts/mask-ask-history';
import { nullAskAuditSha } from '../scripts/null-ask-audit-sha';

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
const DIGITS = /(?:\d\s?){4}|[९८७६५४३२१०]\s?[९८७६५४३२१०]\s?[९८७६५४३२१०]/;

describe('F152-1: spaced single digits are masked everywhere the question is kept or shown', () => {
  for (const [q, want] of [
    ['my number is 9 8 7 6 5 4 3 2 1 0, what are my teams?', 'my number is [phone hidden], what are my teams?'],
    ['+ 9 1 9 8 7 6 5 4 3 2 1 0 what are my teams?', '[phone hidden] what are my teams?'],
    ['code 1 2 3 4 5 6 7 8 9 0 what are my teams?', 'code [phone hidden] what are my teams?'], // stored copy: always, phone-shaped or not
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
      assert.doesNotMatch(JSON.stringify({ a: r.body.answer, c: r.body.cards, p: hist.payload, t: audit.tools }), /9 8 7 6 5|1 2 3 4 5 6/);
    });
  }
  it('an old raw row with spaced digits reads back masked and is tidied by the local-only script (history + audit)', async () => {
    const [hid] = await h.db('ask_history').insert({ user_id: AARAV.uid, lang: 'en', question: 'old: call 9 8 7 6 5 4 3 2 1 0', payload: '{}', created_at: new Date() });
    const [aid] = await h.db('ask_audit').insert({ user_id: AARAV.uid, question_sha: null, question: 'old: nau aath ek do teen char paanch chhe saat aath', lang: 'en', provider: 'mock', tools: '[]', steps: 0, latency_ms: 1, outcome: 'answer', created_at: new Date() });
    const g = await h.as(AARAV).get('/api/ask/history');
    assert.equal(g.body.items.find((i: { id: string }) => i.id === String(hid)).question, 'old: call [phone hidden]');
    assert.ok((await maskAskHistory(h.db, false, 'ask_audit')).changed >= 1);
    await maskAskHistory(h.db, true, 'ask_history');
    await maskAskHistory(h.db, true, 'ask_audit');
    assert.equal((await h.db('ask_history').where({ id: hid }).first()).question, 'old: call [phone hidden]');
    assert.equal((await h.db('ask_audit').where({ id: aid }).first()).question, 'old: [phone hidden]');
    assert.equal((await maskAskHistory(h.db, false, 'ask_audit')).changed, 0);
  });
  it('a team named with spaced digits is masked in answers and cards; its id is untouched', async () => {
    const cap = idOf('seed26');
    const tid = `team_${crypto.randomUUID()}`;
    await teams.createTeam(h.s, cap, { name: 'Club 9 8 7 6 5 4 3 2 1 0', color: '#225588', captainId: cap.uid, memberIds: [cap.uid], subIds: [], pendingPhones: [] }, tid);
    const r = await chat(cap, 'my teams');
    assert.equal(r.status, 200);
    const blob = JSON.stringify({ a: r.body.answer, c: r.body.cards });
    assert.doesNotMatch(blob, /9 8 7 6 5/, blob);
    assert.match(blob, /Club \[phone hidden\]/);
    const ids = (r.body.cards as { items?: { id: string }[] }[]).flatMap((c) => c.items ?? []).map((i) => i.id);
    assert.ok(ids.includes(tid), JSON.stringify(ids));
  });
  it('set scores in a question stay as typed', async () => {
    const r = await chat(AARAV, 'we won 8-6 7-5 9-7, what are my results?');
    assert.equal(r.body.question, 'we won 8-6 7-5 9-7, what are my results?');
  });
});

describe('F152-2: glued plus / spelled-out digits in the stored copies', () => {
  for (const q of ['call plus919812345678 for my teams', 'mera number nau aath ek do teen char paanch chhe saat aath hai', 'मेरा नंबर नौ आठ एक दो तीन चार पाँच छह सात आठ है', 'number double nine eight one two three four five six seven', 'number 98 one two three 45678 please']) {
    it(`masked in response, history and audit: ${JSON.stringify(q)}`, async () => {
      const r = await chat(AARAV, q, /[\u0900-\u097f]/.test(q) ? 'hi' : 'en');
      assert.equal(r.status, 200);
      const { hist, audit } = await lastRows(AARAV.uid);
      for (const s of [r.body.question, hist.question, audit.question]) {
        assert.match(s, /\[phone hidden\]/, s);
        assert.doesNotMatch(s, DIGITS, s);
        assert.doesNotMatch(s, /\b(?:nau|aath|nine|eight|three|plus)\b|नौ|आठ/, s);
      }
    });
  }
});

describe('F152-2: ask_audit.question_sha', () => {
  const q = '9812345678';
  const sha256 = crypto.createHash('sha256').update(q).digest('hex');
  it('no ASK_AUDIT_HMAC_KEY → NULL (never an unsalted hash)', async () => {
    h.s.askAuditHmacKey = undefined;
    await chat(AARAV, q);
    const { audit } = await lastRows(AARAV.uid);
    assert.equal(audit.question_sha, null);
    assert.equal(auditQuestionHash(q, undefined), null);
    assert.equal(auditQuestionHash(q, ''), null);
  });
  it('with a key → HMAC-SHA256(key, question), not the unsalted SHA-256; another key gives another value', async () => {
    const k1 = crypto.randomBytes(32).toString('hex');
    const k2 = crypto.randomBytes(32).toString('hex');
    h.s.askAuditHmacKey = k1;
    try {
      await chat(AARAV, q);
      const { audit } = await lastRows(AARAV.uid);
      assert.equal(audit.question_sha, crypto.createHmac('sha256', k1).update(q).digest('hex'));
      assert.notEqual(audit.question_sha, sha256);
      assert.notEqual(auditQuestionHash(q, k2), audit.question_sha);
      assert.equal(audit.question, '[phone hidden]');
    } finally {
      h.s.askAuditHmacKey = undefined;
    }
  });
  it('old unsalted rows: null-ask-audit-sha (dry run, then apply) sets only question_sha to NULL, before the cut-off', async () => {
    const old = new Date(Date.now() - 3_600_000);
    const [id] = await h.db('ask_audit').insert({ user_id: AARAV.uid, question_sha: sha256, question: '[phone hidden]', lang: 'en', provider: 'mock', tools: '[]', steps: 0, latency_ms: 1, outcome: 'answer', created_at: old });
    const cut = new Date(Date.now() - 60_000);
    const dry = await nullAskAuditSha(h.db, cut, false);
    assert.ok(dry.matched >= 1);
    assert.equal((await h.db('ask_audit').where({ id }).first()).question_sha, sha256);
    const before0 = await h.db('ask_audit').where({ id }).first();
    const ap = await nullAskAuditSha(h.db, cut, true);
    assert.equal(ap.changed, dry.matched);
    const after0 = await h.db('ask_audit').where({ id }).first();
    assert.equal(after0.question_sha, null);
    assert.deepEqual({ ...after0, question_sha: before0.question_sha }, before0); // nothing else changed
    assert.equal((await nullAskAuditSha(h.db, cut, false)).matched, 0);
  });
  it('the column is NULLable after the migrations (0028), same type', async () => {
    const [rows] = await h.db.raw("SELECT IS_NULLABLE n, COLUMN_TYPE t FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ask_audit' AND COLUMN_NAME = 'question_sha'");
    assert.equal(rows[0].n, 'YES');
    assert.equal(rows[0].t, 'char(64)');
  });
  it('config: unset / placeholder = no key in development; the placeholder is refused in production; short keys are refused', () => {
    const dev = { DATABASE_URL: 'mysql://u@127.0.0.1:3306/x_test', AUTH_MODE: 'dev' };
    assert.equal(loadConfig(dev).askAuditHmacKey, '');
    assert.equal(loadConfig({ ...dev, ASK_AUDIT_HMAC_KEY: 'replace-with-at-least-32-random-characters' }).askAuditHmacKey, '');
    assert.throws(() => loadConfig({ ...dev, ASK_AUDIT_HMAC_KEY: 'short' }), /at least 32/);
    const k = crypto.randomBytes(32).toString('hex');
    assert.equal(loadConfig({ ...dev, ASK_AUDIT_HMAC_KEY: k }).askAuditHmacKey, k);
    const SECRET = crypto.randomBytes(24).toString('hex');
    const prod = { NODE_ENV: 'production', DATABASE_URL: 'mysql://u:p@db.internal:3306/v', AUTH_MODE: 'otp', OTP_PROVIDER: 'msg91', MSG91_AUTH_KEY: 'k', MSG91_TEMPLATE_ID: 't', SESSION_SECRET: SECRET, FILE_URL_SECRET: SECRET, PUBLIC_BASE_URL: 'https://api.volley.test' };
    assert.throws(() => loadConfig({ ...prod, ASK_AUDIT_HMAC_KEY: 'replace-with-at-least-32-random-characters' }), /placeholder/);
    assert.equal(loadConfig(prod).askAuditHmacKey, '');
  });
});
