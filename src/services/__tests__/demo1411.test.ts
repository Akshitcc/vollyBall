/**
 * 1.4.11 (QA V1410-2 + demo seed): a rename on an already-broken older match passes in core and the demo, a roster
 * edit there is still checked; the two seeded older-data matches (demo only) show the repair choices.
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

describe('V1410-2: rename on an already-broken older match', () => {
  const gu11 = (base: (o?: Partial<Match>) => Match) => ({ ...base(), id: 'g', events: [], maxEvents: 0, startedAt: null, finishedAt: null, updatedAt: 1, createdAt: 1, scorerReassign: { from: 'b2', to: 'cap', by: 'adm', at: 1 } }) as unknown as Match;
  it('core: verdictSetupChanged ignores names / colours; a roster change counts', async () => {
    const { base } = await demo();
    const m = gu11(base);
    expect(verdictBroken(m)).toBe(true);
    expect(verdictSetupChanged(m, { ...m, teamA: { ...m.teamA, name: 'New', color: '#000000' } } as never)).toBe(false);
    expect(() => guardUpdate(m, { teamA: { ...m.teamA, name: 'New' } })).not.toThrow();
    const a = A.filter((x) => x !== 'a5').concat('b5');
    const bb = B.filter((x) => x !== 'b5').concat('a5');
    expect(() => guardUpdate(m, { teamA: team(a, 'Alpha'), teamB: team(bb, 'Beta'), participantIds: [...a, ...bb] } as never)).toThrow(expect.objectContaining({ code: 'match_no_verdict' }));
  });
  it('demo: the creator renames team A of the GU11 match (stored), a roster swap is refused', async () => {
    const { b, inner, base } = await demo();
    inner.db.matches.g = gu11(base);
    inner.authUser = { uid: 'cap' };
    await b.updateMatch('g', { teamA: { ...inner.db.matches.g.teamA, name: 'Renamed' } });
    expect(inner.db.matches.g.teamA.name).toBe('Renamed');
    const a = A.filter((x) => x !== 'a5').concat('b5');
    const bb = B.filter((x) => x !== 'b5').concat('a5');
    expect(await codeOf(b.updateMatch('g', { teamA: team(a, 'Renamed'), teamB: team(bb, 'Beta'), participantIds: [...a, ...bb] } as never))).toBe('match_no_verdict');
  });
});

describe('demo seed (1.4.11): the two older-data matches', () => {
  it('GU11 → scorer choices; captain mismatch → captain choices only (team B players)', async () => {
    const { inner } = await demo();
    const g = inner.db.matches.match_demo_gu11;
    const c = inner.db.matches.match_demo_capmix;
    expect(verdictBroken(g)).toBe(true);
    expect(repairOptions(g).scorers.length).toBeGreaterThan(0);
    expect(verdictBroken(c)).toBe(true);
    expect(repairOptions(c).scorers).toEqual([]);
    expect(repairOptions(c).confirmers.map((x) => x.side)).toEqual(c.teamB.players.map(() => 'B'));
  });
  it('demo only: the production stub has no seed, and check-strip looks for the ids', () => {
    const fs = require('fs');
    const path = require('path');
    const root = path.join(__dirname, '../../..');
    expect(fs.readFileSync(path.join(root, 'src/stubs/demoSeed.prod.ts'), 'utf8')).not.toMatch(/match_demo_/);
    expect(fs.readFileSync(path.join(root, 'metro.config.js'), 'utf8')).toMatch(/'src\/services\/backend\/demoSeed': 'src\/stubs\/demoSeed\.prod\.ts'/);
    expect(fs.readFileSync(path.join(root, 'scripts/check-strip.js'), 'utf8')).toMatch(/'match_demo_gu11', 'match_demo_capmix'/);
  });
});
