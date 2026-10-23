/** 1.5.2 Tester "1.5.1 retest" on the demo backend: F151-1 (the CURRENT captain acts on a challenge) and F151-2 (parallel
 * accept taps create one match). */
import { DemoBackend } from '../backend/demoBackend';
import { makeSeed } from '../backend/demoSeed';
import type { Challenge, Match, Team } from '../../core/types';

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

const teamNow = (id: string) => (mockB as unknown as { db: { teams: Record<string, Team> } }).db.teams[id];
async function transfer(team: Team, to: string) {
  await as(team.captainId);
  await mockB.updateTeam(team.id, { captainId: to });
  expect(teamNow(team.id).captainId).toBe(to);
}
const otherMember = (t: Team) => t.memberIds.find((m) => m !== t.captainId)!;

describe('F151-1 (demo): current captain at action time', () => {
  test('accept: former challenged captain refused, the new captain accepts', async () => {
    const c = await challenge();
    const nu = otherMember(ninjas);
    await transfer(ninjas, nu);
    const { acceptChallenge } = require('../matchFactory');
    await as(ninjas.captainId);
    await expect(acceptChallenge(c, ninjas.captainId, { from: smashers, to: { ...ninjas, captainId: ninjas.captainId } })).rejects.toMatchObject({ code: 'challenge_not_captain' });
    expect(Object.values(db().matches).filter((m) => m.challengeId === c.id)).toHaveLength(0);
    await as(nu);
    const id: string = await acceptChallenge(c, nu, { from: smashers, to: teamNow(ninjas.id) });
    expect(db().challenges[c.id]).toMatchObject({ status: 'accepted', matchId: id, toCaptainId: nu });
  });
  test('decline: former captain refused, new captain allowed', async () => {
    const c = await challenge();
    const nu = otherMember(ninjas);
    await transfer(ninjas, nu);
    await as(ninjas.captainId);
    await expect(mockB.respondToChallenge(c, 'declined')).rejects.toMatchObject({ code: 'challenge_not_captain' });
    expect(db().challenges[c.id].status).toBe('pending');
    await as(nu);
    await mockB.respondToChallenge(c, 'declined');
    expect(db().challenges[c.id].status).toBe('declined');
  });
  test('cancel: former challenger captain refused, new challenger captain allowed', async () => {
    const c = await challenge();
    const nu = otherMember(smashers);
    await transfer(smashers, nu);
    await as(smashers.captainId);
    await expect(mockB.respondToChallenge(c, 'cancelled')).rejects.toMatchObject({ code: 'challenge_not_captain' });
    await as(nu);
    await mockB.respondToChallenge(c, 'cancelled');
    expect(db().challenges[c.id].status).toBe('cancelled');
  });
  test('watchChallenges shows the current captains (the new captain gets Accept / Decline)', async () => {
    const c = await challenge();
    const nu = otherMember(ninjas);
    await transfer(ninjas, nu);
    const got = await new Promise<Challenge[]>((res) => { const off = mockB.watchChallenges([ninjas.id], (l) => { res(l); setTimeout(() => off?.(), 0); }); });
    expect(got.find((x) => x.id === c.id)?.toCaptainId).toBe(nu);
  });
});

describe('F151-2 (demo): accept is atomic', () => {
  test('5 parallel accept taps → 1 match carrying the challengeId, the challenge links it', async () => {
    const c = await challenge();
    await as(ninjas.captainId);
    const { acceptChallenge } = require('../matchFactory');
    const ids: string[] = await Promise.all(Array.from({ length: 5 }, () => acceptChallenge(c, ninjas.captainId, { from: smashers, to: ninjas })));
    const linked = Object.values(db().matches).filter((m) => m.challengeId === c.id);
    expect(linked).toHaveLength(1);
    expect(new Set(ids)).toEqual(new Set([linked[0].id]));
    expect(db().challenges[c.id]).toMatchObject({ status: 'accepted', matchId: linked[0].id });
    // a later (sequential) accept is still refused
    await expect(acceptChallenge(c, ninjas.captainId, { from: smashers, to: ninjas })).rejects.toMatchObject({ code: 'challenge_used' });
  });
  test('accept and decline tapped together: one consistent outcome', async () => {
    const c = await challenge();
    await as(ninjas.captainId);
    const { acceptChallenge } = require('../matchFactory');
    const r = await Promise.allSettled([acceptChallenge(c, ninjas.captainId, { from: smashers, to: ninjas }), mockB.respondToChallenge(c, 'declined')]);
    const linked = Object.values(db().matches).filter((m) => m.challengeId === c.id);
    const st = db().challenges[c.id].status;
    if (st === 'accepted') expect(linked).toHaveLength(1);
    else { expect(st).toBe('declined'); expect(linked).toHaveLength(0); }
    expect(r.filter((x) => x.status === 'fulfilled').length).toBe(1);
  });
});
