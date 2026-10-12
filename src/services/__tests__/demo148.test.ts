/**
 * 1.4.8 demo (QA V147-1 / V147-2): the verdict invariant on create and on roster edits, and the admin repair.
 */
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

describe('V147-1 (demo): create and roster edits keep someone who can confirm', () => {
  it('create: the scorer on the other team is refused; the normal set-up is accepted', async () => {
    const { b, inner, base } = await demo();
    inner.authUser = { uid: 'cap' };
    expect(await codeOf(b.createMatch(base({ scorerId: 'b1' }) as never))).toBe('match_no_verdict');
    expect(await codeOf(b.createMatch(base({ rules: presetRules('indoor') }) as never))).toBeNull();
  });
  it('a roster edit that moves the scorer to team B (creator on A) is refused, before the first rally', async () => {
    const { b, inner, base } = await demo();
    inner.db.matches.r = { ...base({ createdBy: 'a1', scorerId: 'cap' }), id: 'r', events: [], maxEvents: 0, startedAt: null, finishedAt: null, updatedAt: 1, createdAt: 1, summary: null } as unknown as Match;
    inner.authUser = { uid: 'cap' };
    const err = await codeOf(b.updateMatch('r', { teamA: team(['a1', 'a2', 'a3', 'a4', 'a5', 'b5'], 'Alpha'), teamB: team(['cap', 'b0', 'b1', 'b2', 'b3', 'b4'], 'Beta'), captains: { A: 'a1', B: 'b0' }, participantIds: ['a1', 'a2', 'a3', 'a4', 'a5', 'b5', 'cap', 'b0', 'b1', 'b2', 'b3', 'b4'] }));
    expect(err).toBe('match_no_verdict');
    expect(inner.db.matches.r.teamA.players.map((p) => p.id)).toEqual(A);
  });
});

describe('V147-2 (demo): admin repair', () => {
  it('only an admin outside the match; audited; then the opposing captain can confirm', async () => {
    const { b, inner, base } = await demo();
    let ev: Match['events'] = [];
    for (let i = 0; i < 5; i++) ev = addPoint(WR, ev, 'A', { at: 1 + i });
    inner.db.matches.x = { ...base({ scorerId: 'b1' }), id: 'x', status: 'finished', events: ev, maxEvents: 5, wasWon: true, startedAt: 1, finishedAt: 2, playerOfMatchId: 'a1', verification: { status: 'pending' }, updatedAt: 1, createdAt: 1, summary: null } as unknown as Match;
    inner.authUser = { uid: 'b0' };
    expect(await codeOf(b.repairVerdict('x', { scorerId: 'cap' }))).toBe('admin_only');
    inner.authUser = { uid: DEMO_QA_ADMIN.id };
    await (b as unknown as { setDemoAdmin: (on: boolean) => Promise<void> }).setDemoAdmin(true);
    expect(await codeOf(b.repairVerdict('x', { scorerId: 'b2' }))).toBe('repair_invalid');
    // 1.4.9 (QA V148-2): scorer-only, like core / API / rules – a captain (confirmer) fix is refused
    expect(await codeOf(b.repairVerdict('x', { captain: { side: 'B', id: 'b2' } }))).toBe('repair_invalid');
    inner.db.matches.y = { ...inner.db.matches.x, id: 'y', scorerId: 'cap', captains: { A: 'cap', B: 'a1' } } as unknown as Match; // RP9 shape
    // 1.4.10 (QA V149-3): there a team-B captain is the (only) fix; never an A player for B
    expect(await codeOf(b.repairVerdict('y', { captain: { side: 'B', id: 'a2' } }))).toBe('repair_invalid');
    await b.repairVerdict('y', { captain: { side: 'B', id: 'b1' } });
    expect(inner.db.matches.y.captains).toEqual({ A: 'cap', B: 'b1' });
    expect(inner.db.matches.y.verdictRepair).toMatchObject({ kind: 'confirmer', side: 'B', to: 'b1', prevCaptainB: 'a1' });
    await b.repairVerdict('x', { scorerId: 'cap' });
    const m = inner.db.matches.x;
    expect(m.scorerId).toBe('cap');
    expect(m.verdictRepair).toMatchObject({ by: DEMO_QA_ADMIN.id, kind: 'scorer', to: 'cap', prevScorer: 'b1', prevCaptainA: 'cap', prevCaptainB: 'b0' });
    expect(await codeOf(b.repairVerdict('x', { scorerId: 'a1' }))).toBe('repair_not_needed');
    inner.authUser = { uid: 'b0' };
    await b.confirmResult('x');
    expect(inner.db.matches.x.verification?.captain).toBe('confirmed');
  });
});
