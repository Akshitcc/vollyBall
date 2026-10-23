/**
 * 1.4.20 Ask VolleyLive (RAG phase 1) on the API: the index lives in MySQL (ask_chunks, migration 0021) and is
 * synced from the shared content on first use (only changed rows are rewritten), then cached in memory.
 * Logs: provider, language, question LENGTH, hit count and the outcome – never the question, the answer or a key.
 */
import crypto from 'node:crypto';
import type { Services } from '../context';
import { HttpError } from '../errors';
import { log, type Logger } from '../ops/logger';
import type { Identity } from '../auth/verifier';
import { answerQuestion, ASK_CONTENT_TEXT_MAX, ASK_CONTENT_TITLE_MAX, buildChunks, checkAskQuestion, embed, EMBED_VERSION, mockProvider, type AskChunk, type AskContent, type AskIndex, type AskKind } from '../../../src/core/ask';
import { filterPii } from '../../../src/core/ask/tools';
import { maskPiiStored } from '../../../src/core/pii';
import { ASK_HISTORY_MAX, ASK_HISTORY_PAGE, historyItemOf, mockPlanner, plannerFromProvider, runAgent, type AgentResult, type AskHistoryItem } from '../../../src/core/ask/agent';
import { FAQS } from '../../../src/core/helpFaq';
import { RULE_NOTES } from '../../../src/core/ask/rulesKnowledge';
import { GUIDES } from '../../../src/core/ask/guides';
import { stripHidden } from '../../../src/core/text';
import { isAdmin } from '../context';
import { forbidden, notFound } from '../errors';
import { serverToolHost } from '../ask/host';

const cache = new WeakMap<object, Promise<AskIndex>>();
// 1.4.23: EMBED_VERSION is part of the hash, so a change to the embedding (stop words) re-embeds every stored row.
const sha = (c: AskChunk) => crypto.createHash('sha256').update(JSON.stringify([c.kind, c.lang, c.title, c.text, c.url, EMBED_VERSION])).digest('hex');

/** 1.5.0: the code content (FAQ, rule notes, guides) + the admins' ask_content rows. */
export async function allChunks(s: Services): Promise<AskChunk[]> {
  return buildChunks(FAQS, RULE_NOTES, GUIDES, await loadContent(s));
}

export async function syncAskIndex(s: Services, chunks0?: AskChunk[]): Promise<AskIndex> {
  const chunks = chunks0 ?? (await allChunks(s));
  const rows: { id: string; content_sha: string }[] = await s.db('ask_chunks').select('id', 'content_sha');
  const have = new Map(rows.map((r) => [r.id, r.content_sha]));
  const now = new Date();
  for (const c of chunks) {
    const h = sha(c);
    if (have.get(c.id) === h) continue;
    const row = { id: c.id, kind: c.kind, lang: c.lang, title: c.title, body: c.text, url: c.url, vec: JSON.stringify(embed(`${c.title} ${c.title} ${c.text}`)), content_sha: h, updated_at: now };
    await s.db('ask_chunks').insert(row).onConflict('id').merge();
  }
  const keep = new Set(chunks.map((c) => c.id));
  const stale = rows.map((r) => r.id).filter((id) => !keep.has(id));
  if (stale.length) await s.db('ask_chunks').whereIn('id', stale).del(); // our own generated rows only
  const all: { id: string; kind: AskKind; lang: 'en' | 'hi'; title: string; body: string; url: string; vec: string }[] = await s.db('ask_chunks').select('id', 'kind', 'lang', 'title', 'body', 'url', 'vec').orderBy('id');
  return { chunks: all.map((r) => ({ id: r.id, kind: r.kind, lang: r.lang, title: r.title, text: r.body, url: r.url })), vectors: all.map((r) => JSON.parse(r.vec) as number[]) };
}

export function askIndex(s: Services): Promise<AskIndex> {
  let p = cache.get(s);
  if (!p) {
    p = syncAskIndex(s);
    cache.set(s, p);
    p.catch(() => cache.delete(s));
  }
  return p;
}
/**
 * 1.4.24 (QA V1423-2 info): build/sync the Ask index at server start instead of on the first question. Never throws:
 * on failure it logs and the first question tries again (askIndex drops a failed promise from the cache).
 */
export async function warmAskIndex(s: Services, logger: Pick<Logger, 'info'> & Partial<Pick<Logger, 'warn'>> = { info: () => {} }): Promise<boolean> {
  try {
    const ix = await askIndex(s);
    logger.info('ask index ready', { chunks: ix.chunks.length });
    return true;
  } catch (e) {
    (logger.warn ?? logger.info)('ask index warm-up failed; will retry on first question', { error: (e as Error).message });
    return false;
  }
}

/** Tests: forget the cached index. */
export const resetAskIndex = (s: Services) => cache.delete(s);

export function validateAsk(body: Record<string, unknown>) {
  try {
    return checkAskQuestion(body);
  } catch (e) {
    const err = e as { code: string; field?: string; message?: string; min?: number; max?: number };
    throw new HttpError(400, err.code, `Invalid request: ${err.field ?? ''} – ${err.message}`, { field: err.field, min: err.min, max: err.max });
  }
}

export async function ask(s: Services, _id: Identity, q: { question: string; lang: 'en' | 'hi' }) {
  const provider = s.ask ?? mockProvider;
  const t0 = Date.now();
  const r = await answerQuestion(await askIndex(s), q.question, q.lang, provider);
  log.info('ask', { provider: provider.name, lang: q.lang, qlen: [...q.question].length, hits: r.sources.length, idk: r.idk, ms: Date.now() - t0 });
  return r;
}

// ---------- 1.5.0 chat: agent + tools as the user, history, audit ----------
/**
 * 1.5.3 (Tester F152-2): the audit's question hash is an HMAC keyed with the server-side ASK_AUDIT_HMAC_KEY, so a short
 * question (a bare phone number) can't be recovered by brute force from the table. No key = no hash (NULL), never an
 * unsalted one.
 */
export const auditQuestionHash = (q: string, key: string | undefined): string | null => (key ? crypto.createHmac('sha256', key).update(q).digest('hex') : null);

/** Planner: s.askAgent (ASK_PROVIDER with function calling) → a 1.4.20 text provider wrapped → the mock planner. */
const plannerOf = (s: Services) => s.askAgent ?? (s.ask && s.ask !== mockProvider ? plannerFromProvider(s.ask) : mockPlanner);

export interface AuditRow { userId: string; question: string; lang: string; provider: string; tools: AgentResult['tools']; steps: number; ms: number; outcome: string; refusal?: string | null; injection?: boolean }
/** One audit row: question hash + PII-masked text, validated tool args, provider, latency – never keys or answers. */
export async function writeAudit(s: Services, a: AuditRow) {
  await s.db('ask_audit').insert({
    user_id: a.userId, question_sha: auditQuestionHash(a.question, s.askAuditHmacKey), question: maskPiiStored(a.question).slice(0, 500), lang: a.lang === 'hi' ? 'hi' : 'en', provider: a.provider.slice(0, 20),
    // 1.5.1 (F150-4): tool args are masked too (a model could pass a number it read in the question);
    // 1.5.2 (F151-4): field by field, so ids in the args stay intact
    tools: JSON.stringify(a.tools.map((t) => filterPii({ name: t.name, args: t.args, ok: t.ok, ms: t.ms, ...(t.error ? { error: t.error } : {}) }, '', true))).slice(0, 60_000),
    steps: Math.min(255, a.steps), latency_ms: Math.max(0, Math.round(a.ms)), outcome: a.outcome.slice(0, 16), refusal: a.refusal ?? null, injection: a.injection ? 1 : 0, created_at: new Date(),
  });
}

export async function chat(s: Services, id: Identity, q: { question: string; lang: 'en' | 'hi' }): Promise<AskHistoryItem> {
  const planner = plannerOf(s);
  const t0 = Date.now();
  let r: AgentResult;
  try {
    r = await runAgent({ question: q.question, lang: q.lang, host: serverToolHost(s, id), index: await askIndex(s), planner });
  } catch (e) {
    await writeAudit(s, { userId: id.uid, question: q.question, lang: q.lang, provider: planner.name, tools: [], steps: 0, ms: Date.now() - t0, outcome: 'error' }).catch(() => {});
    throw e;
  }
  const ms = Date.now() - t0;
  const now = new Date();
  // 1.5.2 (Tester F151-6): the history keeps a MASKED copy of what the user typed (same mask as the audit), and the
  // response returns that copy – a typed phone number / e-mail is never stored or shown back from the server.
  const item0 = historyItemOf('', now.getTime(), maskPiiStored(q.question).slice(0, 500), q.lang, r);
  const { id: _i, at: _a, question: _q, lang: _l, ...payload } = item0;
  const [hid] = await s.db('ask_history').insert({ user_id: id.uid, lang: q.lang, question: item0.question, payload: JSON.stringify(payload), created_at: now });
  // keep the newest ASK_HISTORY_MAX turns per user
  const old = await s.db('ask_history').where({ user_id: id.uid }).orderBy('id', 'desc').offset(ASK_HISTORY_MAX).limit(1000).select('id');
  if (old.length) await s.db('ask_history').whereIn('id', old.map((x: { id: number }) => x.id)).del();
  await writeAudit(s, { userId: id.uid, question: q.question, lang: q.lang, provider: planner.name, tools: r.tools, steps: r.steps, ms, outcome: r.outcome, refusal: r.refusal, injection: r.injection });
  log.info('ask chat', { provider: planner.name, lang: q.lang, qlen: [...q.question].length, tools: r.tools.map((t) => t.name).join(','), outcome: r.outcome, ms });
  return { ...item0, id: String(hid) };
}

export async function history(s: Services, id: Identity): Promise<{ items: AskHistoryItem[] }> {
  const rows: { id: number; lang: 'en' | 'hi'; question: string; payload: string; created_at: Date }[] = await s.db('ask_history').where({ user_id: id.uid }).orderBy('id', 'desc').limit(ASK_HISTORY_PAGE).select('id', 'lang', 'question', 'payload', 'created_at');
  const items = rows.reverse().map((r) => { let p: Record<string, unknown> = {}; try { p = JSON.parse(r.payload); } catch { /* skip */ } return { ...(p as object), id: String(r.id), at: new Date(r.created_at).getTime(), question: maskPiiStored(r.question), lang: r.lang } /* 1.5.2 (F151-6): rows from before 1.5.2 are masked on read too */ as AskHistoryItem; });
  return { items };
}
export async function clearHistory(s: Services, id: Identity) {
  await s.db('ask_history').where({ user_id: id.uid }).del();
}

// ---------- 1.5.0 admin content (ADMIN_UIDS) + re-index ----------
const requireAdmin = (s: Services, id: Identity) => { if (!isAdmin(s, id.uid)) throw forbidden('admin_only', 'Admins only'); };
const SLUG = /^[a-z0-9][a-z0-9-]{0,63}$/;
const bad = (code: string, field: string, msg: string) => new HttpError(400, code, `Invalid request: ${field} – ${msg}`, { field });

export async function loadContent(s: Services): Promise<AskContent[]> {
  const rows: { id: string; lang: 'en' | 'hi'; title: string; body: string; url: string | null }[] = await s.db('ask_content').select('id', 'lang', 'title', 'body', 'url').orderBy(['id', 'lang']);
  return rows.map((r) => ({ id: r.id, lang: r.lang, title: r.title, text: r.body, url: r.url }));
}
export async function listContent(s: Services, id: Identity) {
  requireAdmin(s, id);
  return { items: await loadContent(s) };
}
export function checkContent(cid: string, body: Record<string, unknown>): AskContent {
  if (!SLUG.test(cid)) throw bad('ask_content_id', 'id', 'use a-z, 0-9 and -, at most 64');
  const allowed = new Set(['lang', 'title', 'text', 'url']);
  for (const k of Object.keys(body)) if (!allowed.has(k)) throw bad('unknown_field', k, 'not allowed');
  if (body.lang !== 'en' && body.lang !== 'hi') throw bad('ask_content_lang', 'lang', 'en or hi');
  const title = typeof body.title === 'string' ? stripHidden(body.title, { multiline: false }).trim() : '';
  const text = typeof body.text === 'string' ? stripHidden(body.text, { multiline: true }).trim() : '';
  if (!title || [...title].length > ASK_CONTENT_TITLE_MAX) throw bad('ask_content_title', 'title', `1-${ASK_CONTENT_TITLE_MAX} characters`);
  if (!text || [...text].length > ASK_CONTENT_TEXT_MAX) throw bad('ask_content_text', 'text', `1-${ASK_CONTENT_TEXT_MAX} characters`);
  const url = body.url === undefined || body.url === null || body.url === '' ? null : body.url;
  if (url !== null && (typeof url !== 'string' || url.length > 500 || !/^(https:\/\/|volleylive:\/\/)[^\s]+$/.test(url))) throw bad('ask_content_url', 'url', 'https:// or volleylive:// link');
  return { id: cid, lang: body.lang, title, text, url: url as string | null };
}
/** Re-index: rebuild ask_chunks from the code content + ask_content (only changed rows are rewritten). */
export async function reindex(s: Services, id: Identity) {
  requireAdmin(s, id);
  resetAskIndex(s);
  const ix = await askIndex(s);
  log.info('ask reindex', { chunks: ix.chunks.length });
  return { chunks: ix.chunks.length, custom: ix.chunks.filter((c) => c.kind === 'custom').length };
}
export async function putContent(s: Services, id: Identity, cid: string, body: Record<string, unknown>) {
  requireAdmin(s, id);
  const c = checkContent(cid, body ?? {});
  await s.db('ask_content').insert({ id: c.id, lang: c.lang, title: c.title, body: c.text, url: c.url ?? null, updated_by: id.uid, updated_at: new Date() }).onConflict(['id', 'lang']).merge();
  return { item: c, index: await reindex(s, id) };
}
export async function deleteContent(s: Services, id: Identity, cid: string, lang?: unknown) {
  requireAdmin(s, id);
  const q = s.db('ask_content').where({ id: cid });
  if (lang === 'en' || lang === 'hi') q.andWhere({ lang });
  const n = await q.del();
  if (!n) throw notFound('Content not found');
  return { deleted: n, index: await reindex(s, id) };
}
