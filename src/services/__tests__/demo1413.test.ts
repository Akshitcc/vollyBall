/**
 * 1.4.13: V1412-1 (High – a captain-mix match: the wrong captain can't confirm; the verdict follows the side a captain
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

import { confirmProblem, verdictCaptains } from '../../core/antifraud';
import { lcRoles } from '../../core/lifecycle';
import { answerAbandon } from '../../core/abandon';

const finished = (base: (o?: Partial<Match>) => Match, winner: 'A' | 'B', over: Partial<Match> = {}): Match => {
  let ev: Match['events'] = [];
  for (let i = 0; i < 5; i++) ev = addPoint(WR, ev, winner, { at: 1000 + i });
  return { ...base(), id: 'f', status: 'finished', events: ev, maxEvents: ev.length, wasWon: true, playerOfMatchId: winner === 'A' ? 'a2' : 'b2', startedAt: 1, finishedAt: 2, finishedServerAt: 2, updatedAt: 1, createdAt: 1, verification: { status: 'pending' }, ...over } as unknown as Match;
};

describe('V1412-1 (core): captain mix – by the side a captain plays for', () => {
  it.each(['A', 'B'] as const)('team %s won: the team-B captain who plays for A (a1) can\'t confirm; nobody can until repaired', async (w) => {
    const { base } = await demo();
    const m = finished(base, w, { captains: { A: 'cap', B: 'a1' } } as Partial<Match>);
    expect(confirmProblem(m, 'a1')).toBe('not_captain');
    expect(confirmProblem(m, 'b0')).toBe('not_captain');
    expect(verdictCaptains(m)).toEqual([]);
    expect(verdictBroken(m)).toBe(true);
    const fixed = { ...m, captains: { A: 'cap', B: 'b0' } } as Match;
    expect(confirmProblem(fixed, 'b0')).toBeNull();
    expect(confirmProblem(fixed, 'a1')).toBe('not_captain');
  });
  it('a neutral scorer: A\'s own captain may confirm, B\'s off-side captain may not', async () => {
    const { base } = await demo();
    const m = finished(base, 'A', { captains: { A: 'cap', B: 'a1' }, scorerId: 'zz', createdBy: 'zz' } as Partial<Match>);
    expect(verdictCaptains(m)).toEqual(['cap']);
    expect(confirmProblem(m, 'a1')).toBe('not_captain');
  });
  it('audit: an off-side captain reports for nobody, and can\'t agree to their own side\'s abandon request', async () => {
    const { base } = await demo();
    const ab = { ...base({ captains: { A: 'cap', B: 'a1' } }), status: 'abandoned', abandon: { by: 'cap', at: 1, events: 3, mode: 'review', review: 'pending', score: { setsA: 0, setsB: 0, currentA: 0, currentB: 3 }, behind: true } } as unknown as Match;
    expect(lcRoles(ab as never, 'a1', false).has('reporter')).toBe(false);
    expect(lcRoles({ ...ab, captains: { A: 'cap', B: 'b0' } } as never, 'b0', false).has('reporter')).toBe(true);
    const live = { ...base({ captains: { A: 'cap', B: 'a1' } }), status: 'live', abandonRequest: { by: 'cap', at: 1, side: 'A', agreedBy: [] } } as unknown as Match;
    expect(() => answerAbandon(live as never, 'a1', 'agree', 2)).toThrow();
  });
});

describe('V1412-1 (demo): the seeded finished captain-mix match', () => {
  it('the wrong captain is refused (not_captain); the repair works (no 409); the new captain confirms; the old one still can\'t', async () => {
    const { b, inner } = await demo();
    const m = inner.db.matches.match_demo_capmix_done;
    const wrong = m.captains!.B;
    expect(m.teamA.players.some((p) => p.id === wrong)).toBe(true);
    inner.authUser = { uid: wrong };
    inner.terms[wrong] = { version: TERMS_VERSION, acceptedAt: 1 };
    expect(await codeOf(b.confirmResult(m.id))).toBe('not_captain');
    expect(inner.db.matches[m.id].verification?.status).toBe('pending');
    const c = repairOptions(m).confirmers[0];
    inner.authUser = { uid: DEMO_QA_ADMIN.id };
    await (b as unknown as { setDemoAdmin: (on: boolean) => Promise<void> }).setDemoAdmin(true);
    await b.repairVerdict(m.id, { captain: c });
    inner.authUser = { uid: wrong };
    expect(await codeOf(b.confirmResult(m.id))).toBe('not_captain');
    inner.authUser = { uid: c.id };
    inner.terms[c.id] = { version: TERMS_VERSION, acceptedAt: 1 };
    await b.confirmResult(m.id);
    expect(inner.db.matches[m.id].verification?.status).toBe('confirmed');
  });
});

describe('V1412-4: leftover differences', () => {
  it('core: a teamId change is a set-up change; the captains\' key order is not', async () => {
    const { base } = await demo();
    const m = base();
    expect(verdictSetupChanged(m, { ...m, teamA: { ...m.teamA, teamId: 'team_x' } } as never)).toBe(true);
    expect(verdictSetupChanged(m, { ...m, captains: { B: 'b0', A: 'cap' } } as never)).toBe(false);
    const cm = { ...m, id: 'c', captains: { A: 'cap', B: 'a1' }, maxEvents: 0 } as unknown as Match;
    expect(() => guardUpdate(cm, { captains: { B: 'a1', A: 'cap' } } as never)).not.toThrow();
    expect(() => guardUpdate(cm, { teamA: { ...cm.teamA, teamId: 'team_x' } } as never)).toThrow();
  });
  it('demo: an extra captains key, an unknown captain id and a teamId change on a captain-mix match are refused', async () => {
    const { b, inner, base } = await demo();
    inner.db.matches.h = { ...base(), id: 'h', maxEvents: 0, updatedAt: 1, createdAt: 1 } as unknown as Match;
    inner.authUser = { uid: 'cap' };
    expect(await codeOf(b.updateMatch('h', { captains: { A: 'cap', B: 'b0', C: 'b1' } } as never))).toBe('captains_required');
    expect(await codeOf(b.updateMatch('h', { captains: { A: 'cap', B: 'ghost' } } as never))).not.toBeNull();
    expect(inner.db.matches.h.captains).toEqual({ A: 'cap', B: 'b0' });
    inner.db.matches.c = { ...base({ captains: { A: 'cap', B: 'a1' } }), id: 'c', maxEvents: 0, updatedAt: 1, createdAt: 1 } as unknown as Match;
    expect(await codeOf(b.updateMatch('c', { teamA: { ...inner.db.matches.c.teamA, teamId: 'team_smashers' } } as never))).not.toBeNull();
    await b.updateMatch('c', { teamA: { ...inner.db.matches.c.teamA, name: 'Renamed' } });
    expect(inner.db.matches.c.teamA.name).toBe('Renamed');
  });
});

describe('V1412-6: ranking after a confirm – a tie on points', () => {
  it('equal ranking points: more wins goes first; equal everything falls to the player id (stable, documented)', () => {
    const { rankPlayers } = require('../../core/ranking');
    const base = { points: 0, potm: 0, matches: 5 };
    // 53 = 3 wins (30) + 23 credited points vs 2 wins (20) + 33 points
    const r = rankPlayers([
      { playerId: 'priya', name: 'Priya', ...base, wins: 2, points: 33 },
      { playerId: 'vihaan', name: 'Vihaan', ...base, wins: 3, points: 23 },
    ]);
    const rows = r.ranked;
    expect(rows.map((x: { playerId: string }) => x.playerId)).toEqual(['vihaan', 'priya']);
    expect(rows[0].rankingPoints).toBe(rows[1].rankingPoints);
  });
});

describe('V1413-4 (1.4.14): a captain on BOTH rosters gives no verdict (core + demo)', () => {
  it('core: B captain also on A, and (neutral scorer) A captain also on B → not_captain, no verdict captain', async () => {
    const { base } = await demo();
    const dupB = finished((o) => ({ ...base(o), teamA: team([...A.slice(0, 5), 'b0'], 'Alpha') }), 'A');
    expect(confirmProblem(dupB, 'b0')).toBe('not_captain');
    expect(verdictCaptains(dupB)).toEqual([]);
    const neutral = { createdBy: 'zz', scorerId: 'zz', captains: { A: 'a1', B: 'b0' } } as Partial<Match>;
    const dupA = finished((o) => ({ ...base(o), ...neutral, teamB: team([...B.slice(0, 5), 'a1'], 'Beta') }), 'A');
    expect(confirmProblem(dupA, 'a1')).toBe('not_captain');
    expect(verdictCaptains(dupA)).toEqual(['b0']);
    const okM = finished((o) => ({ ...base(o), ...neutral }), 'A');
    expect(confirmProblem(okM, 'a1')).toBeNull(); // control
  });
  it('demo: the both-rosters captain is refused (not_captain) and nothing is stored', async () => {
    const { b, inner, base } = await demo();
    const m = finished((o) => ({ ...base(o), teamA: team([...A.slice(0, 5), 'b0'], 'Alpha') }), 'A', { id: 'dup' } as Partial<Match>);
    inner.db.matches.dup = m;
    inner.authUser = { uid: 'b0' };
    expect(await codeOf(b.confirmResult('dup'))).toBe('not_captain');
    expect(inner.db.matches.dup.verification?.status).toBe('pending');
  });
});

describe('V1415-1 (1.4.16): 13 on a side is its own error (team_too_large) on core and demo – with and without captains', () => {
  const thirteen = (base: Match) => ({ teamA: { ...base.teamA, players: [...base.teamA.players, ...Array.from({ length: 7 }, (_, i) => ({ id: `x${i}`, name: `x${i}` }))] } });
  it('core guardUpdate', async () => {
    const { base } = await demo();
    const { guardUpdate: gu, TEAM_TOO_LARGE } = require('../../core/matchGuards');
    const code = (m: Match, p: Partial<Match>) => { try { gu(m, p); return 'ok'; } catch (e) { return (e as { code?: string }).code; } };
    const withCaps = base();
    expect(code(withCaps, thirteen(withCaps))).toBe(TEAM_TOO_LARGE);
    const noCaps = base({ captains: undefined } as Partial<Match>);
    expect(code(noCaps, thirteen(noCaps))).toBe('team_too_large');
    const twelve = { teamA: { ...withCaps.teamA, players: thirteen(withCaps).teamA.players.slice(0, 12) } };
    expect(code(withCaps, twelve)).not.toBe('team_too_large');
  });
  it('demo updateMatch + the EN/HI message', async () => {
    const { b, inner, base } = await demo();
    inner.db.matches.big = { ...base(), id: 'big' } as Match;
    inner.authUser = { uid: 'cap' };
    expect(await codeOf(b.updateMatch('big', thirteen(inner.db.matches.big) as Partial<Match>))).toBe('team_too_large');
    expect(en.errors.codes.team_too_large).toContain('12');
    expect(hi.errors.codes.team_too_large).toContain('12');
  });
});

describe('V1416-1 (1.4.17): create with 13 or 14 on a side is team_too_large on core and demo – before the captain / verdict checks', () => {
  const extra = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `x${i}`, name: `x${i}` }));
  const grown = (base: (o?: Partial<Match>) => Match, side: 'teamA' | 'teamB', size: number, over: Partial<Match> = {}) => {
    const m = base(over);
    const t = { ...m[side], players: [...m[side].players, ...extra(size - m[side].players.length)] };
    const nm = { ...m, [side]: t } as Match;
    return { ...nm, participantIds: [...nm.teamA.players, ...nm.teamB.players].map((p) => p.id) } as Match;
  };
  const caps = { A: 'cap', B: 'b0' };
  it('core guardCreate: 13 and 14 on A or B, with and without captains; 12 is not team_too_large', async () => {
    const { base } = await demo();
    const { guardCreate: gc } = require('../../core/matchGuards');
    const code = (m: Match, c: object) => { try { gc(m, c); return 'ok'; } catch (e) { return (e as { code?: string }).code; } };
    for (const side of ['teamA', 'teamB'] as const) for (const n of [13, 14]) {
      expect(code(grown(base, side, n), caps)).toBe('team_too_large');
      expect(code(grown(base, side, n, { captains: undefined } as Partial<Match>), {})).toBe('team_too_large');
    }
    expect(code(grown(base, 'teamA', 12), caps)).not.toBe('team_too_large');
    expect(code(grown(base, 'teamA', 12, { captains: undefined } as Partial<Match>), {})).not.toBe('team_too_large');
    expect(code(base(), caps)).toBe('ok');
  });
  it('demo createMatch: 13 and 14 → team_too_large, with and without captains', async () => {
    const { b, inner, base } = await demo();
    const proto = inner.db.users.cap;
    extra(14).forEach((p, i) => (inner.db.users[p.id] = { ...proto, id: p.id, name: p.id, phone: `+9190008${String(i).padStart(5, '0')}` }));
    inner.authUser = { uid: 'cap' };
    for (const n of [13, 14]) {
      expect(await codeOf(b.createMatch(grown(base, 'teamA', n, { rules: presetRules('indoor') } as Partial<Match>) as never))).toBe('team_too_large');
      expect(await codeOf(b.createMatch(grown(base, 'teamB', n, { captains: undefined, rules: presetRules('indoor') } as Partial<Match>) as never))).toBe('team_too_large');
    }
    expect(await codeOf(b.createMatch(base({ rules: presetRules('indoor') }) as never))).toBeNull();
  });
});

describe('1.4.18 (small): a side with players null / missing is a coded error, not a TypeError', () => {
  it('core guardCreate and demo createMatch → team_invalid (with captains), EN/HI messages', async () => {
    const { b, inner, base } = await demo();
    const { guardCreate: gc } = require('../../core/matchGuards');
    const code = (m: unknown) => { try { gc(m, { A: 'cap', B: 'b0' }); return 'ok'; } catch (e) { return (e as { code?: string }).code ?? String(e); } };
    const m = base({ rules: presetRules('indoor') });
    expect(code({ ...m, teamA: { ...m.teamA, players: null } })).toBe('team_invalid');
    expect(code({ ...m, teamB: { ...m.teamB, players: 'x' } })).toBe('team_invalid');
    expect(code({ ...m, teamA: null })).toBe('team_invalid');
    inner.authUser = { uid: 'cap' };
    expect(await codeOf(b.createMatch({ ...m, teamA: { ...m.teamA, players: null } } as never))).toBe('team_invalid');
    expect(await codeOf(b.createMatch({ ...m, teamB: null } as never))).toBe('team_invalid');
    expect((en.errors.codes as Record<string, string>).team_invalid).toBeTruthy();
    expect((hi.errors.codes as Record<string, string>).team_invalid).toBeTruthy();
  });
});
