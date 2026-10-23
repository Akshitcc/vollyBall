/** 1.5.0 (Tester F1428-4, demo): no automatic invites for new sign-ups (registered-only rule), stale ones from older
 * demo data are cleaned, and one Join tap adds exactly the signed-in player – once. */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { DemoBackend } from '../backend/demoBackend';
import { makeSeed } from '../backend/demoSeed';
import type { Team } from '../../core/types';

jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
const TERMS = require('../../core/terms').TERMS_VERSION;
const seed = makeSeed();
type Db = { db: { teams: Record<string, Team>; users: Record<string, { phone: string }> }; authUser: { uid: string; phoneNumber: string } | null; simTimer: ReturnType<typeof setInterval> | null };
let b: DemoBackend;
const raw = () => b as unknown as Db;
async function as(uid: string) {
  raw().authUser = { uid, phoneNumber: raw().db.users[uid]?.phone ?? seed.users[uid].phone };
  await b.acceptTerms(uid, TERMS);
}
beforeEach(async () => { await AsyncStorage.clear(); b = new DemoBackend(); await (b as unknown as { ready: Promise<void> }).ready; });
afterEach(() => { if (raw().simTimer) clearInterval(raw().simTimer!); });

test('the seeded Delhi Smashers has no pending invites', () => {
  expect(raw().db.teams.team_smashers.pendingPhones).toEqual([]);
  expect(seed.teams.team_smashers.pendingPhones).toEqual([]);
});

test('a new sign-up (complete or not) gets no automatic invite', async () => {
  raw().authUser = { uid: 'u919000002001', phoneNumber: '+919000002001' };
  await b.acceptTerms('u919000002001', TERMS);
  await b.saveProfile({ id: 'u919000002001', name: 'Asha Rao', phone: '+919000002001', position: 'any', city: 'Mumbai', photoURL: null, createdAt: Date.now() } as never);
  expect(raw().db.teams.team_smashers.pendingPhones).toEqual([]);
});

test('older demo data: invites for numbers that are not registered are removed on load', async () => {
  const db = JSON.parse(JSON.stringify(seed));
  db.teams.team_smashers.pendingPhones = ['+919000002001', '+919000002004', seed.users[seed.teams.team_blockers.memberIds[1]].phone];
  db.users.u919000002001 = { id: 'u919000002001', name: 'Half Signup', phone: '+919000002001' };
  // the demo's own storage key (read from the source so the test follows a key bump)
  const KEY = require('fs').readFileSync(require('path').join(__dirname, '../backend/demoBackend.ts'), 'utf8').match(/const KEY = '([^']+)'/)?.[1];
  await AsyncStorage.setItem(KEY, JSON.stringify(db));
  if (raw().simTimer) clearInterval(raw().simTimer!);
  b = new DemoBackend();
  await (b as unknown as { ready: Promise<void> }).ready;
  expect(raw().db.teams.team_smashers.pendingPhones).toEqual([seed.users[seed.teams.team_blockers.memberIds[1]].phone]);
});

test('one Join tap adds exactly the signed-in player, once; nobody joins for someone else', async () => {
  const smashers = seed.teams.team_smashers;
  const [p2, p3] = seed.teams.team_blockers.memberIds.filter((x) => !smashers.memberIds.includes(x)).slice(1, 3);
  const [ph2, ph3] = [seed.users[p2].phone, seed.users[p3].phone];
  await as(smashers.captainId);
  await b.updateTeam(smashers.id, { pendingPhones: [ph2, ph3] });
  await as(p3);
  await expect(b.acceptTeamInvite(smashers.id, p2, ph2)).rejects.toThrow('Only the invited player');
  await b.acceptTeamInvite(smashers.id, p3, ph3);
  await b.acceptTeamInvite(smashers.id, p3, ph3); // double tap
  const t = raw().db.teams[smashers.id];
  expect(t.memberIds.filter((x) => x === p3)).toHaveLength(1);
  expect(t.memberIds).not.toContain(p2);
  expect(t.pendingPhones).toEqual([ph2]);
  expect(t.subIds.filter((x) => x === p3).length).toBeLessThanOrEqual(1);
  expect(t.memberIds.length).toBe(smashers.memberIds.length + 1);
});

test('1.5.1 F150-3: only the invited player can decline their own invite (like the API)', async () => {
  const cap = seed.teams.team_smashers.captainId;
  const [p1, p2] = seed.teams.team_blockers.memberIds.slice(1, 3);
  const ph = (u: string) => raw().db.users[u]?.phone ?? seed.users[u].phone;
  raw().db.teams.team_smashers = { ...raw().db.teams.team_smashers, pendingPhones: [ph(p1), ph(p2)] };
  // another signed-in player (Tester repro) – refused, the invite stays
  await as(p1);
  await expect(b.declineTeamInvite('team_smashers', ph(p2))).rejects.toThrow('Only the invited player can decline the invite');
  // the captain can't decline it either (they withdraw an invite by editing the team)
  await as(cap);
  await expect(b.declineTeamInvite('team_smashers', ph(p2))).rejects.toThrow();
  expect(raw().db.teams.team_smashers.pendingPhones).toEqual([ph(p1), ph(p2)]);
  // the invitee declines their own; a second tap changes nothing
  await as(p2);
  await b.declineTeamInvite('team_smashers', ph(p2));
  await b.declineTeamInvite('team_smashers', ph(p2));
  expect(raw().db.teams.team_smashers.pendingPhones).toEqual([ph(p1)]);
  raw().authUser = null;
  await expect(b.declineTeamInvite('team_smashers', ph(p1))).rejects.toThrow();
});
