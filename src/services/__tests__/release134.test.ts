/**
 * 1.3.4 services / core:
 *  - sign-up hardening (a): resolveBackendMode fails loudly when API mode is asked for without
 *    EXPO_PUBLIC_API_URL (and the API host shown in Profile > About);
 *  - D133-1 connectivity + syncView (simulated offline);
 *  - D133-3 sha256 (vs node:crypto), D133-2 slots / batch-capped picks;
 *  - D133-5 offCourtCredit; demo backend: bench credit refused, D133-6 summary recomputed from the
 *    events, simulated offline refuses writes, photo duplicate / per-match cap;
 *  - the demo-only "Demo admin" (QA access) – never outside demo mode.
 */
import { createHash } from 'crypto';
import { apiHostOf, BackendConfigError, resolveBackendMode } from '../../core/backendMode';
import { sha256Hex, SHA256_HEX_RE } from '../../core/sha256';
import { MAX_PHOTOS_PER_BATCH, MAX_PHOTOS_PER_MATCH, photoSlots } from '../../core/limits';
import { offCourtCredit, rotationState } from '../../core/rotation';
import { computeState, summarize, type MatchEvent } from '../../core/scoring';
import { connectivity, isNetworkError, syncView } from '../connectivity';
import { queuePickedPhotos } from '../photoPick';
import { TERMS_VERSION } from '../../core/terms';
import type { Match } from '../../core/types';

jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('../backend', () => ({ backend: {} })); // photoQueue's default backend is not used here
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null, MaterialCommunityIcons: () => null }));
// Photos in the demo backend: bytes derived from the file name, so "a.jpg" twice is the same image.
jest.mock('../photoFile', () => {
  const actual = jest.requireActual('../photoFile');
  return {
    ...actual,
    readPhoto: async (uri: string) => {
      const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...Array.from(uri, (c) => c.charCodeAt(0)), ...new Array(200).fill(7)]);
      return { blob: { size: bytes.length, type: 'image/jpeg', arrayBuffer: async () => bytes.buffer }, size: bytes.length, type: 'image/jpeg', ext: 'jpg' };
    },
  };
});

describe('sign-up hardening (a): backend mode', () => {
  const env = (o: Record<string, string | boolean>) => ({ hasFirebase: false, ...o }) as Parameters<typeof resolveBackendMode>[0];
  it('no settings → demo (shipped phone builds); Firebase config → firebase', () => {
    expect(resolveBackendMode(env({})).kind).toBe('demo');
    expect(resolveBackendMode(env({ hasFirebase: true })).kind).toBe('firebase');
    expect(resolveBackendMode(env({ EXPO_PUBLIC_DEMO_MODE: '1', hasFirebase: true, EXPO_PUBLIC_API_URL: 'http://x:4000' })).kind).toBe('demo');
  });
  it('API asked for without EXPO_PUBLIC_API_URL fails loudly (never a silent demo build)', () => {
    expect(() => resolveBackendMode(env({ EXPO_PUBLIC_BACKEND: 'api' }))).toThrow(BackendConfigError);
    expect(() => resolveBackendMode(env({ EXPO_PUBLIC_BACKEND: 'api' }))).toThrow('EXPO_PUBLIC_API_URL is not set');
    expect(() => resolveBackendMode(env({ EXPO_PUBLIC_API_DEV_AUTH: '1' }))).toThrow('EXPO_PUBLIC_API_URL is not set');
    // a URL but no way to sign in used to fall back to demo silently
    expect(() => resolveBackendMode(env({ EXPO_PUBLIC_API_URL: 'http://192.168.1.10:4000' }))).toThrow(/EXPO_PUBLIC_API_DEV_AUTH=1/);
    expect(() => resolveBackendMode(env({ EXPO_PUBLIC_BACKEND: 'api', EXPO_PUBLIC_API_URL: 'ftp://x', EXPO_PUBLIC_API_DEV_AUTH: '1' }))).toThrow('http(s)');
    expect(() => resolveBackendMode(env({ EXPO_PUBLIC_BACKEND: 'firebase' }))).toThrow('EXPO_PUBLIC_FIREBASE_');
    expect(() => resolveBackendMode(env({ EXPO_PUBLIC_BACKEND: 'mysql' }))).toThrow('demo, api or firebase');
    expect(() => resolveBackendMode(env({ EXPO_PUBLIC_BACKEND: 'api', EXPO_PUBLIC_DEMO_MODE: '1' }))).toThrow('contradicts');
  });
  it('a complete API config → api, with the host (no path / query) for Profile > About', () => {
    const m = resolveBackendMode(env({ EXPO_PUBLIC_BACKEND: 'api', EXPO_PUBLIC_API_URL: 'http://192.168.1.10:4000/', EXPO_PUBLIC_API_DEV_AUTH: '1' }));
    expect(m).toEqual({ kind: 'api', apiHost: '192.168.1.10:4000', apiUrl: 'http://192.168.1.10:4000', devAuth: true });
    expect(resolveBackendMode(env({ EXPO_PUBLIC_API_URL: 'https://api.example.in/v1?x=1', hasFirebase: true })).apiHost).toBe('api.example.in');
    expect(apiHostOf('https://user@evil')).toBeNull();
  });
  it('this test build (no EXPO_PUBLIC_* backend values) is a demo build', () => {
    const cfg = require('../config');
    expect([cfg.BACKEND_KIND, cfg.DEMO_MODE, cfg.API_HOST]).toEqual(['demo', true, '']);
  });
});

describe('D133-1: connectivity', () => {
  afterEach(() => {
    connectivity.setSimulatedOffline(false);
    connectivity.reportNetworkSuccess();
  });
  it('simulated offline / network failures make it offline and notify; turning it off restores', () => {
    const seen: boolean[] = [];
    const un = connectivity.subscribe(() => seen.push(connectivity.isOnline()));
    expect(connectivity.isOnline()).toBe(true);
    connectivity.setSimulatedOffline(true);
    connectivity.reportNetworkFailure();
    connectivity.setSimulatedOffline(false); // also forgets the simulated failure
    connectivity.reportNetworkFailure();
    connectivity.reportNetworkSuccess();
    un();
    expect(seen).toEqual([false, false, true, false, true]);
    expect(isNetworkError(new TypeError('Network request failed'))).toBe(true);
    expect(isNetworkError(Object.assign(new Error('That player is not on court'), { code: 'not_on_court' }))).toBe(false);
  });
  it('syncView: offline wins, then syncing (with the count), then synced', () => {
    expect(syncView({ online: false, saving: false, failed: false, error: false, pending: 3 })).toEqual({ kind: 'offline', pending: 3 });
    expect(syncView({ online: true, saving: false, failed: true, error: false, pending: 1 })).toEqual({ kind: 'offline', pending: 1 });
    expect(syncView({ online: true, saving: true, failed: false, error: false, pending: 1 })).toEqual({ kind: 'syncing', pending: 1 });
    expect(syncView({ online: true, saving: false, failed: false, error: false, pending: 0 })).toEqual({ kind: 'synced', pending: 0 });
    expect(syncView({ online: false, saving: false, failed: false, error: true, pending: 0 }).kind).toBe('error');
  });
});

describe('D133-2 / D133-3: photo limits and hashes', () => {
  it('sha256Hex matches node:crypto', () => {
    for (const n of [0, 1, 55, 56, 63, 64, 65, 1000, 70001]) {
      const b = new Uint8Array(n).map((_, i) => (i * 31 + n) & 255);
      expect(sha256Hex(b)).toBe(createHash('sha256').update(b).digest('hex'));
    }
    expect(SHA256_HEX_RE.test('a'.repeat(64))).toBe(true);
  });
  it('limits: 10 per upload, 50 per match (no PRD number: 50 chosen); slots count queued photos', () => {
    expect([MAX_PHOTOS_PER_BATCH, MAX_PHOTOS_PER_MATCH]).toEqual([10, 50]);
    expect(photoSlots(45, 2)).toEqual({ used: 47, left: 3 });
    expect(photoSlots(60, 0)).toEqual({ used: 60, left: 0 });
  });
  it('a pick over the limit queues `limit` and reports the rest as dropped', async () => {
    const add = jest.fn(async () => {});
    const picked = Array.from({ length: 14 }, (_, i) => ({ uri: `f:${i}`, fileSize: 1000, mimeType: 'image/jpeg' }));
    const r = await queuePickedPhotos(picked, 'm1', 'a1', { read: async () => ({}), add, limit: 3 });
    expect([r.queued, r.dropped, add.mock.calls.length]).toEqual([3, 11, 3]);
  });
});

describe('D133-5: offCourtCredit', () => {
  const R = { ...require('../../core/rules').INDOOR_RULES, bestOf: 1, pointsPerSet: 25 };
  const A = ['a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7'];
  const B = ['b1', 'b2', 'b3', 'b4', 'b5', 'b6'];
  it('the 7th player starts on the bench; a set-1 lineup puts them on court', () => {
    const ev: MatchEvent[] = [{ type: 'point', side: 'A', at: 1, playerId: 'a7' }];
    expect(offCourtCredit(R, ev, 'A', { A, B })).toEqual({ index: 0, side: 'A', playerId: 'a7' });
    expect(offCourtCredit(R, [{ type: 'point', side: 'A', at: 1, playerId: 'a3' }], 'A', { A, B })).toBeNull();
    const lineups = { '1': { A: ['a7', 'a2', 'a3', 'a4', 'a5', 'a6'], B } };
    expect(offCourtCredit(R, ev, 'A', { A, B }, lineups)).toBeNull();
    expect(rotationState(R, [], 'A', { A, B }, lineups).positions.A).toContain('a7');
    // only events from `from` on are checked (older saved data is left alone)
    expect(offCourtCredit(R, [...ev, { type: 'point', side: 'A', at: 2, playerId: 'a2' }], 'A', { A, B }, null, 1)).toBeNull();
  });
});

describe('demo backend', () => {
  const { DemoBackend } = require('../backend/demoBackend');
  type Demo = InstanceType<typeof DemoBackend>;
  async function signedIn(n: number): Promise<Demo> {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
    const b = new DemoBackend();
    made.push(b);
    const otp = b.sendOtp(`+9190000000${String(n + 9).padStart(2, '0')}`);
    await jest.advanceTimersByTimeAsync(500);
    const done = (await otp).confirm('123456');
    await jest.advanceTimersByTimeAsync(500);
    await done;
    jest.useRealTimers();
    await b.acceptTerms(`seed${n}`, TERMS_VERSION);
    return b;
  }
  const db = (b: Demo) => (b as unknown as { db: { matches: Record<string, Match>; photos: Record<string, { matchId: string; hash?: string | null }> } }).db;
  beforeEach(async () => {
    const AS = require('@react-native-async-storage/async-storage');
    await (AS.default ?? AS).clear();
    connectivity.setSimulatedOffline(false);
  });
  const made: Demo[] = [];
  afterEach(() => {
    connectivity.setSimulatedOffline(false);
    for (const b of made.splice(0)) clearInterval((b as unknown as { simTimer: ReturnType<typeof setInterval> }).simTimer);
  });

  it('D133-6: the stored summary is recomputed from the events (client totals ignored)', async () => {
    const b = await signedIn(1);
    const m = db(b).matches.match_live;
    const next = [...m.events, { type: 'point', side: 'B', at: Date.now() } as MatchEvent];
    const forged = { ...summarize(computeState(m.rules, next, m.firstServe)), currentA: 99, setsA: 9 };
    await b.saveMatchProgress('match_live', { events: next, summary: forged as never, status: 'live' });
    expect(db(b).matches.match_live.summary).toEqual(summarize(computeState(m.rules, next, m.firstServe)));
  });

  it('D133-5: a credit for a bench player is refused (not_on_court)', async () => {
    const b = await signedIn(1);
    const m = db(b).matches.match_live;
    const ids = { A: m.teamA.players.map((p) => p.id), B: m.teamB.players.map((p) => p.id) };
    const on = rotationState(m.rules, m.events, m.firstServe, ids, m.lineups).positions.A;
    // a 7th (registered) player on team A, not in the lineup: on the bench
    const users = (b as unknown as { db: { users: Record<string, { name: string }> } }).db.users;
    const inMatch = new Set([...ids.A, ...ids.B]);
    const extra = Object.keys(users).find((u) => !inMatch.has(u))!;
    db(b).matches.match_live = { ...m, teamA: { ...m.teamA, players: [...m.teamA.players, { id: extra, name: users[extra].name, photoURL: null }] }, participantIds: [...ids.A, extra, ...m.participantIds.slice(ids.A.length)] } as Match;
    const bench = [...m.events, { type: 'point', side: 'A', at: Date.now(), playerId: extra } as MatchEvent];
    await expect(b.saveMatchProgress('match_live', { events: bench, summary: m.summary, status: 'live' })).rejects.toMatchObject({ code: 'not_on_court' });
    const ok = [...m.events, { type: 'point', side: 'A', at: Date.now(), playerId: on[0]! } as MatchEvent];
    await expect(b.saveMatchProgress('match_live', { events: ok, summary: m.summary, status: 'live' })).resolves.toBeUndefined();
  });

  it('D133-1: "Simulate offline" makes writes fail like a dropped connection', async () => {
    const b = await signedIn(1);
    const m = db(b).matches.match_live;
    connectivity.setSimulatedOffline(true);
    await expect(b.saveMatchProgress('match_live', { events: m.events, summary: m.summary, status: 'live' })).rejects.toThrow(/Network request failed/);
    await expect(b.uploadMatchPhoto('match_live', 'seed1', 'file:///x.jpg')).rejects.toThrow(/Network request failed/);
  });

  it('D133-3 / D133-2: same image twice → photo_duplicate (hash stored); the 51st → photo_limit', async () => {
    const b = await signedIn(1);
    const before = Object.values(db(b).photos).filter((p) => p.matchId === 'match_live').length;
    await b.uploadMatchPhoto('match_live', 'seed1', 'file:///same.jpg');
    const mine = Object.values(db(b).photos).filter((p) => p.matchId === 'match_live' && p.hash);
    expect(mine.at(-1)?.hash).toMatch(/^[0-9a-f]{64}$/);
    await expect(b.uploadMatchPhoto('match_live', 'seed1', 'file:///same.jpg')).rejects.toMatchObject({ code: 'photo_duplicate' });
    for (let i = before + 1; i < MAX_PHOTOS_PER_MATCH; i++) await b.uploadMatchPhoto('match_live', 'seed1', `file:///p${i}.jpg`);
    expect(Object.values(db(b).photos).filter((p) => p.matchId === 'match_live')).toHaveLength(MAX_PHOTOS_PER_MATCH);
    await expect(b.uploadMatchPhoto('match_live', 'seed1', 'file:///one-more.jpg')).rejects.toMatchObject({ code: 'photo_limit' });
  });

  it('QA access: "Demo admin" makes the demo admin seed account an admin (flagged-match review); off again', async () => {
    // 1.3.5 (E134-2): only the fixed demo admin seed (+919000000001, id seed_admin) can switch it on
    const other = await signedIn(1);
    await expect(other.setDemoAdmin(true)).rejects.toThrow('+919000000001');
    expect(await other.isAdmin('seed1')).toBe(false);
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
    const b = new DemoBackend();
    made.push(b);
    const otp = b.sendOtp('+919000000001');
    await jest.advanceTimersByTimeAsync(500);
    const done = (await otp).confirm('123456');
    await jest.advanceTimersByTimeAsync(500);
    await done;
    jest.useRealTimers();
    await b.acceptTerms('seed_admin', TERMS_VERSION);
    expect(await b.isAdmin('seed_admin')).toBe(false);
    await expect(b.listFlagged()).resolves.toEqual([]);
    await b.setDemoAdmin(true);
    expect(await b.isAdmin('seed_admin')).toBe(true);
    expect(b.isDemoAdmin('seed_admin')).toBe(true);
    expect(await b.isAdmin('seed2')).toBe(false); // only that account
    await b.setDemoAdmin(false);
    expect(await b.isAdmin('seed_admin')).toBe(false);
  });
});

describe('QA access is demo-only', () => {
  it('with DEMO_MODE off the switch refuses and nobody becomes admin', async () => {
    jest.resetModules();
    jest.doMock('../config', () => ({ ...jest.requireActual('../config'), DEMO_MODE: false, BACKEND_KIND: 'api' }));
    const { DemoBackend } = require('../backend/demoBackend');
    const b = new DemoBackend();
    (b as unknown as { authUser: { uid: string } }).authUser = { uid: 'seed1' };
    await expect(b.setDemoAdmin(true)).rejects.toThrow('only available in demo mode');
    await (b as unknown as { ready: Promise<void> }).ready;
    clearInterval((b as unknown as { simTimer: ReturnType<typeof setInterval> }).simTimer);
    (b as unknown as { qaAdmins: Set<string> }).qaAdmins.add('seed1'); // even a stale stored flag
    expect(await b.isAdmin('seed1')).toBe(false);
    expect(b.isDemoAdmin('seed1')).toBe(false);
    jest.dontMock('../config');
  });
  it('the Profile tools render only in demo mode; the API and Firebase backends have no such switch', () => {
    const { ApiBackend } = jest.requireActual('../backend/apiBackend');
    expect('setDemoAdmin' in ApiBackend.prototype).toBe(false);
    const src = require('fs').readFileSync(require('path').join(__dirname, '../backend/firebaseBackend.ts'), 'utf8');
    expect(src).not.toMatch(/setDemoAdmin|qaAdmins/);
    const tools = require('fs').readFileSync(require('path').join(__dirname, '../../components/AboutCard.tsx'), 'utf8');
    expect(tools).toMatch(/if \(!DEMO_MODE \|\| !\(backend instanceof DemoBackend\)\) return null;/);
  });
});
