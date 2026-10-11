/**
 * 1.3.7 launch prep: server-SMS sign-in (ServerOtpTokenSource), the production build guard, the demo
 * strip (metro stubs + check-strip), the admin review / feedback / daily-item calls in API mode, and
 * the R136-16 / F135-2 helpers (pincode prefixes, local unsynced scores in lists).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { ApiBackend, ServerOtpTokenSource } from '../backend/apiBackend';
import { assertProductionBuild, BackendConfigError, resolveBackendMode } from '../../core/backendMode';
import { demoPincodeLookup, pincodePrefixOk, registrationFieldErrors } from '../../core/registration';
import { applyLocal, scoreCacheKey, withLocalScores } from '../localScore';
import { INDOOR_RULES } from '../../core/rules';
import type { Match } from '../../core/types';

jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));

type Call = { method: string; url: string; headers: Record<string, string>; body?: unknown };
let calls: Call[];
let respond: (c: Call) => { status: number; body?: unknown };
beforeEach(async () => {
  await AsyncStorage.clear();
  calls = [];
  respond = () => ({ status: 200, body: {} });
  global.fetch = jest.fn(async (url: string, init: { method?: string; headers?: Record<string, string>; body?: string } = {}) => {
    const c: Call = { method: init.method ?? 'GET', url, headers: init.headers ?? {}, body: init.body ? JSON.parse(init.body) : undefined };
    calls.push(c);
    const r = respond(c);
    return { ok: r.status < 400, status: r.status, text: async () => (r.body === undefined ? '' : JSON.stringify(r.body)) };
  }) as unknown as typeof fetch;
});

describe('ServerOtpTokenSource (server sends the SMS)', () => {
  it('request → verify stores only the session token; wrong code keeps attemptsLeft; expiry and sign-out', async () => {
    let now = 1_000;
    const src = new ServerOtpTokenSource('https://api.example.invalid', () => now);
    const seen: unknown[] = [];
    src.onAuthChanged((u) => seen.push(u));
    respond = (c) =>
      c.url.endsWith('/auth/otp/verify') && (c.body as { code: string }).code !== '424242'
        ? { status: 400, body: { error: 'otp_invalid', message: 'Wrong code', attemptsLeft: 2 } }
        : c.url.endsWith('/auth/otp/verify')
          ? { status: 200, body: { token: 'vls1.abc', uid: 'u9', expiresAt: 5_000 } }
          : { status: 204 };
    const s = await src.sendOtp('+919812345678');
    expect(calls[0]).toMatchObject({ method: 'POST', url: 'https://api.example.invalid/auth/otp/request', body: { phone: '+919812345678' } });
    const bad = await s.confirm('000000').catch((e) => e);
    expect(bad.code).toBe('otp_invalid');
    expect(bad.attemptsLeft).toBe(2);
    await s.confirm('424242');
    expect(await src.token()).toBe('vls1.abc');
    expect(seen[seen.length - 1]).toEqual({ uid: 'u9', phoneNumber: '+919812345678' });
    const stored = JSON.parse((await AsyncStorage.getItem((await AsyncStorage.getAllKeys())[0]))!);
    expect(Object.keys(stored).sort()).toEqual(['expiresAt', 'phoneNumber', 'token', 'uid']); // no code, no OTP
    now = 6_000; // expired
    expect(await src.token()).toBeNull();
    await s.confirm('424242');
    calls = [];
    await src.signOut();
    expect(calls[0]).toMatchObject({ url: 'https://api.example.invalid/auth/logout', headers: { Authorization: 'Bearer vls1.abc' } });
    expect(await src.token()).toBeNull();
  });
});

describe('production build guard', () => {
  const env = (o: Record<string, string | boolean>) => ({ hasFirebase: false, ...o }) as Parameters<typeof resolveBackendMode>[0];
  const prodEnv = { EXPO_PUBLIC_BACKEND: 'api', EXPO_PUBLIC_API_URL: 'https://api.example.invalid', EXPO_PUBLIC_API_AUTH: 'otp', EXPO_PUBLIC_STRIP_DEMO: '1' };
  it('accepts https API + server OTP + stripped demo; refuses demo, http, dev sign-in, demo admins, unstripped', () => {
    expect(assertProductionBuild(resolveBackendMode(env(prodEnv)), prodEnv)).toBe(true);
    expect(() => assertProductionBuild(resolveBackendMode(env({})), {})).toThrow(BackendConfigError);
    const http = { ...prodEnv, EXPO_PUBLIC_API_URL: 'http://api.example.invalid' };
    expect(() => assertProductionBuild(resolveBackendMode(env(http)), http)).toThrow(/https/);
    expect(() => resolveBackendMode(env({ ...prodEnv, EXPO_PUBLIC_API_AUTH: 'dev', production: true }))).toThrow(/dev sign-in/);
    expect(() => assertProductionBuild(resolveBackendMode(env(prodEnv)), { ...prodEnv, EXPO_PUBLIC_DEMO_ADMIN_UIDS: 'x' })).toThrow(/DEMO_ADMIN/);
    expect(() => assertProductionBuild(resolveBackendMode(env(prodEnv)), { ...prodEnv, EXPO_PUBLIC_STRIP_DEMO: '' })).toThrow(/STRIP_DEMO/);
  });
});

describe('demo strip (metro stubs + check-strip)', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { checkStrip, DEMO_MARKERS } = require('../../../scripts/check-strip');
  it('metro swaps the demo modules for stubs only when EXPO_PUBLIC_STRIP_DEMO=1', () => {
    jest.isolateModules(() => {
      jest.doMock('expo/metro-config', () => ({ getDefaultConfig: () => ({ resolver: {} }) }));
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const metro = require('../../../metro.config.js');
      const root = path.resolve(__dirname, '../../..');
      const cfg = metro.withDemoStrip({ resolver: { resolveRequest: (_c: unknown, name: string) => ({ type: 'sourceFile', filePath: path.join(root, name) }) } }, { EXPO_PUBLIC_STRIP_DEMO: '1' }, root);
      const r = cfg.resolver.resolveRequest({}, 'src/services/backend/demoBackend.ts', 'android');
      expect(r.filePath).toBe(path.join(root, 'src/stubs/demoBackend.prod.ts'));
      expect(cfg.resolver.resolveRequest({}, 'src/core/scoring.ts', 'android').filePath).toBe(path.join(root, 'src/core/scoring.ts'));
      const off = { resolver: {} };
      expect(metro.withDemoStrip(off, {}, root)).toBe(off);
      for (const stub of Object.values(metro.DEMO_STUBS) as string[]) expect(fs.existsSync(path.join(root, stub))).toBe(true);
    });
  });
  it('check-strip finds demo markers and the expected API URL', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vl-strip-'));
    fs.writeFileSync(path.join(dir, 'a.js'), 'fetch("https://api.example.invalid/api")');
    expect(checkStrip(dir, 'https://api.example.invalid')).toMatchObject({ files: 1, found: [], hasApi: true });
    fs.writeFileSync(path.join(dir, 'b.js'), `x=${JSON.stringify(DEMO_MARKERS[0])}`);
    expect(checkStrip(dir).found).toHaveLength(1);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe('API mode: admin review, feedback, daily items', () => {
  async function signedIn() {
    const b = new ApiBackend({ baseUrl: 'http://api.local:4000/', devAuth: true });
    respond = (c) => (c.url.endsWith('/api/me') ? { status: 200, body: { uid: 'adm', phone: '+919000000001' } } : { status: 200, body: [] });
    const s = await b.sendOtp('+919000000001', null);
    await s.confirm('123456');
    calls = [];
    return b;
  }
  it('flagged list + review decision; feedback POST (validated first); daily items public + admin CRUD', async () => {
    const b = await signedIn();
    await b.listFlagged();
    await b.reviewMatch('m1', 'approve');
    expect(calls.map((c) => `${c.method} ${c.url.replace('http://api.local:4000', '')}`)).toEqual(['GET /api/admin/matches/flagged', 'POST /api/admin/matches/m1/review']);
    expect(calls[1].body).toEqual({ decision: 'approve' });
    calls = [];
    await expect(b.sendFeedback({ stars: 0, text: '' })).rejects.toMatchObject({ code: 'feedback_stars' });
    expect(calls).toHaveLength(0);
    await b.sendFeedback({ stars: 5, text: ' ok ', appVersion: '1.3.7 (13)' });
    expect(calls[0]).toMatchObject({ method: 'POST', url: 'http://api.local:4000/api/feedback', body: { stars: 5, text: 'ok', appVersion: '1.3.7 (13)' } });
    calls = [];
    await b.listDailyItems();
    await b.listDailyItems({ all: true });
    respond = () => ({ status: 201, body: { id: 'n1' } });
    expect(await b.saveDailyItem({ type: 'fact', textEn: 'F', textHi: 'फ', active: true })).toBe('n1');
    await b.saveDailyItem({ id: 'n1', type: 'fact', textEn: 'F2', textHi: 'फ', active: false });
    respond = () => ({ status: 204 });
    await b.deleteDailyItem('n1');
    expect(calls.map((c) => `${c.method} ${c.url.replace('http://api.local:4000', '')}`)).toEqual([
      'GET /api/daily-items', 'GET /api/admin/daily-items', 'POST /api/admin/daily-items', 'PATCH /api/admin/daily-items/n1', 'DELETE /api/admin/daily-items/n1',
    ]);
  });
});

describe('R136-16/17: pincode prefixes and the per-field order', () => {
  it('unallocated prefixes (999999, 100001, 290001, 860001) are invalid offline in the demo; others unknown or found', () => {
    for (const p of ['999999', '100001', '290001', '350001', '545454', '860001']) expect(demoPincodeLookup(p)).toEqual({ status: 'invalid' });
    expect(demoPincodeLookup('110001')).toMatchObject({ status: 'ok', district: 'New Delhi' });
    expect(demoPincodeLookup('121001')).toEqual({ status: 'unknown' }); // real format, not in the sample
    expect(pincodePrefixOk('744101')).toBe(true); // Andaman (WB circle)
    expect(pincodePrefixOk('900001')).toBe(false); // APS: looked up on the API, not accepted offline
  });
  it('pincode: empty → required; letters → digits only; bad format → invalid; names: emoji says letters only', () => {
    const base = { firstName: 'Asha', lastName: 'Rao', dob: '2000-01-01', pincode: '110001' };
    expect(registrationFieldErrors({ ...base, pincode: '' }, null).pincode?.code).toBe('pincode_required');
    expect(registrationFieldErrors({ ...base, pincode: '11a001' }, null).pincode?.code).toBe('pincode_digits');
    expect(registrationFieldErrors({ ...base, pincode: '012345' }, null).pincode?.code).toBe('pincode_invalid');
    expect(registrationFieldErrors({ ...base, pincode: '११०००१' }, null).pincode).toBeUndefined(); // Hindi digits
    expect(registrationFieldErrors({ ...base, firstName: '😀' }, null).firstName?.code).toBe('name_chars');
    expect(registrationFieldErrors({ ...base, firstName: 'A' }, null).firstName?.code).toBe('name_length');
    const all = registrationFieldErrors({ firstName: '', lastName: '', dob: '', pincode: '' }, null);
    expect(Object.keys(all).sort()).toEqual(['dob', 'firstName', 'lastName', 'pincode']); // every problem at once
  });
});

describe('F135-2: lists show this phone’s unsynced score', () => {
  const m = { id: 'm1', status: 'live', rules: { ...INDOOR_RULES }, firstServe: 'A', events: [], updatedAt: 100, summary: { setsA: 0, setsB: 0, setScores: [], currentA: 0, currentB: 0, winner: null } } as unknown as Match;
  const pts = (n: number) => Array.from({ length: n }, (_, i) => ({ type: 'point', side: 'A', at: 200 + i }));
  it('a pending local copy newer than the server wins; synced or older copies are ignored', async () => {
    expect(applyLocal(m, { events: pts(3) as never, savedAt: 300, pending: true }).summary.currentA).toBe(3);
    expect(applyLocal(m, { events: pts(3) as never, savedAt: 300, pending: false })).toBe(m);
    expect(applyLocal(m, { events: pts(3) as never, savedAt: 50, pending: true })).toBe(m);
    await AsyncStorage.setItem(scoreCacheKey('m1'), JSON.stringify({ events: pts(2), savedAt: 300, pending: true }));
    const [out] = await withLocalScores([m]);
    expect(out.summary.currentA).toBe(2);
  });
});
