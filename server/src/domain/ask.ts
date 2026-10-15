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
import { answerQuestion, buildChunks, checkAskQuestion, embed, EMBED_VERSION, mockProvider, type AskChunk, type AskIndex } from '../../../src/core/ask';

const cache = new WeakMap<object, Promise<AskIndex>>();
// 1.4.23: EMBED_VERSION is part of the hash, so a change to the embedding (stop words) re-embeds every stored row.
const sha = (c: AskChunk) => crypto.createHash('sha256').update(JSON.stringify([c.kind, c.lang, c.title, c.text, c.url, EMBED_VERSION])).digest('hex');

export async function syncAskIndex(s: Services, chunks: AskChunk[] = buildChunks()): Promise<AskIndex> {
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
  const all: { id: string; kind: 'faq' | 'rules'; lang: 'en' | 'hi'; title: string; body: string; url: string; vec: string }[] = await s.db('ask_chunks').select('id', 'kind', 'lang', 'title', 'body', 'url', 'vec').orderBy('id');
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
