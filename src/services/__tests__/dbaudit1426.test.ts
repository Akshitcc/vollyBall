/** 1.4.26 DB audit (DB-1, DB-4): match create Idempotency-Key and the score save sequence, against a fake server. */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ApiBackend, docHash } from '../backend/apiBackend';

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


const doc = (title: string) => ({ title, teamA: { name: 'A', color: '#E53935', players: [] }, teamB: { name: 'B', color: '#1E88E5', players: [] } }) as never;

it('DB-1: the same create document (double tap / retry) carries the same Idempotency-Key; another document a new one', async () => {
  const b = await signedIn();
  respond = () => ({ status: 201, body: { id: 'm1' } });
  await b.createMatch(doc('Sunday'));
  await b.createMatch(doc('Sunday'));
  await b.createMatch(doc('Monday'));
  const keys = calls.map((c) => c.headers['Idempotency-Key']);
  expect(keys[0]).toMatch(/^[A-Za-z0-9_-]{8,64}$/);
  expect(keys[1]).toBe(keys[0]);
  expect(keys[2]).not.toBe(keys[0]);
  expect(docHash('x')).toHaveLength(8);
});

it('DB-4: every score save sends a growing seq; a 409 progress_stale (server has newer) resolves the save', async () => {
  const b = await signedIn();
  const ev = (n: number) => Array.from({ length: n }, (_, i) => ({ type: 'point' as const, side: 'A' as const, at: i }));
  const prog = (n: number) => ({ events: ev(n), summary: {} as never, status: 'live' as const });
  respond = () => ({ status: 200, body: {} });
  await b.saveMatchProgress('m1', prog(1));
  await b.saveMatchProgress('m1', prog(2));
  const seqs = calls.map((c) => (c.body as { seq: number }).seq);
  expect(seqs[1]).toBeGreaterThan(seqs[0]);
  // 1.4.27 (V1426-2): no longer resolved silently – rebased on the server's seq and re-sent; refused again -> rejected
  let n = 0;
  respond = () => (n++ === 0 ? { status: 409, body: { error: 'progress_stale', message: 'A newer score is already saved', seq: 5_000 } } : { status: 200, body: {} });
  calls = [];
  await expect(b.saveMatchProgress('m1', prog(3))).resolves.toBeUndefined();
  expect(calls).toHaveLength(2);
  expect((calls[1].body as { seq: number }).seq).toBe(5_001);
  expect((calls[1].body as { events: unknown[] }).events).toHaveLength(3); // the same rallies, not dropped
  respond = () => ({ status: 409, body: { error: 'progress_stale', message: 'A newer score is already saved', seq: 1 } });
  await expect(b.saveMatchProgress('m1', prog(4))).rejects.toMatchObject({ code: 'progress_stale' });
});

it('V1426-2: the save sequence is a counter, not the device clock (a handoff to a phone 2 min behind keeps working)', async () => {
  const b = await signedIn();
  const prog = { events: [], summary: {} as never, status: 'live' as const };
  const now = jest.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-10-16T10:00:00Z'));
  await b.saveMatchProgress('m9', prog);
  now.mockReturnValue(Date.parse('2026-10-16T09:58:00Z'));
  await b.saveMatchProgress('m9', prog);
  now.mockRestore();
  expect(calls.map((c) => (c.body as { seq: number }).seq)).toEqual([1, 2]);
});
