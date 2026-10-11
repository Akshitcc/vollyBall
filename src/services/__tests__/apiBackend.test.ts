/** ApiBackend against a fake server (fetch + WebSocket mocked): request shapes, auth, live updates, save queue. */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ApiBackend, ApiError } from '../backend/apiBackend';

jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));

type Call = { method: string; url: string; headers: Record<string, string>; body?: unknown };
let calls: Call[];
let respond: (c: Call) => { status: number; body?: unknown } | Promise<{ status: number; body?: unknown }>;

class FakeSocket {
  static last: FakeSocket | null = null;
  readyState = 0;
  sent: Record<string, unknown>[] = [];
  onopen?: () => void;
  onmessage?: (e: { data: string }) => void;
  onclose?: () => void;
  onerror?: () => void;
  constructor(readonly url: string) {
    FakeSocket.last = this;
    setTimeout(() => {
      this.readyState = 1;
      this.onopen?.();
    }, 0);
  }
  send(s: string) {
    this.sent.push(JSON.parse(s));
  }
  close() {
    this.readyState = 3;
    this.onclose?.();
  }
  push(m: object) {
    this.onmessage?.({ data: JSON.stringify(m) });
  }
}

const flush = async (ms = 0) => {
  await new Promise((r) => setTimeout(r, ms));
  await Promise.resolve();
};

beforeEach(async () => {
  await AsyncStorage.clear();
  calls = [];
  respond = () => ({ status: 200, body: {} });
  (global as unknown as { WebSocket: unknown }).WebSocket = FakeSocket;
  global.fetch = jest.fn(async (url: string, init: { method?: string; headers?: Record<string, string>; body?: string } = {}) => {
    const c: Call = { method: init.method ?? 'GET', url, headers: init.headers ?? {}, body: init.body ? JSON.parse(init.body) : undefined };
    calls.push(c);
    const r = await respond(c);
    return { ok: r.status < 400, status: r.status, text: async () => (r.body === undefined ? '' : JSON.stringify(r.body)) };
  }) as unknown as typeof fetch;
});

async function signedIn() {
  const b = new ApiBackend({ baseUrl: 'http://api.local:4000/', devAuth: true });
  respond = (c) => (c.url.endsWith('/api/me') ? { status: 200, body: { uid: 'u1', phone: '+919000000001' } } : { status: 200, body: {} });
  const users: unknown[] = [];
  b.onAuthChanged((u) => users.push(u));
  const s = await b.sendOtp('+919000000001', null);
  await expect(s.confirm('000000')).rejects.toThrow('invalid-verification-code');
  await s.confirm('123456');
  expect(users[users.length - 1]).toEqual({ uid: 'u1', phoneNumber: '+919000000001' });
  calls = [];
  return b;
}

it('dev auth sends dev:<phone> as a Bearer token and remembers the session', async () => {
  const b = await signedIn();
  respond = () => ({ status: 404, body: { message: 'Profile not found' } });
  expect(await b.findUserByPhone('+919000000002')).toBeNull();
  expect(calls[0].url).toBe('http://api.local:4000/api/users/by-phone/%2B919000000002');
  expect(calls[0].headers.Authorization).toBe('Bearer dev:+919000000001');
  const again = new ApiBackend({ baseUrl: 'http://api.local:4000', devAuth: true });
  const seen = await new Promise((r) => again.onAuthChanged(r));
  expect(seen).toEqual({ uid: 'u1', phoneNumber: '+919000000001' });
});

it('rule rejections surface the server message (so "permission" errors translate)', async () => {
  const b = await signedIn();
  respond = () => ({ status: 403, body: { error: 'forbidden', message: 'Missing or insufficient permissions: only the captain can edit this team [teams.update.captain]' } });
  const err = await b.updateTeam('t1', { name: 'X', id: 't1', nameLower: 'x' }).catch((e) => e);
  expect(err).toBeInstanceOf(ApiError);
  expect(err.message).toMatch(/permission/);
  expect(calls[0]).toMatchObject({ method: 'PATCH', url: 'http://api.local:4000/api/teams/t1', body: { name: 'X' } });
});

it('team invites use the dedicated accept/decline endpoints', async () => {
  const b = await signedIn();
  await b.acceptTeamInvite('t1');
  await b.declineTeamInvite('t2');
  expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual(['POST http://api.local:4000/api/teams/t1/accept', 'POST http://api.local:4000/api/teams/t2/decline']);
});

it('watchMatch fetches, then applies pushed documents from the live socket', async () => {
  const b = await signedIn();
  respond = () => ({ status: 200, body: { id: 'm1', summary: { currentA: 0 }, stream: { provider: 'rtmp', live: true, ingestUrl: 'rtmp://x/placeholder' } } });
  const seen: { summary: { currentA: number }; stream: { ingestUrl?: string } }[] = [];
  const stop = b.watchMatch('m1', (m) => seen.push(m as never));
  await flush(5);
  const ws = FakeSocket.last!;
  expect(ws.url).toBe('ws://api.local:4000/live');
  expect(ws.sent[0]).toEqual({ type: 'auth', token: 'dev:+919000000001' });
  ws.push({ type: 'ready', uid: 'u1' });
  expect(ws.sent[1]).toEqual({ type: 'sub', topic: 'match:m1' });
  ws.push({ type: 'doc', topic: 'match:m1', data: { id: 'm1', summary: { currentA: 1 }, stream: { provider: 'rtmp', live: true } } });
  expect(seen.map((m) => m.summary.currentA)).toEqual([0, 1]);
  expect(seen[1].stream.ingestUrl).toBe('rtmp://x/placeholder'); // the scorer keeps the fetched ingest URL
  stop();
  expect(ws.sent[ws.sent.length - 1]).toEqual({ type: 'unsub', topic: 'match:m1' });
});

it('list watchers refetch when the topic is invalidated', async () => {
  const b = await signedIn();
  let n = 0;
  respond = () => ({ status: 200, body: [{ id: `t${++n}` }] });
  const seen: unknown[] = [];
  b.watchMyTeams('u1', (t) => seen.push(t));
  await flush(5);
  FakeSocket.last!.push({ type: 'ready', uid: 'u1' });
  FakeSocket.last!.push({ type: 'invalidate', topic: 'teams' });
  await flush(200);
  expect(seen).toEqual([[{ id: 't1' }], [{ id: 't2' }]]);
  expect(calls[0].url).toBe('http://api.local:4000/api/teams?member=u1');
});

it('score saves are queued: latest state wins, everyone resolves when it is saved', async () => {
  const b = await signedIn();
  let release!: () => void;
  respond = (c) => (calls.length === 1 ? new Promise((r) => (release = () => r({ status: 200, body: {} }))) : { status: 200, body: c.body });
  const ev = (n: number) => Array.from({ length: n }, (_, i) => ({ type: 'point' as const, side: 'A' as const, at: i }));
  const prog = (n: number) => ({ events: ev(n), summary: {} as never, status: 'live' as const });
  const p1 = b.saveMatchProgress('m1', prog(1));
  const p2 = b.saveMatchProgress('m1', prog(2));
  const p3 = b.saveMatchProgress('m1', prog(3));
  await flush();
  release();
  await Promise.all([p1, p2, p3]);
  expect(calls.map((c) => (c.body as { events: unknown[] }).events.length)).toEqual([1, 3]); // 2 was superseded
  expect(calls[1]).toMatchObject({ method: 'PUT', url: 'http://api.local:4000/api/matches/m1/progress' });
  expect((calls[1].body as Record<string, unknown>).summary).toBeUndefined(); // the server derives it
});

describe('429 rate limiting (QA C130-2)', () => {
  const i18n = require('../../i18n').default as { changeLanguage: (l: string) => Promise<unknown>; t: (k: string, o?: object) => string };
  const { translateError } = require('../../i18n/format') as { translateError: (e: unknown, t: (k: string, o?: object) => string) => string };
  const limited = { status: 429, body: { error: 'rate_limited', message: 'Too many requests. Wait a moment and try again.', retryAfter: 7 } };

  it.each([
    ['en', /Too many tries.*Wait 7 s/],
    ['hi', /बहुत ज़्यादा कोशिशें.*7 सेकंड/],
  ])('accept T&C / confirm get a translated message with the wait (%s)', async (lang, re) => {
    const b = await signedIn();
    respond = () => limited;
    const err = await b.acceptTerms('u1', '2026-01').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 429, code: 'rate_limited', retryAfter: 7 });
    await i18n.changeLanguage(lang);
    const msg = translateError(err, i18n.t.bind(i18n));
    expect(msg).toMatch(re);
    expect(msg).not.toMatch(/Too many requests/); // not the raw server text
    await i18n.changeLanguage('en');
  });

  it('a rate-limited score save waits Retry-After and resends the newest state instead of failing', async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
    try {
      const b = await (async () => {
        jest.useRealTimers();
        const x = await signedIn();
        jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
        return x;
      })();
      let n = 0;
      respond = () => (++n === 1 ? { status: 429, body: { ...limited.body, retryAfter: 2 } } : { status: 200, body: {} });
      const ev = (k: number) => Array.from({ length: k }, (_, i) => ({ type: 'point' as const, side: 'A' as const, at: i }));
      let settled: string | null = null;
      const p = b.saveMatchProgress('m1', { events: ev(1), summary: {} as never, status: 'live' }).then(() => (settled = 'ok'), () => (settled = 'rejected'));
      for (let i = 0; i < 5; i++) await Promise.resolve();
      await jest.advanceTimersByTimeAsync(1000);
      expect(settled).toBeNull(); // still waiting, not rejected
      const p2 = b.saveMatchProgress('m1', { events: ev(2), summary: {} as never, status: 'live' });
      await jest.advanceTimersByTimeAsync(1500);
      await Promise.all([p, p2]);
      expect(settled).toBe('ok');
      expect(calls.map((c) => (c.body as { events: unknown[] }).events.length)).toEqual([1, 2]);
    } finally {
      jest.useRealTimers();
    }
  });
});

it('1.3.8 (V137-4): serverNow() follows the server clock from the HTTP Date header (phone clock is only the fallback)', async () => {
  const b = await signedIn();
  expect(b.serverNow()).toBeNull(); // the fake server sends no Date header
  const serverAt = Date.now() + 3 * 86_400_000; // phone clock 3 days behind
  global.fetch = jest.fn(async () => ({ ok: true, status: 200, headers: { get: (h: string) => (h.toLowerCase() === 'date' ? new Date(serverAt).toUTCString() : null) }, text: async () => '[]' })) as unknown as typeof fetch;
  await b.findUserByPhone('+919000000002').catch(() => null);
  expect(Math.abs(b.serverNow()! - serverAt)).toBeLessThan(2000);
});
