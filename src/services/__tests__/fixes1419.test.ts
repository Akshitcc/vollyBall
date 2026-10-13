/**
 * (copied helper) 1.4.13: V1412-1 (High – a captain-mix match: the wrong captain can't confirm; the verdict follows the side a captain
 * plays for; the repair still works, then the new captain confirms), the audit (abandon report / consent agree), and
 * V1412-4 (teamId change = set-up change; captain keys order-free in core; demo refuses extra keys / unknown ids).
 */
import { guardUpdate, verdictSetupChanged } from '../../core/matchGuards';
import { repairOptions, verdictBroken } from '../../core/verdictRepair';
import { DemoBackend } from '../backend/demoBackend';
import { DEMO_QA_ADMIN } from '../backend/demoSeed';
import type { Match } from '../../core/types';
import { presetRules } from '../../core/rules';
import { addPoint } from '../../core/scoring';
import en from '../../i18n/locales/en';
import hi from '../../i18n/locales/hi';
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


describe('1.4.19 (QA V1418-1): team_invalid on update and for null entries', () => {
  const { guardUpdate: gu, guardCreate: gc, teamShapeProblem } = require('../../core/matchGuards');
  it('core: shape check', () => {
    for (const bad of [null, undefined, 'x', {}, { players: null }, { players: 'abc' }, { players: [null] }, { players: [{ id: 5 }] }, { players: [{}] }]) expect(teamShapeProblem(bad)).toBe(true);
    expect(teamShapeProblem({ players: [{ id: 'a' }] })).toBe(false);
    expect(teamShapeProblem({ players: [] })).toBe(false);
  });
  it('core guardUpdate / guardCreate → team_invalid, never a TypeError', async () => {
    const { base } = await demo();
    const code = (f: () => void) => { try { f(); return 'ok'; } catch (e) { return (e as { code?: string }).code ?? String(e); } };
    const m = { ...base(), id: 'x' } as Match;
    for (const t of [null, 'x', { ...m.teamA, players: null }, { ...m.teamA, players: 'abc' }, { ...m.teamA, players: Array(6).fill(null) }])
      expect(code(() => gu(m, { teamA: t } as never))).toBe('team_invalid');
    expect(code(() => gc(base({ teamA: { ...base().teamA, players: Array(6).fill(null) } } as never), { A: 'cap', B: 'b0' }))).toBe('team_invalid');
  });
  it('demo updateMatch / createMatch → team_invalid', async () => {
    const { b, inner, base } = await demo();
    inner.authUser = { uid: 'cap' };
    const id = await b.createMatch(base({ rules: presetRules('indoor') }) as never);
    const m = inner.db.matches[id];
    for (const t of [null, 'x', { ...m.teamA, players: null }, { ...m.teamA, players: 'abc' }, { ...m.teamA, players: Array(6).fill(null) }])
      expect(await codeOf(b.updateMatch(id, { teamA: t } as never))).toBe('team_invalid');
    expect(await codeOf(b.createMatch(base({ rules: presetRules('indoor'), teamA: { ...base().teamA, players: Array(6).fill(null) } } as never) as never))).toBe('team_invalid');
  });
});
