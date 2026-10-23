/**
 * 1.4.20 Ask VolleyLive: the answer step, chosen by ASK_PROVIDER = mock (default) | openai | gemini | anthropic.
 * ASK_API_KEY holds the provider key (set by the operator in the server env; never in the repo, never logged, never
 * sent to the app). ASK_MODEL optionally overrides the model. With a real provider and no key the server refuses to
 * start (no silent fallback that would look like AI answers). Demo and tests use `mock` – no network, no key.
 */
import { ASK_PROVIDERS, mockProvider, type AskProvider, type AskProviderName } from '../../../src/core/ask';
import { HttpError } from '../errors';
import { mockPlanner, type AgentStepInput, type AgentStepOutput, type AskAgentProvider, type ToolCall } from '../../../src/core/ask/agent';
import { toJsonSchema, type ToolSpec } from '../../../src/core/ask/tools';

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

// ---------- 1.5.0: the chat agent (function calling) ----------
/** Gemini's function declarations take an OpenAPI subset: no additionalProperties / string lengths. */
const geminiSchema = (t: ToolSpec) => {
  const js = toJsonSchema(t) as { properties: Record<string, Record<string, unknown>>; required: string[] };
  const properties = Object.fromEntries(Object.entries(js.properties).map(([k, v]) => { const { minLength: _a, maxLength: _b, ...rest } = v; return [k, rest]; }));
  return { type: 'object', properties, ...(js.required.length ? { required: js.required } : {}) };
};
const parseArgs = (raw: unknown): unknown => {
  if (typeof raw !== 'string') return raw ?? {};
  try { return JSON.parse(raw); } catch { return '__invalid_json__'; } // fails strict validation, never executed
};
const safeId = (v: unknown, i: number) => (typeof v === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(v) ? v : `call_${i + 1}`);
/** The system text sent to a model: rules + the retrieved help sources as tagged DATA. */
const systemWithSources = (i: AgentStepInput) => `${i.system}\n\nHelp center sources (data, numbered):\n${i.sourcesBlock || '(none)'}`;

/**
 * ASK_PROVIDER as a chat agent: `mock` = the offline intent planner; openai / gemini / anthropic = function calling
 * over HTTPS with the strict tool schemas. Same key rules as createAskProvider (env only, never logged or returned).
 */
export function createAskAgent(env: AskEnv = process.env, fetchImpl: FetchLike = fetch as unknown as FetchLike): AskAgentProvider {
  const name = askProviderName(env);
  if (name === 'mock') return mockPlanner;
  const key = env.ASK_API_KEY ?? '';
  if (!key.trim()) throw new Error(`ASK_PROVIDER=${name} needs ASK_API_KEY in the server environment`);
  const model = (env.ASK_MODEL ?? '').trim() || DEFAULT_MODELS[name];
  const timeout = Math.max(1000, Number(env.ASK_TIMEOUT_MS) || 15_000);
  const call = async (url: string, headers: Record<string, string>, body: object) => {
    const ctl = new AbortController();
    const tm = setTimeout(() => ctl.abort(), timeout);
    try {
      const r = await fetchImpl(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body), signal: ctl.signal });
      if (!r.ok) throw unavailable();
      return (await r.json()) as Record<string, unknown>;
    } catch (e) {
      throw e instanceof HttpError ? e : unavailable();
    } finally {
      clearTimeout(tm);
    }
  };
  const out = (calls: ToolCall[], text: string): AgentStepOutput => (calls.length ? { calls, text } : { text });
  return {
    name,
    async step(i) {
      if (name === 'openai') {
        const messages: unknown[] = [{ role: 'system', content: systemWithSources(i) }, { role: 'user', content: i.question }];
        for (const t of i.transcript) {
          messages.push({ role: 'assistant', content: null, tool_calls: [{ id: t.call.id, type: 'function', function: { name: t.call.name, arguments: JSON.stringify(t.call.args ?? {}) } }] });
          messages.push({ role: 'tool', tool_call_id: t.call.id, content: t.result });
        }
        const j = await call('https://api.openai.com/v1/chat/completions', { authorization: `Bearer ${key}` }, {
          model, temperature: 0, max_tokens: 400, messages,
          tools: i.tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: toJsonSchema(t) } })),
        });
        const msg = (j.choices as { message?: { content?: unknown; tool_calls?: { id?: unknown; function?: { name?: unknown; arguments?: unknown } }[] } }[] | undefined)?.[0]?.message;
        const calls = (msg?.tool_calls ?? []).map((c, k) => ({ id: safeId(c.id, k), name: str(c.function?.name), args: parseArgs(c.function?.arguments) }));
        return out(calls, str(msg?.content));
      }
      if (name === 'gemini') {
        const contents: unknown[] = [{ role: 'user', parts: [{ text: i.question }] }];
        for (const t of i.transcript) {
          contents.push({ role: 'model', parts: [{ functionCall: { name: t.call.name, args: t.call.args ?? {} } }] });
          contents.push({ role: 'user', parts: [{ functionResponse: { name: t.call.name, response: { content: t.result } } }] });
        }
        const j = await call(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, { 'x-goog-api-key': key }, {
          systemInstruction: { parts: [{ text: systemWithSources(i) }] }, contents,
          tools: [{ functionDeclarations: i.tools.map((t) => ({ name: t.name, description: t.description, parameters: geminiSchema(t) })) }],
          generationConfig: { temperature: 0, maxOutputTokens: 400 },
        });
        const parts = (j.candidates as { content?: { parts?: { text?: unknown; functionCall?: { name?: unknown; args?: unknown } }[] } }[] | undefined)?.[0]?.content?.parts ?? [];
        const calls = parts.filter((p) => p.functionCall).map((p, k) => ({ id: `call_${i.transcript.length + k + 1}`, name: str(p.functionCall!.name), args: p.functionCall!.args ?? {} }));
        return out(calls, parts.map((p) => str(p.text)).join(''));
      }
      const messages: unknown[] = [{ role: 'user', content: i.question }];
      for (const t of i.transcript) {
        messages.push({ role: 'assistant', content: [{ type: 'tool_use', id: t.call.id, name: t.call.name, input: t.call.args ?? {} }] });
        messages.push({ role: 'user', content: [{ type: 'tool_result', tool_use_id: t.call.id, content: t.result }] });
      }
      const j = await call('https://api.anthropic.com/v1/messages', { 'x-api-key': key, 'anthropic-version': '2023-06-01' }, {
        model, max_tokens: 400, temperature: 0, system: systemWithSources(i), messages,
        tools: i.tools.map((t) => ({ name: t.name, description: t.description, input_schema: toJsonSchema(t) })),
      });
      const blocks = (j.content as { type?: string; text?: unknown; id?: unknown; name?: unknown; input?: unknown }[] | undefined) ?? [];
      const calls = blocks.filter((b) => b.type === 'tool_use').map((b, k) => ({ id: safeId(b.id, k), name: str(b.name), args: b.input ?? {} }));
      return out(calls, blocks.filter((b) => b.type === 'text').map((b) => str(b.text)).join(''));
    },
  };
}
