/**
 * 1.4.7 demo (QA V146-9 / V146-10): after the first rally the creator's handoff list includes the demo admin account
 * (no admin mode needed on the scorer's phone) and the handoff to it works; at no stage is the opposing captain or
 * their team offered or accepted.
 */
import { DemoBackend } from '../backend/demoBackend';
import { DEMO_QA_ADMIN } from '../backend/demoSeed';
import type { Match } from '../../core/types';
import { presetRules } from '../../core/rules';
import { addPoint } from '../../core/scoring';
import { handoverProblem } from '../../core/scorerHandoff';
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
  const proto = Object.values(inner.db.users).find((u) => u.id !== DEMO_QA_ADMIN.id)!;
  [...A, ...B].forEach((id, i) => (inner.db.users[id] = { ...proto, id, name: id, phone: `+9190006${String(i).padStart(5, '0')}` }));
  for (const u of [...A, ...B]) inner.terms[u] = { version: TERMS_VERSION, acceptedAt: 1 };
  const mk = (rallies: number): Match => {
    let events: Match['events'] = [];
    for (let i = 0; i < rallies; i++) events = addPoint(WR, events, 'B', { at: 1 + i });
    return {
      id: 'h', rules: WR, firstServe: 'A', summary: null, teamA: team(A, 'Alpha'), teamB: team(B, 'Beta'), captains: { A: 'cap', B: 'b0' }, createdBy: 'cap', scorerId: 'cap',
      participantIds: [...A, ...B], status: rallies ? 'live' : 'scheduled', scheduledAt: rallies ? null : Date.now() + 3600000, startedAt: rallies ? 1 : null, finishedAt: null,
      interestedIds: [], updatedAt: 1, createdAt: 1, events, maxEvents: rallies,
    } as unknown as Match;
  };
  return { b, inner, mk };
}

describe('V146-9: the demo admin is offered after the first rally', () => {
  it('without admin mode on this phone; the handoff to it is accepted', async () => {
    const { b, inner, mk } = await demo();
    inner.db.matches.h = mk(2);
    inner.authUser = { uid: 'cap' };
    const list = await b.handoffAdmins('h');
    expect(list.map((x) => x.id)).toEqual([DEMO_QA_ADMIN.id]);
    await b.updateMatch('h', { scorerId: DEMO_QA_ADMIN.id });
    expect(inner.db.matches.h.scorerId).toBe(DEMO_QA_ADMIN.id);
  });
});

describe('V146-10: never the opposing captain or their team, at any stage', () => {
  it.each([0, 2])('%i rallies: B players refused by core and by the demo; A players accepted', async (n) => {
    const { b, inner, mk } = await demo();
    for (const to of B) {
      inner.db.matches.h = mk(n);
      inner.authUser = { uid: 'cap' };
      expect([to, handoverProblem(mk(n), to)]).not.toEqual([to, null]);
      await expect(b.updateMatch('h', { scorerId: to })).rejects.toBeTruthy();
      expect(inner.db.matches.h.scorerId).toBe('cap');
    }
    inner.db.matches.h = mk(n);
    await b.updateMatch('h', { scorerId: 'a2' });
    expect(inner.db.matches.h.scorerId).toBe('a2');
  });
});
