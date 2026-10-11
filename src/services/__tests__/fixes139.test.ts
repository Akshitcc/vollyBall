/**
 * 1.3.9 demo backend: V138-11 (confirming never changes the match's date/start time; lists keep the match
 * date order) and V138-7 (an admin's new fact joins the rotation the next IST day).
 */
import { DemoBackend } from '../backend/demoBackend';
import { matchDate } from '../../core/antifraud';
import type { Match } from '../../core/types';

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
type Db = { matches: Record<string, Match> };
const dbOf = (b: DemoBackend) => (b as unknown as { db: Db }).db;
const mine = (b: DemoBackend, uid: string) => new Promise<Match[]>((r) => { const off = b.watchMyMatches(uid, (l) => { r(l); setTimeout(() => off(), 0); }); });

describe('V138-11: confirming keeps the match date and start time', () => {
  it('confirmedAt is set; startedAt / finishedAt / scheduledAt / createdAt are unchanged; order is by match date', async () => {
    const b = await signedIn(); // seed1
    const db = dbOf(b);
    const done = Object.values(db.matches).filter((m) => m.status === 'finished');
    expect(done.length).toBeGreaterThan(1);
    // an older finished match where seed1 is the opposing captain (seed1 plays on side B), not yet confirmed
    const m0 = done[0];
    const players = [...m0.teamA.players, ...m0.teamB.players].map((p) => p.id).filter((id) => id !== 'seed1');
    const old: Match = {
      ...m0,
      id: 'm_v13811',
      teamB: { ...m0.teamB, players: [{ id: 'seed1', name: 'Seed 1' }, ...m0.teamB.players.filter((p) => p.id !== 'seed1')] },
      teamA: { ...m0.teamA, players: m0.teamA.players.filter((p) => p.id !== 'seed1') },
      captains: { A: players[0], B: 'seed1' },
      createdBy: players[0],
      scorerId: players[0],
      participantIds: Array.from(new Set([...(m0.participantIds ?? []), 'seed1'])),
      createdAt: Date.UTC(2026, 0, 1),
      scheduledAt: Date.UTC(2026, 0, 2),
      startedAt: Date.UTC(2026, 0, 2, 10),
      finishedAt: Date.UTC(2026, 0, 2, 11),
      startedServerAt: Date.UTC(2026, 0, 2, 10),
      finishedServerAt: Date.UTC(2026, 0, 2, 11),
      updatedAt: Date.UTC(2026, 0, 2, 11),
      verification: { status: 'pending' },
      playerOfMatchId: m0.playerOfMatchId ?? players[0],
    } as Match;
    db.matches[old.id] = old;
    const before = (await mine(b, 'seed1')).map((m) => m.id);
    const t0 = Date.now();
    await b.confirmResult(old.id);
    const after = db.matches[old.id];
    for (const k of ['createdAt', 'scheduledAt', 'startedAt', 'finishedAt', 'startedServerAt', 'finishedServerAt'] as const) expect([k, after[k]]).toEqual([k, old[k]]);
    expect(after.confirmedAt).toBeGreaterThanOrEqual(t0);
    expect(after.updatedAt).toBeGreaterThanOrEqual(t0); // bumped – which is why lists no longer sort by it
    const list = await mine(b, 'seed1');
    expect(list.map((m) => m.id)).toEqual(before); // confirming did not move it to the top
    const dates = list.map(matchDate);
    expect(dates).toEqual([...dates].sort((x, y) => y - x));
    expect(list[0].id).not.toBe(old.id);
  });
});

describe('V138-7: demo admin facts', () => {
  it('a new fact gets createdAt (and keeps it on edit)', async () => {
    const b = await signedIn('+919000000001'); // the demo admin seed
    await (b as unknown as { setDemoAdmin: (on: boolean) => Promise<void> }).setDemoAdmin(true);
    expect(await b.isAdmin((b as unknown as { authUser: { uid: string } }).authUser.uid)).toBe(true);
    const t0 = Date.now();
    const id = await b.saveDailyItem({ type: 'fact', textEn: 'New fact', textHi: 'नया तथ्य', active: true });
    const it1 = (await b.listDailyItems({ all: true })).find((x) => x.id === id)!;
    expect(it1.createdAt).toBeGreaterThanOrEqual(t0);
    await b.saveDailyItem({ id, type: 'fact', textEn: 'New fact 2', textHi: 'नया तथ्य 2', active: true });
    expect((await b.listDailyItems({ all: true })).find((x) => x.id === id)!.createdAt).toBe(it1.createdAt);
  });
});
