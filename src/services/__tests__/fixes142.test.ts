/**
 * 1.4.2 demo backend: V141-8 (a finished match's score can never change – no undo, no extra rally, no
 * move back to live; only crediting one of the last rallies to a player is left).
 */
import { DemoBackend } from '../backend/demoBackend';
import type { Match } from '../../core/types';
import { addPoint, computeState, summarize, undo, type MatchEvent } from '../../core/scoring';

jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('../backend/firebaseBackend', () => ({ FirebaseBackend: class {} }));

const made: DemoBackend[] = [];
afterEach(() => {
  for (const b of made.splice(0)) clearInterval((b as unknown as { simTimer: ReturnType<typeof setInterval> }).simTimer);
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
const dbOf = (b: DemoBackend) => (b as unknown as { db: { matches: Record<string, Match> } }).db;
const codeOf = (p: Promise<unknown>) => p.then(() => null, (e: { code?: string }) => e.code ?? String(e));
const save = (b: DemoBackend, m: Match, events: MatchEvent[], status?: Match['status']) => {
  const st = computeState(m.rules, events, m.firstServe);
  return b.saveMatchProgress(m.id, { events, summary: summarize(st), status: status ?? (st.finished ? 'finished' : 'live') });
};

describe('V141-8: demo – once the match is over the score is final', () => {
  it('scores match_live to the end, then refuses undo / an extra rally / back to live; the score is unchanged', async () => {
    const b = await signedIn();
    let m = dbOf(b).matches.match_live;
    let ev = [...m.events];
    let t = Date.now();
    while (!computeState(m.rules, ev, m.firstServe).finished) ev = addPoint(m.rules, ev, 'A', { at: ++t });
    await save(b, m, ev);
    m = dbOf(b).matches.match_live;
    expect(m.status).toBe('finished');
    expect(m.playerOfMatchId ?? null).toBeNull(); // the sheet was closed before the POTM was confirmed
    const frozen = JSON.stringify(m.events);
    expect(await codeOf(save(b, m, undo(ev), 'live'))).toBe('match_finished'); // "Arjun −1 · Back to 24–0"
    expect(await codeOf(save(b, m, undo(ev), 'finished'))).toBe('match_finished');
    expect(await codeOf(save(b, m, [...ev, { type: 'point', side: 'B', at: ++t } as MatchEvent], 'finished'))).toBe('match_finished');
    // 1.4.3 (V142-7, API parity): the status follows the events – "live" with the winning rally stays finished
    expect(await codeOf(save(b, m, ev, 'live'))).toBeNull();
    expect(JSON.stringify(dbOf(b).matches.match_live.events)).toBe(frozen);
    expect(dbOf(b).matches.match_live.status).toBe('finished');
    // crediting the winning rally ("Who scored?") still works for a player on court
    const ok: (string | null)[] = [];
    for (const p of m.teamA.players) {
      const last = ev[ev.length - 1] as Extract<MatchEvent, { type: 'point' }>;
      ok.push(await codeOf(save(b, dbOf(b).matches.match_live, [...ev.slice(0, -1), { ...last, playerId: p.id }], 'finished')));
    }
    expect(ok).toContain(null);
    expect(ok).not.toContain('match_finished');
  });
});

async function admin() {
  const b = await signedIn('+919000000001'); // the demo admin seed
  await (b as unknown as { setDemoAdmin: (on: boolean) => Promise<void> }).setDemoAdmin(true);
  return b;
}

describe('V141-7: demo – scheduledAt must be a sane epoch-ms value', () => {
  it('1e300, 2^53 and > 2 years ahead are time_invalid (also on a scheduled match, before time_in_past); 1 year ahead is fine', async () => {
    const b = await signedIn();
    const sched = Object.values(dbOf(b).matches).find((m) => m.status === 'scheduled' && m.createdBy === 'seed1') ?? Object.values(dbOf(b).matches).find((m) => m.status === 'scheduled');
    for (const id of ['match_live', sched!.id]) {
      for (const bad of [1e300, 2 ** 53, Date.now() + 3 * 365 * 86_400_000, -1, 1.5]) {
        expect([id, bad, await codeOf(b.updateMatch(id, { scheduledAt: bad }))]).toEqual([id, bad, 'time_invalid']);
      }
    }
    const own = Object.values(dbOf(b).matches).find((m) => m.status === 'scheduled' && (m.createdBy === 'seed1' || m.scorerId === 'seed1'));
    if (own) {
      expect(await codeOf(b.updateMatch(own.id, { scheduledAt: Date.now() + 365 * 86_400_000 }))).toBeNull();
      // a patch without a status uses the stored one: a past time on a scheduled match is time_in_past
      expect(await codeOf(b.updateMatch(own.id, { scheduledAt: Date.now() - 86_400_000 }))).toBe('time_in_past');
    }
  });
});

describe('V141-6 / info: demo daily items', () => {
  it('a deleted item keeps no text, even in the stored data; active must be a boolean', async () => {
    const b = await admin();
    const it0 = (await b.listDailyItems({ all: true })).find((x) => x.active)!;
    await b.deleteDailyItem(it0.id);
    const stored = (b as unknown as { db: { dailyItems: { id: string; textEn: string; textHi: string; deleted?: boolean }[] } }).db.dailyItems.find((x) => x.id === it0.id)!;
    expect([stored.textEn, stored.textHi, stored.deleted]).toEqual(['', '', true]);
    const it1 = (await b.listDailyItems({ all: true })).find((x) => x.active)!;
    for (const v of ['false', 0, 1, null] as unknown[]) expect(await codeOf(b.saveDailyItem({ ...it1, active: v as boolean }))).toBe('daily_invalid');
    expect(await codeOf(b.saveDailyItem({ ...it1, active: false }))).toBeNull();
  });
});
