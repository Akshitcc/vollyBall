/**
 * 1.4.20 Ask VolleyLive without our API server (demo backend, Firebase build): the same retrieval and grounding as
 * the server (core/ask), on the device, with the mock (extractive) answer step – no AI provider, no key, no network.
 * Per-user rate limit: the API's rule (ASK_RATE), counted in memory; only accepted questions count.
 */
import { answerQuestion, ASK_RATE, buildIndex, checkAskQuestion, mockProvider, type AskAnswer, type AskIndex, type AskLang } from '../core/ask';
import { CodedError } from '../core/codedError';
import { supportRateWait } from '../core/support';

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
