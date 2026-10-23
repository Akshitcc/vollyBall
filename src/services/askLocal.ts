/**
 * 1.4.20 Ask VolleyLive without our API server (demo backend, Firebase build): the same retrieval and grounding as
 * the server (core/ask), on the device, with the mock (extractive) answer step – no AI provider, no key, no network.
 * Per-user rate limit: the API's rule (ASK_RATE), counted in memory; only accepted questions count.
 */
import { answerQuestion, ASK_RATE, buildIndex, checkAskQuestion, mockProvider, type AskAnswer, type AskIndex, type AskLang } from '../core/ask';
import { CodedError } from '../core/codedError';
import { maskPiiStored } from '../core/pii';
import { supportRateWait } from '../core/support';
import { ASK_CHAT_RATE, ASK_HISTORY_MAX, ASK_HISTORY_PAGE, historyItemOf, runAgent, type AskHistoryItem } from '../core/ask/agent';
import { backendToolHost } from './askHost';
import type { Backend } from './backend/types';

let index: AskIndex | null = null;
const asked = new Map<string, number[]>();

export async function askLocally(uid: string | null | undefined, question: string, lang: AskLang, now: () => number = Date.now): Promise<AskAnswer> {
  if (!uid) throw new CodedError('ask_sign_in', 'Sign in to ask VolleyLive'); // 1.4.21: friendly, translated (was a raw 'Not signed in yet')
  const q = checkAskQuestion({ question, lang });
  const t = now();
  const mine = (asked.get(uid) ?? []).filter((x) => t - x < 3_600_000);
  const wait = supportRateWait(mine, t, ASK_RATE);
  if (wait) throw Object.assign(new CodedError('rate_limited', 'Too many requests. Wait a moment and try again.'), { retryAfter: wait });
  mine.push(t);
  asked.set(uid, mine);
  index ??= buildIndex();
  return answerQuestion(index, q.question, q.lang, mockProvider);
}
/** Tests. */
export const resetAskLocal = () => asked.clear();

// AsyncStorage is loaded on first use (importing this module must not need the native module)
const store = (): typeof import('@react-native-async-storage/async-storage').default => { const m = require('@react-native-async-storage/async-storage'); return m.default ?? m; }; // eslint-disable-line @typescript-eslint/no-require-imports

// ---------- 1.5.0 chat (agent + tools + history) without our API ----------
const chatted = new Map<string, number[]>();
export const askHistoryKey = (uid: string) => `volleylive.ask.history.v1.${uid}`;
async function readHistory(uid: string): Promise<AskHistoryItem[]> {
  try { const v = JSON.parse((await store().getItem(askHistoryKey(uid))) ?? '[]'); return Array.isArray(v) ? v : []; } catch { return []; }
}
/** One chat turn on the device: same checks, limits, tools and safety as the API (mock planner, no network). */
export async function askChatLocally(b: Backend, uid: string | null | undefined, question: string, lang: AskLang, now: () => number = Date.now): Promise<AskHistoryItem> {
  if (!uid) throw new CodedError('ask_sign_in', 'Sign in to ask VolleyLive');
  const q = checkAskQuestion({ question, lang });
  const t = now();
  const mine = (chatted.get(uid) ?? []).filter((x) => t - x < 3_600_000);
  const wait = supportRateWait(mine, t, ASK_CHAT_RATE);
  if (wait) throw Object.assign(new CodedError('rate_limited', 'Too many requests. Wait a moment and try again.'), { retryAfter: wait });
  mine.push(t);
  chatted.set(uid, mine);
  index ??= buildIndex();
  const r = await runAgent({ question: q.question, lang: q.lang, host: backendToolHost(b, uid), index });
  // 1.5.2 (F151-6): the kept history holds the masked question, as on the API
  const item = historyItemOf(`l${t.toString(36)}${Math.random().toString(36).slice(2, 6)}`, t, maskPiiStored(q.question), q.lang, r);
  const list = [...(await readHistory(uid)), item].slice(-ASK_HISTORY_MAX);
  await store().setItem(askHistoryKey(uid), JSON.stringify(list)).catch(() => {});
  return item;
}
export async function askHistoryLocally(uid: string | null | undefined): Promise<AskHistoryItem[]> {
  if (!uid) return [];
  return (await readHistory(uid)).slice(-ASK_HISTORY_PAGE);
}
export async function clearAskHistoryLocally(uid: string | null | undefined): Promise<void> {
  if (uid) await store().removeItem(askHistoryKey(uid));
}
/** Tests. */
export const resetAskChatLocal = () => chatted.clear();
