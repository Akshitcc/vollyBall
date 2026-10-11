/**
 * 1.3.5 (QA build 1.3.4 retest), demo build:
 *  - E134-2: nobody reviews a match they played in, scored, captained or created (all backends share
 *    core/antifraud ownMatchReview); the Demo admin switch is the demo admin seed's only.
 *  - E134-1: on the web a demo save is refused when the app's own server can't be reached (requests
 *    failing while navigator.onLine still says true), so the header never says "Synced" then;
 *    "Simulate offline" is stored, and Reset demo data clears it.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { ownMatchReview } from '../../core/antifraud';
import { DemoBackend } from '../backend/demoBackend';
import { DEMO_QA_ADMIN } from '../backend/demoSeed';
import { connectivity } from '../connectivity';

jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('../backend/firebaseBackend', () => ({ FirebaseBackend: class {} }));

const made: DemoBackend[] = [];
afterEach(() => {
  for (const b of made.splice(0)) clearInterval((b as unknown as { simTimer: ReturnType<typeof setInterval> }).simTimer);
  connectivity.setSimulatedOffline(false);
});
async function demo() {
  const b = new DemoBackend();
  made.push(b);
  await (b as unknown as { ready: Promise<void> }).ready;
  return b;
}
type Db = { matches: Record<string, Parameters<typeof ownMatchReview>[0] & { id: string; status: string; events: unknown[]; rules: unknown }>; users: Record<string, { phone: string }> };
const dbOf = (b: DemoBackend) => (b as unknown as { db: Db }).db;

describe('E134-2: own matches can never be reviewed', () => {
  const m = {
    createdBy: 'c',
    scorerId: 's',
    captains: { A: 'ca', B: 'cb' },
    participantIds: ['x'],
    teamA: { players: [{ id: 'a1' }] },
    teamB: { players: [{ id: 'b1' }] },
  } as unknown as Parameters<typeof ownMatchReview>[0];
  it.each(['c', 's', 'ca', 'cb', 'x', 'a1', 'b1'])('%s is refused', (uid) => expect(ownMatchReview(m, uid)).toBe(true));
  it('an outsider (and no uid) is not', () => {
    expect(ownMatchReview(m, 'admin')).toBe(false);
    expect(ownMatchReview(m, '')).toBe(false);
  });

  it('the demo admin seed is a fake +91 900… number in no team or match, and only it may toggle', async () => {
    const b = await demo();
    const db = dbOf(b);
    expect(DEMO_QA_ADMIN.phone).toBe('+919000000001');
    expect(db.users[DEMO_QA_ADMIN.id].phone).toBe(DEMO_QA_ADMIN.phone);
    for (const mm of Object.values(db.matches)) expect(ownMatchReview(mm, DEMO_QA_ADMIN.id)).toBe(false);
    expect(b.canBeDemoAdmin(DEMO_QA_ADMIN.id)).toBe(true);
    expect(b.canBeDemoAdmin('seed1')).toBe(false);
    expect(b.canBeDemoAdmin(null)).toBe(false);
  });
});

describe('E134-1: web demo saves need the app server; Simulate offline is stored', () => {
  it('requests failing while navigator.onLine is true → the save is refused as a network error', async () => {
    const b = await demo();
    const realOS = Platform.OS;
    const g = globalThis as { fetch?: unknown; location?: unknown };
    const [realFetch, realLoc] = [g.fetch, g.location];
    Object.defineProperty(Platform, 'OS', { get: () => 'web', configurable: true });
    Object.defineProperty(globalThis, 'location', { value: { origin: 'http://localhost:8099' }, configurable: true, writable: true });
    try {
      g.fetch = jest.fn(async () => {
        throw new TypeError('Failed to fetch');
      });
      expect(await connectivity.reachable()).toBe(false);
      await expect(b.saveMatchProgress('match_live', { events: [], status: 'live' } as never)).rejects.toThrow(/Network request failed/);
      g.fetch = jest.fn(async () => ({ ok: true, status: 200 }));
      expect(await connectivity.reachable()).toBe(true);
    } finally {
      Object.defineProperty(Platform, 'OS', { get: () => realOS, configurable: true });
      g.fetch = realFetch;
      Object.defineProperty(globalThis, 'location', { value: realLoc, configurable: true, writable: true });
    }
  });

  it('the switch is stored, refuses saves on any platform, and Reset demo data clears it', async () => {
    const b = await demo();
    connectivity.setSimulatedOffline(true);
    await new Promise((r) => setImmediate(r));
    expect(await AsyncStorage.getItem('volleylive-demo-sim-offline-v1')).toBe('1');
    await expect(b.saveMatchProgress('match_live', { events: [], status: 'live' } as never)).rejects.toThrow(/offline/);
    await b.reset();
    expect(connectivity.isSimulatedOffline()).toBe(false);
    expect(await AsyncStorage.getItem('volleylive-demo-sim-offline-v1')).toBeNull();
  });
});
