/**
 * Security rules tests (run against the Firebase emulator):
 *   cd rules-tests && npm install && npm test
 */
const fs = require('fs');
const path = require('path');
const { initializeTestEnvironment, assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');
const { doc, getDoc, setDoc, updateDoc, deleteDoc, collection, getDocs, addDoc, arrayUnion, arrayRemove, serverTimestamp, deleteField } = require('firebase/firestore');
const { ref, uploadBytes } = require('firebase/storage');

let env;
const hostPort = (v, port) => (v ? { host: v.split(':')[0], port: Number(v.split(':')[1]) } : { host: '127.0.0.1', port });
const PHONES = { cap: '+919000000001', bob: '+919000000002', eve: '+919000000003' };
const ctx = (uid) => env.authenticatedContext(uid, { phone_number: PHONES[uid] });

// Team rosters: t1 = cap + p1..p5, t2 = eve + q1..q5 (6 members each, MIN_PLAYERS).
const T1 = ['cap', 'p1', 'p2', 'p3', 'p4', 'p5'];
const T2 = ['eve', 'q1', 'q2', 'q3', 'q4', 'q5'];
const side = (teamId, ids, name = teamId || 'Built') => ({ teamId, name, color: '#123456', players: ids.map((id) => ({ id, name: id.toUpperCase() })) });
// participantIds in the order the rules expect: team A, team B, then creator/scorer.
const ordered = (a, b, extra = []) => [...new Set([...a, ...b, ...extra])];
const RULES = { preset: 'indoor', bestOf: 5, pointsPerSet: 25, decidingSetPoints: 15, winBy: 2, pointCap: null, timeoutsPerSet: 2, sideSwitchEvery: null, decidingSideSwitchEvery: null, decidingSwitchAt: 8 };
// Every new match carries the empty summary (required since 1.2.1, QA NB-R1).
const EMPTY_SUMMARY = { setsA: 0, setsB: 0, currentA: 0, currentB: 0, setScores: [], winner: null, serving: 'A' };
const matchDoc = (a, b, over = {}) => ({
  createdBy: 'cap', scorerId: 'cap', status: 'scheduled', events: [], interestedIds: [], rules: RULES, firstServe: 'A', summary: EMPTY_SUMMARY,
  teamA: side(a.teamId ?? null, a.ids), teamB: side(b.teamId ?? null, b.ids),
  participantIds: ordered(a.ids, b.ids, ['cap']),
  // 1.3.0: captains (a registered team's captain, else a player named by the creator): first player of each side.
  ...(a.ids.length && b.ids.length ? { captains: { A: a.ids[0], B: b.ids[0] } } : {}),
  ...over,
});
// 1.3.0: everyone the suites act as has accepted the current T&C (the gate is tested below).
const TERMS_VERSION = '2026-10-draft-1';
const TERMS_UIDS = ['cap', 'bob', 'eve', 'zz', 'good', 'old', 'p1', 'p2', 'p3', 'p4', 'p5', 'q1', 'q2', 'q3', 'q4', 'q5',
  'u1', 'u2', 'u3', 'u4', 'u5', 'u6', 'w1', 'w2', 'w3', 'w4', 'w5', 'w6', 'bad0', 'bad1', 'bad2', 'bad3', 'bad4', 'bad5'];
// (1.3.0) match photos are create-only and the storage emulator remembers deleted objects across
// clearStorage(), so file names are unique per run.
const RUN = Date.now().toString(36);
const PLACE = { name: 'Siri Fort', lat: 28.55, lng: 77.22 };
const DAY = 86400000;
const photoUrl = (p, bucket = 'demo-volleylive.appspot.com') => `https://firebasestorage.googleapis.com/v0/b/${bucket}/o/${encodeURIComponent(p)}?alt=media&token=0b1c2d3e`;
// A challenge as firebaseBackend writes it (names copied from the team docs, QA G19).
const challengeDoc = (over = {}) => ({
  fromTeamId: 't1', fromTeamName: 'Smashers', fromCaptainId: 'cap', toTeamId: 't2', toTeamName: 'Blockers', toCaptainId: 'eve',
  status: 'pending', when: Date.now() + DAY, location: PLACE, message: '', rules: RULES, matchId: null, createdAt: Date.now(), ...over,
});
const newMatch = (data) => setDoc(doc(ctx('cap').firestore(), `matches/n${Math.random().toString(36).slice(2)}`), data);

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-volleylive',
    // emulators:exec sets *_EMULATOR_HOST (so a run on other ports works too); defaults as in firebase.json.
    firestore: { rules: fs.readFileSync(path.join(__dirname, '../firestore.rules'), 'utf8'), ...hostPort(process.env.FIRESTORE_EMULATOR_HOST, 8080) },
    storage: { rules: fs.readFileSync(path.join(__dirname, '../storage.rules'), 'utf8'), ...hostPort(process.env.FIREBASE_STORAGE_EMULATOR_HOST, 9199) },
  });
});
afterAll(() => env.cleanup());
beforeEach(async () => {
  await env.clearFirestore();
  // (1.3.0) uploads are create-only (resource == null): start each test with an empty bucket so a
  // re-run against the same emulator doesn't see the previous run's files.
  await env.clearStorage();
  await env.withSecurityRulesDisabled(async (c) => {
    const db = c.firestore();
    await setDoc(doc(db, 'teams/t1'), { name: 'Smashers', captainId: 'cap', memberIds: T1, subIds: [], pendingPhones: [PHONES.bob] });
    await setDoc(doc(db, 'teams/t2'), { name: 'Blockers', captainId: 'eve', memberIds: T2, subIds: [], pendingPhones: [] });
    await setDoc(doc(db, 'teams/tsolo'), { name: 'Solo', captainId: 'eve', memberIds: ['eve'], subIds: [], pendingPhones: [] });
    await setDoc(doc(db, 'matches/m1'), matchDoc({ teamId: 't1', ids: T1 }, { teamId: 't2', ids: T2 }, { status: 'live' }));
    // registered profiles for everyone the tests put in by-number sides
    const seeded = [...T1, ...T2, 'bob', 'u1', 'u2', 'u3', 'u4', 'u5', 'u6', 'w1', 'w2', 'w3', 'w4', 'w5', 'w6'];
    for (const [i, id] of seeded.entries()) {
      await setDoc(doc(db, `users/${id}`), { name: id, phone: PHONES[id] ?? `+9190001${String(i).padStart(5, '0')}` });
    }
    for (const id of TERMS_UIDS) await setDoc(doc(db, `terms/${id}`), { version: TERMS_VERSION, acceptedAt: new Date() });
  });
});

describe('users & phone index', () => {
  test('can create own profile with own verified phone', async () => {
    await assertSucceeds(setDoc(doc(ctx('bob').firestore(), 'users/bob'), { name: 'Bob', phone: PHONES.bob }));
  });
  test('cannot claim another number', async () => {
    await assertFails(setDoc(doc(ctx('bob').firestore(), 'users/bob'), { name: 'Bob', phone: PHONES.eve }));
    await assertFails(setDoc(doc(ctx('bob').firestore(), `phoneIndex/${PHONES.eve}`), { uid: 'bob' }));
  });
  test('phone lookup is get-only', async () => {
    const db = ctx('bob').firestore();
    await assertSucceeds(setDoc(doc(db, `phoneIndex/${PHONES.bob}`), { uid: 'bob' }));
    await assertSucceeds(getDoc(doc(ctx('eve').firestore(), `phoneIndex/${PHONES.bob}`)));
    await assertFails(getDocs(collection(ctx('eve').firestore(), 'phoneIndex')));
  });
  test('push tokens are private', async () => {
    await assertSucceeds(setDoc(doc(ctx('bob').firestore(), 'pushTokens/bob'), { token: 'x' }));
    await assertFails(getDoc(doc(ctx('eve').firestore(), 'pushTokens/bob')));
  });
});

describe('phone numbers: Indian mobiles only, ^\\+91[6-9]\\d{9}$ (QA G6)', () => {
  const BAD = ['+9198765432101', '+91987654321', '+915876543210', '+910876543210', '+16505551234', '9876543210'];
  const as = (uid, phone) => env.authenticatedContext(uid, { phone_number: phone });
  test('profile and phone index: deny malformed numbers (even when the token carries them)', async () => {
    for (const [i, phone] of BAD.entries()) {
      const db = as(`bad${i}`, phone).firestore();
      await assertFails(setDoc(doc(db, `users/bad${i}`), { name: 'Bad', phone }));
      await assertFails(setDoc(doc(db, `phoneIndex/${phone}`), { uid: `bad${i}` }));
    }
  });
  test('profile and phone index: allow a valid number', async () => {
    const db = as('good', '+916000000001').firestore();
    await assertSucceeds(setDoc(doc(db, 'users/good'), { name: 'Good', phone: '+916000000001' }));
    await assertSucceeds(setDoc(doc(db, 'phoneIndex/+916000000001'), { uid: 'good' }));
  });
  test('invites: deny a malformed number even if it is in phoneIndex; allow a valid registered one', async () => {
    await env.withSecurityRulesDisabled(async (c) => {
      await setDoc(doc(c.firestore(), 'phoneIndex/+9198765432101'), { uid: 'legacy' });
      await setDoc(doc(c.firestore(), `phoneIndex/${PHONES.eve}`), { uid: 'eve' });
    });
    await assertFails(updateDoc(doc(ctx('cap').firestore(), 'teams/t1'), { pendingPhones: arrayUnion('+9198765432101') }));
    await assertSucceeds(updateDoc(doc(ctx('cap').firestore(), 'teams/t1'), { pendingPhones: arrayUnion(PHONES.eve) }));
  });
});

describe('teams: only captains edit', () => {
  test('captain can invite a registered number', async () => {
    await env.withSecurityRulesDisabled((c) => setDoc(doc(c.firestore(), `phoneIndex/${PHONES.eve}`), { uid: 'eve' }));
    await assertSucceeds(updateDoc(doc(ctx('cap').firestore(), 'teams/t1'), { pendingPhones: arrayUnion(PHONES.eve) }));
  });
  test('captain cannot invite an unregistered number', async () => {
    await assertFails(updateDoc(doc(ctx('cap').firestore(), 'teams/t1'), { pendingPhones: arrayUnion('+919811111111') }));
  });
  test('captain cannot sneak in two numbers at once', async () => {
    await env.withSecurityRulesDisabled((c) => setDoc(doc(c.firestore(), `phoneIndex/${PHONES.eve}`), { uid: 'eve' }));
    await assertFails(
      updateDoc(doc(ctx('cap').firestore(), 'teams/t1'), { pendingPhones: [PHONES.bob, '+919811111111', PHONES.eve] }),
    );
  });
  test('captain can still edit the team without inviting', async () => {
    await assertSucceeds(updateDoc(doc(ctx('cap').firestore(), 'teams/t1'), { name: 'Smashers 2' }));
  });
  test('team cannot be created with pre-filled invites', async () => {
    await assertFails(
      setDoc(doc(ctx('bob').firestore(), 'teams/t5'), { name: 'Bees', captainId: 'bob', memberIds: ['bob'], subIds: [], pendingPhones: ['+919811111111'] }),
    );
  });
  test('captain cannot add members directly (they must accept an invite)', async () => {
    await assertFails(updateDoc(doc(ctx('cap').firestore(), 'teams/t1'), { memberIds: arrayUnion('bob') }));
    await assertSucceeds(updateDoc(doc(ctx('cap').firestore(), 'teams/t1'), { memberIds: arrayRemove('p5') }));
  });
  test('non-captain cannot edit team', async () => {
    await assertFails(updateDoc(doc(ctx('eve').firestore(), 'teams/t1'), { name: 'Hacked' }));
    await assertFails(updateDoc(doc(ctx('eve').firestore(), 'teams/t1'), { memberIds: arrayUnion('eve') }));
  });
  test('invited player (matching phone) can accept', async () => {
    await assertSucceeds(
      updateDoc(doc(ctx('bob').firestore(), 'teams/t1'), { memberIds: arrayUnion('bob'), pendingPhones: arrayRemove(PHONES.bob) }),
    );
  });
  test('invited player cannot add others while accepting', async () => {
    await assertFails(
      updateDoc(doc(ctx('bob').firestore(), 'teams/t1'), { memberIds: ['cap', 'bob', 'eve'], pendingPhones: [] }),
    );
  });
  test('invited player can decline', async () => {
    await assertSucceeds(updateDoc(doc(ctx('bob').firestore(), 'teams/t1'), { pendingPhones: arrayRemove(PHONES.bob) }));
  });
  test('team must be created with self as captain', async () => {
    await assertSucceeds(setDoc(doc(ctx('bob').firestore(), 'teams/t3'), { name: 'Bees', captainId: 'bob', memberIds: ['bob'], subIds: [], pendingPhones: [] }));
    await assertFails(setDoc(doc(ctx('bob').firestore(), 'teams/t4'), { name: 'Bees', captainId: 'cap', memberIds: ['cap'], subIds: [], pendingPhones: [] }));
  });
});

describe('matches: only the assigned scorer changes the score', () => {
  test('scorer can update events', async () => {
    await assertSucceeds(updateDoc(doc(ctx('cap').firestore(), 'matches/m1'), { events: [{ type: 'point', side: 'A', at: 1 }] }));
  });
  test('other participant cannot update score', async () => {
    await assertFails(updateDoc(doc(ctx('bob').firestore(), 'matches/m1'), { events: [{ type: 'point', side: 'B', at: 1 }] }));
  });
  test('scorer can save the starting lineup; nobody else can', async () => {
    const lineups = { 1: { A: ['cap', 'p1', 'p2', 'p3', 'p4', 'p5'], B: T2 } };
    await assertSucceeds(updateDoc(doc(ctx('cap').firestore(), 'matches/m1'), { lineups }));
    // (a different value – an identical no-op write changes nothing and is harmless)
    const other = { 1: { A: ['p1', 'cap', 'p2', 'p3', 'p4', 'p5'], B: T2 } };
    await assertFails(updateDoc(doc(ctx('p1').firestore(), 'matches/m1'), { lineups: other }));
    await assertFails(updateDoc(doc(ctx('eve').firestore(), 'matches/m1'), { lineups: other }));
  });
  test('creator can hand over scoring, then loses score access', async () => {
    await assertSucceeds(updateDoc(doc(ctx('cap').firestore(), 'matches/m1'), { scorerId: 'p1' }));
    await assertFails(updateDoc(doc(ctx('cap').firestore(), 'matches/m1'), { events: [{ type: 'point', side: 'A', at: 2 }] }));
    await assertSucceeds(updateDoc(doc(ctx('p1').firestore(), 'matches/m1'), { events: [] }));
  });
  test('stranger can only toggle themselves as interested', async () => {
    await assertSucceeds(updateDoc(doc(ctx('eve').firestore(), 'matches/m1'), { interestedIds: ['eve'] }));
    await assertFails(updateDoc(doc(ctx('eve').firestore(), 'matches/m1'), { interestedIds: ['eve', 'bob'] }));
    await assertFails(updateDoc(doc(ctx('eve').firestore(), 'matches/m1'), { scorerId: 'eve' }));
  });
  test('photos only by players of the match (or its scorer)', async () => {
    await assertSucceeds(addDoc(collection(ctx('p1').firestore(), 'matches/m1/photos'), { uploadedBy: 'p1', url: photoUrl('matches/m1/p1/1.jpg') }));
    await assertFails(addDoc(collection(ctx('bob').firestore(), 'matches/m1/photos'), { uploadedBy: 'bob', url: photoUrl('matches/m1/bob/1.jpg') }));
  });
});

describe('matches: registered players only', () => {
  const BUILT_A = ['u1', 'u2', 'u3', 'u4', 'u5', 'u6'];
  const BUILT_B = ['w1', 'w2', 'w3', 'w4', 'w5', 'w6'];
  test('MIN_PLAYERS in src/core/roster.ts matches minPlayers() in firestore.rules', () => {
    const code = fs.readFileSync(path.join(__dirname, '../src/core/roster.ts'), 'utf8');
    const rules = fs.readFileSync(path.join(__dirname, '../firestore.rules'), 'utf8');
    const min = Number(/export const MIN_PLAYERS = (\d+);/.exec(code)[1]);
    expect(Number(/function minPlayers\(\) \{ return (\d+); \}/.exec(rules)[1])).toBe(min);
  });
  test('registered teams and by-number sides can be created', async () => {
    await assertSucceeds(newMatch(matchDoc({ teamId: 't1', ids: T1 }, { teamId: 't2', ids: T2 })));
    await assertSucceeds(newMatch(matchDoc({ ids: BUILT_A }, { ids: ['cap', ...BUILT_B] }, { status: 'live' })));
  });
  test('typed names / guest ids are rejected', async () => {
    await assertFails(newMatch(matchDoc({ ids: ['cap', 'Rahul K', 'u2', 'u3', 'u4', 'u5'] }, { ids: BUILT_B })));
    await assertFails(newMatch(matchDoc({ ids: ['cap', 'guest:1', 'u2', 'u3', 'u4', 'u5'] }, { ids: BUILT_B })));
  });
  test('full 12 v 12 rosters from registered teams fit within the rules limits', async () => {
    const big = (k) => Array.from({ length: 12 }, (_, i) => `${k}${i}`);
    const A = ['cap', ...big('a').slice(1)];
    const B = big('b');
    await env.withSecurityRulesDisabled(async (c) => {
      await setDoc(doc(c.firestore(), 'teams/big1'), { name: 'Big 1', captainId: 'cap', memberIds: A, subIds: [], pendingPhones: [] });
      await setDoc(doc(c.firestore(), 'teams/big2'), { name: 'Big 2', captainId: 'b0', memberIds: B, subIds: [], pendingPhones: [] });
    });
    await assertSucceeds(newMatch(matchDoc({ teamId: 'big1', ids: A }, { teamId: 'big2', ids: B }, { status: 'live' })));
    // and the scorer's roster update (the costliest update) also fits
    await env.withSecurityRulesDisabled((c) => setDoc(doc(c.firestore(), 'matches/big'), matchDoc({ teamId: 'big1', ids: A.slice(0, 11) }, { teamId: 'big2', ids: B })));
    // (1.3.0: going live is its own write, stamping the server start; firebaseBackend never combines it with a roster change)
    const bigRef = doc(ctx('cap').firestore(), 'matches/big');
    await assertSucceeds(updateDoc(bigRef, { teamA: side('big1', A), participantIds: ordered(A, B, ['cap']) }));
    await assertFails(updateDoc(bigRef, { status: 'live' })); // no server start (QA N121-3)
    await assertSucceeds(updateDoc(bigRef, { status: 'live', startedAt: Date.now(), startedServerAt: serverTimestamp() }));
  });
  test('more than 12 players on a team is rejected', async () => {
    const thirteen = Array.from({ length: 13 }, (_, i) => `x${i}`);
    await assertFails(newMatch(matchDoc({ ids: thirteen }, { ids: BUILT_B })));
  });
  test('a player twice, or on both teams, is rejected', async () => {
    await assertFails(newMatch(matchDoc({ ids: ['cap', 'u1', 'u1', 'u3', 'u4', 'u5'] }, { ids: BUILT_B })));
    await assertFails(newMatch(matchDoc({ ids: ['cap', ...BUILT_A] }, { ids: ['u1', ...BUILT_B] })));
  });
  test('participantIds must list exactly the players (plus creator/scorer)', async () => {
    const d = matchDoc({ ids: BUILT_A }, { ids: BUILT_B });
    await assertFails(newMatch({ ...d, participantIds: [...d.participantIds, 'stranger'] }));
    await assertFails(newMatch({ ...d, participantIds: [...d.participantIds].reverse() }));
  });
  test('participantIds order is fixed: B-then-A is rejected, the canonical A, B, creator order every backend writes passes (fix-retest #5)', async () => {
    const d = matchDoc({ ids: BUILT_A }, { ids: BUILT_B });
    await assertFails(newMatch({ ...d, participantIds: [...BUILT_B, ...BUILT_A, 'cap'] }));
    await assertFails(newMatch({ ...d, participantIds: ['cap', ...BUILT_A, ...BUILT_B] }));
    // what canonicalParticipants() (core/roster.ts) produces for the same set
    await assertSucceeds(newMatch({ ...d, participantIds: [...BUILT_A, ...BUILT_B, 'cap'] }));
  });
  test('a registered team side may only list that team\'s members', async () => {
    await assertFails(newMatch(matchDoc({ teamId: 't1', ids: ['cap', 'p1', 'p2', 'p3', 'p4', 'bob'] }, { teamId: 't2', ids: T2 })));
    await assertFails(newMatch(matchDoc({ teamId: 'nope', ids: BUILT_A }, { ids: ['cap', ...BUILT_B] })));
  });
  test('fewer than 6 players: may be scheduled, but cannot go live or record points', async () => {
    const five = ['cap', 'u2', 'u3', 'u4', 'u5'];
    await assertFails(newMatch(matchDoc({ ids: five }, { ids: BUILT_B }, { status: 'live' })));
    await env.withSecurityRulesDisabled((c) => setDoc(doc(c.firestore(), 'matches/small'), matchDoc({ ids: five }, { ids: BUILT_B })));
    await assertSucceeds(newMatch(matchDoc({ ids: five }, { ids: BUILT_B })));
    await assertFails(updateDoc(doc(ctx('cap').firestore(), 'matches/small'), { status: 'live' }));
    await assertFails(updateDoc(doc(ctx('cap').firestore(), 'matches/small'), { events: [{ type: 'point', side: 'A', at: 1 }] }));
    // adding a sixth player before the first rally is fine, then scoring can start
    const a = ['cap', 'u2', 'u3', 'u4', 'u5', 'u6'];
    await assertSucceeds(updateDoc(doc(ctx('cap').firestore(), 'matches/small'), { teamA: side(null, a, 'Built'), participantIds: ordered(a, BUILT_B, ['cap']) }));
    await assertSucceeds(updateDoc(doc(ctx('cap').firestore(), 'matches/small'), { status: 'live', startedAt: Date.now(), startedServerAt: serverTimestamp() }));
  });
  test('by-number sides: the first players must have a profile (QA retest #4)', async () => {
    const ghostFirst = ['ghost', 'u2', 'u3', 'u4', 'u5', 'u6'];
    await assertFails(newMatch(matchDoc({ ids: ghostFirst }, { ids: ['cap', ...BUILT_B] })));
    const ghostFourth = ['u1', 'u2', 'u3', 'ghost', 'u5', 'u6'];
    await assertFails(newMatch(matchDoc({ ids: ghostFourth }, { ids: ['cap', ...BUILT_B] })));
    // documented gap: players 5+ of a by-number side are format-checked only (the app checks them all)
    const ghostSixth = ['u1', 'u2', 'u3', 'u4', 'u5', 'ghost'];
    await assertSucceeds(newMatch(matchDoc({ ids: ghostSixth }, { ids: ['cap', ...BUILT_B] })));
  });
  test('worst case read budget: two by-number 12-player sides still fit', async () => {
    const big = (k) => Array.from({ length: 12 }, (_, i) => `${k}${i}`);
    await env.withSecurityRulesDisabled(async (c) => {
      for (const id of [...big('a').slice(0, 4), ...big('b').slice(0, 4)]) await setDoc(doc(c.firestore(), `users/${id}`), { name: id, phone: '+919800000000' });
    });
    await assertSucceeds(newMatch(matchDoc({ ids: big('a') }, { ids: big('b') })));
  });
  test('a legacy live match short of players can be abandoned by its scorer only (QA retest #2)', async () => {
    const five = ['cap', 'u2', 'u3', 'u4', 'u5'];
    await env.withSecurityRulesDisabled((c) =>
      setDoc(doc(c.firestore(), 'matches/legacy'), matchDoc({ ids: five }, { ids: BUILT_B }, { status: 'live', events: [{ type: 'point', side: 'A', at: 1 }] })),
    );
    const ref = (who) => doc(ctx(who).firestore(), 'matches/legacy');
    await assertFails(updateDoc(ref('cap'), { events: [{ type: 'point', side: 'A', at: 1 }, { type: 'point', side: 'B', at: 2 }] }));
    await assertFails(updateDoc(ref('cap'), { status: 'abandoned', title: 'x' }));
    await assertFails(updateDoc(ref('cap'), { status: 'finished' }));
    await assertFails(updateDoc(ref('bob'), { status: 'abandoned' }));
    await assertSucceeds(updateDoc(ref('cap'), { status: 'abandoned', finishedAt: 5, updatedAt: 5 }));
    await assertFails(updateDoc(ref('cap'), { events: [{ type: 'point', side: 'A', at: 1 }, { type: 'point', side: 'B', at: 2 }] }));
  });
  test('the scorer cannot rewrite rosters after the first rally', async () => {
    const ref = doc(ctx('cap').firestore(), 'matches/m1');
    await assertSucceeds(updateDoc(ref, { events: [{ type: 'point', side: 'A', at: 1 }] }));
    const t1 = ['cap', 'p1', 'p2', 'p3', 'p4'];
    await assertFails(updateDoc(ref, { teamA: side('t1', t1), participantIds: ordered(t1, T2, ['cap']) }));
    await assertFails(updateDoc(ref, { teamA: { ...side('t1', T1), name: 'Renamed' } }));
  });
});

describe('challenges', () => {
  test('captain challenges, other captain accepts', async () => {
    const c = challengeDoc();
    await assertSucceeds(setDoc(doc(ctx('cap').firestore(), 'challenges/c1'), c));
    await assertFails(setDoc(doc(ctx('bob').firestore(), 'challenges/c2'), { ...c, fromCaptainId: 'bob' }));
    await assertFails(updateDoc(doc(ctx('cap').firestore(), 'challenges/c1'), { status: 'accepted' }));
    await assertSucceeds(updateDoc(doc(ctx('eve').firestore(), 'challenges/c1'), { status: 'accepted', matchId: 'm9' }));
  });
  test('a team with fewer than 6 members cannot challenge or be challenged', async () => {
    const c = challengeDoc({ toTeamId: 'tsolo', toTeamName: 'Solo' });
    await assertFails(setDoc(doc(ctx('cap').firestore(), 'challenges/c3'), c));
  });
  test('cannot accept once a team has dropped below 6 members', async () => {
    await env.withSecurityRulesDisabled((c) =>
      setDoc(doc(c.firestore(), 'challenges/c4'), { fromTeamId: 't1', fromCaptainId: 'cap', toTeamId: 'tsolo', toCaptainId: 'eve', status: 'pending' }),
    );
    await assertFails(updateDoc(doc(ctx('eve').firestore(), 'challenges/c4'), { status: 'accepted', matchId: 'm9' }));
    await assertSucceeds(updateDoc(doc(ctx('eve').firestore(), 'challenges/c4'), { status: 'declined' }));
  });
});

describe('tournaments: registered teams with enough players (QA retest #4)', () => {
  const tour = (teams) => ({ name: 'Cup', organizerId: 'cap', format: 'knockout', rules: RULES, startDate: Date.now() + DAY, endDate: Date.now() + 2 * DAY, location: PLACE, teams: teams.map((id) => ({ id, name: id, color: '#123456' })), fixtures: [], status: 'registration' });
  test('create checks every team (up to 10)', async () => {
    await assertSucceeds(setDoc(doc(ctx('cap').firestore(), 'tournaments/ok'), tour(['t1', 't2'])));
    await assertFails(setDoc(doc(ctx('cap').firestore(), 'tournaments/solo'), tour(['t1', 'tsolo'])));
    await assertFails(setDoc(doc(ctx('cap').firestore(), 'tournaments/ext'), tour(['t1', 'ext_1'])));
    await assertFails(setDoc(doc(ctx('cap').firestore(), 'tournaments/one'), tour(['t1'])));
  });
  test('10 teams fit in the read budget', async () => {
    const ids = Array.from({ length: 10 }, (_, i) => `big${i}`);
    await env.withSecurityRulesDisabled(async (c) => {
      for (const id of ids) await setDoc(doc(c.firestore(), `teams/${id}`), { name: id, captainId: 'cap', memberIds: T1, subIds: [], pendingPhones: [] });
    });
    await assertSucceeds(setDoc(doc(ctx('cap').firestore(), 'tournaments/ten'), tour(ids)));
  });
  test('updates re-check teams only when they change', async () => {
    await env.withSecurityRulesDisabled((c) => setDoc(doc(c.firestore(), 'tournaments/t'), tour(['t1', 't2'])));
    await assertSucceeds(updateDoc(doc(ctx('cap').firestore(), 'tournaments/t'), { status: 'running' }));
    await assertFails(updateDoc(doc(ctx('cap').firestore(), 'tournaments/t'), { teams: tour(['t1', 'tsolo']).teams }));
    await assertFails(updateDoc(doc(ctx('eve').firestore(), 'tournaments/t'), { status: 'finished' }));
  });
});

describe('storage', () => {
  const img = new Uint8Array(120); // above every per-type minimum (1.2.1)
  test('participant can upload a match photo', async () => {
    await assertSucceeds(uploadBytes(ref(ctx('p1').storage(), `matches/m1/p1/a-${RUN}.jpg`), img, { contentType: 'image/jpeg' }));
  });
  test('non-participant or wrong folder or non-image denied', async () => {
    await assertFails(uploadBytes(ref(ctx('bob').storage(), `matches/m1/bob/a-${RUN}.jpg`), img, { contentType: 'image/jpeg' }));
    await assertFails(uploadBytes(ref(ctx('p1').storage(), `matches/m1/cap/a-${RUN}.jpg`), img, { contentType: 'image/jpeg' }));
    await assertFails(uploadBytes(ref(ctx('p1').storage(), `matches/m1/p1/a-${RUN}.txt`), img, { contentType: 'text/plain' }));
  });
});

describe('input validation (QA input-validation audit G1–G19, retest N4)', () => {
  const A = { teamId: 't1', ids: T1 };
  const B = { teamId: 't2', ids: T2 };
  const base = (over = {}) => matchDoc(A, B, { location: PLACE, scheduledAt: Date.now() + DAY, ...over });
  const scorer = () => doc(ctx('cap').firestore(), 'matches/m1');

  test('G1 match create: title length, status enum, first serve, rules shape, no extra keys, empty events', async () => {
    await assertSucceeds(newMatch(base({ title: 'x'.repeat(120) })));
    await assertSucceeds(newMatch(base({ title: 'मानसून कप फ़ाइनल' })));
    await assertFails(newMatch(base({ title: 'x'.repeat(121) })));
    await assertFails(newMatch(base({ status: 'hacked' })));
    await assertFails(newMatch(base({ status: 'finished' })));
    await assertFails(newMatch(base({ firstServe: 'C' })));
    await assertFails(newMatch(base({ isAdmin: true })));
    await assertFails(newMatch(base({ events: [{ type: 'point', side: 'A', at: Date.now() }] })));
    await assertFails(newMatch(base({ rules: { ...RULES, pointsPerSet: 0 } })));
    await assertFails(newMatch(base({ rules: { ...RULES, pointsPerSet: 1000 } })));
    await assertFails(newMatch(base({ rules: { ...RULES, bestOf: 4 } })));
    await assertFails(newMatch(base({ rules: { ...RULES, decidingSwitchAt: 20 } }))); // > decidingSetPoints
    await assertFails(newMatch(base({ rules: { ...RULES, extra: 1 } })));
  });
  test('G1/G15 side names: 40 max, no control/bidi characters', async () => {
    const named = (name) => base({ teamA: { ...side('t1', T1), name } });
    await assertSucceeds(newMatch(named('x'.repeat(40))));
    await assertFails(newMatch(named('x'.repeat(41))));
    await assertFails(newMatch(named('Smash\u202Eers')));
    await assertFails(newMatch(named('Smash\u0007ers')));
    await assertFails(newMatch(named(' Smashers')));
  });
  test('G1 events: side A/B only, sane timestamps, capped at 2000', async () => {
    await assertSucceeds(updateDoc(scorer(), { events: [{ type: 'point', side: 'A', at: Date.now() }] }));
    await assertFails(updateDoc(scorer(), { events: [{ type: 'point', side: 'C', at: Date.now() }] }));
    await assertFails(updateDoc(scorer(), { events: [{ type: 'point', side: 'A', at: Date.now() + 3 * DAY }] }));
    const many = Array.from({ length: 2001 }, (_, i) => ({ type: 'point', side: i % 2 ? 'A' : 'B', at: Date.now() }));
    await assertFails(updateDoc(scorer(), { events: many }));
  });
  test('G9 a new scheduled match cannot start in the past (15 min grace)', async () => {
    await assertFails(newMatch(base({ scheduledAt: Date.now() - DAY })));
    await assertSucceeds(newMatch(base({ scheduledAt: Date.now() - 5 * 60000 })));
  });
  test('G13 finish ≥ start', async () => {
    await assertFails(updateDoc(scorer(), { startedAt: Date.now(), finishedAt: Date.now() - DAY }));
  });

  test('G3 photo URLs: https on this project’s storage host, own folder only', async () => {
    const db = ctx('bob').firestore();
    await assertSucceeds(setDoc(doc(db, 'users/bob'), { name: 'Bob', phone: PHONES.bob, photoURL: photoUrl('avatars/bob/a.jpg') }));
    await assertFails(setDoc(doc(db, 'users/bob'), { name: 'Bob', phone: PHONES.bob, photoURL: 'https://evil.example/a.jpg' }));
    await assertFails(setDoc(doc(db, 'users/bob'), { name: 'Bob', phone: PHONES.bob, photoURL: 'javascript:alert(1)' }));
    await assertFails(setDoc(doc(db, 'users/bob'), { name: 'Bob', phone: PHONES.bob, photoURL: photoUrl('avatars/eve/a.jpg') }));
    await assertFails(setDoc(doc(db, 'users/bob'), { name: 'Bob', phone: PHONES.bob, photoURL: photoUrl('avatars/bob/a.jpg', 'other-project.appspot.com') }));
    await assertFails(addDoc(collection(ctx('p1').firestore(), 'matches/m1/photos'), { uploadedBy: 'p1', url: 'https://evil.example/x.jpg' }));
    await assertFails(addDoc(collection(ctx('p1').firestore(), 'matches/m1/photos'), { uploadedBy: 'p1', url: photoUrl('matches/m1/cap/1.jpg') }));
  });

  test('G7 profiles: allowed keys, trimmed names 2–60 (Hindi ok), city ≤ 80, no role field', async () => {
    const db = ctx('bob').firestore();
    await assertSucceeds(setDoc(doc(db, 'users/bob'), { name: 'आरव शर्मा', phone: PHONES.bob, city: 'नई दिल्ली' }));
    await assertFails(setDoc(doc(db, 'users/bob'), { name: 'Bob', phone: PHONES.bob, role: 'admin' }));
    await assertFails(setDoc(doc(db, 'users/bob'), { name: ' Bob', phone: PHONES.bob }));
    await assertFails(setDoc(doc(db, 'users/bob'), { name: 'B', phone: PHONES.bob }));
    await assertFails(setDoc(doc(db, 'users/bob'), { name: 'x'.repeat(61), phone: PHONES.bob }));
    await assertFails(setDoc(doc(db, 'users/bob'), { name: 'Bo\u200Bb\u202E', phone: PHONES.bob }));
    await assertFails(setDoc(doc(db, 'users/bob'), { name: 'Bob', phone: PHONES.bob, city: '   ' })); // B3: stored as '' by the app
    await assertSucceeds(setDoc(doc(db, 'users/bob'), { name: 'Bob', phone: PHONES.bob, city: '' }));
  });
  test('G7 teams and courts: names, keys, coordinates', async () => {
    const db = ctx('bob').firestore();
    const team = (over) => ({ name: 'Bees', captainId: 'bob', memberIds: ['bob'], subIds: [], pendingPhones: [], ...over });
    await assertSucceeds(setDoc(doc(db, 'teams/tb'), team()));
    await assertFails(setDoc(doc(db, 'teams/tb2'), team({ name: 'x'.repeat(41) })));
    await assertFails(setDoc(doc(db, 'teams/tb3'), team({ name: 'B' })));
    await assertFails(setDoc(doc(db, 'teams/tb4'), team({ admin: true })));
    const court = (over) => ({ name: 'Siri Fort Court', location: PLACE, surface: 'indoor', addedBy: 'bob', createdAt: Date.now(), ...over });
    await assertSucceeds(setDoc(doc(db, 'courts/c1'), court()));
    await assertFails(setDoc(doc(db, 'courts/c2'), court({ location: { ...PLACE, lat: 91 } })));
    await assertFails(setDoc(doc(db, 'courts/c3'), court({ location: { ...PLACE, lng: -181 } })));
    await assertFails(setDoc(doc(db, 'courts/c4'), court({ name: 'x'.repeat(81) })));
    await assertFails(setDoc(doc(db, 'courts/c5'), court({ verified: true })));
    await assertFails(setDoc(doc(db, 'courts/c6'), court({ surface: 'lava' })));
  });

  test('G8 tournaments: end ≥ start, ≥ 2 distinct teams, start not in the past', async () => {
    const tour = (over) => ({ name: 'Monsoon Cup', organizerId: 'cap', format: 'knockout', rules: RULES, startDate: Date.now() + DAY, endDate: Date.now() + 2 * DAY, location: PLACE, teams: ['t1', 't2'].map((id) => ({ id, name: id, color: '#123456' })), fixtures: [], status: 'registration', ...over });
    const db = ctx('cap').firestore();
    await assertSucceeds(setDoc(doc(db, 'tournaments/ok'), tour()));
    await assertFails(setDoc(doc(db, 'tournaments/back'), tour({ endDate: Date.now() })));
    await assertFails(setDoc(doc(db, 'tournaments/past'), tour({ startDate: Date.now() - DAY, endDate: Date.now() + DAY })));
    await assertFails(setDoc(doc(db, 'tournaments/dup'), tour({ teams: ['t1', 't1'].map((id) => ({ id, name: id, color: '#123456' })) })));
    await assertFails(setDoc(doc(db, 'tournaments/nm'), tour({ name: 'Cu' })));
  });

  test('G9 / G19 challenges: not in the past; names are the team documents’ names', async () => {
    const db = ctx('cap').firestore();
    await assertSucceeds(setDoc(doc(db, 'challenges/ok'), challengeDoc()));
    await assertSucceeds(setDoc(doc(db, 'challenges/grace'), challengeDoc({ when: Date.now() - 5 * 60000 })));
    await assertFails(setDoc(doc(db, 'challenges/past'), challengeDoc({ when: Date.now() - DAY })));
    await assertFails(setDoc(doc(db, 'challenges/spoof'), challengeDoc({ fromTeamName: 'Fake Smashers' })));
    await assertFails(setDoc(doc(db, 'challenges/spoof2'), challengeDoc({ toTeamName: 'Fake' })));
    await assertFails(setDoc(doc(db, 'challenges/long'), challengeDoc({ message: 'x'.repeat(501) })));
    await assertSucceeds(setDoc(doc(db, 'challenges/multi'), challengeDoc({ message: 'Line one\nLine two' })));
  });

  test('N4 an account with a pre-216 non-Indian number can still save its profile unchanged; no new bad numbers', async () => {
    const legacy = '+16505551234';
    await env.withSecurityRulesDisabled(async (c) => {
      await setDoc(doc(c.firestore(), 'users/old'), { name: 'Old', phone: legacy });
      await setDoc(doc(c.firestore(), `phoneIndex/${legacy}`), { uid: 'old' });
    });
    const db = env.authenticatedContext('old', { phone_number: legacy }).firestore();
    await assertSucceeds(setDoc(doc(db, 'users/old'), { name: 'Old Timer', phone: legacy, city: 'Delhi' }));
    await assertSucceeds(setDoc(doc(db, `phoneIndex/${legacy}`), { uid: 'old' })); // its own entry, rewritten
    await assertFails(setDoc(doc(db, 'users/old'), { name: 'Old', phone: '+447700900123' }));
  });
});

describe('storage: image allow-list and size (QA G2)', () => {
  const up = (p, bytes, contentType) => uploadBytes(ref(ctx('bob').storage(), p), bytes, { contentType });
  test('jpeg/png/webp/heic/gif under 10 MB allowed; SVG, HTML, empty and 10 MB+ denied', async () => {
    const img = new Uint8Array(120);
    img.set([0xff, 0xd8, 0xff, 0xe0]);
    for (const t of ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/gif']) await assertSucceeds(up('avatars/bob/a', img, t));
    await assertFails(up('avatars/bob/a.svg', new TextEncoder().encode('<svg/>'), 'image/svg+xml'));
    await assertFails(up('avatars/bob/a.html', new TextEncoder().encode('<html>'), 'text/html'));
    await assertFails(up('avatars/bob/empty.jpg', new Uint8Array(0), 'image/jpeg'));
    await assertFails(up('avatars/bob/big.jpg', new Uint8Array(10 * 1024 * 1024), 'image/jpeg'));
    await assertFails(uploadBytes(ref(ctx('eve').storage(), 'avatars/bob/a.jpg'), img, { contentType: 'image/jpeg' }));
  });
});

describe('build 27: match photos by players + scorer; Player of the Match', () => {
  // m2: created by bob (not playing), scored by zz (not playing); players T1 v T2.
  const seedM2 = (over = {}) =>
    env.withSecurityRulesDisabled((c) =>
      setDoc(doc(c.firestore(), 'matches/m2'), matchDoc({ teamId: 't1', ids: T1 }, { teamId: 't2', ids: T2 }, {
        createdBy: 'bob', scorerId: 'zz', participantIds: ordered(T1, T2, ['bob', 'zz']), status: 'live', ...over,
      })),
    );
  const finishedAt = () => Date.now() - 60 * 1000;
  // m3: finished a minute ago, scored by cap (who also plays for t1).
  const seedFinished = (id, over = {}) =>
    env.withSecurityRulesDisabled((c) =>
      setDoc(doc(c.firestore(), `matches/${id}`), matchDoc({ teamId: 't1', ids: T1 }, { teamId: 't2', ids: T2 }, {
        status: 'finished', startedAt: Date.now() - 3600 * 1000, finishedAt: finishedAt(), events: [{ type: 'point', side: 'A', at: 1 }], ...over,
      })),
    );
  const img = new Uint8Array(120);

  test('photos: players and the scorer can add; the creator who does not play or score cannot', async () => {
    await seedM2();
    const add = (uid) => addDoc(collection(ctx(uid).firestore(), 'matches/m2/photos'), { matchId: 'm2', uploadedBy: uid, url: photoUrl(`matches/m2/${uid}/1.jpg`), storagePath: `matches/m2/${uid}/1.jpg`, createdAt: Date.now() });
    await assertSucceeds(add('zz')); // scorer
    await assertSucceeds(add('q1')); // team B
    await assertSucceeds(add('p5')); // team A
    await assertFails(add('bob')); // creator only
    await assertFails(add('u1')); // stranger
  });

  test('storage: same rule for the file itself', async () => {
    await seedM2();
    await assertSucceeds(uploadBytes(ref(ctx('zz').storage(), `matches/m2/zz/a-${RUN}.jpg`), img, { contentType: 'image/jpeg' }));
    await assertSucceeds(uploadBytes(ref(ctx('q5').storage(), `matches/m2/q5/a-${RUN}.jpg`), img, { contentType: 'image/jpeg' }));
    await assertFails(uploadBytes(ref(ctx('bob').storage(), `matches/m2/bob/a-${RUN}.jpg`), img, { contentType: 'image/jpeg' }));
    await assertFails(uploadBytes(ref(ctx('u1').storage(), `matches/m2/u1/a-${RUN}.jpg`), img, { contentType: 'image/jpeg' }));
  });

  test('POTM: the scorer sets it once on a finished match, to a player of the match', async () => {
    await seedFinished('m3');
    const m3 = (uid) => doc(ctx(uid).firestore(), 'matches/m3');
    await assertFails(updateDoc(m3('p1'), { playerOfMatchId: 'p1' })); // a player, not the scorer
    await assertFails(updateDoc(m3('eve'), { playerOfMatchId: 'eve' }));
    await assertFails(updateDoc(m3('cap'), { playerOfMatchId: 'bob' })); // not in the match
    await assertFails(updateDoc(m3('cap'), { playerOfMatchId: 'u1' }));
    await assertFails(updateDoc(m3('cap'), { playerOfMatchId: 42 }));
    await assertSucceeds(updateDoc(m3('cap'), { playerOfMatchId: 'q3', updatedAt: Date.now() })); // override: any player
    await assertFails(updateDoc(m3('cap'), { playerOfMatchId: 'p1' })); // already confirmed
    await assertFails(updateDoc(m3('cap'), { playerOfMatchId: null })); // can't be wiped while finished
  });

  test('POTM: a scorer who does not play cannot name themselves', async () => {
    await seedM2({ status: 'finished', startedAt: Date.now() - 3600 * 1000, finishedAt: finishedAt(), events: [{ type: 'point', side: 'A', at: 1 }] });
    await assertFails(updateDoc(doc(ctx('zz').firestore(), 'matches/m2'), { playerOfMatchId: 'zz' }));
    await assertFails(updateDoc(doc(ctx('bob').firestore(), 'matches/m2'), { playerOfMatchId: 'p1' })); // creator, not scorer
    await assertSucceeds(updateDoc(doc(ctx('zz').firestore(), 'matches/m2'), { playerOfMatchId: 'p1' }));
  });

  test('POTM: only on a finished match – not on a live match, not 24 h after the finish, not at create', async () => {
    await assertFails(updateDoc(doc(ctx('cap').firestore(), 'matches/m1'), { playerOfMatchId: 'p1' })); // live
    await seedFinished('old', { finishedAt: Date.now() - DAY - 60000 });
    await assertFails(updateDoc(doc(ctx('cap').firestore(), 'matches/old'), { playerOfMatchId: 'p1' }));
    // 1.2.1 (QA NB-R3): the finishing write can't carry the POTM (the finish time would move with it)
    await assertFails(updateDoc(doc(ctx('cap').firestore(), 'matches/m1'), { status: 'finished', startedAt: Date.now() - 3600000, finishedAt: Date.now() - 1000, playerOfMatchId: 'q2' }));
    // can't be created with one
    await assertFails(newMatch(matchDoc({ teamId: 't1', ids: T1 }, { teamId: 't2', ids: T2 }, { createdAt: Date.now(), updatedAt: Date.now(), playerOfMatchId: 'p1' })));
    await assertSucceeds(newMatch(matchDoc({ teamId: 't1', ids: T1 }, { teamId: 't2', ids: T2 }, { createdAt: Date.now(), updatedAt: Date.now() })));
  });

  test('POTM is locked: re-opening the match keeps it; it can never be cleared or re-picked (QA NB-R3)', async () => {
    await seedFinished('m4', { playerOfMatchId: 'p2' });
    const m4 = doc(ctx('cap').firestore(), 'matches/m4');
    // 1.3.0 (QA N121-1 / INFO): with the POTM picked the match is completed and closed, so it can't
    // be re-opened at all; a POTM is therefore never left on a re-opened match.
    await assertFails(updateDoc(m4, { status: 'live', finishedAt: null, finishedServerAt: null, playerOfMatchId: null })); // can't clear it
    await assertFails(updateDoc(m4, { status: 'live', finishedAt: null, finishedServerAt: null })); // can't re-open
    expect((await getDoc(m4)).data().playerOfMatchId).toBe('p2');
    await assertFails(updateDoc(m4, { playerOfMatchId: 'q1' })); // can't move it
  });
});

describe('build-217 retest follow-ups', () => {
  const m1 = (who = 'cap') => doc(ctx(who).firestore(), 'matches/m1');
  const now = Date.now();
  const ev = (side, i, extra = {}) => ({ type: 'point', side, at: now + i, ...extra });
  const log = (n) => Array.from({ length: n }, (_, i) => ev(i % 2 ? 'B' : 'A', i));
  const seed = (over) => env.withSecurityRulesDisabled((c) => updateDoc(doc(c.firestore(), 'matches/m1'), over));

  test('G1: an update appends at most 1 event, shape-checked at its index', async () => {
    await assertSucceeds(updateDoc(m1(), { events: log(1) }));
    await assertFails(updateDoc(m1(), { events: log(3) })); // +2
    const l = log(1);
    await assertFails(updateDoc(m1(), { events: [...l, ev('C', 1)] })); // bad side
    await assertFails(updateDoc(m1(), { events: [...l, ev('A', 1, { extra: 1 })] })); // extra key
    await assertFails(updateDoc(m1(), { events: [...l, ev('A', 1, { kind: 'smash' })] })); // unknown shot type
    await assertFails(updateDoc(m1(), { events: [...l, ev('A', 1, { playerId: 'not an id!' })] }));
    await assertFails(updateDoc(m1(), { events: [...l, ev('A', 1, { at: now + 5 * DAY })] })); // insane time
    await assertFails(updateDoc(m1(), { events: [...l, { type: 'point', side: 'A', at: 'soon' }] }));
    await assertFails(updateDoc(m1(), { events: [ev('B', 0), ev('A', 1)] })); // history rewritten
    await assertSucceeds(updateDoc(m1(), { events: [...l, ev('B', 1, { playerId: 'q1', kind: 'kill' })] }));
    await assertSucceeds(updateDoc(m1(), { events: [...l, ev('B', 1, { playerId: 'q1', kind: 'kill' }), { type: 'timeout', side: 'A', at: now + 2 }] }));
  });
  test('G1: undo exactly the last event; re-credit one of the last 3 without changing the rally', async () => {
    await seed({ events: log(6) });
    await assertFails(updateDoc(m1(), { events: log(4) })); // two undone at once
    await assertSucceeds(updateDoc(m1(), { events: log(5) }));
    const l = log(5);
    // event 3 was won by team B: only a team B player can be credited (QA NB-R5)
    await assertFails(updateDoc(m1(), { events: l.map((e, i) => (i === 3 ? { ...e, playerId: 'p1', kind: 'ace' } : e)) }));
    await assertSucceeds(updateDoc(m1(), { events: l.map((e, i) => (i === 3 ? { ...e, playerId: 'q1', kind: 'ace' } : e)) }));
    await assertFails(updateDoc(m1(), { events: l.map((e, i) => (i === 0 ? { ...e, playerId: 'p1' } : e)) })); // too far back
    await assertFails(updateDoc(m1(), { events: l.map((e, i) => (i === 4 ? { ...e, side: e.side === 'A' ? 'B' : 'A' } : e)) }));
  });
  test('G1: the summary moves at most 1 rally per appended event, completed sets only grow at the end', async () => {
    const summary = { setsA: 1, setsB: 0, currentA: 5, currentB: 0, setScores: [{ a: 25, b: 20 }], winner: null, serving: 'A' };
    await seed({ events: log(50), summary });
    const next = [...log(50), ev('A', 50)];
    await assertFails(updateDoc(m1(), { events: next, summary: { ...summary, currentA: 7 } })); // +2 for 1 event
    await assertFails(updateDoc(m1(), { events: next, summary: { ...summary, currentA: 6, setScores: [{ a: 25, b: 19 }] } })); // past set edited
    await assertFails(updateDoc(m1(), { events: next, summary: null })); // can't drop the summary
    await assertSucceeds(updateDoc(m1(), { events: next, summary: { ...summary, currentA: 6 } }));
    await assertFails(updateDoc(m1(), { events: log(50), summary: { ...summary, currentA: 3 } })); // undo moves 1 at most
    await assertSucceeds(updateDoc(m1(), { events: log(50), summary }));
  });
  // Worst cases for the 1000-expression budget: 12-a-side rosters, title + place, a long log,
  // 4 completed sets; the finishing rally (status + finish time change), undoing it (POTM
  // cleared), and re-crediting an older rally.
  const S4 = [{ a: 25, b: 23 }, { a: 23, b: 25 }, { a: 30, b: 28 }, { a: 26, b: 28 }];
  const A12 = ['cap', ...Array.from({ length: 11 }, (_, i) => `a${i + 1}`)];
  const B12 = Array.from({ length: 12 }, (_, i) => `b${i}`);
  const big = (over) => env.withSecurityRulesDisabled((c) =>
    setDoc(doc(c.firestore(), 'matches/big'), matchDoc({ ids: A12 }, { ids: B12 }, { title: 'Final', location: PLACE, startedAt: Date.now() - 7200000, ...over })));
  const bigRef = () => doc(ctx('cap').firestore(), 'matches/big');
  const live5 = { setsA: 2, setsB: 2, currentA: 14, currentB: 13, setScores: S4, winner: null, serving: 'A' };
  const won5 = { setsA: 3, setsB: 2, currentA: 15, currentB: 13, setScores: [...S4, { a: 15, b: 13 }], winner: 'A', serving: 'A' };
  test('G1 budget: finishing rally of a 3-2 match, 12-a-side, 300 events', async () => {
    await big({ status: 'live', events: log(300), summary: live5 });
    await assertSucceeds(updateDoc(bigRef(), { events: [...log(300), ev('A', 300, { playerId: 'a7', kind: 'kill' })], summary: won5, status: 'finished', finishedAt: Date.now(), finishedServerAt: serverTimestamp(), updatedAt: Date.now() }));
  });
  test('G1 budget: undoing the winning rally while the POTM is open, 12-a-side (1.3.0: after the POTM it is closed)', async () => {
    await big({ status: 'finished', events: [...log(300), ev('A', 300)], summary: won5, finishedAt: Date.now() - 60000 });
    await assertSucceeds(updateDoc(bigRef(), { events: log(300), summary: live5, status: 'live', finishedAt: null, finishedServerAt: null, updatedAt: Date.now() }));
    await big({ status: 'finished', events: [...log(300), ev('A', 300)], summary: won5, finishedAt: Date.now() - 60000, playerOfMatchId: 'a1' });
    await assertFails(updateDoc(bigRef(), { events: log(300), summary: live5, status: 'live', finishedAt: null, finishedServerAt: null, updatedAt: Date.now() }));
  });
  test('G1 budget: re-crediting the 3rd-last rally, 12-a-side', async () => {
    await big({ status: 'live', events: log(300), summary: live5 });
    const l = log(300);
    l[297] = { ...l[297], playerId: 'b3', kind: 'ace' }; // rally 297 was won by team B
    await assertSucceeds(updateDoc(bigRef(), { events: l, summary: live5, updatedAt: Date.now() }));
  });
  test('sets to win = (bestOf + 1) / 2: a best-of-3 2-1 finish is accepted', async () => {
    const r3 = { ...RULES, bestOf: 3 };
    const s2 = { setsA: 1, setsB: 1, currentA: 14, currentB: 10, setScores: [{ a: 25, b: 20 }, { a: 20, b: 25 }], winner: null, serving: 'A' };
    await seed({ rules: r3, events: log(80), summary: s2 });
    await assertSucceeds(updateDoc(m1(), {
      events: [...log(80), ev('A', 80)], status: 'finished', finishedAt: Date.now(), finishedServerAt: serverTimestamp(),
      summary: { setsA: 2, setsB: 1, currentA: 15, currentB: 10, setScores: [...s2.setScores, { a: 15, b: 10 }], winner: 'A', serving: 'A' },
    }));
  });
  test('G1: a newly completed set score is range-checked; sets won must match the sets listed', async () => {
    const s1 = { setsA: 0, setsB: 0, currentA: 24, currentB: 20, setScores: [], winner: null, serving: 'A' };
    await seed({ events: log(44), summary: s1 });
    const done = (set) => ({ setsA: 1, setsB: 0, currentA: 0, currentB: 0, setScores: [set], winner: null, serving: 'B' });
    await assertFails(updateDoc(m1(), { events: log(45), summary: done({ a: 25, b: 500 }) }));
    await assertFails(updateDoc(m1(), { events: log(45), summary: done({ a: -1, b: 20 }) }));
    await assertFails(updateDoc(m1(), { events: log(45), summary: { ...done({ a: 25, b: 20 }), setsA: 0 } })); // sets won ≠ sets listed
    await assertSucceeds(updateDoc(m1(), { events: log(45), summary: done({ a: 25, b: 20 }) }));
  });

  const tour = (teams) => ({ name: 'Cup', organizerId: 'cap', format: 'knockout', rules: RULES, startDate: Date.now() + DAY, endDate: Date.now() + 2 * DAY, location: PLACE, teams: teams.map((id) => ({ id, name: id, color: '#123456' })), fixtures: [], status: 'registration' });
  const bigTeams = async (n) => {
    const ids = Array.from({ length: n }, (_, i) => `big${i}`);
    await env.withSecurityRulesDisabled(async (c) => {
      for (const id of ids) await setDoc(doc(c.firestore(), `teams/${id}`), { name: id, captainId: 'cap', memberIds: T1, subIds: [], pendingPhones: [] });
    });
    return ids;
  };
  test('G8: at most 10 teams; duplicates and registration checked for every one of them', async () => {
    const ids = await bigTeams(11);
    await assertFails(setDoc(doc(ctx('cap').firestore(), 'tournaments/eleven'), tour(ids)));
    await assertFails(setDoc(doc(ctx('cap').firestore(), 'tournaments/dup'), tour([...ids.slice(0, 9), 'big0'])));
    await assertFails(setDoc(doc(ctx('cap').firestore(), 'tournaments/solo10'), tour([...ids.slice(0, 9), 'tsolo'])));
    await assertFails(setDoc(doc(ctx('cap').firestore(), 'tournaments/ext10'), tour([...ids.slice(0, 9), 'ext_10'])));
    await assertSucceeds(setDoc(doc(ctx('cap').firestore(), 'tournaments/ten'), tour(ids.slice(0, 10))));
    await assertFails(updateDoc(doc(ctx('cap').firestore(), 'tournaments/ten'), { teams: tour(ids).teams }));
  });

  const team = () => doc(ctx('cap').firestore(), 'teams/t1');
  test('#4/#7: filler-only names, leading/trailing NBSP or line separator are refused', async () => {
    for (const f of ['\u3164', '\uFFA0', '\u115F', '\u1160', '\u2800']) {
      await assertFails(updateDoc(team(), { name: f.repeat(3) }));
      await assertFails(updateDoc(team(), { name: `${f}Smashers` }));
      await assertFails(updateDoc(team(), { name: `Smashers${f}` }));
      await assertFails(updateDoc(team(), { name: `.${f}.` })); // a filler is not a letter
    }
    await assertFails(updateDoc(team(), { name: 'Smash\u180Eers' }));
    for (const ws of ['\u00A0', '\u2028', '\u2029', '\u3000', '\u202F', '\u2007']) {
      await assertFails(updateDoc(team(), { name: `${ws}Smashers` }));
      await assertFails(updateDoc(team(), { name: `Smashers${ws}` }));
    }
    await assertFails(updateDoc(m1(), { title: '\u00A0Final' }));
    await assertSucceeds(updateDoc(team(), { name: 'Smash\u00A0ers 한국' })); // inside, and real Hangul, are fine
  });
  test('#5 colours: #RRGGBB only', async () => {
    await assertFails(updateDoc(team(), { color: '#FFF' }));
    await assertFails(updateDoc(team(), { color: '#FFAA00CC' }));
    await assertSucceeds(updateDoc(team(), { color: '#FFAA00' }));
  });
  test('#6 lengths: UTF-16 units, as the app counts (an emoji is 2)', async () => {
    await assertFails(updateDoc(team(), { name: 'A' + '😀'.repeat(20) })); // 41 units: the app says tooLong too
    await assertSucceeds(updateDoc(team(), { name: 'A' + '😀'.repeat(19) })); // 39 units
  });
});


describe('1.2.1: retest 1.1.0 bugs (NB-R1..R5, storage)', () => {
  const now = Date.now();
  const ev = (side, i, extra = {}) => ({ type: 'point', side, at: now + i, ...extra });
  const log = (n) => Array.from({ length: n }, (_, i) => ev(i % 2 ? 'B' : 'A', i));
  const m1 = (who = 'cap') => doc(ctx(who).firestore(), 'matches/m1');
  const seed = (over) => env.withSecurityRulesDisabled((c) => updateDoc(doc(c.firestore(), 'matches/m1'), over));
  const base = (over = {}) => matchDoc({ teamId: 't1', ids: T1 }, { teamId: 't2', ids: T2 }, { createdAt: now, updatedAt: now, ...over });
  const won3 = { setsA: 3, setsB: 0, currentA: 25, currentB: 0, setScores: [{ a: 25, b: 0 }, { a: 25, b: 0 }, { a: 25, b: 0 }], winner: 'A', serving: 'A' };

  test('NB-R1: a match must be created with the empty summary', async () => {
    const { summary, ...noSummary } = base();
    await assertFails(newMatch(noSummary));
    await assertFails(newMatch(base({ summary: { ...summary, currentA: 3 } })));
    await assertFails(newMatch(base({ summary: { ...summary, winner: 'A' } })));
    await assertSucceeds(newMatch(base()));
  });
  test('NB-R1: a stored document without a summary is checked against the empty one (no jump to 3-0)', async () => {
    await seed({ summary: deleteField() });
    await assertFails(updateDoc(m1(), { events: log(1), summary: won3, status: 'finished', finishedAt: Date.now(), finishedServerAt: serverTimestamp() }));
    await assertSucceeds(updateDoc(m1(), { events: log(1), summary: { setsA: 0, setsB: 0, currentA: 1, currentB: 0, setScores: [], winner: null, serving: 'A' } }));
  });
  test('NB-R2: status finished needs a winner (status-only write denied)', async () => {
    await assertFails(updateDoc(m1(), { status: 'finished', finishedAt: Date.now(), finishedServerAt: serverTimestamp() }));
    await seed({ events: log(150), summary: { setsA: 2, setsB: 0, currentA: 24, currentB: 0, setScores: [{ a: 25, b: 0 }, { a: 25, b: 0 }], winner: null, serving: 'A' } });
    await assertFails(updateDoc(m1(), { status: 'finished', finishedAt: Date.now(), finishedServerAt: serverTimestamp() }));
    await assertSucceeds(updateDoc(m1(), { status: 'abandoned', finishedAt: Date.now() }));
  });
  test('NB-R3: finishedAt moves only with the status, never into the future; finishedServerAt = request.time', async () => {
    const live = { setsA: 2, setsB: 0, currentA: 24, currentB: 0, setScores: [{ a: 25, b: 0 }, { a: 25, b: 0 }], winner: null, serving: 'A' };
    await seed({ events: log(74), summary: live });
    const fin = (over) => updateDoc(m1(), { events: log(75), summary: won3, status: 'finished', finishedAt: Date.now(), finishedServerAt: serverTimestamp(), ...over });
    await assertFails(fin({ finishedAt: Date.now() + 30 * DAY })); // far future
    await assertFails(fin({ finishedServerAt: deleteField() })); // no server time
    await assertFails(fin({ finishedServerAt: new Date(Date.now() + DAY) })); // client-chosen time
    await assertSucceeds(fin({}));
    await assertFails(updateDoc(m1(), { finishedAt: Date.now() + 60000 })); // without a status change
    await assertFails(updateDoc(m1(), { finishedServerAt: serverTimestamp() }));
  });
  test('NB-R3: the POTM write cannot move the finish; the 24 h window runs from finishedServerAt', async () => {
    const fin = (ago) => env.withSecurityRulesDisabled((c) => setDoc(doc(c.firestore(), 'matches/f1'), base({
      status: 'finished', startedAt: now - 3 * DAY, finishedAt: now - 60000, finishedServerAt: new Date(Date.now() - ago), events: log(75), summary: won3,
    })));
    const f1 = doc(ctx('cap').firestore(), 'matches/f1');
    await fin(25 * 3600 * 1000); // stored finish 25 h ago (finishedAt says 1 min: ignored)
    await assertFails(updateDoc(f1, { playerOfMatchId: 'p1' }));
    await assertFails(updateDoc(f1, { playerOfMatchId: 'p1', finishedAt: Date.now() }));
    await fin(60000);
    await assertFails(updateDoc(f1, { playerOfMatchId: 'p1', finishedAt: Date.now() - 1000 })); // finish time changed with it
    await assertSucceeds(updateDoc(f1, { playerOfMatchId: 'p1' }));
  });
  test('NB-R3 / 1.3.0: after a confirmed POTM the match is closed: no undo, no re-pick', async () => {
    const live = { setsA: 2, setsB: 0, currentA: 24, currentB: 0, setScores: [{ a: 25, b: 0 }, { a: 25, b: 0 }], winner: null, serving: 'A' };
    await env.withSecurityRulesDisabled((c) => setDoc(doc(c.firestore(), 'matches/f2'), base({
      status: 'finished', startedAt: now - 3600000, finishedAt: now - 60000, finishedServerAt: new Date(Date.now() - 60000), events: log(75), summary: won3, playerOfMatchId: 'p1',
    })));
    const f2 = doc(ctx('cap').firestore(), 'matches/f2');
    await assertFails(updateDoc(f2, { events: log(74), summary: live, status: 'live', finishedAt: null, finishedServerAt: null }));
    await assertFails(updateDoc(f2, { playerOfMatchId: 'q1' }));
    expect((await getDoc(f2)).data().playerOfMatchId).toBe('p1');
  });
  test('NB-R5: a credited player must be on the side that won the rally', async () => {
    await assertFails(updateDoc(m1(), { events: [ev('A', 0, { playerId: 'q1' })] })); // team B player on an A rally
    await assertFails(updateDoc(m1(), { events: [ev('A', 0, { playerId: 'bob' })] })); // not a player
    await assertSucceeds(updateDoc(m1(), { events: [ev('A', 0, { playerId: 'p1', kind: 'kill' })] }));
    await assertSucceeds(updateDoc(m1(), { events: [ev('A', 0, { playerId: 'p1', kind: 'kill' }), ev('B', 1, { playerId: 'q5' })] }));
  });
  test('storage: no overwriting an existing photo; per-type minimum size (bare GIF header denied)', async () => {
    const st = ctx('p1').storage();
    await assertFails(uploadBytes(ref(st, `matches/m1/p1/tiny-${RUN}.gif`), new TextEncoder().encode('GIF89a'), { contentType: 'image/gif' }));
    await assertFails(uploadBytes(ref(st, `matches/m1/p1/small-${RUN}.png`), new Uint8Array(66), { contentType: 'image/png' }));
    await assertSucceeds(uploadBytes(ref(st, `matches/m1/p1/ok-${RUN}.png`), new Uint8Array(67), { contentType: 'image/png' }));
    await assertFails(uploadBytes(ref(st, `matches/m1/p1/ok-${RUN}.png`), new Uint8Array(200), { contentType: 'image/png' })); // overwrite
  });
});

describe('1.3.0: T&C gate, anti-fraud, baseline holes', () => {
  const now = Date.now();
  const fresh = () => env.authenticatedContext('fresh', { phone_number: '+919555500001' });
  const admin = () => env.authenticatedContext('adm', { admin: true });
  const won3 = { setsA: 3, setsB: 0, currentA: 25, currentB: 0, setScores: [{ a: 25, b: 0 }, { a: 25, b: 0 }, { a: 25, b: 0 }], winner: 'A', serving: 'A' };
  const ev = (side, i) => ({ type: 'point', side, at: now + i });
  const log = (n) => Array.from({ length: n }, (_, i) => ev(i % 2 ? 'B' : 'A', i));
  const base = (over = {}) => matchDoc({ teamId: 't1', ids: T1 }, { teamId: 't2', ids: T2 }, { createdAt: now, updatedAt: now, ...over });
  /** A completed match (finished + POTM) between t1 (captain cap, scorer cap) and t2 (captain eve). */
  const seedDone = (id = 'done', over = {}) => env.withSecurityRulesDisabled((c) => setDoc(doc(c.firestore(), `matches/${id}`), base({
    status: 'finished', events: log(75), summary: won3, finishedAt: now - 60000, finishedServerAt: new Date(now - 60000),
    startedServerAt: new Date(now - 3600000), playerOfMatchId: 'p1', ...over,
  })));
  const m = (id, who = 'cap') => doc((typeof who === 'string' ? ctx(who) : who).firestore(), `matches/${id}`);
  const confirm = (who, over = {}) => updateDoc(m('done', who), { verification: { status: 'confirmed', by: typeof who === 'string' ? who : 'adm', at: serverTimestamp(), ...over } });
  beforeEach(() => env.withSecurityRulesDisabled((c) => setDoc(doc(c.firestore(), 'terms/adm'), { version: TERMS_VERSION, acceptedAt: new Date() })));

  test('the rules T&C version equals src/core/terms.ts (and storage.rules)', () => {
    const core = fs.readFileSync(path.join(__dirname, '../src/core/terms.ts'), 'utf8').match(/TERMS_VERSION = '([^']+)'/)[1];
    expect(fs.readFileSync(path.join(__dirname, '../firestore.rules'), 'utf8')).toContain(`function termsVersion() { return '${core}'; }`);
    expect(fs.readFileSync(path.join(__dirname, '../storage.rules'), 'utf8')).toContain(`.data.version == '${core}'`);
    expect(core).toBe(TERMS_VERSION);
  });
  test('TC-07: without acceptance every write is denied (profile, phone index, team, match, photo, upload)', async () => {
    const db = fresh().firestore();
    await assertFails(setDoc(doc(db, 'users/fresh'), { name: 'Fresh', phone: '+919555500001' }));
    await assertFails(setDoc(doc(db, 'phoneIndex/+919555500001'), { uid: 'fresh' }));
    await assertFails(setDoc(doc(db, 'teams/tf'), { name: 'Fresh', captainId: 'fresh', memberIds: ['fresh'], subIds: [], pendingPhones: [] }));
    await assertFails(setDoc(doc(db, 'courts/c1'), { name: 'Court', location: PLACE, surface: 'indoor', addedBy: 'fresh' }));
    await assertFails(uploadBytes(ref(fresh().storage(), 'avatars/fresh/a.png'), new Uint8Array(200), { contentType: 'image/png' }));
    // bob (accepted) can upload his avatar
    await assertSucceeds(uploadBytes(ref(ctx('bob').storage(), 'avatars/bob/a.png'), new Uint8Array(200), { contentType: 'image/png' }));
  });
  test('TC-02/08/09/10/11: accept = own doc, exact version, server time, forward only, no delete', async () => {
    const db = fresh().firestore();
    const t = doc(db, 'terms/fresh');
    await assertFails(setDoc(t, { version: '2025-01', acceptedAt: serverTimestamp() }));
    await assertFails(setDoc(t, { version: TERMS_VERSION + ' ', acceptedAt: serverTimestamp() }));
    await assertFails(setDoc(t, { version: TERMS_VERSION, acceptedAt: new Date(now - DAY) })); // client time
    await assertFails(setDoc(t, { version: TERMS_VERSION, acceptedAt: serverTimestamp(), lang: 'hi', extra: 1 }));
    await assertFails(setDoc(doc(db, 'terms/bob'), { version: TERMS_VERSION, acceptedAt: serverTimestamp() })); // someone else
    await assertSucceeds(setDoc(t, { version: TERMS_VERSION, acceptedAt: serverTimestamp() }));
    await assertFails(setDoc(t, { version: TERMS_VERSION, acceptedAt: serverTimestamp() })); // the first acceptance is kept
    await assertFails(deleteDoc(t));
    await assertFails(getDoc(doc(ctx('eve').firestore(), 'terms/fresh')));
    await assertSucceeds(getDoc(t));
    await assertSucceeds(setDoc(doc(db, 'users/fresh'), { name: 'Fresh', phone: '+919555500001' }));
    // an OLDER stored version is gated and can move forward
    await env.withSecurityRulesDisabled((c) => setDoc(doc(c.firestore(), 'terms/bob'), { version: '2025-old', acceptedAt: new Date() }));
    await assertFails(setDoc(doc(ctx('bob').firestore(), 'users/bob'), { name: 'Bob', phone: PHONES.bob }));
    await assertSucceeds(setDoc(doc(ctx('bob').firestore(), 'terms/bob'), { version: TERMS_VERSION, acceptedAt: serverTimestamp() }));
    await assertSucceeds(setDoc(doc(ctx('bob').firestore(), 'users/bob'), { name: 'Bob', phone: PHONES.bob }));
  });
  test('TC-08/WL-03/WL-04: profile can not carry T&C, points, bonus or wallet fields; no wallet/ledger/redeem collections', async () => {
    const db = ctx('bob').firestore();
    for (const extra of [{ termsVersion: TERMS_VERSION }, { termsAcceptedAt: 1 }, { balance: 9999 }, { points: 5 }, { bonus: 100 }])
      await assertFails(setDoc(doc(db, 'users/bob'), { name: 'Bob', phone: PHONES.bob, ...extra }));
    for (const p of ['wallets/bob', 'ledger/x', 'redemptions/x', 'payouts/x', 'bonuses/bob'])
      await assertFails(setDoc(doc(db, p), { amount: 100, uid: 'bob' }));
  });
  test('AF-18: a match can not be created finished, with a finish time or with a verification', async () => {
    await assertFails(newMatch(base({ status: 'finished', summary: won3, events: log(75) })));
    await assertFails(newMatch(base({ status: 'live', finishedAt: Date.UTC(2100, 0, 1) })));
    await assertFails(newMatch(base({ status: 'live', verification: { status: 'confirmed' } })));
    await assertSucceeds(newMatch(base({ status: 'live' })));
  });
  test('AF-14/AF-17a: start times are the server\'s, never backdated', async () => {
    await assertFails(newMatch(base({ status: 'live', startedAt: now - 2 * 3600000 })));
    await assertFails(newMatch(base({ status: 'live', startedServerAt: new Date(now - 3600000) })));
    await assertFails(newMatch(base({ status: 'scheduled', scheduledAt: now + DAY, startedServerAt: serverTimestamp() })));
    await assertSucceeds(newMatch(base({ status: 'live', startedAt: Date.now(), startedServerAt: serverTimestamp() })));
    // live m1 without a start: set once with the server time; backdating denied
    await assertFails(updateDoc(m('m1'), { startedAt: now - 2 * 3600000, startedServerAt: serverTimestamp() }));
    await assertFails(updateDoc(m('m1'), { startedAt: Date.now(), startedServerAt: new Date(now - 3600000) }));
    await assertSucceeds(updateDoc(m('m1'), { startedAt: Date.now(), startedServerAt: serverTimestamp() }));
    await assertFails(updateDoc(m('m1'), { startedAt: Date.now() - 600000 }));
    await assertFails(updateDoc(m('m1'), { startedServerAt: serverTimestamp() }));
  });
  test('captains: required, different, the team captain / a player of a by-number side, fixed after the first rally', async () => {
    const { captains, ...none } = base({ status: 'live' });
    await assertFails(newMatch(none));
    await assertFails(newMatch(base({ captains: { A: 'cap', B: 'cap' } })));
    await assertFails(newMatch(base({ captains: { A: 'p1', B: 'eve' } }))); // t1's captain is cap
    const U = ['u1', 'u2', 'u3', 'u4', 'u5', 'u6'];
    const W = ['w1', 'w2', 'w3', 'w4', 'w5', 'w6'];
    const built = (c) => matchDoc({ ids: U }, { ids: W }, { participantIds: ordered(U, W, ['cap']), captains: c });
    await assertFails(newMatch(built({ A: 'u1', B: 'u2' }))); // u2 is not on side B
    await assertFails(newMatch(built({ A: 'cap', B: 'w1' }))); // the creator isn't a player of side A
    await assertSucceeds(newMatch(built({ A: 'u3', B: 'w2' })));
    await env.withSecurityRulesDisabled((c) => updateDoc(doc(c.firestore(), 'matches/m1'), { events: log(1), summary: { ...EMPTY_SUMMARY, currentA: 1 } }));
    await assertFails(updateDoc(m('m1'), { captains: { A: 'cap', B: 'q1' } }));
  });
  test('terminal: a completed match (finished + POTM) is closed; abandoned can not come back (PM-10b, PM-15b, AF-43)', async () => {
    await seedDone();
    await assertFails(updateDoc(m('done'), { events: log(74), summary: { ...won3, setsA: 2, winner: null, currentA: 24, setScores: won3.setScores.slice(0, 2) }, status: 'live', finishedAt: null, finishedServerAt: null }));
    await assertFails(updateDoc(m('done'), { status: 'abandoned', finishedAt: Date.now() }));
    await assertFails(updateDoc(m('done'), { title: 'Edited' }));
    await assertFails(updateDoc(m('done'), { scorerId: 'bob' }));
    await assertSucceeds(updateDoc(m('done', 'bob'), { interestedIds: ['bob'] }));
    await seedDone('ab', { status: 'abandoned', playerOfMatchId: null, summary: { ...EMPTY_SUMMARY, currentA: 3 }, events: log(3), finishedServerAt: null });
    await assertFails(updateDoc(m('ab'), { status: 'live' }));
    await assertFails(updateDoc(m('ab'), { status: 'finished', summary: won3, events: log(75), finishedAt: Date.now(), finishedServerAt: serverTimestamp() }));
    await assertFails(updateDoc(m('ab'), { events: log(4), summary: { ...EMPTY_SUMMARY, currentA: 3, currentB: 1 } }));
  });
  test('awaiting POTM: no abandon (PM-05), no handover (PM-13); back to scheduled only before the first rally', async () => {
    await seedDone('await', { playerOfMatchId: null });
    await assertFails(updateDoc(m('await'), { status: 'abandoned', finishedAt: Date.now() }));
    await assertFails(updateDoc(m('await'), { scorerId: 'bob' }));
    await assertSucceeds(updateDoc(m('m1'), { status: 'scheduled', scheduledAt: Date.now() + DAY }));
    await env.withSecurityRulesDisabled((c) => updateDoc(doc(c.firestore(), 'matches/m1'), { status: 'live', events: log(1), summary: { ...EMPTY_SUMMARY, currentA: 1 } }));
    await assertFails(updateDoc(m('m1'), { status: 'scheduled', scheduledAt: Date.now() + DAY }));
  });
  test('confirm: only the opposing captain, once, verification only, server time (AF-40..AF-46)', async () => {
    await seedDone();
    await assertFails(confirm('cap')); // scorer + creator + captain A
    await assertFails(confirm('p1')); // A player
    await assertFails(confirm('q1')); // B player, not captain
    await assertFails(confirm('bob'));
    await assertFails(confirm('eve', { by: 'cap' }));
    await assertFails(confirm('eve', { at: new Date(now - DAY) }));
    await assertFails(updateDoc(m('done', 'eve'), { verification: { status: 'confirmed', by: 'eve', at: serverTimestamp() }, playerOfMatchId: 'q1' }));
    await assertFails(confirm('eve', { status: 'approved' }));
    await assertSucceeds(confirm('eve'));
    await assertFails(confirm('eve', { status: 'disputed' })); // only once
  });
  test('confirm: needs a completed match; B captain can not confirm when B scores; reject reason <= 200 plain text', async () => {
    await seedDone('done', { playerOfMatchId: null });
    await assertFails(confirm('eve'));
    await seedDone('done', { scorerId: 'q2', participantIds: ordered(T1, T2, ['cap']) });
    await assertFails(confirm('eve'));
    await seedDone();
    await assertFails(confirm('eve', { status: 'disputed', reason: 'x'.repeat(201) }));
    await assertFails(confirm('eve', { status: 'disputed', reason: 'bad\u0007' }));
    await assertFails(confirm('eve', { reason: 'confirm has no reason' }));
    await assertSucceeds(confirm('eve', { status: 'disputed', reason: 'Score is wrong' }));
  });
  test('admin review: custom claim only; approve/void a completed match once (AF-48, AF-49)', async () => {
    await seedDone();
    const review = (who, v) => updateDoc(m('done', who), { verification: { reviewedBy: who === 'cap' ? 'cap' : 'adm', reviewedAt: serverTimestamp(), ...v } });
    await assertFails(review('cap', { status: 'approved' }));
    await assertFails(updateDoc(m('done', 'eve'), { verification: { status: 'approved', by: 'eve', at: serverTimestamp() } }));
    await assertFails(review(admin(), { status: 'approved', reviewedAt: new Date(now - DAY) }));
    await assertSucceeds(review(admin(), { status: 'approved' }));
    await assertFails(review(admin(), { status: 'voided' }));
  });
  test('QA retest 1.2.1 N121-1: no finished <-> abandoned toggle, no re-stamp, no POTM on an abandoned match (H-AB1..3)', async () => {
    await seedDone('await', { playerOfMatchId: null });
    await assertFails(updateDoc(m('await'), { status: 'abandoned' })); // H-AB1 (status only)
    await assertFails(updateDoc(m('await'), { status: 'abandoned', finishedAt: Date.now(), finishedServerAt: null }));
    await assertFails(updateDoc(m('await'), { finishedAt: Date.now(), finishedServerAt: serverTimestamp() })); // re-stamp
    await seedDone('ab', { status: 'abandoned', playerOfMatchId: null, finishedServerAt: null });
    await assertFails(updateDoc(m('ab'), { status: 'finished', finishedAt: Date.now(), finishedServerAt: serverTimestamp() })); // H-AB2
    await assertFails(updateDoc(m('ab'), { playerOfMatchId: 'p1' })); // H-AB3
    await seedDone();
    await assertFails(updateDoc(m('done'), { status: 'abandoned' }));
  });
  test('QA retest 1.2.1 N121-3: no backdated start on a live or finished match; going live stamps the server start (H-ST1/2)', async () => {
    await seedDone('await', { playerOfMatchId: null });
    await assertFails(updateDoc(m('await'), { startedAt: now - 5 * 3600000 })); // H3 / H-ST2
    await assertFails(updateDoc(m('await'), { startedAt: Date.now(), startedServerAt: serverTimestamp() }));
    await env.withSecurityRulesDisabled((c) => setDoc(doc(c.firestore(), 'matches/s2'), base({ status: 'scheduled', scheduledAt: now + DAY })));
    await assertFails(updateDoc(m('s2'), { status: 'live' })); // no server start
    await assertFails(updateDoc(m('s2'), { status: 'live', startedAt: now - 3600000, startedServerAt: serverTimestamp() })); // H-ST1
    await assertSucceeds(updateDoc(m('s2'), { status: 'live', startedAt: Date.now(), startedServerAt: serverTimestamp() }));
  });
  test('delete: a finished match only by an admin; scheduled by its creator (AF-50, BN-11)', async () => {
    await seedDone();
    await assertFails(deleteDoc(m('done')));
    await seedDone('await', { playerOfMatchId: null });
    await assertFails(deleteDoc(m('await')));
    await assertSucceeds(deleteDoc(m('done', admin())));
    await env.withSecurityRulesDisabled((c) => setDoc(doc(c.firestore(), 'matches/s1'), base({ status: 'scheduled', scheduledAt: now + DAY })));
    await assertFails(deleteDoc(m('s1', 'bob')));
    await assertSucceeds(deleteDoc(m('s1')));
  });
});
