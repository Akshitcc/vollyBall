/** 1.4.27 (QA V1426-5): the demo answers an unlink of a played fixture like the API (1.4.26 DB-6): the claim is kept,
 * nothing is refused; a swap or a removal of a played fixture is still fixture_locked. */
import { DemoBackend } from '../backend/demoBackend';
import type { Match, Tournament } from '../../core/types';
import { TERMS_VERSION } from '../../core/terms';
import { fixtureResultFromMatch } from '../../core/results';
jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('../backend/firebaseBackend', () => ({ FirebaseBackend: class {} }));
const codeOf = (p: Promise<unknown>) => p.then(() => null, (e) => (e as { code?: string }).code ?? String(e));

it('unlink of a played fixture: accepted, claim kept (API parity); swap / remove: fixture_locked', async () => {
  const b = new DemoBackend();
  await (b as unknown as { ready: Promise<void> }).ready;
  const inner = b as unknown as { db: { tournaments: Record<string, Tournament>; matches: Record<string, Match>; users: Record<string, unknown> }; authUser: { uid: string } | null; terms: Record<string, unknown> };
  for (const u of Object.keys(inner.db.users)) inner.terms[u] = { version: TERMS_VERSION, acceptedAt: 1 };
  const t = Object.values(inner.db.tournaments).find((x) => x.organizerId === 'seed1')!;
  const f = t.fixtures.find((x) => x.homeId && x.awayId)!;
  const src = Object.values(inner.db.matches).filter((m) => m.status === 'finished').find((m) => fixtureResultFromMatch({ ...m, fixtureId: f.id } as Match))!;
  const m = { ...src, id: 'played-1427', tournamentId: t.id, fixtureId: f.id, teamA: { ...src.teamA, teamId: f.homeId }, teamB: { ...src.teamB, teamId: f.awayId } } as Match;
  inner.db.matches[m.id] = m;
  inner.db.tournaments[t.id] = { ...t, fixtures: t.fixtures.map((x) => (x.id === f.id ? { ...x, matchId: m.id } : x)) };
  inner.authUser = { uid: 'seed1' };
  const cur = inner.db.tournaments[t.id];
  expect(await codeOf(b.updateTournament(t.id, { fixtures: cur.fixtures.map((x) => (x.id === f.id ? { ...x, matchId: undefined } : x)) }))).toBeNull();
  expect(inner.db.tournaments[t.id].fixtures.find((x) => x.id === f.id)!.matchId).toBe(m.id);
  expect(await codeOf(b.updateTournament(t.id, { fixtures: cur.fixtures.map((x) => (x.id === f.id ? { ...x, homeId: x.awayId, awayId: x.homeId } : x)) }))).toBe('fixture_locked');
  expect(await codeOf(b.updateTournament(t.id, { fixtures: cur.fixtures.filter((x) => x.id !== f.id) }))).toBe('fixture_locked');
  clearInterval((b as unknown as { simTimer: ReturnType<typeof setInterval> }).simTimer);
});
