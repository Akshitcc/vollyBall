/**
 * 1.4.4 demo backend (API parity): V143-8 (a live doc whose events have a winner is over: no undo of the winning
 * rally, no abandon; 'finished' without a winner keeps the match live; rules that would end a live match are
 * refused), V143-7 (the finishing write repairs such a doc), V143-6 (the unchanged stored email passes on save).
 */
import { DemoBackend } from '../backend/demoBackend';
import type { Match, UserProfile } from '../../core/types';
import { addPoint, computeState, summarize, type MatchEvent } from '../../core/scoring';

jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('../backend/firebaseBackend', () => ({ FirebaseBackend: class {} }));

const AS = () => { const m = require('@react-native-async-storage/async-storage'); return m.default ?? m; };
const made: DemoBackend[] = [];
// 1.4.9 (QA V148-1): each test is isolated – the shared AsyncStorage mock is emptied and every backend's pending
// 300 ms save (DemoBackend's debounce) and simulation timer are cleared, so nothing from one test lands in the next.
type Timers = { simTimer: ReturnType<typeof setInterval> | null; saveTimer: ReturnType<typeof setTimeout> | null };
beforeEach(async () => {
  await AS().clear();
});
afterEach(async () => {
  for (const b of made.splice(0)) {
    const t = b as unknown as Timers;
    if (t.simTimer) clearInterval(t.simTimer);
    if (t.saveTimer) clearTimeout(t.saveTimer);
    t.saveTimer = null;
  }
  jest.useRealTimers();
  await AS().clear();
});
async function signedIn(phone = '+919000000010') {
  jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
  const b = new DemoBackend();
  made.push(b);
  const otp = b.sendOtp(phone);
  await jest.advanceTimersByTimeAsync(500);
  const done = (await otp).confirm('123456');
  await jest.advanceTimersByTimeAsync(500);
  await done;
  jest.useRealTimers();
  await b.acceptTerms((b as unknown as { authUser: { uid: string } }).authUser.uid, require('../../core/terms').TERMS_VERSION);
  return b;
}
const dbOf = (b: DemoBackend) => (b as unknown as { db: { matches: Record<string, Match>; users: Record<string, Record<string, unknown>> } }).db;
const prog = (events: MatchEvent[], status: Match['status']) => ({ events, status, summary: null as never });
const codeOf = (p: Promise<unknown>) => p.then(() => null, (e: { code?: string }) => e.code ?? String(e));

/** Tester's seed: the demo's live match with a winning log, still stored as 'live'. */
async function stuckLive() {
  const b = await signedIn();
  const m0 = dbOf(b).matches.match_live;
  let ev = [...m0.events];
  let t = Date.now();
  while (!computeState(m0.rules, ev, m0.firstServe).finished) ev = addPoint(m0.rules, ev, 'A', { at: ++t });
  dbOf(b).matches[m0.id] = { ...m0, events: ev, summary: summarize(computeState(m0.rules, ev, m0.firstServe)), status: 'live' };
  return { b, id: m0.id, ev, m0 };
}

describe('V143-8: a live doc whose events have a winner is over (guardProgress uses matchOver)', () => {
  it('undoing the winning rally and then abandoning are refused', async () => {
    const { b, id, ev } = await stuckLive();
    expect(await codeOf(b.saveMatchProgress(id, prog(ev.slice(0, -1), 'live')))).toBe('match_finished');
    expect(dbOf(b).matches[id].events.length).toBe(ev.length);
    // 'abandoned' with the winning log: the status follows the events (as on the API) – finished, never abandoned
    await b.saveMatchProgress(id, prog(ev, 'abandoned'));
    expect(dbOf(b).matches[id].status).toBe('finished');
    expect(await codeOf(b.updateMatch(id, { status: 'abandoned' }))).toBe('match_finished');
  });
  it('V143-7: the finishing write (same events) closes it as finished with the backend time', async () => {
    const { b, id, ev } = await stuckLive();
    await b.saveMatchProgress(id, prog(ev, 'live'));
    const m = dbOf(b).matches[id];
    expect(m.status).toBe('finished');
    expect(m.finishedAt).toBeGreaterThan(Date.now() - 60_000);
    const { b: b2, id: id2 } = await stuckLive();
    await b2.updateMatch(id2, { status: 'finished' });
    expect(dbOf(b2).matches[id2].status).toBe('finished');
  });
});

describe('V143-8: no "finished" without a winner; rules can\'t end a live match', () => {
  it("saveMatchProgress(n-1, 'finished') keeps the match live (like the API) – nothing finished with winner null", async () => {
    const b = await signedIn();
    const m0 = dbOf(b).matches.match_live;
    let ev = [...m0.events];
    let t = Date.now();
    while (!computeState(m0.rules, addPoint(m0.rules, ev, 'A', { at: t + 1 }), m0.firstServe).finished) ev = addPoint(m0.rules, ev, 'A', { at: ++t });
    await b.saveMatchProgress(m0.id, prog(ev, 'finished'));
    const m = dbOf(b).matches[m0.id];
    expect(m.status).toBe('live');
    expect(m.finishedAt ?? null).toBeNull();
    expect(m.summary?.winner ?? null).toBeNull();
  });
  it('a rules change that would make the live match won is refused (1.4.5: match_setup_locked); the match stays live', async () => {
    const b = await signedIn();
    const m0 = dbOf(b).matches.match_live;
    let ev = [...m0.events];
    let t = Date.now();
    while (!computeState(m0.rules, addPoint(m0.rules, ev, 'A', { at: t + 1 }), m0.firstServe).finished) ev = addPoint(m0.rules, ev, 'A', { at: ++t });
    await b.saveMatchProgress(m0.id, prog(ev, 'live'));
    const short = { ...m0.rules, pointsPerSet: 15, decidingSetPoints: 15, decidingSwitchAt: 8 };
    // 1.4.5 (V144-4): every rules change after the first rally is refused first (match_setup_locked), so the
    // match_rules_end check behind it can no longer be reached from a live match with rallies
    expect(await codeOf(b.updateMatch(m0.id, { rules: short }))).toBe('match_setup_locked');
    expect(dbOf(b).matches[m0.id].status).toBe('live');
    expect(dbOf(b).matches[m0.id].rules.pointsPerSet).toBe(m0.rules.pointsPerSet);
  });
});

describe('V143-6: the stored email, unchanged, passes on a demo save', () => {
  it("Tester's probes: 张伟@example.com / a\\u200bb@x.in / ab@ex..com stored → a pincode save works, the address is kept", async () => {
    const b = await signedIn();
    const uid = (b as unknown as { authUser: { uid: string } }).authUser.uid;
    for (const legacy of ['张伟@example.com', 'a\u200bb@x.in', 'ab@ex..com']) {
      dbOf(b).users[uid] = { ...dbOf(b).users[uid], email: legacy };
      const u = dbOf(b).users[uid] as unknown as UserProfile;
      await b.saveProfile({ ...u, pincode: '400001' });
      expect(dbOf(b).users[uid].email).toBe(legacy);
      expect(await codeOf(b.saveProfile({ ...u, email: `x${legacy}` }))).not.toBeNull();
    }
  });
});

describe('V148-1: isolation', () => {
  it('no save timer of an earlier test is left pending, and storage starts empty', async () => {
    expect(await AS().getAllKeys()).toEqual([]);
    const b = await signedIn('+919000000099');
    expect(made).toContain(b);
  });
});
