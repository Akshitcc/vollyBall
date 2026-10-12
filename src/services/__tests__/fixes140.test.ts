/**
 * 1.4.0 demo backend: V139-3 (one email per account), V139-5 (updateMatch: createdAt, past scheduledAt).
 */
import { DemoBackend } from '../backend/demoBackend';
import type { Match, UserProfile } from '../../core/types';

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
type Db = { matches: Record<string, Match>; users: Record<string, UserProfile> };
const dbOf = (b: DemoBackend) => (b as unknown as { db: Db }).db;
const codeOf = (p: Promise<unknown>) => p.then(() => null, (e: { code?: string }) => e.code ?? String(e));

describe('V139-3: demo – one email per account (case/spaces/NFC; accents count)', () => {
  it('refuses another account\'s address, accepts its own and accent variants', async () => {
    const b = await signedIn(); // seed1
    const db = dbOf(b);
    db.users.seed2.email = 'taken@x.in';
    db.users.seed3.email = 'josé@x.in';
    const me = db.users.seed1;
    const save = (email: string) => b.saveProfile({ ...me, email } as UserProfile);
    for (const e of ['taken@x.in', ' TAKEN@X.IN ', 'jose\u0301@x.in', 'JOSÉ@x.in']) {
      const c = await codeOf(save(e));
      expect([e, c]).toEqual([e, 'email_taken']);
    }
    expect(await codeOf(save('jose@x.in'))).toBeNull(); // accent-free variant is another address
    expect(db.users.seed1.email).toBe('jose@x.in');
    expect(await codeOf(save('JOSE@x.in'))).toBeNull(); // own address again (case only)
    expect(await codeOf(save('mine\u0301@x.in'))).toBeNull();
    expect(db.users.seed1.email).toBe('miné@x.in'); // stored NFC
  });
});

describe('V139-5: demo updateMatch – createdAt is the server\'s, scheduledAt like the API', () => {
  it('refuses createdAt: 1 and a past scheduledAt; accepts a future time', async () => {
    const b = await signedIn('+919000000001'); // demo admin (creator of the seed matches may differ; the guards come first)
    const db = dbOf(b);
    const m = db.matches.match_upcoming;
    expect(m.status).toBe('scheduled');
    const before = m.createdAt;
    expect(await codeOf(b.updateMatch('match_upcoming', { createdAt: 1 }))).toBe('server_field');
    expect(await codeOf(b.updateMatch('match_upcoming', { scheduledAt: 1 }))).toBe('time_in_past');
    expect(await codeOf(b.updateMatch('match_upcoming', { scheduledAt: Date.now() - 3600_000 }))).toBe('time_in_past');
    expect(db.matches.match_upcoming.createdAt).toBe(before);
    expect(db.matches.match_upcoming.scheduledAt).toBe(m.scheduledAt);
    const later = Date.now() + 3 * 86_400_000;
    // 1.4.6 (QA V145): like the API, only the scorer edits a match – make the signed-in admin its scorer
    expect(await codeOf(b.updateMatch('match_upcoming', { scheduledAt: later }))).toBe(m.scorerId === (b as unknown as { authUser: { uid: string } }).authUser.uid ? null : 'forbidden');
    db.matches.match_upcoming.scorerId = (b as unknown as { authUser: { uid: string } }).authUser.uid;
    expect(await codeOf(b.updateMatch('match_upcoming', { scheduledAt: later }))).toBeNull();
    expect(db.matches.match_upcoming.scheduledAt).toBe(later);
  });
});
