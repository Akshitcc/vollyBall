/** Demo backend validates like the API server and the rules (registered-players re-test #2, #4). */
import { DemoBackend } from '../backend/demoBackend';
import { makeSeed } from '../backend/demoSeed';
import { orderedParticipants } from '../../core/roster';

jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));

async function signedIn(phone = '+919000000010') {
  jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
  const b = new DemoBackend();
  const otp = b.sendOtp(phone);
  await jest.advanceTimersByTimeAsync(500);
  const done = (await otp).confirm('123456');
  await jest.advanceTimersByTimeAsync(500);
  await done;
  jest.useRealTimers();
  // 1.3.0: every write needs the current T&C accepted (the gate itself is tested in terms130)
  await b.acceptTerms((b as unknown as { authUser: { uid: string } }).authUser.uid, require('../../core/terms').TERMS_VERSION);
  return b;
}
const seed = makeSeed();
const team = (id: string) => seed.teams[id];

test('createChallenge: only your own team, as its captain, against a team that can play', async () => {
  const b = await signedIn(); // seed1 = captain of team_smashers
  const base = { fromTeamId: 'team_smashers', fromTeamName: 'x', fromCaptainId: 'seed1', toTeamId: 'team_blockers', toTeamName: 'y', toCaptainId: team('team_blockers').captainId, when: Date.now(), location: { lat: 1, lng: 1, name: 'Court' }, rules: seed.matches[Object.keys(seed.matches)[0]].rules };
  await expect(b.createChallenge(base)).resolves.toBeTruthy();
  await expect(b.createChallenge({ ...base, fromTeamId: 'team_blockers', fromCaptainId: team('team_blockers').captainId, toTeamId: 'team_ninjas', toCaptainId: team('team_ninjas').captainId })).rejects.toThrow('Only the team captain');
  await expect(b.createChallenge({ ...base, toTeamId: 'team_smashers', toCaptainId: 'seed1' })).rejects.toThrow('cannot challenge itself');
  await expect(b.createChallenge({ ...base, toTeamId: 'nope' })).rejects.toThrow('Team not found');
  const solo = await b.createTeam({ name: 'Solo', color: '#2B2B2B', captainId: 'seed1', memberIds: ['seed1'], subIds: [], pendingPhones: [], city: '' });
  await expect(b.createChallenge({ ...base, fromTeamId: solo })).rejects.toThrow('at least 6 players');
});

test('updateTournament: organiser only, and new teams must be registered and big enough', async () => {
  const b = await signedIn();
  const tid = Object.keys(seed.tournaments)[0];
  const t = seed.tournaments[tid];
  expect(t.organizerId).toBe('seed1');
  const other = await signedIn('+919000000011'); // seed2, not the organiser
  await expect(other.updateTournament(tid, { status: 'running' })).rejects.toThrow('Only the tournament owner');
  await expect(b.updateTournament(tid, { status: 'running' })).resolves.toBeUndefined();
  await expect(b.updateTournament(tid, { teams: [...t.teams, { id: 'ext_1', name: 'Ext', color: '#2B2B2B' }] })).rejects.toThrow('registered teams');
  const solo = await b.createTeam({ name: 'Solo', color: '#2B2B2B', captainId: 'seed1', memberIds: ['seed1'], subIds: [], pendingPhones: [], city: '' });
  await expect(b.updateTournament(tid, { teams: [...t.teams, { id: solo, name: 'Solo', color: '#2B2B2B' }] })).rejects.toThrow('at least 6 players');
});

test('a match short of players can be abandoned but not scored; participantIds must match the rosters', async () => {
  const b = await signedIn();
  const m = Object.values(seed.matches).find((x) => x.status === 'live' && x.scorerId === 'seed1') ?? Object.values(seed.matches)[0];
  const teamA = { ...m.teamA, players: m.teamA.players.slice(0, 5) };
  const id = await b.createMatch({ ...m, teamA, status: 'scheduled', events: [], participantIds: orderedParticipants(teamA, m.teamB, [m.createdBy, m.scorerId]) } as never);
  // legacy: make it live with a rally (as old data could be)
  (b as unknown as { db: { matches: Record<string, { status: string; events: unknown[] }> } }).db.matches[id].status = 'live';
  (b as unknown as { db: { matches: Record<string, { status: string; events: unknown[] }> } }).db.matches[id].events = [{ type: 'point', side: 'A', at: 1 }];
  await expect(b.updateMatch(id, { status: 'live', title: 'x' })).rejects.toThrow('at least 6 players');
  await expect(b.updateMatch(id, { status: 'abandoned' })).resolves.toBeUndefined();
  await expect(b.createMatch({ ...m, participantIds: [...m.participantIds, 'stranger'] } as never)).rejects.toThrow('Participants must be');
});
