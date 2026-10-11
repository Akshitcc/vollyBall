/**
 * 1.3.0 demo backend parity with the API server and firestore.rules: T&C gate, server-only times,
 * one-way terminal statuses, opposing-captain confirmation, derived wallet, flagged matches excluded
 * until an admin (env ADMIN list, no new accounts) reviews them.
 */
import { DemoBackend } from '../backend/demoBackend';
import { TERMS_NOT_ACCEPTED, TERMS_VERSION, TERMS_VERSION_MISMATCH } from '../../core/terms';
import { ANTI_FRAUD } from '../../core/antifraud';

jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
// the demo admin list comes from EXPO_PUBLIC_DEMO_ADMIN_UIDS (env only); seed2 here
jest.mock('../config', () => ({ ...jest.requireActual('../config'), DEMO_ADMIN_UIDS: ['seed2'] }));

const phoneOf = (n: number) => `+9190000000${String(n + 9).padStart(2, '0')}`;
async function signedIn(n: number, accept = true) {
  jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
  const b = new DemoBackend();
  const otp = b.sendOtp(phoneOf(n));
  await jest.advanceTimersByTimeAsync(500);
  const done = (await otp).confirm('123456');
  await jest.advanceTimersByTimeAsync(500);
  await done;
  jest.useRealTimers();
  if (accept) await b.acceptTerms(`seed${n}`, TERMS_VERSION);
  return b;
}
const db = (b: DemoBackend) => (b as unknown as { db: { matches: Record<string, Record<string, unknown>>; users: Record<string, Record<string, unknown>> } }).db;
const codeOf = async (p: Promise<unknown>) => p.then(() => null, (e) => (e as { code?: string }).code ?? String(e));
const newTeam = { name: 'Gate Test', color: '#2B2B2B', captainId: 'seed1', memberIds: ['seed1'], subIds: [], pendingPhones: [], city: '' };

beforeEach(async () => {
  const AS = require('@react-native-async-storage/async-storage');
  await (AS.default ?? AS).clear();
});

describe('T&C gate (item 1)', () => {
  it('no writes before the current version is accepted; a stale version is refused; acceptance is stored', async () => {
    const b = await signedIn(1, false);
    expect(await b.getTerms('seed1')).toBeNull();
    expect(await codeOf(b.createTeam(newTeam))).toBe(TERMS_NOT_ACCEPTED);
    expect(await codeOf(b.acceptTerms('seed1', '2025-01-old'))).toBe(TERMS_VERSION_MISMATCH);
    await expect(b.acceptTerms('seed2', TERMS_VERSION)).rejects.toThrow(); // only for yourself
    await b.acceptTerms('seed1', TERMS_VERSION);
    expect(await b.getTerms('seed1')).toMatchObject({ version: TERMS_VERSION });
    await expect(b.createTeam(newTeam)).resolves.toBeTruthy();
  });
});

describe('baseline holes on the demo backend (item 6, N121-1..3)', () => {
  it('no create-as-finished, no client times, terminal is one-way', async () => {
    const b = await signedIn(1);
    const live = db(b).matches.match_live as never as { id: string };
    const m = db(b).matches.match_upcoming as Record<string, unknown>;
    expect(await codeOf(b.createMatch({ ...m, id: undefined, status: 'finished' } as never))).toBe('match_bad_status');
    expect(await codeOf(b.updateMatch(live.id, { finishedAt: Date.now() + 86_400_000 } as never))).toBe('server_time');
    expect(await codeOf(b.updateMatch(live.id, { startedAt: 1 } as never))).toBe('server_time');
    expect(await codeOf(b.updateMatch(live.id, { verification: { status: 'approved' } } as never))).toBe('server_field');
    await b.updateMatch('match_upcoming', { status: 'abandoned' });
    expect(db(b).matches.match_upcoming.finishedAt).toEqual(expect.any(Number)); // stamped by the backend
    expect(await codeOf(b.updateMatch('match_upcoming', { status: 'live' }))).toBe('match_terminal');
    expect(await codeOf(b.updateMatch('match_upcoming', { status: 'scheduled' }))).toBe('match_terminal');
  });
});

describe('confirmation by the opposing captain (item 5)', () => {
  it('the scoring side cannot confirm; the other captain can, once', async () => {
    const scorer = await signedIn(1);
    expect(db(scorer).matches.match_await.captains).toEqual({ A: 'seed1', B: 'seed7' });
    expect(await codeOf(scorer.confirmResult('match_await'))).toMatch(/scoring_side|not_captain/);
    const before = await scorer.getWallet('seed1');
    expect(before.awaitingConfirmation).toBeGreaterThan(0);
    const other = await signedIn(7);
    // share the stored DB between the two sessions (same device in the demo)
    (other as unknown as { db: unknown }).db = db(scorer);
    await other.acceptTerms('seed7', TERMS_VERSION);
    await other.confirmResult('match_await');
    expect(db(scorer).matches.match_await.verification).toMatchObject({ status: 'confirmed', by: 'seed7' });
    expect(await codeOf(other.confirmResult('match_await'))).toBe('already_reviewed');
    const after = await scorer.getWallet('seed1');
    expect(after.awaitingConfirmation).toBe(before.awaitingConfirmation - 1);
    expect(after.countedMatches).toBe(before.countedMatches + 1);
  });
  it('a reject needs no more than the reason limit', async () => {
    const other = await signedIn(7);
    await expect(other.rejectResult('match_await', 'x'.repeat(ANTI_FRAUD.REJECT_REASON_MAX + 1))).rejects.toThrow();
    await other.rejectResult('match_await', 'Score is wrong');
    expect(db(other).matches.match_await.verification).toMatchObject({ status: 'disputed', reason: 'Score is wrong' });
  });
});

describe('wallet (items 3, 4): derived, balance only', () => {
  it('bonus is +100 per 5 counted wins and nothing is stored on the user', async () => {
    const b = await signedIn(1);
    const w = await b.getWallet('seed1');
    expect(w.bonus).toBe(Math.floor(w.wins / 5) * 100);
    expect(w.balance).toBe(w.matchPoints + w.bonus);
    for (const k of ['wallet', 'balance', 'bonus', 'points']) expect(db(b).users.seed1[k]).toBeUndefined();
    expect(Object.keys(w).join(' ')).not.toMatch(/cash|redeem|rupee|inr|aadhaar/i);
  });
});

describe('flagged until an admin reviews it (item 5)', () => {
  it('a short match is excluded from rankings, listed for the env admin only, counted after approval', async () => {
    const b = await signedIn(1);
    expect(await b.isAdmin('seed1')).toBe(false);
    expect(await b.listFlagged()).toEqual([]);
    const admin = await signedIn(2);
    (admin as unknown as { db: unknown }).db = db(b);
    expect(await admin.isAdmin('seed2')).toBe(true);
    expect((await admin.listFlagged()).map((m) => m.id)).toContain('match_flagged');
    const before = await b.getWallet('seed1');
    expect(before.flagged).toBeGreaterThan(0);
    expect(await codeOf(b.reviewMatch('match_flagged', 'approve'))).toBe('admin_only');
    await admin.reviewMatch('match_flagged', 'approve');
    const after = await b.getWallet('seed1');
    expect(after.flagged).toBe(before.flagged - 1);
    expect(after.countedMatches).toBe(before.countedMatches + 1);
    expect(await codeOf(admin.reviewMatch('match_flagged', 'void'))).toBe('already_reviewed');
  });
});

describe('1.3.1: one source for rank card, Career stats and the wallet history (QA C130-7 / C130-8)', () => {
  it('getRankings gives my counted match ids (exactly the matches behind `me`); the wallet history adds up to the balance', async () => {
    const b = await signedIn(1);
    const r = await b.getRankings('seed1');
    expect(r.me).not.toBeNull();
    expect(r.myCountedMatchIds.length).toBe(r.me!.matches);
    const w = await b.getWallet('seed1');
    expect(w.history.filter((h) => h.kind === 'match').map((h) => h.matchId).sort()).toEqual([...r.myCountedMatchIds].sort());
    expect(w.history.reduce((n, h) => n + h.points, 0)).toBe(w.balance);
    for (let i = 1; i < w.history.length; i++) expect(w.history[i - 1].at).toBeGreaterThanOrEqual(w.history[i].at); // newest first
    // a match waiting for the other captain is in neither
    const pending = Object.values(db(b).matches).find((m) => m.status === 'finished' && !(m.verification as { status?: string } | null)?.status);
    if (pending) expect(r.myCountedMatchIds).not.toContain(pending.id);
  });
});
