/** 1.5.0 Tester's full E2E 1.4.28 on the demo backend: F1428-1 (Accept builds a match nobody could confirm →
 * match_no_verdict) and F1428-2 (the challenge ↔ match link is checked like the API). */
import { DemoBackend } from '../backend/demoBackend';
import { makeSeed } from '../backend/demoSeed';
import { expectedConfirmer, verdictSetupProblem } from '../../core/antifraud';
import type { Challenge, Match } from '../../core/types';

jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
let mockB: DemoBackend;
jest.mock('../backend', () => ({ get backend() { return mockB; } }));

const seed = makeSeed();
const TERMS = require('../../core/terms').TERMS_VERSION;
async function as(uid: string) {
  (mockB as unknown as { authUser: { uid: string; phoneNumber: string } }).authUser = { uid, phoneNumber: seed.users[uid]?.phone ?? '+919000000099' };
  await mockB.acceptTerms(uid, TERMS);
}
const smashers = seed.teams.team_smashers;
const ninjas = seed.teams.team_ninjas;
async function challenge(): Promise<Challenge> {
  await as(smashers.captainId);
  const id = await mockB.createChallenge({ fromTeamId: smashers.id, fromTeamName: smashers.name, fromCaptainId: smashers.captainId, toTeamId: ninjas.id, toTeamName: ninjas.name, toCaptainId: ninjas.captainId, when: Date.now() + 3_600_000, location: { lat: 28.5, lng: 77.2, name: 'Siri Fort' }, rules: seed.matches[Object.keys(seed.matches)[0]].rules });
  return { ...(mockB as unknown as { db: { challenges: Record<string, Challenge> } }).db.challenges[id], id };
}
const db = () => (mockB as unknown as { db: { challenges: Record<string, Challenge>; matches: Record<string, Match> } }).db;

beforeEach(() => { mockB = new DemoBackend(); });
// the demo's live-score simulation timer would keep jest alive
afterEach(() => { const t = (mockB as unknown as { simTimer: ReturnType<typeof setInterval> | null }).simTimer; if (t) clearInterval(t); });

test('seed teams have 6+ players (the Tester repro: 6 v 6)', () => {
  expect(smashers.memberIds.length).toBeGreaterThanOrEqual(6);
  expect(ninjas.memberIds.length).toBeGreaterThanOrEqual(6);
});

test('F1428-1: captain B accepts captain A\'s challenge → a playable match, A confirms, challenge accepted', async () => {
  const c = await challenge();
  await as(ninjas.captainId);
  const { acceptChallenge } = require('../matchFactory');
  const matchId: string = await acceptChallenge(c, ninjas.captainId, { from: smashers, to: ninjas });
  const m = db().matches[matchId];
  expect(m).toBeTruthy();
  expect(m.scorerId).toBe(ninjas.captainId);
  expect(m.challengeId).toBe(c.id);
  expect(verdictSetupProblem(m)).toBeNull();
  expect(expectedConfirmer(m)).toBe(smashers.captainId);
  expect(db().challenges[c.id].status).toBe('accepted');
  expect(db().challenges[c.id].matchId).toBe(matchId);
  // playable: the scorer starts it and scores a rally
  await mockB.updateMatch(matchId, { status: 'live' } as Partial<Match>);
  await mockB.updateMatch(matchId, { events: [{ type: 'point', side: 'A', at: Date.now() }] } as Partial<Match>);
  expect(db().matches[matchId].status).toBe('live');
  expect(db().matches[matchId].events).toHaveLength(1);
});

test('F1428-2 (a): accepting with an unrelated match id is refused; the challenge stays pending', async () => {
  const c = await challenge();
  const other = Object.values(db().matches).find((m) => m.challengeId == null && m.status === 'scheduled')!;
  await as(ninjas.captainId);
  await expect(mockB.respondToChallenge(c, 'accepted', other.id)).rejects.toMatchObject({ code: 'challenge_match_invalid' });
  expect(db().challenges[c.id].status).toBe('pending');
  await expect(mockB.respondToChallenge(c, 'declined', other.id)).rejects.toMatchObject({ code: 'challenge_match_invalid' });
  await expect(mockB.respondToChallenge(c, 'accepted', 'nope')).rejects.toMatchObject({ code: 'challenge_match_invalid' });
});

test('F1428-2 (b): a non-captain cannot claim a declined challenge; a captain cannot replay it; answers by captains only', async () => {
  const c = await challenge();
  await as(smashers.captainId);
  await expect(mockB.respondToChallenge(c, 'accepted')).rejects.toMatchObject({ code: 'challenge_not_captain' }); // the challenger can't accept
  await as(ninjas.captainId);
  await mockB.respondToChallenge(c, 'declined');
  const player = smashers.memberIds.find((x) => x !== smashers.captainId)!;
  await as(player);
  const body = (createdBy: string) => ({ ...Object.values(db().matches)[0], id: undefined, challengeId: c.id, createdBy, scorerId: createdBy, status: 'scheduled', events: [], scheduledAt: Date.now() + 3_600_000 }) as never;
  await expect(mockB.createMatch(body(player))).rejects.toMatchObject({ code: 'challenge_not_captain' });
  await as(ninjas.captainId);
  await expect(mockB.createMatch(body(ninjas.captainId))).rejects.toMatchObject({ code: 'challenge_closed' });
  await expect(mockB.respondToChallenge(c, 'accepted')).rejects.toMatchObject({ code: 'challenge_closed' });
});

test('F1428-2: a second match for the same challenge and moving the link are refused', async () => {
  const c = await challenge();
  await as(ninjas.captainId);
  const { acceptChallenge } = require('../matchFactory');
  const matchId: string = await acceptChallenge(c, ninjas.captainId, { from: smashers, to: ninjas });
  await as(smashers.captainId);
  const { id: _i, verification: _v, createdAt: _c, updatedAt: _u, startedServerAt: _s, finishedServerAt: _f, ...m } = db().matches[matchId] as Match & Record<string, unknown>;
  await expect(mockB.createMatch({ ...m, createdBy: smashers.captainId, scorerId: smashers.captainId } as never)).rejects.toMatchObject({ code: 'challenge_used' });
  await as(ninjas.captainId);
  await expect(mockB.updateMatch(matchId, { challengeId: null })).rejects.toMatchObject({ code: 'challenge_link_frozen' });
});

describe('1.5.1 F150-1 (demo): only the challenged captain\'s Accept creates the match', () => {
  const body = (c: Challenge, createdBy: string) => ({ ...Object.values(db().matches)[0], id: undefined, challengeId: c.id, createdBy, scorerId: createdBy, status: 'scheduled', events: [], scheduledAt: Date.now() + 3_600_000, teamA: { ...Object.values(db().matches)[0].teamA, teamId: smashers.id }, teamB: { ...Object.values(db().matches)[0].teamB, teamId: ninjas.id }, captains: { A: smashers.captainId, B: ninjas.captainId } }) as never;
  const linked = (c: Challenge) => Object.values(db().matches).filter((m) => m.challengeId === c.id).length;
  test('Tester repro: the challenger pre-creating the match of a pending challenge is refused; B accepts; decline no longer possible', async () => {
    const c = await challenge();
    await as(smashers.captainId);
    await expect(mockB.createMatch(body(c, smashers.captainId))).rejects.toMatchObject({ code: 'challenge_pending' });
    await expect(mockB.acceptChallenge(c, body(c, smashers.captainId))).rejects.toMatchObject({ code: 'challenge_not_captain' });
    await as(ninjas.captainId);
    await expect(mockB.createMatch(body(c, ninjas.captainId))).rejects.toMatchObject({ code: 'challenge_pending' });
    await expect(mockB.respondToChallenge(c, 'accepted')).rejects.toMatchObject({ code: 'challenge_accept_match' });
    expect(linked(c)).toBe(0);
    expect(db().challenges[c.id].status).toBe('pending');
    const { acceptChallenge } = require('../matchFactory');
    const matchId: string = await acceptChallenge(c, ninjas.captainId, { from: smashers, to: ninjas });
    expect(db().challenges[c.id]).toMatchObject({ status: 'accepted', matchId });
    await expect(mockB.respondToChallenge(c, 'declined')).rejects.toMatchObject({ code: 'challenge_used' });
    await expect(mockB.acceptChallenge(c, body(c, ninjas.captainId))).rejects.toMatchObject({ code: 'challenge_used' });
    expect(linked(c)).toBe(1);
  });
  test('a decline / cancel leaves no match and can\'t be accepted afterwards', async () => {
    const c = await challenge();
    await as(ninjas.captainId);
    await mockB.respondToChallenge(c, 'declined');
    await expect(mockB.acceptChallenge(c, body(c, ninjas.captainId))).rejects.toMatchObject({ code: 'challenge_closed' });
    const c2 = await challenge();
    await mockB.respondToChallenge(c2, 'cancelled');
    await as(ninjas.captainId);
    await expect(mockB.acceptChallenge(c2, body(c2, ninjas.captainId))).rejects.toMatchObject({ code: 'challenge_closed' });
    expect(linked(c) + linked(c2)).toBe(0);
  });
});
