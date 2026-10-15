/**
 * 1.4.20 Ask VolleyLive: the answer step, chosen by ASK_PROVIDER = mock (default) | openai | gemini | anthropic.
 * ASK_API_KEY holds the provider key (set by the operator in the server env; never in the repo, never logged, never
 * sent to the app). ASK_MODEL optionally overrides the model. With a real provider and no key the server refuses to
 * start (no silent fallback that would look like AI answers). Demo and tests use `mock` – no network, no key.
 */
import { ASK_PROVIDERS, mockProvider, type AskProvider, type AskProviderName } from '../../../src/core/ask';
import { HttpError } from '../errors';

type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export const DEFAULT_MODELS: Record<Exclude<AskProviderName, 'mock'>, string> = {
  openai: 'gpt-4o-mini',
  gemini: 'gemini-1.5-flash',
  anthropic: 'claude-3-5-haiku-latest',
};

export interface AskEnv { ASK_PROVIDER?: string; ASK_API_KEY?: string; ASK_MODEL?: string; ASK_TIMEOUT_MS?: string }

export function askProviderName(env: AskEnv): AskProviderName {
  const n = (env.ASK_PROVIDER ?? 'mock').trim().toLowerCase() || 'mock';
  if (!(ASK_PROVIDERS as readonly string[]).includes(n)) throw new Error(`ASK_PROVIDER must be one of ${ASK_PROVIDERS.join(', ')}`);
  return n as AskProviderName;
}

const unavailable = () => new HttpError(503, 'ask_unavailable', 'The assistant is not available right now');
const str = (v: unknown) => (typeof v === 'string' ? v : '');

export function createAskProvider(env: AskEnv = process.env, fetchImpl: FetchLike = fetch as unknown as FetchLike): AskProvider {
  const name = askProviderName(env);
  if (name === 'mock') return mockProvider;
  const key = env.ASK_API_KEY ?? '';
  if (!key.trim()) throw new Error(`ASK_PROVIDER=${name} needs ASK_API_KEY in the server environment`);
  const model = (env.ASK_MODEL ?? '').trim() || DEFAULT_MODELS[name];
  const timeout = Math.max(1000, Number(env.ASK_TIMEOUT_MS) || 15_000);
  const call = async (url: string, headers: Record<string, string>, body: object) => {
    const ctl = new AbortController();
    const tm = setTimeout(() => ctl.abort(), timeout);
    try {
      const r = await fetchImpl(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body), signal: ctl.signal });
      if (!r.ok) throw unavailable(); // the status only – the provider's body may echo request details
      return (await r.json()) as Record<string, unknown>;
    } catch (e) {
      throw e instanceof HttpError ? e : unavailable();
    } finally {
      clearTimeout(tm);
    }
  };
  return {
    name,
    async complete({ system, user }) {
      if (name === 'openai') {
        const j = await call('https://api.openai.com/v1/chat/completions', { authorization: `Bearer ${key}` }, { model, temperature: 0, max_tokens: 300, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] });
        return str((j.choices as { message?: { content?: unknown } }[] | undefined)?.[0]?.message?.content);
      }
      if (name === 'gemini') {
        const j = await call(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, { 'x-goog-api-key': key }, { systemInstruction: { parts: [{ text: system }] }, contents: [{ role: 'user', parts: [{ text: user }] }], generationConfig: { temperature: 0, maxOutputTokens: 300 } });
        return str((j.candidates as { content?: { parts?: { text?: unknown }[] } }[] | undefined)?.[0]?.content?.parts?.map((p) => str(p.text)).join(''));
      }
      const j = await call('https://api.anthropic.com/v1/messages', { 'x-api-key': key, 'anthropic-version': '2023-06-01' }, { model, max_tokens: 300, temperature: 0, system, messages: [{ role: 'user', content: user }] });
      return str((j.content as { type?: string; text?: unknown }[] | undefined)?.filter((c) => c.type === 'text').map((c) => str(c.text)).join(''));
    },
  };
}
