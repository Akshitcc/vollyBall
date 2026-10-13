/** 1.4.19: tournament admin permissions – core helper and demo backend (owner can, non-owner / app admin can't). */
import { claimedTournamentMatches, assertTournamentAdmin, guardTournamentEdit, isTournamentAdmin, NOT_TOURNAMENT_ADMIN, tournamentLinkProblem, tournamentViewOnly } from '../../core/tournamentAdmin';
import { DemoBackend } from '../backend/demoBackend';
import { DEMO_QA_ADMIN } from '../backend/demoSeed';
import type { Match, Tournament } from '../../core/types';
import { TERMS_VERSION } from '../../core/terms';
import { presetRules } from '../../core/rules';
import { translateCode } from '../../i18n/format';
import en from '../../i18n/locales/en';
import hi from '../../i18n/locales/hi';

jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('../backend/firebaseBackend', () => ({ FirebaseBackend: class {} }));

const made: DemoBackend[] = [];
afterEach(() => {
  for (const b of made.splice(0)) clearInterval((b as unknown as { simTimer: ReturnType<typeof setInterval> }).simTimer);
});
const codeOf = (p: Promise<unknown>) => p.then(() => null, (e) => (e as { code?: string }).code ?? String(e));
const codeSync = (f: () => void) => { try { f(); return null; } catch (e) { return (e as { code?: string }).code; } };

describe('core/tournamentAdmin', () => {
  const t = { organizerId: 'own' };
  it('only the owner is admin; an owner-less (older) doc has no admin', () => {
    expect(isTournamentAdmin(t, 'own')).toBe(true);
    for (const u of ['x', '', null, undefined]) expect(isTournamentAdmin(t, u)).toBe(false);
    for (const d of [{}, { organizerId: null }, { organizerId: '' }, null, undefined]) {
      expect(isTournamentAdmin(d, 'own')).toBe(false);
      expect(isTournamentAdmin(d, '')).toBe(false);
    }
    expect(tournamentViewOnly(t, 'x')).toBe(true);
    expect(tournamentViewOnly(t, 'own')).toBe(false);
    expect(tournamentViewOnly({}, 'own')).toBe(true);
  });
  it('assert / edit guard: coded not_tournament_admin; no hand-over', () => {
    expect(codeSync(() => assertTournamentAdmin(t, 'own'))).toBeNull();
    expect(codeSync(() => assertTournamentAdmin(t, 'x'))).toBe(NOT_TOURNAMENT_ADMIN);
    expect(codeSync(() => guardTournamentEdit(t, 'own', { name: 'n' } as object))).toBeNull();
    expect(codeSync(() => guardTournamentEdit(t, 'own', { organizerId: 'own' }))).toBeNull();
    expect(codeSync(() => guardTournamentEdit(t, 'own', { organizerId: 'x' }))).toBe(NOT_TOURNAMENT_ADMIN);
    expect(codeSync(() => guardTournamentEdit(t, 'x', {}))).toBe(NOT_TOURNAMENT_ADMIN);
  });
  it('match link: new link by the owner only; fixed afterwards; unlinked matches untouched', () => {
    const look = (id: string) => (id === 'T' ? t : null);
    expect(tournamentLinkProblem(null, {}, 'x', look)).toBeNull();
    expect(tournamentLinkProblem(null, { tournamentId: 'T', fixtureId: 'f' }, 'own', look)).toBeNull();
    expect(tournamentLinkProblem(null, { tournamentId: 'T', fixtureId: 'f' }, 'x', look)).toBe(NOT_TOURNAMENT_ADMIN);
    expect(tournamentLinkProblem(null, { tournamentId: 'nope' }, 'own', look)).toBe(NOT_TOURNAMENT_ADMIN);
    expect(tournamentLinkProblem(null, { fixtureId: 'f' }, 'own', look)).toBe(NOT_TOURNAMENT_ADMIN);
    expect(tournamentLinkProblem({ tournamentId: 'T', fixtureId: 'f' }, { tournamentId: 'T', fixtureId: 'f' }, 'x', look)).toBeNull();
    expect(tournamentLinkProblem({ tournamentId: 'T', fixtureId: 'f' }, { tournamentId: 'T', fixtureId: 'g' }, 'own', look)).toBe(NOT_TOURNAMENT_ADMIN);
    expect(tournamentLinkProblem({}, { tournamentId: 'T' }, 'own', look)).toBe(NOT_TOURNAMENT_ADMIN);
  });
  it('standings count only the matches the owner claimed in a fixture', () => {
    const t = { fixtures: [{ id: 'f1', matchId: 'm1' }, { id: 'f2' }] };
    const ms = [{ id: 'm1', fixtureId: 'f1' }, { id: 'evil', fixtureId: 'f1' }, { id: 'x', fixtureId: 'f2' }, { id: 'm1b', fixtureId: null }];
    expect(claimedTournamentMatches(t, ms).map((m) => m.id)).toEqual(['m1']);
    expect(claimedTournamentMatches(null, ms)).toEqual([]);
    expect(claimedTournamentMatches({ fixtures: [{ id: 'f2', matchId: 'm1' }] }, ms)).toEqual([]);
  });
  it('EN / HI error text and the View only label', () => {
    expect(translateCode({ code: NOT_TOURNAMENT_ADMIN })).toBe(en.errors.codes.not_tournament_admin);
    expect((en as any).tournament.viewOnly).toBe('View only');
    expect((hi as any).tournament.viewOnly).toBeTruthy();
    expect((hi as any).errors.codes.not_tournament_admin).not.toBe((en as any).errors.codes.not_tournament_admin);
  });
});

describe('demo backend', () => {
  async function demo() {
    const b = new DemoBackend();
    made.push(b);
    await (b as unknown as { ready: Promise<void> }).ready;
    const inner = b as unknown as { db: { tournaments: Record<string, Tournament>; matches: Record<string, Match>; users: Record<string, Record<string, unknown>> }; authUser: { uid: string } | null; terms: Record<string, unknown> };
    (b as unknown as { qaAdmins: Set<string> }).qaAdmins.add(DEMO_QA_ADMIN.id); // the demo app admin, switched on
    expect(await b.isAdmin(DEMO_QA_ADMIN.id)).toBe(true);
    for (const u of [...Object.keys(inner.db.users)]) inner.terms[u] = { version: TERMS_VERSION, acceptedAt: 1 };
    const tid = Object.values(inner.db.tournaments).find((x) => x.organizerId === 'seed1')!.id;
    return { b, inner, tid, as: (uid: string | null) => (inner.authUser = uid ? { uid } : null) };
  }
  const edits = (t: Tournament): [string, Partial<Tournament>][] => [
    ['name', { name: 'Cup Two' }],
    ['rules', { rules: { ...t.rules, bestOf: 3 } as Tournament['rules'] }],
    ['dates', { startDate: Date.now() + 2 * 86400000, endDate: Date.now() + 3 * 86400000 }],
    ['venue', { location: { name: 'Talkatora', lat: 28.6, lng: 77.2 } as Tournament['location'] }],
    ['teams', { teams: t.teams.slice(0, 2) }],
    ['fixtures', { fixtures: [] }],
    ['status', { status: 'running' }],
  ];
  it('every edit type: player / stranger / app admin / signed out refused (not_tournament_admin), owner allowed', async () => {
    const { b, inner, tid, as } = await demo();
    for (const [name, patch] of edits(inner.db.tournaments[tid])) {
      for (const u of ['seed2', 'seed5', DEMO_QA_ADMIN.id, null]) {
        as(u);
        expect([name, u, await codeOf(b.updateTournament(tid, patch))]).toEqual([name, u, NOT_TOURNAMENT_ADMIN]);
      }
      as('seed1');
      expect([name, await codeOf(b.updateTournament(tid, patch))]).toEqual([name, null]);
    }
    expect(await codeOf(b.updateTournament(tid, { organizerId: 'seed2' }))).toBe(NOT_TOURNAMENT_ADMIN);
  });
  it('delete: owner only', async () => {
    const { b, inner, tid, as } = await demo();
    for (const u of ['seed2', DEMO_QA_ADMIN.id, null]) {
      as(u);
      expect(await codeOf(b.deleteTournament(tid))).toBe(NOT_TOURNAMENT_ADMIN);
    }
    expect(inner.db.tournaments[tid]).toBeTruthy();
    as('seed1');
    expect(await codeOf(b.deleteTournament(tid))).toBeNull();
    expect(inner.db.tournaments[tid]).toBeUndefined();
  });
  it('an older tournament without an owner: nobody edits or deletes it', async () => {
    const { b, inner, tid, as } = await demo();
    delete (inner.db.tournaments[tid] as Partial<Tournament>).organizerId;
    for (const u of ['seed1', 'seed2', DEMO_QA_ADMIN.id]) {
      as(u);
      expect(await codeOf(b.updateTournament(tid, { name: 'Mine now' }))).toBe(NOT_TOURNAMENT_ADMIN);
      expect(await codeOf(b.deleteTournament(tid))).toBe(NOT_TOURNAMENT_ADMIN);
    }
  });
  it('match link: a non-owner cannot tag or retag a match into the tournament', async () => {
    const { b, inner, tid, as } = await demo();
    const ms = Object.values(inner.db.matches).filter((m) => !m.tournamentId && m.status !== 'finished');
    expect(ms.length).toBeGreaterThanOrEqual(2);
    const [free, linked] = ms;
    inner.db.matches[linked.id] = { ...linked, tournamentId: tid, fixtureId: 'f1' };
    as(free.createdBy);
    expect(await codeOf(b.updateMatch(free.id, { tournamentId: tid, fixtureId: 'f1' }))).toBe(NOT_TOURNAMENT_ADMIN);
    as('seed1'); // even the owner can't move a linked match
    expect(await codeOf(b.updateMatch(linked.id, { fixtureId: 'other' }))).toBe(NOT_TOURNAMENT_ADMIN);
    expect(await codeOf(b.updateMatch(linked.id, { tournamentId: null as never }))).toBe(NOT_TOURNAMENT_ADMIN);
    void presetRules;
  });
});
