/**
 * 1.4.12: V1411-2 (captain-mix rename everywhere), V1411-3 (demo refuses clearing captains / changing the creator), the
 * finished captain-mix seed (repair then confirm by the new captain).
 */
import { guardUpdate, verdictSetupChanged } from '../../core/matchGuards';
import { repairOptions, verdictBroken } from '../../core/verdictRepair';
import { DemoBackend } from '../backend/demoBackend';
import { DEMO_QA_ADMIN } from '../backend/demoSeed';
import type { Match } from '../../core/types';
import { presetRules } from '../../core/rules';
import { addPoint } from '../../core/scoring';
import { TERMS_VERSION } from '../../core/terms';

jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('../backend/firebaseBackend', () => ({ FirebaseBackend: class {} }));

const made: DemoBackend[] = [];
afterEach(() => {
  for (const b of made.splice(0)) clearInterval((b as unknown as { simTimer: ReturnType<typeof setInterval> }).simTimer);
});
const WR = { ...presetRules('indoor'), bestOf: 1 as const, pointsPerSet: 5, decidingSetPoints: 5, winBy: 1 };
const A = ['cap', 'a1', 'a2', 'a3', 'a4', 'a5'];
const B = ['b0', 'b1', 'b2', 'b3', 'b4', 'b5'];
const team = (ids: string[], name: string) => ({ teamId: null, name, color: '#123456', players: ids.map((id) => ({ id, name: id })) });

async function demo() {
  const b = new DemoBackend();
  made.push(b);
  await (b as unknown as { ready: Promise<void> }).ready;
  const inner = b as unknown as { db: { matches: Record<string, Match>; users: Record<string, Record<string, unknown>> }; authUser: { uid: string } | null; terms: Record<string, unknown> };
  const proto = Object.values(inner.db.users).find((u) => u.id !== DEMO_QA_ADMIN.id && u.dob && u.pincode) ?? Object.values(inner.db.users).find((u) => u.id !== DEMO_QA_ADMIN.id)!;
  [...A, ...B].forEach((id, i) => (inner.db.users[id] = { ...proto, id, name: id, phone: `+9190007${String(i).padStart(5, '0')}` }));
  for (const u of [...A, ...B, DEMO_QA_ADMIN.id]) inner.terms[u] = { version: TERMS_VERSION, acceptedAt: 1 };
  const base = (over: Partial<Match> = {}): Match =>
    ({
      rules: WR, firstServe: 'A', teamA: team(A, 'Alpha'), teamB: team(B, 'Beta'), captains: { A: 'cap', B: 'b0' }, createdBy: 'cap', scorerId: 'cap',
      participantIds: [...A, ...B], status: 'scheduled', scheduledAt: Date.now() + 3600000, interestedIds: [], events: [], summary: null, ...over,
    }) as unknown as Match;
  return { b, inner, base };
}
const codeOf = (p: Promise<unknown>) => p.then(() => null, (e) => (e as { code?: string }).code ?? String(e));


describe('V1411-3 (demo): captains and creator', () => {
  it('clearing or half-setting the captains → captains_required; a creator change → forbidden', async () => {
    const { b, inner, base } = await demo();
    inner.db.matches.h = { ...base(), id: 'h', maxEvents: 0, updatedAt: 1, createdAt: 1 } as unknown as Match;
    inner.authUser = { uid: 'cap' };
    expect(await codeOf(b.updateMatch('h', { captains: null } as never))).toBe('captains_required');
    expect(await codeOf(b.updateMatch('h', { captains: { A: 'cap' } } as never))).toBe('captains_required');
    expect(await codeOf(b.updateMatch('h', { createdBy: 'a1' } as never))).toBe('forbidden');
    expect(inner.db.matches.h.captains).toEqual({ A: 'cap', B: 'b0' });
    expect(inner.db.matches.h.createdBy).toBe('cap');
    // unchanged values are fine; an older doc without captains may keep null
    await b.updateMatch('h', { createdBy: 'cap', captains: { A: 'cap', B: 'b0' }, title: 'ok' } as never);
    inner.db.matches.h = { ...inner.db.matches.h, captains: null } as Match;
    await b.updateMatch('h', { captains: null, title: 'still ok' } as never);
  });
});

describe('V1411-2: rename on a captain-mix match (captain B plays for team A)', () => {
  it('core and demo allow a rename / name change; a roster reorder is still checked', async () => {
    const { b, inner, base } = await demo();
    const m = { ...base({ captains: { A: 'cap', B: 'a1' } }), id: 'c', maxEvents: 0, updatedAt: 1, createdAt: 1 } as unknown as Match;
    expect(verdictBroken(m)).toBe(true);
    expect(() => guardUpdate(m, { teamB: { ...m.teamB, name: 'New' } })).not.toThrow();
    inner.db.matches.c = m;
    inner.authUser = { uid: 'cap' };
    await b.updateMatch('c', { teamB: { ...m.teamB, name: 'Renamed', players: m.teamB.players.map((p, i) => (i === 1 ? { ...p, name: 'Shown name' } : p)) } });
    expect(inner.db.matches.c.teamB.name).toBe('Renamed');
    const rb = [...B].reverse();
    expect(await codeOf(b.updateMatch('c', { teamB: team(rb, 'Renamed'), participantIds: [...A, ...rb] } as never))).not.toBeNull();
  });
});

describe('demo seed (1.4.12): finished captain-mix match', () => {
  it('broken, pending; admin repairs team B captain; the new captain confirms', async () => {
    const { b, inner } = await demo();
    const m = inner.db.matches.match_demo_capmix_done;
    expect(m.status).toBe('finished');
    expect(m.verification?.status).toBe('pending');
    expect(verdictBroken(m)).toBe(true);
    const opts = repairOptions(m);
    expect(opts.scorers).toEqual([]);
    const c = opts.confirmers[0];
    expect(c.side).toBe('B');
    inner.authUser = { uid: DEMO_QA_ADMIN.id };
    await (b as unknown as { setDemoAdmin: (on: boolean) => Promise<void> }).setDemoAdmin(true);
    await b.repairVerdict(m.id, { captain: c });
    expect(inner.db.matches[m.id].captains?.B).toBe(c.id);
    expect(verdictBroken(inner.db.matches[m.id])).toBe(false);
    inner.authUser = { uid: c.id };
    inner.terms[c.id] = { version: TERMS_VERSION, acceptedAt: 1 };
    await b.confirmResult(m.id);
    expect(inner.db.matches[m.id].verification?.status).toBe('confirmed');
  });
});
