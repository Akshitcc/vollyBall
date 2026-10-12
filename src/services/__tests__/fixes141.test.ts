/**
 * 1.4.1 demo backend: V140-10 (scheduledAt must be epoch ms on every status), V140-7 (daily tombstones –
 * deleting / turning off never reshuffles started cycles; turning back on is a copy), V140-3 (an unchanged
 * legacy address never 409s), V140-13 (Reset demo data clears the review prompt's 60-day clock).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { DemoBackend } from '../backend/demoBackend';
import type { Match, UserProfile } from '../../core/types';
import { dailySlot, type DailyItem } from '../../core/dailyItems';
import { REVIEW_LAST_ASKED_PREFIX } from '../../core/reviewPrompt';

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
async function admin() {
  const b = await signedIn('+919000000001'); // the demo admin seed
  await (b as unknown as { setDemoAdmin: (on: boolean) => Promise<void> }).setDemoAdmin(true);
  return b;
}
type Db = { matches: Record<string, Match>; users: Record<string, UserProfile>; dailyItems?: DailyItem[] };
const dbOf = (b: DemoBackend) => (b as unknown as { db: Db }).db;
const codeOf = (p: Promise<unknown>) => p.then(() => null, (e: { code?: string }) => e.code ?? String(e));

describe('V140-10: demo – scheduledAt is a whole epoch-ms number, also on live matches', () => {
  it('refuses "1" (string), NaN, 1.5 and negative on match_live; stored value unchanged', async () => {
    const b = await signedIn();
    const m = dbOf(b).matches.match_live;
    expect(m.status).toBe('live');
    const before = m.scheduledAt ?? null;
    for (const bad of ['1', NaN, 1.5, -5] as unknown[]) {
      expect([bad, await codeOf(b.updateMatch('match_live', { scheduledAt: bad as number }))]).toEqual([bad, 'time_invalid']);
    }
    expect(dbOf(b).matches.match_live.scheduledAt ?? null).toBe(before);
  });
});

describe('V140-7: demo – daily items are tombstoned, reactivation is a copy', () => {
  it('delete keeps a tombstone in the public list (no text), hidden from admin; today is unchanged', async () => {
    const b = await admin();
    const day = Math.floor((Date.now() + 5.5 * 3600_000) / 86_400_000);
    const pub0 = await b.listDailyItems();
    const today0 = dailySlot(pub0, day)?.item.id;
    const admin0 = await b.listDailyItems({ all: true });
    const victim = admin0.find((x) => x.active && x.id !== today0)!;
    await b.deleteDailyItem(victim.id);
    const pub1 = await b.listDailyItems();
    const tomb = pub1.find((x) => x.id === victim.id)!;
    expect(tomb).toBeTruthy();
    expect(tomb.active).toBe(false);
    expect(tomb.textEn ?? '').toBe('');
    expect(typeof tomb.removedAt).toBe('number');
    expect((await b.listDailyItems({ all: true })).some((x) => x.id === victim.id)).toBe(false);
    expect(dailySlot(pub1, day)?.item.id).toBe(today0);
  });
  it('off → on creates a new id (new createdAt); the old row becomes a deleted tombstone', async () => {
    const b = await admin();
    const admin0 = await b.listDailyItems({ all: true });
    const it0 = admin0.find((x) => x.active)!;
    await b.saveDailyItem({ ...it0, active: false });
    const off = (await b.listDailyItems({ all: true })).find((x) => x.id === it0.id)!;
    expect(off.active).toBe(false);
    const stamped = off.removedAt;
    expect(typeof stamped).toBe('number');
    await b.saveDailyItem({ ...off, textEn: off.textEn + ' (edited)' }); // still off: removedAt kept
    expect((await b.listDailyItems({ all: true })).find((x) => x.id === it0.id)!.removedAt).toBe(stamped);
    const newId = await b.saveDailyItem({ ...off, active: true });
    expect(newId).not.toBe(it0.id);
    const all = await b.listDailyItems({ all: true });
    expect(all.some((x) => x.id === it0.id)).toBe(false);
    expect(all.find((x) => x.id === newId)!.active).toBe(true);
    const raw = dbOf(b).dailyItems!.find((x) => x.id === it0.id)!;
    expect(raw.deleted).toBe(true);
  });
});

describe('V140-7: demo – an item turned off before 1.4.1 (no removedAt) is never stamped later', () => {
  it('edit and delete keep removedAt null; it is never listed publicly (in no cycle)', async () => {
    const b = await admin();
    const db = dbOf(b);
    await b.listDailyItems({ all: true }); // materialise the list
    const legacy = { ...db.dailyItems![0], id: 'legacy_off', active: false, removedAt: null, createdAt: Date.now() - 30 * 86_400_000 };
    db.dailyItems!.push(legacy);
    await b.saveDailyItem({ ...legacy, textEn: 'Edited while off' });
    expect(db.dailyItems!.find((x) => x.id === 'legacy_off')!.removedAt).toBeNull();
    await b.deleteDailyItem('legacy_off');
    const raw = db.dailyItems!.find((x) => x.id === 'legacy_off')!;
    expect([raw.deleted, raw.removedAt]).toEqual([true, null]);
    expect((await b.listDailyItems()).some((x) => x.id === 'legacy_off')).toBe(false);
  });
});

describe('V140-3: demo – an unchanged legacy (NFD / upper-case) address saves', () => {
  it('my stored NFD address is someone else\'s NFC key: saving the profile unchanged is not email_taken', async () => {
    const b = await signedIn();
    const db = dbOf(b);
    db.users.seed1.email = 'JOSE\u0301@x.in'; // legacy, stored before 1.3.9 normalisation
    db.users.seed2.email = 'josé@x.in';
    expect(await codeOf(b.saveProfile({ ...db.users.seed1 } as UserProfile))).toBeNull();
    expect(await codeOf(b.saveProfile({ ...db.users.seed1, email: 'josé@x.in' } as UserProfile))).toBeNull(); // same key = unchanged
    expect(await codeOf(b.saveProfile({ ...db.users.seed1, email: 'other@x.in' } as UserProfile))).toBeNull();
    expect(await codeOf(b.saveProfile({ ...db.users.seed1, email: 'JOSÉ@x.in' } as UserProfile))).toBe('email_taken'); // changed back: refused
  });
});

describe('V140-13: Reset demo data clears the review prompt\'s "last asked"', () => {
  it('removes every volleylive.review.lastAsked.* key and nothing unrelated', async () => {
    const b = await signedIn();
    await AsyncStorage.setItem(`${REVIEW_LAST_ASKED_PREFIX}seed1`, String(Date.now() - 86_400_000));
    await AsyncStorage.setItem(`${REVIEW_LAST_ASKED_PREFIX}seed7`, String(Date.now()));
    await AsyncStorage.setItem('volleylive.language', 'hi');
    await b.reset();
    expect(await AsyncStorage.getItem(`${REVIEW_LAST_ASKED_PREFIX}seed1`)).toBeNull();
    expect(await AsyncStorage.getItem(`${REVIEW_LAST_ASKED_PREFIX}seed7`)).toBeNull();
    expect(await AsyncStorage.getItem('volleylive.language')).toBe('hi');
  });
});
