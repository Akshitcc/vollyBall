/**
 * Security rules tests (run against the Firebase emulator):
 *   cd rules-tests && npm install && npm test
 */
const fs = require('fs');
const path = require('path');
const { initializeTestEnvironment, assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');
const { doc, getDoc, setDoc, updateDoc: rawUpdateDoc, deleteDoc, collection, getDocs, addDoc, arrayUnion, arrayRemove, serverTimestamp, deleteField, writeBatch } = require('firebase/firestore');
const { ref, uploadBytes, getMetadata } = require('firebase/storage');

let env;
/**
 * 1.4.5 (QA V144-1): every events write on a match that isn't stored as finished states maxEvents (max of the stored
 * value / old length and the new length), and the write that finishes sets wasWon – as the app does
 * (firebaseBackend marksFor). The older suites below are about other rules, so their match writes get these two
 * fields added here; the 1.4.5 suite uses rawUpdateDoc to test the enforcement itself.
 */
let WRAP_ENV = null; // the budget test's second environment (its matches live there)
async function updateDoc(ref, data, ...rest) {
  if (rest.length || !data || typeof data !== 'object' || !/^matches\/[^/]+$/.test(ref.path) || 'maxEvents' in data) return rawUpdateDoc(ref, data, ...rest);
  let stored = null;
  await (WRAP_ENV || env).withSecurityRulesDisabled(async (c) => {
    const snap = await getDoc(doc(c.firestore(), ref.path));
    stored = snap.exists() ? snap.data() : null;
  });
  if (!stored || stored.status === 'finished') return rawUpdateDoc(ref, data);
  const extra = {};
  if (Array.isArray(data.events)) {
    const old = typeof stored.maxEvents === 'number' ? stored.maxEvents : (stored.events ?? []).length;
    extra.maxEvents = Math.max(old, data.events.length);
  }
  if (data.status === 'finished' && !('wasWon' in data)) extra.wasWon = true;
  return rawUpdateDoc(ref, { ...data, ...extra });
}
const hostPort = (v, port) => (v ? { host: v.split(':')[0], port: Number(v.split(':')[1]) } : { host: '127.0.0.1', port });
const PHONES = { cap: '+919000000001', bob: '+919000000002', eve: '+919000000003' };
const ctx = (uid) => env.authenticatedContext(uid, { phone_number: PHONES[uid] });
// 1.4.5 (V144-1): the record an abandon after the first rally carries ('review' policy: core/abandon.ts planAbandon)
// 1.4.6 (V145-4): `behind` is a bool (null only in an admin's record), the score four small ints
const abRec = (by, events, over = {}) => ({ by, at: serverTimestamp(), events, mode: 'review', review: 'pending', score: { setsA: 0, setsB: 0, currentA: 0, currentB: 0 }, behind: over.mode === 'admin' ? null : false, ...over });

// Team rosters: t1 = cap + p1..p5, t2 = eve + q1..q5 (6 members each, MIN_PLAYERS).
const T1 = ['cap', 'p1', 'p2', 'p3', 'p4', 'p5'];
const T2 = ['eve', 'q1', 'q2', 'q3', 'q4', 'q5'];
const side = (teamId, ids, name = teamId || 'Built') => ({ teamId, name, color: '#123456', players: ids.map((id) => ({ id, name: id.toUpperCase() })) });
// participantIds in the order the rules expect: team A, team B, then creator/scorer.
const ordered = (a, b, extra = []) => [...new Set([...a, ...b, ...extra])];
const RULES = { preset: 'indoor', bestOf: 5, pointsPerSet: 25, decidingSetPoints: 15, winBy: 2, pointCap: null, timeoutsPerSet: 2, sideSwitchEvery: null, decidingSideSwitchEvery: null, decidingSwitchAt: 8 };
// Every new match carries the empty summary (required since 1.2.1, QA NB-R1).
const EMPTY_SUMMARY = { setsA: 0, setsB: 0, currentA: 0, currentB: 0, setScores: [], winner: null, serving: 'A' };
// 1.4.3 (V142-2): the summary follows the rallies exactly (one point per appended point event), so an event write
// carries the summary the app computes; within the first set that is the points per side.
const sumOf = (events) => (Array.isArray(events)
  ? { ...EMPTY_SUMMARY, currentA: events.filter((e) => e.type === 'point' && e.side === 'A').length, currentB: events.filter((e) => e.type === 'point' && e.side === 'B').length }
  : EMPTY_SUMMARY);
const withSum = (o) => ({ ...o, summary: sumOf(o.events) });
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
/**
 * 1.3.5: a match photo is written as the app does it: id = its sha256 (`hash`), in one batch with the
 * per-match counter photoMeta/count (n + 1, last = this id). `hash` defaults to a fresh fake digest.
 */
let PHOTO_N = 0;
const fakeHash = () => (Date.now().toString(16) + (++PHOTO_N).toString(16).padStart(8, '0')).padStart(64, 'f');
async function addPhoto(db, matchId, data, { n, id } = {}) {
  const hash = data.hash === undefined ? fakeHash() : data.hash;
  const docId = id ?? (typeof hash === 'string' && /^[0-9a-f]{64}$/.test(hash) ? hash : `x${++PHOTO_N}`);
  const cRef = doc(db, `matches/${matchId}/photoMeta/count`);
  let next = n;
  if (next === undefined) {
    const c = await getDoc(cRef).catch(() => null);
    next = (c && c.exists() ? c.data().n : 0) + 1;
  }
  const b = writeBatch(db);
  b.set(doc(db, `matches/${matchId}/photos/${docId}`), { ...data, hash });
  b.set(cRef, { n: next, last: docId });
  return b.commit();
}
const photoUrl = (p, bucket = 'demo-volleylive.appspot.com') => `https://firebasestorage.googleapis.com/v0/b/${bucket}/o/${encodeURIComponent(p)}?alt=media&token=0b1c2d3e`;
// A challenge as firebaseBackend writes it (names copied from the team docs, QA G19).
const challengeDoc = (over = {}) => ({
  fromTeamId: 't1', fromTeamName: 'Smashers', fromCaptainId: 'cap', toTeamId: 't2', toTeamName: 'Blockers', toCaptainId: 'eve',
  status: 'pending', when: Date.now() + DAY, location: PLACE, message: '', rules: RULES, matchId: null, createdAt: Date.now(), ...over,
});
// 1.4.4 (V143-5): a match created live carries its server start (what every app version since 1.3.0 writes)
const liveNow = () => ({ status: 'live', startedAt: Date.now(), startedServerAt: serverTimestamp() });
const newMatch = (data) => setDoc(doc(ctx('cap').firestore(), `matches/n${Math.random().toString(36).slice(2)}`), data);

// 1.4.1 (QA harness note): the emulator can take well over jest's default 5 s to answer under CPU load (e.g.
// when run alongside jest + server + tsc). Generous timeouts here; still, run this suite on its own (serially).
jest.setTimeout(30000);
beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-volleylive',
    // emulators:exec sets *_EMULATOR_HOST (so a run on other ports works too); defaults as in firebase.json.
    firestore: { rules: fs.readFileSync(path.join(__dirname, '../firestore.rules'), 'utf8'), ...hostPort(process.env.FIRESTORE_EMULATOR_HOST, 8080) },
    storage: { rules: fs.readFileSync(path.join(__dirname, '../storage.rules'), 'utf8'), ...hostPort(process.env.FIREBASE_STORAGE_EMULATOR_HOST, 9199) },
  });
}, 120000);
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
    await assertSucceeds(updateDoc(doc(ctx('cap').firestore(), 'matches/m1'), withSum({ events: [{ type: 'point', side: 'A', at: 1 }] })));
    // 1.4.4 (V143-1): the summary is untrusted on Firebase (the app replays the events): a rally may carry any
    // well-shaped summary, or none; a malformed one is refused (cheap shape check)
    await env.withSecurityRulesDisabled((c) => updateDoc(doc(c.firestore(), 'matches/m1'), { events: [], summary: EMPTY_SUMMARY }));
    await assertSucceeds(updateDoc(doc(ctx('cap').firestore(), 'matches/m1'), { events: [{ type: 'point', side: 'A', at: 1 }] })); // summary unchanged
    await assertFails(updateDoc(doc(ctx('cap').firestore(), 'matches/m1'), { events: [{ type: 'point', side: 'A', at: 1 }, { type: 'point', side: 'B', at: 2 }], summary: { ...EMPTY_SUMMARY, currentB: 'x' } }));
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
    await assertSucceeds(addPhoto(ctx('p1').firestore(), 'm1', { uploadedBy: 'p1', url: photoUrl('matches/m1/p1/1.jpg') }));
    await assertFails(addPhoto(ctx('bob').firestore(), 'm1', { uploadedBy: 'bob', url: photoUrl('matches/m1/bob/1.jpg') }));
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
    await assertSucceeds(newMatch(matchDoc({ ids: BUILT_A }, { ids: ['cap', ...BUILT_B] }, liveNow())));
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
    await assertSucceeds(newMatch(matchDoc({ teamId: 'big1', ids: A }, { teamId: 'big2', ids: B }, liveNow())));
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
    const ghostThird = ['u1', 'u2', 'ghost', 'u4', 'u5', 'u6'];
    await assertFails(newMatch(matchDoc({ ids: ghostThird }, { ids: ['cap', ...BUILT_B] })));
    // documented gap: since 1.4.4 (V143-5, create budget) players 4+ of a by-number side are format-checked only
    // (the app checks them all before writing; the API checks every player)
    const ghostFourth = ['u1', 'u2', 'u3', 'ghost', 'u5', 'u6'];
    await assertSucceeds(newMatch(matchDoc({ ids: ghostFourth }, { ids: ['cap', ...BUILT_B] })));
  });
  test('worst case read budget: two by-number 12-player sides still fit', async () => {
    const big = (k) => Array.from({ length: 12 }, (_, i) => `${k}${i}`);
    await env.withSecurityRulesDisabled(async (c) => {
      for (const id of [...big('a').slice(0, 4), ...big('b').slice(0, 4)]) await setDoc(doc(c.firestore(), `users/${id}`), { name: id, phone: '+919800000000' });
    });
    await assertSucceeds(newMatch(matchDoc({ ids: big('a') }, { ids: big('b') })));
    // 1.3.7: with teamSizeMode (every 1.3.6+ client sends it) and uneven sides (12 v 11 costs the most)
    for (const n of [12, 11, 10, 9]) await assertSucceeds(newMatch(matchDoc({ ids: big('a') }, { ids: big('b').slice(0, n) }, { teamSizeMode: 'custom' })));
    await assertSucceeds(newMatch(matchDoc({ ids: big('a') }, { ids: big('b').slice(0, 11) })));
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
    await assertFails(updateDoc(ref('cap'), { status: 'abandoned', finishedAt: 5, updatedAt: 5 })); // 1.4.5: after a rally, only with the record
    await assertSucceeds(updateDoc(ref('cap'), { status: 'abandoned', finishedAt: 5, updatedAt: 5, abandon: abRec('cap', 1) }));
    await assertFails(updateDoc(ref('cap'), { events: [{ type: 'point', side: 'A', at: 1 }, { type: 'point', side: 'B', at: 2 }] }));
  });
  test('the scorer cannot rewrite rosters after the first rally', async () => {
    const ref = doc(ctx('cap').firestore(), 'matches/m1');
    await assertSucceeds(updateDoc(ref, withSum({ events: [{ type: 'point', side: 'A', at: 1 }] })));
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
    await assertSucceeds(updateDoc(scorer(), withSum({ events: [{ type: 'point', side: 'A', at: Date.now() }] })));
    await assertFails(updateDoc(scorer(), withSum({ events: [{ type: 'point', side: 'C', at: Date.now() }] })));
    await assertFails(updateDoc(scorer(), withSum({ events: [{ type: 'point', side: 'A', at: Date.now() + 3 * DAY }] })));
    const many = Array.from({ length: 2001 }, (_, i) => ({ type: 'point', side: i % 2 ? 'A' : 'B', at: Date.now() }));
    await assertFails(updateDoc(scorer(), withSum({ events: many })));
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
    await assertFails(addPhoto(ctx('p1').firestore(), 'm1', { uploadedBy: 'p1', url: 'https://evil.example/x.jpg' }));
    await assertFails(addPhoto(ctx('p1').firestore(), 'm1', { uploadedBy: 'p1', url: photoUrl('matches/m1/cap/1.jpg') }));
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
    const add = (uid) => addPhoto(ctx(uid).firestore(), 'm2', { matchId: 'm2', uploadedBy: uid, url: photoUrl(`matches/m2/${uid}/1.jpg`), storagePath: `matches/m2/${uid}/1.jpg`, createdAt: Date.now() });
    await assertSucceeds(add('zz')); // scorer
    await assertSucceeds(add('q1')); // team B
    await assertSucceeds(add('p5')); // team A
    await assertFails(add('bob')); // creator only
    await assertFails(add('u1')); // stranger
  });

  test('1.3.4/1.3.5: the sha256 hash is required (64 lowercase hex) and is the document id', async () => {
    await seedM2();
    const base = (uid, extra) => ({ matchId: 'm2', uploadedBy: uid, url: photoUrl(`matches/m2/${uid}/1.jpg`), storagePath: `matches/m2/${uid}/1.jpg`, createdAt: Date.now(), ...extra });
    const add = (uid, extra, o) => addPhoto(ctx(uid).firestore(), 'm2', base(uid, extra), o);
    await assertSucceeds(add('zz', { hash: 'a'.repeat(64) }));
    await assertSucceeds(add('zz', { hash: '0123456789abcdef'.repeat(4), key: 'p_abc12345' }));
    await assertFails(add('zz', { hash: 'A'.repeat(64) }));
    await assertFails(add('zz', { hash: 'a'.repeat(63) }));
    await assertFails(add('zz', { hash: 42 }));
    await assertFails(add('zz', { hash: null })); // 1.3.5: required
    await assertFails(add('zz', { sha: 'a'.repeat(64) }));
    await assertFails(add('zz', { hash: 'c'.repeat(64) }, { id: 'd'.repeat(64) })); // id must be the hash
    await assertFails(add('bob', { hash: 'b'.repeat(64) })); // still players + scorer only
  });

  test('1.3.5: the same file twice in a match is refused by the rules (same id), also from another player', async () => {
    await seedM2();
    const h = 'e'.repeat(64);
    const base = (uid) => ({ matchId: 'm2', uploadedBy: uid, url: photoUrl(`matches/m2/${uid}/1.jpg`), storagePath: `matches/m2/${uid}/1.jpg`, createdAt: Date.now(), hash: h });
    await assertSucceeds(addPhoto(ctx('zz').firestore(), 'm2', base('zz')));
    await assertFails(addPhoto(ctx('zz').firestore(), 'm2', base('zz')));
    await assertFails(addPhoto(ctx('q1').firestore(), 'm2', base('q1')));
  });

  test('1.3.5: at most 50 photos per match, counted by rules; the counter moves only with a photo', async () => {
    await seedM2();
    const db = ctx('zz').firestore();
    const base = (extra = {}) => ({ matchId: 'm2', uploadedBy: 'zz', url: photoUrl('matches/m2/zz/1.jpg'), storagePath: 'matches/m2/zz/1.jpg', createdAt: Date.now(), ...extra });
    // a photo without the counter step, or a wrong step, is refused
    const h1 = fakeHash();
    await assertFails(setDoc(doc(db, `matches/m2/photos/${h1}`), base({ hash: h1 })));
    await assertFails(addPhoto(db, 'm2', base(), { n: 2 }));
    // the counter alone can't move (no photo), nor jump
    await assertFails(setDoc(doc(db, 'matches/m2/photoMeta/count'), { n: 1, last: fakeHash() }));
    // fill to 49 directly, then 50 is the last one allowed
    await env.withSecurityRulesDisabled((c) => setDoc(doc(c.firestore(), 'matches/m2/photoMeta/count'), { n: 49, last: 'f'.repeat(64) }));
    await assertSucceeds(addPhoto(db, 'm2', base()));
    await assertFails(addPhoto(db, 'm2', base()));
    await assertFails(addPhoto(db, 'm2', base(), { n: 50 })); // same n again (a racing writer)
    // deleting a counted photo gives the slot back (in the same batch), then one more fits
    const last = (await getDoc(doc(db, 'matches/m2/photoMeta/count'))).data().last;
    await assertFails(deleteDoc(doc(db, `matches/m2/photos/${last}`))); // without the counter
    await assertFails(updateDoc(doc(db, 'matches/m2/photoMeta/count'), { n: 49 })); // counter without the photo
    const b = writeBatch(db);
    b.delete(doc(db, `matches/m2/photos/${last}`));
    b.set(doc(db, 'matches/m2/photoMeta/count'), { n: 49, last });
    await assertSucceeds(b.commit());
    await assertSucceeds(addPhoto(db, 'm2', base()));
    // someone else's photo can't be deleted to free a slot
    const mine = (await getDoc(doc(db, 'matches/m2/photoMeta/count'))).data().last;
    const other = ctx('q1').firestore();
    const b2 = writeBatch(other);
    b2.delete(doc(other, `matches/m2/photos/${mine}`));
    b2.set(doc(other, 'matches/m2/photoMeta/count'), { n: 49, last: mine });
    await assertFails(b2.commit());
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
    await assertFails(newMatch(matchDoc({ teamId: 't1', ids: T1 }, { teamId: 't2', ids: T2 }, { updatedAt: Date.now(), playerOfMatchId: 'p1' })));
    await assertSucceeds(newMatch(matchDoc({ teamId: 't1', ids: T1 }, { teamId: 't2', ids: T2 }, { updatedAt: Date.now() })));
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
    await assertSucceeds(updateDoc(m1(), withSum({ events: log(1) })));
    await assertFails(updateDoc(m1(), withSum({ events: log(3) }))); // +2
    const l = log(1);
    await assertFails(updateDoc(m1(), withSum({ events: [...l, ev('C', 1)] }))); // bad side
    await assertFails(updateDoc(m1(), withSum({ events: [...l, ev('A', 1, { extra: 1 })] }))); // extra key
    await assertFails(updateDoc(m1(), withSum({ events: [...l, ev('A', 1, { kind: 'smash' })] }))); // unknown shot type
    await assertFails(updateDoc(m1(), withSum({ events: [...l, ev('A', 1, { playerId: 'not an id!' })] })));
    await assertFails(updateDoc(m1(), withSum({ events: [...l, ev('A', 1, { at: now + 5 * DAY })] }))); // insane time
    await assertFails(updateDoc(m1(), withSum({ events: [...l, { type: 'point', side: 'A', at: 'soon' }] })));
    await assertFails(updateDoc(m1(), withSum({ events: [ev('B', 0), ev('A', 1)] }))); // history rewritten
    await assertSucceeds(updateDoc(m1(), withSum({ events: [...l, ev('B', 1, { playerId: 'q1', kind: 'kill' })] })));
    await assertSucceeds(updateDoc(m1(), withSum({ events: [...l, ev('B', 1, { playerId: 'q1', kind: 'kill' }), { type: 'timeout', side: 'A', at: now + 2 }] })));
  });
  test('G1: undo exactly the last event; re-credit one of the last 3 without changing the rally', async () => {
    await seed({ events: log(6), summary: sumOf(log(6)) });
    await assertFails(updateDoc(m1(), withSum({ events: log(4) }))); // two undone at once
    await assertSucceeds(updateDoc(m1(), withSum({ events: log(5) })));
    const l = log(5);
    // event 3 was won by team B: only a team B player can be credited (QA NB-R5)
    await assertFails(updateDoc(m1(), withSum({ events: l.map((e, i) => (i === 3 ? { ...e, playerId: 'p1', kind: 'ace' } : e)) })));
    await assertSucceeds(updateDoc(m1(), withSum({ events: l.map((e, i) => (i === 3 ? { ...e, playerId: 'q1', kind: 'ace' } : e)) })));
    await assertFails(updateDoc(m1(), withSum({ events: l.map((e, i) => (i === 0 ? { ...e, playerId: 'p1' } : e)) }))); // too far back
    await assertFails(updateDoc(m1(), withSum({ events: l.map((e, i) => (i === 4 ? { ...e, side: e.side === 'A' ? 'B' : 'A' } : e)) })));
  });
  test('1.4.4 (V143-1/V143-4): the summary is a display hint – any well-shaped summary rides on a rally; a malformed one is refused', async () => {
    const summary = { setsA: 1, setsB: 0, currentA: 5, currentB: 0, setScores: [{ a: 25, b: 20 }], winner: null, serving: 'A' };
    await seed({ events: log(50), summary });
    const next = [...log(50), ev('A', 50)];
    await assertSucceeds(updateDoc(m1(), { events: next, summary: { ...summary, currentA: 7 } })); // ignored by the app (replay)
    for (const bad of [{ ...summary, currentA: 'x' }, { ...summary, currentB: -5 }, { ...summary, serving: 'C' }, { ...summary, winner: 'Z' },
      { ...summary, setsA: 9 }, { ...summary, extra: 1 }, { ...summary, currentA: 10000 }, { ...summary, setScores: 'x' }, 'won']) {
      await seed({ events: log(50), summary });
      await assertFails(updateDoc(m1(), { events: next, summary: bad }));
    }
    await assertSucceeds(updateDoc(m1(), { events: next, summary: null })); // no summary at all: the replay is used anyway
    await assertSucceeds(updateDoc(m1(), { events: log(50), summary })); // undo
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
  // 1.4.2 (QA V141-8): once the match is over its score is final – no undo (before: allowed until the
  // POTM), no extra rally; crediting the winning rally to a player still works. 12-a-side, 300 events.
  test('V141-8: a finished match (POTM still open) refuses undo, back-to-live and an extra rally; a credit is fine', async () => {
    const fin = [...log(300), ev('A', 300)];
    await big({ status: 'finished', events: fin, summary: won5, finishedAt: Date.now() - 60000 });
    await assertFails(updateDoc(bigRef(), { events: log(300), summary: live5, status: 'live', finishedAt: null, finishedServerAt: null, updatedAt: Date.now() }));
    await assertFails(updateDoc(bigRef(), { events: log(300), summary: live5, updatedAt: Date.now() }));
    await assertFails(updateDoc(bigRef(), { events: log(300), summary: won5, updatedAt: Date.now() }));
    await assertFails(updateDoc(bigRef(), { events: [...fin, ev('B', 301)], summary: won5, updatedAt: Date.now() }));
    await assertFails(updateDoc(bigRef(), { events: [...fin, ev('A', 301)], summary: won5, updatedAt: Date.now() }));
    await assertFails(updateDoc(bigRef(), { status: 'live', updatedAt: Date.now() }));
    await assertFails(updateDoc(bigRef(), { events: [...fin, ev('B', 301)], summary: won5, title: 'Edited', updatedAt: Date.now() })); // with a meta field
    await assertSucceeds(updateDoc(bigRef(), { events: [...log(300), ev('A', 300, { playerId: 'a7', kind: 'kill' })], summary: won5, updatedAt: Date.now() }));
    await big({ status: 'finished', events: fin, summary: won5, finishedAt: Date.now() - 60000, playerOfMatchId: 'a1' });
    await assertFails(updateDoc(bigRef(), { events: log(300), summary: live5, status: 'live', finishedAt: null, finishedServerAt: null, updatedAt: Date.now() }));
  });
  // 1.4.3 (QA V142-2): Tester's 1.4.2 probes (qa142.probe.js F4–F5, C11, T2/T3) – the summary and the rules of a
  // finished match were writable before the POTM. Now a finished match only takes a credit on one of the last 3
  // rallies, the POTM and the verdict/review; every other field is frozen (src/core/matchGuards.ts MATCH_FIELDS).
  const won5b = { ...won5, setsA: 2, setsB: 3, winner: 'B' };
  const FROZEN_WRITES = [
    ['summary: winner flipped to B', { summary: won5b }],
    ['summary: winner removed (2-2)', { summary: { ...won5, setsA: 2, winner: null } }],
    ['summary: currentA 199', { summary: { ...won5, currentA: 199 } }],
    ['summary: 0:25 sets + winner B', { summary: { ...won5b, setScores: [{ a: 0, b: 25 }, { a: 0, b: 25 }, { a: 0, b: 25 }, { a: 25, b: 0 }, { a: 13, b: 15 }] } }],
    ['summary flip + title', { summary: won5b, title: 'x' }],
    ['rules: decidingSetPoints 25', { rules: { ...RULES, decidingSetPoints: 25 } }],
    ['rules: pointsPerSet 30', { rules: { ...RULES, pointsPerSet: 30 } }],
    ['rules: bestOf 3', { rules: { ...RULES, bestOf: 3 } }],
    ['rules: winBy 1', { rules: { ...RULES, winBy: 1 } }],
    ['rules + summary winner null', { rules: { ...RULES, pointsPerSet: 30 }, summary: { ...won5, setsA: 2, winner: null } }],
    ['status: abandoned', { status: 'abandoned', finishedAt: Date.now() }],
    ['status: live', { status: 'live', finishedAt: null, finishedServerAt: null }],
    ['firstServe', { firstServe: 'B' }],
    ['lineups', { lineups: { 1: { A: A12.slice(0, 6), B: B12.slice(0, 6) } } }],
    ['title', { title: 'Edited' }],
    ['location', { location: null }],
    ['scheduledAt', { scheduledAt: Date.now() + DAY }],
    ['tournamentId', { tournamentId: 't9' }],
    ['challengeId', { challengeId: 'c9' }],
    ['fixtureId', { fixtureId: 'f9' }],
    ['stream', { stream: { provider: 'youtube', playbackUrl: 'https://youtu.be/x', live: false } }],
    ['teamSizeMode', { teamSizeMode: 'custom' }],
    ['startedAt', { startedAt: Date.now() - 60000 }],
    ['finishedAt', { finishedAt: Date.now() - 1000 }],
    ['scorerId (handover)', { scorerId: 'a1' }],
    ['captains', { captains: { A: 'a1', B: 'b1' } }],
    ['participantIds', { participantIds: ordered(A12, B12, ['bob']) }],
    ['teamA name', { teamA: { ...side(null, A12), name: 'Renamed' } }],
  ];
  test('V142-2: a finished match before the POTM – every frozen field is refused; a credit and the POTM still work', async () => {
    const fin = [...log(300), ev('A', 300)];
    for (const [what, w] of FROZEN_WRITES) {
      await big({ status: 'finished', events: fin, summary: won5, finishedAt: Date.now() - 60000 });
      try { await assertFails(updateDoc(bigRef(), { ...w, updatedAt: Date.now() })); } catch (e) { throw new Error(`${what} was accepted`); }
    }
    await big({ status: 'finished', events: fin, summary: won5, finishedAt: Date.now() - 60000 });
    // "I want to play" by someone else (scheduled matches only), and the C11 credit + summary flip
    await assertFails(updateDoc(doc(ctx('bob').firestore(), 'matches/big'), { interestedIds: ['bob'] }));
    const credited = [...log(300), ev('A', 300, { playerId: 'a7', kind: 'kill' })];
    await assertFails(updateDoc(bigRef(), { events: credited, summary: won5b, updatedAt: Date.now() }));
    await assertFails(updateDoc(bigRef(), { events: credited, title: 'x', updatedAt: Date.now() }));
    await assertSucceeds(updateDoc(bigRef(), { events: credited, summary: won5, updatedAt: Date.now() }));
    await assertFails(updateDoc(bigRef(), { playerOfMatchId: 'a7', title: 'x' }));
    await assertSucceeds(updateDoc(bigRef(), { playerOfMatchId: 'a7', updatedAt: Date.now() }));
    // after the POTM (T2/T3)
    await assertFails(updateDoc(bigRef(), { summary: won5b }));
    await assertFails(updateDoc(bigRef(), { rules: { ...RULES, decidingSetPoints: 25 } }));
  });
  test('1.4.4 (V143-1/V143-2): the finishing write – at most one appended rally, nothing else rides on it, a log too short for any win is refused', async () => {
    const fin = (over) => ({ events: [...log(300), ev('A', 300)], summary: won5, status: 'finished', finishedAt: Date.now(), finishedServerAt: serverTimestamp(), updatedAt: Date.now(), ...over });
    const tryFin = async (over, seedOver = {}) => { await big({ status: 'live', events: log(300), summary: live5, ...seedOver }); return updateDoc(bigRef(), Object.fromEntries(Object.entries(fin(over)).filter(([, v]) => v !== undefined))); };
    await assertFails(tryFin({ title: 'Final!' })); // nothing else rides on the finishing write
    await assertFails(tryFin({ events: [...log(300), ev('A', 300), ev('A', 301)] })); // two rallies at once
    await assertFails(tryFin({ events: log(299) })); // an undo can't finish
    await assertFails(tryFin({ summary: { ...won5, currentA: 'x' } })); // shape
    await assertFails(tryFin({ rules: { ...RULES, pointsPerSet: 11 } }));
    // fewer events than the shortest possible win (best of 5 to 25: 75 points) – an obvious forgery
    await assertFails(tryFin({ events: [...log(70), ev('A', 70)] }, { events: log(70) }));
    await assertFails(tryFin({ events: undefined }, { events: log(10) }));
    // the summary is NOT checked against the rallies any more (the app replays them): these are accepted by the rules
    // and the app shows the replayed result (src/core/__tests__/replay144.test.ts covers what it shows)
    await assertSucceeds(tryFin({ summary: won5b }));
    await assertSucceeds(tryFin({ events: undefined })); // the winning rally was written before: status-only finish
    await assertSucceeds(tryFin({})); // the real finish
  });
  test('1.4.4 (V143-3): the replay inputs are frozen once the first rally exists – rules, firstServe, rosters, stored set lineups', async () => {
    const L = log(62);
    const seedL = (over = {}) => big({ status: 'live', events: L, summary: live5, lineups: { 1: { A: A12.slice(0, 6), B: B12.slice(0, 6) } }, ...over });
    await seedL();
    await assertFails(updateDoc(bigRef(), { rules: { ...RULES, pointsPerSet: 11 } })); // Tester's L3a
    await assertFails(updateDoc(bigRef(), { rules: { ...RULES, pointsPerSet: 11 }, events: [...L, ev('B', 62)] })); // L4
    await assertFails(updateDoc(bigRef(), { firstServe: 'B' }));
    await assertFails(updateDoc(bigRef(), { teamA: { ...side(null, A12), name: 'Renamed' } }));
    await assertFails(updateDoc(bigRef(), { lineups: { 1: { A: A12.slice(1, 7), B: B12.slice(0, 6) } } })); // set 1's lineup changed
    await assertFails(updateDoc(bigRef(), { lineups: {} })); // removed
    await assertSucceeds(updateDoc(bigRef(), { lineups: { 1: { A: A12.slice(0, 6), B: B12.slice(0, 6) }, 2: { A: A12.slice(1, 7), B: B12.slice(0, 6) } } })); // next set's lineup
    await assertSucceeds(updateDoc(bigRef(), { summary: { ...live5, serving: 'B' } })); // a display hint only
    // before the first rally the rules and the first server may still change, but not in the write adding the first rally
    await seedL({ events: [] });
    await assertFails(updateDoc(bigRef(), { rules: { ...RULES, pointsPerSet: 11 }, events: [ev('A', 0)] }));
    await assertSucceeds(updateDoc(bigRef(), { rules: { ...RULES, pointsPerSet: 21 }, firstServe: 'B' }));
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
  test('1.4.4 (V143-4): summary shape – at most 5 set scores, sets 0-3, points 0-9999', async () => {
    const s1 = { setsA: 0, setsB: 0, currentA: 24, currentB: 20, setScores: [], winner: null, serving: 'A' };
    await seed({ events: log(44), summary: s1 });
    const done = (sets, over = {}) => ({ setsA: 1, setsB: 0, currentA: 0, currentB: 0, setScores: sets, winner: null, serving: 'B', ...over });
    const six = Array.from({ length: 6 }, () => ({ a: 25, b: 20 }));
    await assertFails(updateDoc(m1(), { events: log(45), summary: done(six) }));
    await assertFails(updateDoc(m1(), { events: log(45), summary: done([], { setsA: 4 }) }));
    await assertSucceeds(updateDoc(m1(), { events: log(45), summary: done([{ a: 25, b: 20 }]) }));
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
  const base = (over = {}) => matchDoc({ teamId: 't1', ids: T1 }, { teamId: 't2', ids: T2 }, { updatedAt: now, ...over });
  const won3 = { setsA: 3, setsB: 0, currentA: 25, currentB: 0, setScores: [{ a: 25, b: 0 }, { a: 25, b: 0 }, { a: 25, b: 0 }], winner: 'A', serving: 'A' };

  test('1.4.4: the summary is not checked at create (untrusted; `events == []` is what makes a new match 0-0)', async () => {
    const { summary, ...noSummary } = base();
    await assertSucceeds(newMatch(noSummary));
    await assertSucceeds(newMatch(base({ summary: { ...summary, winner: 'A' } }))); // ignored: the app replays the (empty) log
    await assertFails(newMatch(base({ events: [{ type: 'point', side: 'A', at: 1 }] })));
    await assertSucceeds(newMatch(base()));
  });
  test('NB-R1: a stored document without a summary is checked against the empty one (no jump to 3-0)', async () => {
    await seed({ summary: deleteField() });
    await assertFails(updateDoc(m1(), { events: log(1), summary: won3, status: 'finished', finishedAt: Date.now(), finishedServerAt: serverTimestamp() }));
    await assertSucceeds(updateDoc(m1(), { events: log(1), summary: { setsA: 0, setsB: 0, currentA: 1, currentB: 0, setScores: [], winner: null, serving: 'A' } }));
  });
  test('1.4.4 (V143-2): finishing needs a log long enough for a win; a scorer abandons only a match that can\'t be won yet, an admin any unfinished one', async () => {
    await assertFails(updateDoc(m1(), { status: 'finished', finishedAt: Date.now(), finishedServerAt: serverTimestamp() })); // 0 events
    // best of 5 to 25: no win before 75 points
    await seed({ events: log(74) });
    await assertFails(updateDoc(m1(), { status: 'finished', finishedAt: Date.now(), finishedServerAt: serverTimestamp() }));
    await assertFails(updateDoc(m1(), { status: 'abandoned', finishedAt: Date.now() })); // 1.4.5: no record
    await assertSucceeds(updateDoc(m1(), { status: 'abandoned', finishedAt: Date.now(), abandon: abRec('cap', 74) }));
    await seed({ status: 'live', events: log(150), finishedAt: null, abandon: deleteField(), summary: { setsA: 2, setsB: 0, currentA: 24, currentB: 0, setScores: [{ a: 25, b: 0 }, { a: 25, b: 0 }], winner: null, serving: 'A' } });
    await assertFails(updateDoc(m1(), { status: 'abandoned', finishedAt: Date.now(), abandon: abRec('cap', 150) })); // might be won: scorer can't
    await assertFails(updateDoc(m1(), { status: 'abandoned', finishedAt: Date.now(), events: log(74) })); // not by shortening the log either
    await env.withSecurityRulesDisabled((c) => setDoc(doc(c.firestore(), 'terms/adm'), { version: TERMS_VERSION, acceptedAt: new Date() }));
    await assertFails(updateDoc(doc(env.authenticatedContext('adm', { admin: true }).firestore(), 'matches/m1'), { status: 'abandoned', finishedAt: Date.now(), title: 'x' }));
    await assertFails(updateDoc(doc(env.authenticatedContext('adm', { admin: true }).firestore(), 'matches/m1'), { status: 'abandoned', finishedAt: Date.now(), updatedAt: Date.now() })); // 1.4.5: no record
    await assertSucceeds(updateDoc(doc(env.authenticatedContext('adm', { admin: true }).firestore(), 'matches/m1'), { status: 'abandoned', finishedAt: Date.now(), updatedAt: Date.now(), abandon: abRec('adm', 150, { mode: 'admin', review: 'confirmed', reviewedBy: 'adm', reviewedAt: serverTimestamp() }) }));
    // the status-only finish of a log that is long enough is accepted by the rules; the app shows the replayed result
    await seed({ status: 'live', events: log(150), finishedAt: null });
    await assertSucceeds(updateDoc(m1(), { status: 'finished', finishedAt: Date.now(), finishedServerAt: serverTimestamp() }));
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
    await assertFails(updateDoc(m1(), withSum({ events: [ev('A', 0, { playerId: 'q1' })] }))); // team B player on an A rally
    await assertFails(updateDoc(m1(), withSum({ events: [ev('A', 0, { playerId: 'bob' })] }))); // not a player
    await assertSucceeds(updateDoc(m1(), withSum({ events: [ev('A', 0, { playerId: 'p1', kind: 'kill' })] })));
    await assertSucceeds(updateDoc(m1(), withSum({ events: [ev('A', 0, { playerId: 'p1', kind: 'kill' }), ev('B', 1, { playerId: 'q5' })] })));
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
  const base = (over = {}) => matchDoc({ teamId: 't1', ids: T1 }, { teamId: 't2', ids: T2 }, { updatedAt: now, ...over });
  /** A completed match (finished + POTM) between t1 (captain cap, scorer cap) and t2 (captain eve). */
  const seedDone = (id = 'done', over = {}) => env.withSecurityRulesDisabled((c) => setDoc(doc(c.firestore(), `matches/${id}`), base({
    status: 'finished', events: log(75), summary: won3, finishedAt: now - 60000, finishedServerAt: new Date(now - 60000),
    startedServerAt: new Date(now - 3600000), playerOfMatchId: 'p1', ...over,
  })));
  const m = (id, who = 'cap') => doc((typeof who === 'string' ? ctx(who) : who).firestore(), `matches/${id}`);
  // 1.3.9 (V138-3): clients send the verdict with every answer (the rules require it); `captain: undefined` = an older client
  const confirm = (who, over = {}) => {
    const v = { status: 'confirmed', by: typeof who === 'string' ? who : 'adm', at: serverTimestamp(), ...over };
    if (!('captain' in over)) v.captain = v.status === 'disputed' ? 'rejected' : 'confirmed';
    else if (over.captain === undefined) delete v.captain;
    return updateDoc(m('done', who), { verification: v });
  };
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
    await assertSucceeds(newMatch(base(liveNow())));
    // 1.4.4 (V143-5): a match created live must carry its server start
    await assertFails(newMatch(base({ status: 'live' })));
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
    // 1.4.3 (V142-2): a finished match is final – "I want to play" (offered on scheduled matches only) too
    await assertFails(updateDoc(m('done', 'bob'), { interestedIds: ['bob'] }));
    await seedDone('ab', { status: 'abandoned', playerOfMatchId: null, summary: { ...EMPTY_SUMMARY, currentA: 3 }, events: log(3), finishedServerAt: null });
    await assertSucceeds(updateDoc(m('ab', 'bob'), { interestedIds: ['bob'] })); // abandoned: still harmless
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
  test('1.3.5 E134-2: an admin can never review their own match (creator/scorer, captain, any player)', async () => {
    await seedDone();
    const asAdmin = (uid) => env.authenticatedContext(uid, { admin: true });
    const terms = (uid) => env.withSecurityRulesDisabled((c) => setDoc(doc(c.firestore(), `terms/${uid}`), { version: TERMS_VERSION, acceptedAt: new Date() }));
    const review = (uid) => updateDoc(m('done', asAdmin(uid)), { verification: { status: 'approved', reviewedBy: uid, reviewedAt: serverTimestamp() } });
    for (const uid of ['cap', 'eve', T1[2], T2[3]]) {
      await terms(uid);
      await assertFails(review(uid)); // creator+scorer, other captain, a player of each side
    }
    await assertSucceeds(review('adm')); // an admin who isn't in the match
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
  test('delete: never a finished match (1.4.6 V145-1: not even by an admin); scheduled by its creator (AF-50, BN-11)', async () => {
    await seedDone();
    await assertFails(deleteDoc(m('done')));
    await seedDone('await', { playerOfMatchId: null });
    await assertFails(deleteDoc(m('await')));
    await assertFails(deleteDoc(m('done', admin())));
    await env.withSecurityRulesDisabled((c) => setDoc(doc(c.firestore(), 'matches/s1'), base({ status: 'scheduled', scheduledAt: now + DAY })));
    await assertFails(deleteDoc(m('s1', 'bob')));
    await assertSucceeds(deleteDoc(m('s1')));
  });
});

describe('1.3.2: tap a player to score', () => {
  const m1 = (uid) => doc(ctx(uid).firestore(), 'matches/m1');
  test('one tapped point (team point + player credit in one event): the scorer only', async () => {
    const tapped = [{ type: 'point', side: 'A', at: Date.now(), playerId: 'p2' }];
    await assertFails(updateDoc(m1('p2'), withSum({ events: tapped }))); // the credited player
    await assertFails(updateDoc(m1('eve'), withSum({ events: tapped }))); // the other captain
    await assertFails(updateDoc(m1('bob'), withSum({ events: tapped })));
    await assertSucceeds(updateDoc(m1('cap'), withSum({ events: tapped })));
  });
  test('the credit must be a player of the team that won the rally; team-only points carry none', async () => {
    await assertFails(updateDoc(m1('cap'), withSum({ events: [{ type: 'point', side: 'A', at: Date.now(), playerId: 'q1' }] })));
    await assertFails(updateDoc(m1('cap'), withSum({ events: [{ type: 'point', side: 'A', at: Date.now(), playerId: 'zz' }] })));
    await assertSucceeds(updateDoc(m1('cap'), withSum({ events: [{ type: 'point', side: 'B', at: Date.now() }] })));
  });
  test('1.3.3: a team point (scoreboard panel, no player credit) is scorer-only', async () => {
    const team = [{ type: 'point', side: 'B', at: Date.now() }];
    await assertFails(updateDoc(m1('eve'), withSum({ events: team }))); // captain of B
    await assertFails(updateDoc(m1('p1'), withSum({ events: team })));
    await assertSucceeds(updateDoc(m1('cap'), withSum({ events: team })));
  });
  test('one rally per write, and undo pops it', async () => {
    const at = Date.now();
    const two = [{ type: 'point', side: 'A', at, playerId: 'p2' }, { type: 'point', side: 'A', at, playerId: 'p3' }];
    await assertFails(updateDoc(m1('cap'), withSum({ events: two })));
    await assertSucceeds(updateDoc(m1('cap'), withSum({ events: two.slice(0, 1) })));
    await assertSucceeds(updateDoc(m1('cap'), withSum({ events: [] })));
  });
});

describe('1.3.7: registration fields, team size, admin approval (F135-1)', () => {
  const now = Date.now();
  const istYearsAgo = (years, plusDays = 0) => {
    const t = new Date(Date.now() + 330 * 60000 + plusDays * DAY);
    return `${t.getUTCFullYear() - years}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}`;
  };
  // 1.4.0 (V139-3): a new email is claimed in the same write, as firebaseBackend.saveProfile does
  const reg = async (uid, d) => {
    const db = ctx(uid).firestore();
    const b = writeBatch(db);
    b.set(doc(db, `users/${uid}/private/registration`), d);
    if (typeof d.email === 'string' && /^[^/]+$/.test(d.email)) {
      const c = await getDoc(doc(db, `emails/${d.email}`)).catch(() => null);
      if (c && !c.exists()) b.set(doc(db, `emails/${d.email}`), { uid });
    }
    return b.commit();
  };
  // 1.3.8 (V137-5): Firebase stores no district/state (no lookup in rules; parity with the API without a lookup)
  const okReg = { dob: '2000-05-20', email: null, pincode: '110001', district: null, state: null };

  test('constants agree with the app: minAge(), adminApprovalCounts(), team size', () => {
    const rules = fs.readFileSync(path.join(__dirname, '../firestore.rules'), 'utf8');
    const regSrc = fs.readFileSync(path.join(__dirname, '../src/core/registration.ts'), 'utf8');
    const af = fs.readFileSync(path.join(__dirname, '../src/core/antifraud.ts'), 'utf8');
    expect(Number(/function minAge\(\) \{ return (\d+); \}/.exec(rules)[1])).toBe(Number(/DEFAULT_MIN_AGE = (\d+)/.exec(regSrc)[1]));
    expect(/function adminApprovalCounts\(\) \{ return (true|false); \}/.exec(rules)[1]).toBe(/COUNTS_WITHOUT_CAPTAIN: (true|false)/.exec(af)[1]);
  });
  test('public profile: first/last name checked like the app (Latin + Devanagari, 2–40)', async () => {
    const db = ctx('bob').firestore();
    const put = (over) => setDoc(doc(db, 'users/bob'), { name: 'Bob Kumar', phone: PHONES.bob, ...over });
    for (const ok of [{ firstName: 'Bob', lastName: 'Kumar' }, { firstName: 'अक्षित', lastName: 'कुमार' }, { firstName: "D'Souza", lastName: 'Jean-Luc' }, { firstName: 'José', lastName: 'Ng' }])
      await assertSucceeds(put(ok));
    for (const bad of ['B', '   ', 'R2D2', 'a'.repeat(41), "--", 'Ra--hul', 'Rahul-', 'राहुल१', '😀Bob', 'A×B'])
      await assertFails(put({ firstName: bad, lastName: 'Kumar' }));
    // the private fields can not go on the public doc
    for (const k of ['dob', 'email', 'pincode', 'district', 'state']) await assertFails(put({ [k]: k === 'dob' ? '2000-01-01' : '110001' }));
  });
  test('private registration doc: owner only; DOB real past date with age 10..100 (IST); pincode; optional email', async () => {
    await assertSucceeds(reg('bob', okReg));
    await assertSucceeds(getDoc(doc(ctx('bob').firestore(), 'users/bob/private/registration')));
    await assertFails(getDoc(doc(ctx('eve').firestore(), 'users/bob/private/registration')));
    await assertFails(setDoc(doc(ctx('eve').firestore(), 'users/bob/private/registration'), okReg));
    await assertFails(setDoc(doc(ctx('bob').firestore(), 'users/bob/private/other'), okReg));
    await assertSucceeds(reg('bob', { ...okReg, dob: istYearsAgo(10) })); // 10 today
    await assertFails(reg('bob', { ...okReg, dob: istYearsAgo(10, 1) })); // 10 tomorrow
    await assertSucceeds(reg('bob', { ...okReg, dob: istYearsAgo(101, 1) })); // 100, 101 tomorrow
    await assertFails(reg('bob', { ...okReg, dob: istYearsAgo(101) })); // 101 today
    await assertFails(reg('bob', { ...okReg, dob: istYearsAgo(0) })); // today
    await assertFails(reg('bob', { ...okReg, dob: '2099-01-01' }));
    await assertFails(reg('bob', { ...okReg, dob: '2000-13-01' }));
    for (const pin of ['000000', '012345', '1100011', '11000', 110001]) await assertFails(reg('bob', { ...okReg, pincode: pin }));
    await assertSucceeds(reg('bob', { ...okReg, email: 'a.k@example.in' }));
    await assertFails(reg('bob', { ...okReg, email: 'nope' }));
    await assertFails(reg('bob', { ...okReg, extra: 1 }));
  });
  test('1.3.6 retest (R136-8/9/10): ZWJ/ZWNJ inside Devanagari, no trailing separators, clean lower-case email, an out-of-range DOB already saved can be re-saved', async () => {
    const db = ctx('bob').firestore();
    const put = (firstName) => setDoc(doc(db, 'users/bob'), { name: 'Bob Kumar', phone: PHONES.bob, firstName, lastName: 'Kumar' });
    await assertSucceeds(put('क्\u200Dष'));
    await assertSucceeds(put('श्\u200Cरी'));
    for (const bad of ['Bob\u200D', '\u200Dक', 'Bo\u200Cb', 'क\u200D', 'क्\u094Dष', "Bob'", 'Bob-']) await assertFails(put(bad));
    for (const bad of ['A@b.in', 'a\u200B@b.in', 'a\u0000@b.in', 'a@b\uFEFF.in']) await assertFails(reg('bob', { ...okReg, email: bad }));
    await assertSucceeds(reg('bob', { ...okReg, email: 'a@b.in' }));
    const old = istYearsAgo(101);
    await env.withSecurityRulesDisabled((c) => setDoc(doc(c.firestore(), 'users/bob/private/registration'), { ...okReg, dob: old }));
    await assertSucceeds(reg('bob', { ...okReg, dob: old, pincode: '400001' })); // same DOB: only the format
    await assertFails(reg('bob', { ...okReg, dob: istYearsAgo(102) })); // a new DOB is range-checked
  });
  test('team size: exact = at most 6 per side; custom/missing = up to 12; unknown mode refused (5/6/7/12/13)', async () => {
    const ids = (p, n) => Array.from({ length: n }, (_, i) => `${p}${i + 1}`);
    const built = (na, nb, mode) => {
      const A = ids('u', na);
      const B = ids('w', nb);
      return matchDoc({ ids: A }, { ids: B }, { participantIds: ordered(A, B, ['cap']), captains: { A: 'u1', B: 'w1' }, ...(mode === undefined ? {} : { teamSizeMode: mode }) });
    };
    await assertSucceeds(newMatch(built(6, 6, 'exact')));
    await assertSucceeds(newMatch(built(5, 6, 'exact'))); // scheduled: may fill later
    await assertFails(newMatch(built(7, 6, 'exact')));
    await assertFails(newMatch(built(6, 12, 'exact')));
    await assertSucceeds(newMatch(built(7, 6, 'custom')));
    await assertSucceeds(newMatch(built(12, 12, 'custom')));
    await assertFails(newMatch(built(13, 6, 'custom')));
    await assertSucceeds(newMatch(built(12, 6, undefined))); // matches before 1.3.6
    await assertFails(newMatch(built(6, 6, 'six')));
    // switching an existing 7-player custom match to exact is refused
    const id = 'ts1';
    await env.withSecurityRulesDisabled((c) => setDoc(doc(c.firestore(), `matches/${id}`), built(7, 6, 'custom')));
    await assertFails(updateDoc(doc(ctx('cap').firestore(), `matches/${id}`), { teamSizeMode: 'exact' }));
  });
  test('createdBy never changes on update (now enforced by the update key list)', async () => {
    await assertFails(updateDoc(doc(ctx('cap').firestore(), 'matches/m1'), { createdBy: 'eve' }));
    await assertFails(updateDoc(doc(ctx('cap').firestore(), 'matches/m1'), { createdBy: 'eve', updatedAt: Date.now() }));
    await assertSucceeds(updateDoc(doc(ctx('cap').firestore(), 'matches/m1'), { title: 'Friendly', updatedAt: Date.now() }));
  });

  const won3 = { setsA: 3, setsB: 0, currentA: 25, currentB: 0, setScores: [{ a: 25, b: 0 }, { a: 25, b: 0 }, { a: 25, b: 0 }], winner: 'A', serving: 'A' };
  const log = (n) => Array.from({ length: n }, (_, i) => ({ type: 'point', side: i % 2 ? 'B' : 'A', at: now + i }));
  const seedDone = (verification) => env.withSecurityRulesDisabled((c) => setDoc(doc(c.firestore(), 'matches/f1'), matchDoc({ teamId: 't1', ids: T1 }, { teamId: 't2', ids: T2 }, {
    status: 'finished', events: log(75), summary: won3, finishedAt: now - 60000, finishedServerAt: new Date(now - 60000),
    startedServerAt: new Date(now - 120000), playerOfMatchId: 'p1', createdAt: now, updatedAt: now, ...(verification ? { verification } : {}),
  })));
  const admin = () => env.authenticatedContext('adm', { admin: true });
  const f1 = (who) => doc((typeof who === 'string' ? ctx(who) : who).firestore(), 'matches/f1');
  beforeEach(() => env.withSecurityRulesDisabled((c) => setDoc(doc(c.firestore(), 'terms/adm'), { version: TERMS_VERSION, acceptedAt: new Date() })));

  test('F135-1: approval keeps the captain verdict; after approval of an unanswered match the opposing captain can still confirm once', async () => {
    await seedDone(null); // too short → flagged, nobody answered
    const reviewedAt = new Date(now - 1000);
    await assertSucceeds(updateDoc(f1(admin()), { verification: { status: 'approved', reviewedBy: 'adm', reviewedAt: serverTimestamp() } }));
    // a forged verdict by an admin is refused
    await seedDone(null);
    await assertFails(updateDoc(f1(admin()), { verification: { status: 'approved', captain: 'confirmed', reviewedBy: 'adm', reviewedAt: serverTimestamp() } }));
    // the captain answers after the approval: status stays approved, review fields unchanged
    await seedDone({ status: 'approved', reviewedBy: 'adm', reviewedAt });
    const after = (who, v) => updateDoc(f1(who), { verification: { status: 'approved', reviewedBy: 'adm', reviewedAt, by: typeof who === 'string' ? who : 'adm', at: serverTimestamp(), ...v } });
    await assertFails(after('cap', { captain: 'confirmed' })); // scoring side
    await assertFails(after('q1', { captain: 'confirmed' })); // not a captain
    await assertFails(after('eve', { captain: 'confirmed', reviewedBy: 'eve' })); // review fields changed
    await assertFails(after('eve', { captain: 'confirmed', status: 'confirmed' })); // status must stay
    await assertFails(after('eve', {})); // verdict required
    await assertSucceeds(after('eve', { captain: 'confirmed' }));
    await assertFails(after('eve', { captain: 'rejected' })); // only once
  });
  test('F135-1: a rejected match stays rejected through approval; the verdict must match the decision', async () => {
    await seedDone({ status: 'disputed', by: 'eve', at: new Date(now - 5000), reason: 'wrong', captain: 'rejected' });
    await assertFails(updateDoc(f1(admin()), { verification: { status: 'approved', by: 'eve', at: new Date(now - 5000), reason: 'wrong', captain: 'confirmed', reviewedBy: 'adm', reviewedAt: serverTimestamp() } }));
    await assertSucceeds(updateDoc(f1(admin()), { verification: { status: 'approved', by: 'eve', at: new Date(now - 5000), reason: 'wrong', captain: 'rejected', reviewedBy: 'adm', reviewedAt: serverTimestamp() } }));
    await seedDone(null);
    await assertFails(updateDoc(f1('eve'), { verification: { status: 'confirmed', captain: 'rejected', by: 'eve', at: serverTimestamp() } }));
    await assertSucceeds(updateDoc(f1('eve'), { verification: { status: 'confirmed', captain: 'confirmed', by: 'eve', at: serverTimestamp() } }));
  });
});

describe('1.3.7: feedback + fact of the day', () => {
  const admin = () => env.authenticatedContext('adm', { admin: true });
  const fb = (c) => collection(c.firestore(), 'feedback');
  test('feedback: create own only (1-5 stars, <= 1000 chars); only admins read; no edits or deletes', async () => {
    const good = { userId: 'bob', stars: 4, text: 'Nice', appVersion: '1.3.7 (13)', createdAt: serverTimestamp() };
    await assertSucceeds(setDoc(doc(fb(ctx('bob')), 'f1'), good));
    await assertFails(setDoc(doc(fb(ctx('bob')), 'f2'), { ...good, userId: 'eve' }));
    await assertFails(setDoc(doc(fb(ctx('bob')), 'f2'), { ...good, stars: 0 }));
    await assertFails(setDoc(doc(fb(ctx('bob')), 'f2'), { ...good, stars: 6 }));
    await assertFails(setDoc(doc(fb(ctx('bob')), 'f2'), { ...good, stars: 2.5 }));
    await assertFails(setDoc(doc(fb(ctx('bob')), 'f2'), { ...good, text: 'x'.repeat(1001) }));
    await assertFails(setDoc(doc(fb(ctx('bob')), 'f2'), { ...good, text: 'a\u0000b' }));
    await assertFails(setDoc(doc(fb(ctx('bob')), 'f2'), { ...good, reward: 10 }));
    await assertFails(setDoc(doc(fb(env.unauthenticatedContext()), 'f2'), good));
    await assertFails(getDoc(doc(fb(ctx('bob')), 'f1'))); // not even their own
    await assertFails(getDocs(fb(ctx('eve'))));
    await assertSucceeds(getDocs(fb(admin())));
    await assertFails(updateDoc(doc(fb(ctx('bob')), 'f1'), { stars: 5 }));
    await assertFails(deleteDoc(doc(fb(admin()), 'f1')));
  });
  test('dailyItems: anyone reads; only admins write; quotes need attribution + https source', async () => {
    const fact = { type: 'fact', textEn: 'Court 18 x 9 m', textHi: 'कोर्ट 18 x 9 मी', attribution: 'FIVB', sourceUrl: null, active: true, createdAt: serverTimestamp() };
    const di = (c, id) => doc(c.firestore(), `dailyItems/${id}`);
    await assertFails(setDoc(di(ctx('bob'), 'd1'), fact));
    await assertSucceeds(setDoc(di(admin(), 'd1'), fact));
    await assertSucceeds(getDoc(di(env.unauthenticatedContext(), 'd1')));
    await assertSucceeds(getDocs(collection(ctx('bob').firestore(), 'dailyItems')));
    await assertFails(updateDoc(di(ctx('bob'), 'd1'), { active: false, removedAt: serverTimestamp() }));
    await assertSucceeds(updateDoc(di(admin(), 'd1'), { active: false, removedAt: serverTimestamp() })); // 1.4.1: removedAt stamped
    const quote = { type: 'quote', textEn: 'Q', textHi: 'क्यू', attribution: 'Someone', sourceUrl: 'https://example.org/q', active: true, createdAt: serverTimestamp() };
    await assertSucceeds(setDoc(di(admin(), 'q1'), quote));
    await assertFails(setDoc(di(admin(), 'q2'), { ...quote, sourceUrl: null }));
    await assertFails(setDoc(di(admin(), 'q2'), { ...quote, attribution: null }));
    await assertFails(setDoc(di(admin(), 'q2'), { ...quote, sourceUrl: 'http://example.org' }));
    await assertFails(setDoc(di(admin(), 'q2'), { ...fact, type: 'joke' }));
    await assertFails(setDoc(di(admin(), 'q2'), { ...fact, textEn: '' }));
    await assertFails(setDoc(di(admin(), 'q2'), { ...fact, textHi: 'x'.repeat(401) }));
    await assertFails(setDoc(di(admin(), 'q2'), { ...fact, extra: 1 }));
    await assertFails(deleteDoc(di(ctx('bob'), 'd1')));
    await assertFails(deleteDoc(di(admin(), 'd1'))); // 1.4.1 (V140-7): a tombstone instead (deleted = true)
  });
});

describe('1.3.8: tester findings V137-1 / V137-5', () => {
  const now = Date.now();
  const admin = () => env.authenticatedContext('adm', { admin: true });
  const won3 = { setsA: 3, setsB: 0, currentA: 25, currentB: 0, setScores: [{ a: 25, b: 0 }, { a: 25, b: 0 }, { a: 25, b: 0 }], winner: 'A', serving: 'A' };
  const log = (n) => Array.from({ length: n }, (_, i) => ({ type: 'point', side: i % 2 ? 'B' : 'A', at: now + i }));
  const seedDone = (verification) => env.withSecurityRulesDisabled((c) => setDoc(doc(c.firestore(), 'matches/g1'), matchDoc({ teamId: 't1', ids: T1 }, { teamId: 't2', ids: T2 }, {
    status: 'finished', events: log(75), summary: won3, finishedAt: now - 60000, finishedServerAt: new Date(now - 60000),
    startedServerAt: new Date(now - 120000), playerOfMatchId: 'p1', createdAt: now, updatedAt: now, ...(verification ? { verification } : {}),
  })));
  const g1 = (who) => doc((typeof who === 'string' ? ctx(who) : who).firestore(), 'matches/g1');
  beforeEach(() => env.withSecurityRulesDisabled((c) => setDoc(doc(c.firestore(), 'terms/adm'), { version: TERMS_VERSION, acceptedAt: new Date() })));

  test('V137-1: a 1.3.6 captain confirmation (no `captain` field) is kept when a 1.3.7+ admin approves', async () => {
    const at = new Date(now - 5000);
    // the opposing captain confirmed with a 1.3.6 client: status confirmed, by/at, no `captain`
    await seedDone({ status: 'confirmed', by: 'eve', at });
    const approve = (v) => updateDoc(g1(admin()), { verification: { status: 'approved', by: 'eve', at, reviewedBy: 'adm', reviewedAt: serverTimestamp(), ...v } });
    await assertFails(approve({ captain: 'rejected' })); // can't turn a confirmation into a rejection
    await assertSucceeds(approve({ captain: 'confirmed' })); // the new client stamps the verdict
    await seedDone({ status: 'confirmed', by: 'eve', at });
    await assertFails(approve({})); // 1.3.9 (V138-3): an older admin client that leaves it out is refused
    // a 1.3.6 rejection (disputed, no `captain`) can only be stamped as rejected
    await seedDone({ status: 'disputed', by: 'eve', at, reason: 'wrong' });
    const approveR = (v) => updateDoc(g1(admin()), { verification: { status: 'approved', by: 'eve', at, reason: 'wrong', reviewedBy: 'adm', reviewedAt: serverTimestamp(), ...v } });
    await assertFails(approveR({ captain: 'confirmed' }));
    await assertSucceeds(approveR({ captain: 'rejected' }));
    // nobody answered: no verdict can be invented
    await seedDone(null);
    await assertFails(updateDoc(g1(admin()), { verification: { status: 'approved', captain: 'confirmed', reviewedBy: 'adm', reviewedAt: serverTimestamp() } }));
  });

  test('V137-5: feedback needs the current T&C and refuses hidden characters (newline / tab still fine)', async () => {
    const fb = (uid, id, over = {}) => setDoc(doc(ctx(uid).firestore(), `feedback/${id}`), { userId: uid, stars: 4, text: 'Nice', appVersion: '1.3.8 (14)', createdAt: serverTimestamp(), ...over });
    await assertSucceeds(fb('bob', 'k1'));
    await assertSucceeds(fb('bob', 'k2', { text: 'line one\nline two\tend' }));
    for (const bad of ['a\u200Bb', 'a\u200Fb', 'a\u202Eb', 'a\u2066b', 'a\uFEFFb', 'a\u0007b', 'a\u007Fb'])
      await assertFails(fb('bob', `x${bad.charCodeAt(1)}`, { text: bad }));
    await assertFails(fb('bob', 'k3', { appVersion: '1.3.8\u200B' }));
    // no T&C accepted (or an older version)
    await assertFails(setDoc(doc(env.authenticatedContext('noterms', { phone_number: '+919000000077' }).firestore(), 'feedback/k4'), { userId: 'noterms', stars: 4, text: 'x', createdAt: serverTimestamp() }));
    await env.withSecurityRulesDisabled((c) => setDoc(doc(c.firestore(), 'terms/oldterms'), { version: '2020-old', acceptedAt: new Date() }));
    await assertFails(setDoc(doc(env.authenticatedContext('oldterms', { phone_number: '+919000000078' }).firestore(), 'feedback/k5'), { userId: 'oldterms', stars: 4, text: 'x', createdAt: serverTimestamp() }));
  });

  test('V137-5: private registration: unallocated pincode prefixes and a client-written district/state are refused', async () => {
    const reg = (d) => setDoc(doc(ctx('bob').firestore(), 'users/bob/private/registration'), { dob: '2000-05-20', email: null, pincode: '110001', district: null, state: null, ...d });
    await assertSucceeds(reg({}));
    for (const pin of ['560001', '400001', '700001', '999999', '682001']) await assertSucceeds(reg({ pincode: pin }));
    for (const pin of ['100001', '290001', '350001', '540001', '550001', '860001', '000001']) await assertFails(reg({ pincode: pin }));
    await assertFails(reg({ district: 'New Delhi' }));
    await assertFails(reg({ state: 'Delhi' }));
    await assertSucceeds(setDoc(doc(ctx('bob').firestore(), 'users/bob/private/registration'), { dob: '2000-05-20', email: null, pincode: '110001' })); // keys may be absent
  });

  test('V137-5: daily items refuse control / zero-width / bidi characters in every text field', async () => {
    const di = (id, over) => setDoc(doc(admin().firestore(), `dailyItems/${id}`), { type: 'fact', textEn: 'Court 18 x 9 m', textHi: 'कोर्ट 18 x 9 मी', attribution: 'FIVB', sourceUrl: null, active: true, createdAt: serverTimestamp(), ...over });
    await assertSucceeds(di('c0', {}));
    for (const [k, v] of [['textEn', 'a\nb'], ['textEn', 'a\u0000b'], ['textHi', 'क\u200Bख'], ['attribution', 'FI\u202EVB'], ['textEn', 'x\uFEFF']]) await assertFails(di(`c-${k}`, { [k]: v }));
    const quote = { type: 'quote', textEn: 'Q', textHi: 'क्यू', attribution: 'Someone', sourceUrl: 'https://example.org/q' };
    await assertSucceeds(di('q0', quote));
    await assertFails(di('q1', { ...quote, sourceUrl: 'https://exa\u200Bmple.org' }));
    await assertFails(di('q2', { ...quote, sourceUrl: 'https://example.org/a b' }));
  });
});


describe('1.3.9: tester findings V138-3 / V138-4', () => {
  const now = Date.now();
  const admin = () => env.authenticatedContext('adm', { admin: true });
  const won3 = { setsA: 3, setsB: 0, currentA: 25, currentB: 0, setScores: [{ a: 25, b: 0 }, { a: 25, b: 0 }, { a: 25, b: 0 }], winner: 'A', serving: 'A' };
  const log = (n) => Array.from({ length: n }, (_, i) => ({ type: 'point', side: i % 2 ? 'B' : 'A', at: now + i }));
  const seedDone = (verification) => env.withSecurityRulesDisabled((c) => setDoc(doc(c.firestore(), 'matches/h1'), matchDoc({ teamId: 't1', ids: T1 }, { teamId: 't2', ids: T2 }, {
    status: 'finished', events: log(75), summary: won3, finishedAt: now - 60000, finishedServerAt: new Date(now - 60000),
    startedServerAt: new Date(now - 3600000), playerOfMatchId: 'p1', createdAt: now, updatedAt: now, ...(verification ? { verification } : {}),
  })));
  const h1 = (who) => doc((typeof who === 'string' ? ctx(who) : who).firestore(), 'matches/h1');
  const answer = (v) => updateDoc(h1('eve'), { verification: { by: 'eve', at: serverTimestamp(), ...v } });
  beforeEach(() => env.withSecurityRulesDisabled((c) => setDoc(doc(c.firestore(), 'terms/adm'), { version: TERMS_VERSION, acceptedAt: new Date() })));

  test('V138-3: a new captain answer must carry the verdict (reject with or without a reason, confirm)', async () => {
    await seedDone(null);
    await assertFails(answer({ status: 'disputed' })); // tester's L1a: the 1.3.6 shape, no reason, no verdict
    await assertFails(answer({ status: 'disputed', reason: 'wrong score' }));
    await assertFails(answer({ status: 'confirmed' }));
    await assertFails(answer({ status: 'disputed', captain: 'confirmed' }));
    await assertSucceeds(answer({ status: 'disputed', captain: 'rejected' }));
    await seedDone(null);
    await assertSucceeds(answer({ status: 'disputed', captain: 'rejected', reason: 'wrong score' }));
    await seedDone(null);
    await assertSucceeds(answer({ status: 'confirmed', captain: 'confirmed' }));
  });

  test('V138-3: an admin approval after a captain answer must carry the verdict; nobody answered = none', async () => {
    const at = new Date(now - 5000);
    const review = (old, v) => updateDoc(h1(admin()), { verification: { ...old, reviewedBy: 'adm', reviewedAt: serverTimestamp(), ...v } });
    // a 1.3.8 reason-less rejection: tester's L1b (an outdated admin client drops `captain`) is refused
    const rej = { status: 'disputed', by: 'eve', at, captain: 'rejected' };
    await seedDone(rej);
    await assertFails(review({ by: 'eve', at }, { status: 'approved' }));
    await assertFails(review({ by: 'eve', at }, { status: 'approved', captain: 'confirmed' }));
    await assertSucceeds(review({ by: 'eve', at }, { status: 'approved', captain: 'rejected' }));
    await seedDone(rej);
    await assertFails(review({ by: 'eve', at }, { status: 'voided' }));
    await assertSucceeds(review({ by: 'eve', at }, { status: 'voided', captain: 'rejected' }));
    // a confirmation
    await seedDone({ status: 'confirmed', by: 'eve', at, captain: 'confirmed' });
    await assertFails(review({ by: 'eve', at }, { status: 'approved' }));
    await assertSucceeds(review({ by: 'eve', at }, { status: 'approved', captain: 'confirmed' }));
    // nobody answered (a flagged match): no verdict, and none may be added
    await seedDone(null);
    await assertFails(review({}, { status: 'approved', captain: 'confirmed' }));
    await assertSucceeds(review({}, { status: 'approved' }));
  });

  test('V138-4: every copy of the hidden-character set in firestore.rules equals src/core/text.ts HIDDEN_CHARS', () => {
    const rules = fs.readFileSync(path.join(__dirname, '../firestore.rules'), 'utf8');
    const text = fs.readFileSync(path.join(__dirname, '../src/core/text.ts'), 'utf8');
    const core = text.match(/export const HIDDEN_CHARS = '([^']+)'/)[1];
    // code points of a class body: \\uXXXX (core) or \\x{X} (rules) items and ranges; other items ignored
    const points = (body, re) => {
      const out = new Set();
      const items = [...body.matchAll(re)];
      for (const m of items) {
        const a = parseInt(m[1], 16);
        const b = m[2] ? parseInt(m[2], 16) : a;
        for (let c = a; c <= b; c++) out.add(c);
      }
      return out;
    };
    const coreSet = points(core, /\\\\u([0-9A-F]{4})(?:-\\\\u([0-9A-F]{4}))?/g);
    expect(coreSet.size).toBeGreaterThan(80);
    const R2 = /\\\\x\{([0-9A-F]+)\}(?:-\\\\x\{([0-9A-F]+)\})?/g;
    const classes = [...rules.matchAll(/\[\^?([^\]]*\\\\x\{FEFF\}[^\]]*)\]/g)].map((m) => m[1]).filter((b) => !b.includes('@')); // (email regexes: their own list)
    expect(classes.length).toBeGreaterThanOrEqual(15);
    const EDGE = new Set([0xA0, 0x1680, ...Array.from({ length: 11 }, (_, i) => 0x2000 + i), 0x2028, 0x2029, 0x202F, 0x205F, 0x3000, 0x115F, 0x1160, 0x3164, 0xFFA0, 0x2800]);
    const same = (a, b) => a.size === b.size && [...a].every((x) => b.has(x));
    for (const body of classes) {
      let set = points(body, R2);
      if (body.startsWith('\\\\s')) set = new Set([...set].filter((c) => !EDGE.has(c) || coreSet.has(c))); // edge classes add the trimmed spaces
      const minus = (xs) => new Set([...coreSet].filter((c) => !xs.includes(c)));
      const ok = same(set, coreSet) || same(set, minus([0x9, 0xA])); /* multi-line text: newline/tab allowed */
      if (!ok) throw new Error(`class differs from HIDDEN_CHARS: [${body.slice(0, 80)}…]`);
    }
  });

  test('V138-4: feedback refuses the whole hidden set (C1, U+00AD, U+061C, U+180E, U+2028/9, U+2060–2064); newline/tab fine', async () => {
    const fb = (id, text) => setDoc(doc(ctx('bob').firestore(), `feedback/${id}`), { userId: 'bob', stars: 4, text, appVersion: '1.3.9 (15)', createdAt: serverTimestamp() });
    await assertSucceeds(fb('ok', 'line one\nline two\tend'));
    for (const c of ['\u0085', '\u009B', '\u00AD', '\u061C', '\u180E', '\u2028', '\u2029', '\u2060', '\u2061', '\u2064', '\u200B', '\u202E', '\u2066', '\uFEFF', '\u0007'])
      await assertFails(fb(`h${c.charCodeAt(0).toString(16)}`, `a${c}b`));
    await assertFails(setDoc(doc(ctx('bob').firestore(), 'feedback/av'), { userId: 'bob', stars: 4, text: 'x', appVersion: '1.3.9\u2060', createdAt: serverTimestamp() }));
  });

  test('V138-4: names allow ZWNJ/ZWJ only between two Devanagari characters; other hidden characters refused', async () => {
    const name = (n) => setDoc(doc(ctx('bob').firestore(), 'users/bob'), { name: n, phone: PHONES.bob });
    await assertSucceeds(name('अक्\u200Dषय Rao'));
    await assertSucceeds(name('Bob न\u200Cय'));
    for (const bad of ['Bo\u200Db', 'Bob\u200D', '\u200Dराम', 'रा\u200D m', 'रा\u200C\u200Dम', 'Bo\u00ADb', 'Bo\u2060b', 'Bo\u2062b', 'Bo\u2028b', 'Bo\u0085b', 'Bo\u061Cb', 'Bo\u180Eb'])
      await assertFails(name(bad));
    // team names use the same check
    await assertSucceeds(updateDoc(doc(ctx('cap').firestore(), 'teams/t1'), { name: 'स्मै\u200Dशर्स' }));
    await assertFails(updateDoc(doc(ctx('cap').firestore(), 'teams/t1'), { name: 'Smash\u200Ders' }));
  });

  test('V138-4: daily items refuse the newly listed characters too', async () => {
    const di = (id, over) => setDoc(doc(admin().firestore(), `dailyItems/${id}`), { type: 'fact', textEn: 'Court 18 x 9 m', textHi: 'कोर्ट 18 x 9 मी', attribution: 'FIVB', sourceUrl: null, active: true, createdAt: serverTimestamp(), ...over });
    await assertSucceeds(di('n0', {}));
    for (const [i, c] of ['\u00AD', '\u2060', '\u2063', '\u2028', '\u061C', '\u180E', '\u0085'].entries()) await assertFails(di(`n${i + 1}`, { textEn: `Court${c}18` }));
  });

  test('V138-7: dailyItems.createdAt is the server time on create (1.4.2: required) and never changes', async () => {
    const ref = (id) => doc(admin().firestore(), `dailyItems/${id}`);
    const base = { type: 'fact', textEn: 'Court 18 x 9 m', textHi: 'कोर्ट 18 x 9 मी', attribution: null, sourceUrl: null, active: true };
    await assertSucceeds(setDoc(ref('c1'), { ...base, createdAt: serverTimestamp(), updatedAt: serverTimestamp() }));
    await assertFails(setDoc(ref('c0'), base)); // 1.4.2 (V141-3): a create without createdAt is refused
    await env.withSecurityRulesDisabled((c) => setDoc(doc(c.firestore(), 'dailyItems/c0'), base)); // a 1.3.8-era doc
    await assertFails(setDoc(ref('c2'), { ...base, createdAt: new Date(now - 86400000) })); // back-dated
    await assertFails(setDoc(ref('c3'), { ...base, createdAt: new Date(now + 86400000) })); // forward-dated
    const created = (await getDoc(ref('c1'))).get('createdAt');
    await assertSucceeds(setDoc(ref('c1'), { ...base, textEn: 'Edited', createdAt: created, updatedAt: serverTimestamp() }));
    await assertFails(setDoc(ref('c1'), { ...base, createdAt: serverTimestamp() })); // re-stamped = moved to "new"
    await assertFails(setDoc(ref('c1'), base)); // removed
    await assertFails(setDoc(ref('c0'), { ...base, createdAt: serverTimestamp() })); // added later
  });

  test('V137-4: users/{uid}/private/review holds server timestamps only, owner only', async () => {
    const rv = (who, uid = who) => doc(ctx(who).firestore(), `users/${uid}/private/review`);
    await assertSucceeds(setDoc(rv('bob'), { checkedAt: serverTimestamp() }, { merge: true }));
    await assertSucceeds(getDoc(rv('bob')));
    await assertSucceeds(setDoc(rv('bob'), { lastAskedAt: serverTimestamp() }, { merge: true }));
    await assertSucceeds(setDoc(rv('bob'), { checkedAt: serverTimestamp() }, { merge: true })); // lastAskedAt kept
    await assertFails(setDoc(rv('bob'), { lastAskedAt: new Date(now - 90 * 86400000) }, { merge: true })); // back-dated
    await assertFails(setDoc(rv('bob'), { checkedAt: new Date(now + 86400000) }, { merge: true }));
    await assertFails(updateDoc(rv('bob'), { lastAskedAt: deleteField() })); // can't reset the cooldown
    await assertFails(setDoc(rv('bob'), { other: 1 }, { merge: true }));
    await assertFails(getDoc(rv('eve', 'bob')));
    await assertFails(setDoc(rv('eve', 'bob'), { checkedAt: serverTimestamp() }, { merge: true }));
    await assertFails(setDoc(doc(ctx('bob').firestore(), 'users/bob/private/other'), { checkedAt: serverTimestamp() }));
  });
});

describe('1.4.0: tester findings V139 (real serverTimestamp writes, email claims)', () => {
  const now = Date.now();
  const admin = () => env.authenticatedContext('adm', { admin: true });
  const won3 = { setsA: 3, setsB: 0, currentA: 25, currentB: 0, setScores: [{ a: 25, b: 0 }, { a: 25, b: 0 }, { a: 25, b: 0 }], winner: 'A', serving: 'A' };
  const log = (n) => Array.from({ length: n }, (_, i) => ({ type: 'point', side: i % 2 ? 'B' : 'A', at: now + i }));
  const seedDone = (verification) => env.withSecurityRulesDisabled((c) => setDoc(doc(c.firestore(), 'matches/k1'), matchDoc({ teamId: 't1', ids: T1 }, { teamId: 't2', ids: T2 }, {
    status: 'finished', events: log(75), summary: won3, finishedAt: now - 60000, finishedServerAt: new Date(now - 60000),
    startedServerAt: new Date(now - 3600000), playerOfMatchId: 'p1', createdAt: now, updatedAt: now, ...(verification ? { verification } : {}),
  })));
  const k1 = (who) => doc((typeof who === 'string' ? ctx(who) : who).firestore(), 'matches/k1');
  beforeEach(() => env.withSecurityRulesDisabled((c) => setDoc(doc(c.firestore(), 'terms/adm'), { version: TERMS_VERSION, acceptedAt: new Date() })));

  // The app's own clean() (src/services/backend/firebaseBackend.ts), transpiled from the source, so a
  // regression like 1.3.8's (sentinels turned into plain maps) fails here and not only on a device.
  // (1.4.4: clean() moved to firebaseMatchDoc.ts, which firebaseBackend re-exports; loaded from the source)
  const appClean = require('./appSource')('src/services/backend/firebaseMatchDoc.ts').clean;
  // 1.3.8's clean(): recursed into every object, so serverTimestamp() became {} – the emulator refuses it
  const clean138 = (v) => (Array.isArray(v) ? v.map(clean138) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).filter(([, x]) => x !== undefined).map(([k, x]) => [k, clean138(x)])) : v);
  // firebaseBackend.verify / reviewMatch payloads, field for field
  const captainWrite = (clean, status) => {
    const captain = status === 'confirmed' ? 'confirmed' : 'rejected';
    return updateDoc(k1('eve'), { verification: clean({ status, captain, by: 'eve', at: serverTimestamp(), reason: undefined }), updatedAt: Date.now() });
  };
  const reviewWrite = async (clean, decision) => {
    const s = await getDoc(k1(admin()));
    const old = s.data().verification ?? {};
    return updateDoc(k1(admin()), { verification: clean({ by: old.by, at: old.at, reason: old.reason, captain: old.captain ?? undefined, status: decision === 'approve' ? 'approved' : 'voided', reviewedBy: 'adm', reviewedAt: serverTimestamp() }), updatedAt: Date.now() });
  };

  test('captain confirm and reject through the app\'s clean() with a real serverTimestamp succeed (1.3.8\'s clean() is refused)', async () => {
    expect(typeof appClean).toBe('function');
    await seedDone(null);
    await assertFails(captainWrite(clean138, 'confirmed')); // the bug the 1.3.9 suite missed
    await assertSucceeds(captainWrite(appClean, 'confirmed'));
    const v = (await getDoc(k1(admin()))).data().verification;
    expect(v.at && typeof v.at.toMillis).toBe('function'); // stored as a real timestamp
    expect(Math.abs(v.at.toMillis() - Date.now())).toBeLessThan(120000);
    await seedDone(null);
    await assertSucceeds(captainWrite(appClean, 'disputed'));
  });

  test('admin review through the app\'s clean() with a real serverTimestamp succeeds after a captain answer and on a flagged match', async () => {
    await seedDone(null);
    await assertSucceeds(captainWrite(appClean, 'disputed')); // captain's real-timestamp answer first
    await assertFails(reviewWrite(clean138, 'approve'));
    await assertSucceeds(reviewWrite(appClean, 'approve'));
    const v = (await getDoc(k1(admin()))).data().verification;
    expect(v.status).toBe('approved');
    expect(v.captain).toBe('rejected');
    expect(typeof v.reviewedAt.toMillis).toBe('function');
    await seedDone(null); // nobody answered
    await assertSucceeds(reviewWrite(appClean, 'void'));
    await seedDone(null);
    await assertSucceeds(captainWrite(appClean, 'confirmed'));
    await assertSucceeds(reviewWrite(appClean, 'approve'));
  });

  // ---- V139-3: one email per account ----
  const okReg = { dob: '2000-05-20', email: null, pincode: '110001', district: null, state: null };
  const claimId = (e) => e.replace(/%/g, '%25').replace(/\//g, '%2F'); // = core/registration.ts emailClaimId
  const peek = async (id) => {
    let out;
    await env.withSecurityRulesDisabled(async (c) => { const d = await getDoc(doc(c.firestore(), `emails/${id}`)); out = d.exists() ? d.data() : null; });
    return out;
  };
  const save = (uid, email, { claim = true, release = null } = {}) => {
    const db = ctx(uid).firestore();
    const b = writeBatch(db);
    b.set(doc(db, `users/${uid}/private/registration`), { ...okReg, email });
    if (claim && email) b.set(doc(db, `emails/${claimId(email)}`), { uid });
    if (release) b.delete(doc(db, `emails/${claimId(release)}`));
    return b.commit();
  };

  test('V139-3: a new email must be claimed in the same write; the first account keeps it', async () => {
    await assertFails(save('bob', 'a@b.in', { claim: false }));
    await assertSucceeds(save('bob', 'a@b.in'));
    await assertFails(save('eve', 'a@b.in')); // the claim exists: create becomes an update – refused
    await assertFails(save('eve', 'a@b.in', { claim: false }));
    // a claim only for the email the same write stores, only for yourself
    await assertFails(setDoc(doc(ctx('eve').firestore(), 'emails/x@y.in'), { uid: 'eve' }));
    const db = ctx('eve').firestore();
    let b = writeBatch(db);
    b.set(doc(db, 'users/eve/private/registration'), { ...okReg, email: 'e@y.in' });
    b.set(doc(db, 'emails/e@y.in'), { uid: 'bob' });
    await assertFails(b.commit());
    b = writeBatch(db);
    b.set(doc(db, 'users/eve/private/registration'), { ...okReg, email: 'e@y.in' });
    b.set(doc(db, 'emails/e@y.in'), { uid: 'eve', extra: 1 });
    await assertFails(b.commit());
    // unchanged email re-saved: no new claim needed
    await assertSucceeds(save('bob', 'a@b.in', { claim: false }));
  });

  test('V139-3: claims are private (own or missing only), never listed, never updated', async () => {
    await assertSucceeds(save('bob', 'a@b.in'));
    await assertSucceeds(getDoc(doc(ctx('bob').firestore(), 'emails/a@b.in')));
    await assertFails(getDoc(doc(ctx('eve').firestore(), 'emails/a@b.in'))); // → "email already used" in the app
    await assertSucceeds(getDoc(doc(ctx('eve').firestore(), 'emails/free@b.in')));
    await assertFails(getDocs(collection(ctx('bob').firestore(), 'emails')));
    await assertFails(setDoc(doc(ctx('bob').firestore(), 'emails/a@b.in'), { uid: 'bob' })); // update
    await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(), 'emails/free@b.in')));
  });

  test('V139-3: changing the email releases the old claim; only the owner, only when no longer stored', async () => {
    await assertSucceeds(save('bob', 'a@b.in'));
    await assertFails(deleteDoc(doc(ctx('bob').firestore(), 'emails/a@b.in'))); // still bob's stored email
    await assertFails(deleteDoc(doc(ctx('eve').firestore(), 'emails/a@b.in')));
    await assertSucceeds(save('bob', 'c@d.in', { release: 'a@b.in' }));
    await assertSucceeds(save('eve', 'a@b.in')); // free again
    await assertSucceeds(save('bob', null, { release: 'c@d.in' })); // removing the email releases too
    expect(await peek('c@d.in')).toBe(null);
    expect(await peek('a@b.in')).toEqual({ uid: 'eve' });
  });

  test('V139-3: a 1.3.7–1.3.9 account (email stored, no claim) can still save; addresses with % or / are escaped', async () => {
    await env.withSecurityRulesDisabled((c) => setDoc(doc(c.firestore(), 'users/bob/private/registration'), { ...okReg, email: 'old@b.in' }));
    await assertSucceeds(save('bob', 'old@b.in', { claim: false }));
    await assertSucceeds(save('bob', 'a/b%c@d.in'));
    expect(await peek('a%2Fb%25c@d.in')).toEqual({ uid: 'bob' });
    const src = fs.readFileSync(path.join(__dirname, '../src/core/registration.ts'), 'utf8');
    expect(src).toContain("key.replace(/%/g, '%25').replace(/\\//g, '%2F')");
  });
});

describe('1.4.1: tester findings V140', () => {
  const admin = () => env.authenticatedContext('adm', { admin: true });
  beforeEach(() => env.withSecurityRulesDisabled((c) => setDoc(doc(c.firestore(), 'terms/adm'), { version: TERMS_VERSION, acceptedAt: new Date() })));
  const okReg = { dob: '2000-05-20', email: null, pincode: '110001', district: null, state: null };
  const claimId = (e) => e.replace(/%/g, '%25').replace(/\//g, '%2F');
  const peek = async (id) => {
    let out;
    await env.withSecurityRulesDisabled(async (c) => { const d = await getDoc(doc(c.firestore(), `emails/${id}`)); out = d.exists() ? d.data() : null; });
    return out;
  };
  const save = (uid, email, { claim = true, release = null } = {}) => {
    const db = ctx(uid).firestore();
    const b = writeBatch(db);
    b.set(doc(db, `users/${uid}/private/registration`), { ...okReg, email });
    if (claim && email) b.set(doc(db, `emails/${claimId(email)}`), { uid });
    if (release) b.delete(doc(db, `emails/${claimId(release)}`));
    return b.commit();
  };

  test('V140-5: no claim hoarding – changing or removing the email must release the old claim in the same write', async () => {
    await assertSucceeds(save('eve', 'hoard1@x.in'));
    await assertFails(save('eve', 'hoard2@x.in')); // keeps hoard1's claim: refused
    await assertFails(save('eve', null)); // removing without releasing: refused
    await assertSucceeds(save('eve', 'hoard2@x.in', { release: 'hoard1@x.in' }));
    expect(await peek('hoard1@x.in')).toBe(null);
    await assertSucceeds(save('bob', 'hoard1@x.in')); // the victim can use it
    await assertSucceeds(save('eve', null, { release: 'hoard2@x.in' }));
    expect(await peek('hoard2@x.in')).toBe(null);
    // an old address with no claim (1.3.x) or claimed by someone else (FB-9a) needs no release
    await env.withSecurityRulesDisabled((c) => setDoc(doc(c.firestore(), 'users/eve/private/registration'), { ...okReg, email: 'legacy@x.in' }));
    await assertSucceeds(save('eve', 'new@x.in'));
    await env.withSecurityRulesDisabled(async (c) => {
      await setDoc(doc(c.firestore(), 'users/eve/private/registration'), { ...okReg, email: 'shared@x.in' });
      await setDoc(doc(c.firestore(), 'emails/shared@x.in'), { uid: 'bob' });
    });
    await assertSucceeds(save('eve', 'new2@x.in', { release: null }));
    expect(await peek('shared@x.in')).toEqual({ uid: 'bob' });
  });

  test('V140-6: any upper/title-case letter and any Unicode space are refused (not only ASCII A–Z)', async () => {
    await assertFails(save('bob', 'josÉ@x.in'));
    await assertFails(save('bob', 'bob2@x.in\u00A0'));
    await assertFails(save('bob', 'bo\u3000b@x.in'));
    await assertFails(save('bob', 'ǅx@x.in')); // title case
    await assertFails(save('bob', 'ΟΔΟΣ@x.in'));
    await assertSucceeds(save('bob', 'josé@x.in'));
    await assertSucceeds(save('eve', 'οδοσ@x.in'));
  });

  const BLANK = { textEn: '', textHi: '', attribution: null, sourceUrl: null };
  test('V140-7: dailyItems – removedAt is server time, set once; an item that is off is never turned back on in place; no deletes', async () => {
    const ref = (id) => doc(admin().firestore(), `dailyItems/${id}`);
    const base = { type: 'fact', textEn: 'Court 18 x 9 m', textHi: 'कोर्ट 18 x 9 मी', attribution: null, sourceUrl: null, active: true };
    await assertSucceeds(setDoc(ref('r1'), { ...base, createdAt: serverTimestamp() }));
    const now0 = { createdAt: serverTimestamp() }; // 1.4.2 (V141-3): required on create
    await assertFails(setDoc(ref('r0'), { ...base, ...now0, removedAt: serverTimestamp() })); // on, but "removed"
    await assertFails(setDoc(ref('r0'), { ...base, ...now0, active: false })); // created off without the server stamp
    await assertSucceeds(setDoc(ref('r0'), { ...base, ...now0, active: false, removedAt: serverTimestamp() }));
    await assertFails(setDoc(ref('r5'), { ...base, ...now0, deleted: true, active: false, removedAt: serverTimestamp(), textEn: '', textHi: '' })); // created deleted
    const created = (await getDoc(ref('r1'))).get('createdAt');
    await assertFails(updateDoc(ref('r1'), { active: false })); // off without removedAt
    await assertFails(updateDoc(ref('r1'), { active: false, removedAt: new Date(Date.now() - DAY) })); // back-dated
    await assertSucceeds(updateDoc(ref('r1'), { active: false, removedAt: serverTimestamp() }));
    const removed = (await getDoc(ref('r1'))).get('removedAt');
    await assertFails(updateDoc(ref('r1'), { removedAt: serverTimestamp() })); // re-stamped
    await assertFails(updateDoc(ref('r1'), { active: true, removedAt: null })); // back on in place
    await assertSucceeds(updateDoc(ref('r1'), { textEn: 'Edited while off' }));
    await assertFails(deleteDoc(ref('r1')));
    await assertFails(updateDoc(ref('r1'), { deleted: true })); // 1.4.2 (V141-6): a tombstone keeps no text
    await assertSucceeds(updateDoc(ref('r1'), { deleted: true, ...BLANK }));
    await assertFails(updateDoc(ref('r1'), { deleted: false }));
    await assertFails(updateDoc(ref('r1'), { textEn: 'Edited after delete' }));
    expect((await getDoc(ref('r1'))).get('createdAt')).toEqual(created);
    expect((await getDoc(ref('r1'))).get('removedAt')).toEqual(removed);
    // deleting an item that is on: off + deleted + server stamp in one write
    await assertSucceeds(setDoc(ref('r2'), { ...base, createdAt: serverTimestamp() }));
    await assertFails(updateDoc(ref('r2'), { deleted: true, ...BLANK })); // still on
    await assertSucceeds(updateDoc(ref('r2'), { deleted: true, active: false, removedAt: serverTimestamp(), ...BLANK }));
    // turning back on = a copy (new doc) + the old one marked deleted, in one batch (what the app does)
    await assertSucceeds(setDoc(ref('r3'), { ...base, ...now0, active: false, removedAt: serverTimestamp() }));
    const db = admin().firestore();
    const b = writeBatch(db);
    b.update(doc(db, 'dailyItems/r3'), { deleted: true, ...BLANK });
    b.set(doc(db, 'dailyItems/r4'), { ...base, createdAt: serverTimestamp() });
    await assertSucceeds(b.commit());
    // a doc turned off before 1.4.1 (no removedAt) stays without one (it is in no cycle; a stamp now would make
    // it a member of the running cycle and shift today's fact) – editing or deleting it keeps removedAt absent
    await env.withSecurityRulesDisabled((c) => setDoc(doc(c.firestore(), 'dailyItems/old'), { ...base, active: false }));
    await assertFails(updateDoc(ref('old'), { deleted: true, removedAt: serverTimestamp(), ...BLANK }));
    await assertSucceeds(updateDoc(ref('old'), { textEn: 'Edited while off' }));
    await assertSucceeds(updateDoc(ref('old'), { deleted: true, ...BLANK }));
  });

  test('V140-8: match createdAt can be neither set at create nor changed by an update', async () => {
    const A = { teamId: 't1', ids: T1 };
    const B = { teamId: 't2', ids: T2 };
    const base = (over = {}) => matchDoc(A, B, { location: PLACE, scheduledAt: Date.now() + DAY, ...over });
    await assertSucceeds(newMatch(base())); // absent (what the app writes since 1.4.1)
    await assertFails(newMatch(base({ createdAt: Date.now() }))); // any client value
    await assertFails(newMatch(base({ createdAt: serverTimestamp() })));
    await assertFails(newMatch(base({ createdAt: 1 })));
    await assertFails(newMatch(base({ createdAt: Date.now() - DAY })));
    await assertFails(newMatch(base({ createdAt: Date.now() + DAY })));
    await assertFails(newMatch(base({ createdAt: String(Date.now()) })));
    await assertFails(newMatch(base({ status: 'live', createdAt: 1 })));
    const m1 = doc(ctx('cap').firestore(), 'matches/m1'); // live, cap scores
    await assertFails(updateDoc(m1, { createdAt: 1 }));
    await env.withSecurityRulesDisabled((c) => setDoc(doc(c.firestore(), 'matches/s9'), base({ status: 'scheduled', createdAt: new Date() })));
    await assertFails(updateDoc(doc(ctx('cap').firestore(), 'matches/s9'), { createdAt: 1 }));
    await assertSucceeds(updateDoc(doc(ctx('cap').firestore(), 'matches/s9'), { title: 'Renamed' }));
  });
});

describe('1.4.2: tester findings V141', () => {
  const admin = () => env.authenticatedContext('adm', { admin: true });
  beforeEach(() => env.withSecurityRulesDisabled((c) => setDoc(doc(c.firestore(), 'terms/adm'), { version: TERMS_VERSION, acceptedAt: new Date() })));
  const okReg = { dob: '2000-05-20', email: null, pincode: '110001', district: null, state: null };
  const claimId = (e) => e.replace(/%/g, '%25').replace(/\//g, '%2F');
  // (bob, a registered user with the current T&C; a successful save releases bob's previous claim)
  let last = null;
  const save = async (_uid, email) => {
    const db = ctx('bob').firestore();
    const b = writeBatch(db);
    b.set(doc(db, 'users/bob/private/registration'), { ...okReg, email });
    if (email) b.set(doc(db, `emails/${claimId(email)}`), { uid: 'bob' });
    if (last) b.delete(doc(db, `emails/${claimId(last)}`));
    await b.commit();
    last = email;
  };
  beforeEach(() => (last = null));
  const base = { type: 'fact', textEn: 'Court 18 x 9 m', textHi: 'कोर्ट 18 x 9 मी', attribution: null, sourceUrl: null, active: true };
  const ref = (id) => doc(admin().firestore(), `dailyItems/${id}`);

  test('V141-3: a daily item create needs createdAt = server time (absent, client or dated values refused)', async () => {
    await assertFails(setDoc(ref('k1'), base));
    await assertFails(setDoc(ref('k1'), { ...base, createdAt: null }));
    await assertFails(setDoc(ref('k1'), { ...base, createdAt: new Date() }));
    await assertFails(setDoc(ref('k1'), { ...base, createdAt: Date.now() }));
    await assertSucceeds(setDoc(ref('k1'), { ...base, createdAt: serverTimestamp() }));
  });

  test('V141-4: capitals RE2 misses or that are not Lu are refused (Mtavruli, Cherokee, Ⓐ, Ⅰ), and unfolded letters', async () => {
    let n = 0;
    for (const bad of ['\u1C90x@x.in', '\u13A0x@x.in', '\u24B6x@x.in', '\u2160x@x.in', 'x@\u1C90x.in', 'x@x.\u24B6\u24B7', '\u10A0x@x.in', 'ς1@x.in', 'a\u0345@x.in', 'ſ@x.in'])
      await assertFails(save(`u${n++}`, bad));
    // their lower-case forms (what the app stores after emailFold) are fine in the vetted scripts
    for (const good of ['σ1@x.in', 'aι@x.in'])
      await assertSucceeds(save(`v${n++}`, good));
    // 1.4.3 (QA V142-5): Georgian, Cherokee, circled and Roman-numeral forms are outside the allow list now –
    // the app refuses them too (email_chars), so Firebase never refuses something the app accepted
    for (const nowBad of ['\u10D0x@x.in', '\uAB70x@x.in', '\u24D0x@x.in', '\u2170x@x.in'])
      await assertFails(save(`v${n++}`, nowBad));
  });

  test('V141-5: invisible / filler characters are refused in an address (local part, domain and TLD)', async () => {
    let n = 0;
    const inv = ['\u3164', '\u115F', '\u1160', '\uFFA0', '\u034F', '\u2800', '\u200B', '\u2060', '\u206A', '\uFE0F', '\u180B', '\u202E', '\u2066', '\u{E0041}', '\u{1D173}', '\u17B4'];
    for (const c of inv) {
      await assertFails(save(`w${n++}`, `bo${c}b@x.in`));
      await assertFails(save(`w${n++}`, `bob@x${c}.in`));
      await assertFails(save(`w${n++}`, `bob@x.in${c}`));
    }
    await assertSucceeds(save('w-ok', 'bob.k@x.in'));
  });

  test('V141-6: a deleted daily item keeps no text (public read); a 1.4.1 tombstone with text may only be scrubbed', async () => {
    const BLANK = { textEn: '', textHi: '', attribution: null, sourceUrl: null };
    await assertSucceeds(setDoc(ref('t1'), { ...base, createdAt: serverTimestamp() }));
    await assertFails(updateDoc(ref('t1'), { deleted: true, active: false, removedAt: serverTimestamp() })); // text kept
    await assertFails(updateDoc(ref('t1'), { deleted: true, active: false, removedAt: serverTimestamp(), textEn: '', textHi: '', attribution: 'x' }));
    await assertSucceeds(updateDoc(ref('t1'), { deleted: true, active: false, removedAt: serverTimestamp(), ...BLANK }));
    const pub = (await getDoc(doc(env.unauthenticatedContext().firestore(), 'dailyItems/t1'))).data();
    expect([pub.textEn, pub.textHi, pub.deleted]).toEqual(['', '', true]);
    await assertFails(updateDoc(ref('t1'), { textEn: 'back' }));
    // a quote tombstone needs neither attribution nor source any more
    await assertSucceeds(setDoc(ref('t2'), { ...base, type: 'quote', attribution: 'A', sourceUrl: 'https://e.org/q', createdAt: serverTimestamp() }));
    await assertSucceeds(updateDoc(ref('t2'), { deleted: true, active: false, removedAt: serverTimestamp(), ...BLANK }));
    // a tombstone written by 1.4.1 (text still there): scrubbing is allowed, nothing else
    const at = new Date(Date.now() - 86400000);
    await env.withSecurityRulesDisabled((c) => setDoc(doc(c.firestore(), 'dailyItems/t3'), { ...base, active: false, deleted: true, removedAt: at, createdAt: at }));
    await assertFails(updateDoc(ref('t3'), { textEn: 'Changed' }));
    await assertFails(updateDoc(ref('t3'), { ...BLANK, deleted: false }));
    await assertFails(updateDoc(ref('t3'), { ...BLANK, removedAt: serverTimestamp() }));
    await assertSucceeds(updateDoc(ref('t3'), { ...BLANK }));
    await assertFails(updateDoc(ref('t3'), { ...BLANK, updatedAt: serverTimestamp() })); // once scrubbed it is frozen
  });

  test('V141-7: a scheduled time is a safe integer at most 2 years ahead', async () => {
    const A = { teamId: 't1', ids: T1 };
    const B = { teamId: 't2', ids: T2 };
    const mk = (scheduledAt) => newMatch(matchDoc(A, B, { location: PLACE, scheduledAt }));
    await assertFails(mk(2 ** 53));
    await assertFails(mk(1e300));
    await assertFails(mk(Date.now() + 3 * 365 * DAY));
    await assertSucceeds(mk(Date.now() + 365 * DAY));
  });
});

describe('1.4.3: tester findings V142-5/V142-6 (email allow list)', () => {
  const okReg = { dob: '2000-05-20', email: null, pincode: '110001', district: null, state: null };
  const claimId = (e) => e.replace(/%/g, '%25').replace(/\//g, '%2F');
  // each address on its own user (no claim release needed): uid = 'e' + counter
  let n = 0;
  const save = async (email) => {
    const uid = `e${n++}`;
    PHONES[uid] = PHONES[uid] || `+9198${String(10000000 + n).slice(-8)}`;
    const db = ctx(uid).firestore();
    await env.withSecurityRulesDisabled((c) => setDoc(doc(c.firestore(), `terms/${uid}`), { version: TERMS_VERSION, acceptedAt: new Date() }));
    const b = writeBatch(db);
    b.set(doc(db, `users/${uid}/private/registration`), { ...okReg, email });
    if (email) b.set(doc(db, `emails/${claimId(email)}`), { uid });
    return b.commit();
  };
  // the app's generated class (src/core/emailChars.ts), transpiled from the source
  const chars = (() => {
    const ts = require('../node_modules/typescript');
    const src = fs.readFileSync(path.join(__dirname, '../src/core/emailChars.ts'), 'utf8');
    const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 } }).outputText;
    const m = { exports: {} };
    new Function('module', 'exports', js)(m, m.exports);
    return m.exports;
  })();
  const rulesText = fs.readFileSync(path.join(__dirname, '../firestore.rules'), 'utf8');
  const allowed = new RegExp(`^[${chars.EMAIL_LETTERS}]$`);

  test('V142-5: firestore.rules uses exactly the app\'s generated letters (local part, domain and TLD)', () => {
    const fn = /function emailLetters\(\) \{\s*return '([^']*)';/.exec(rulesText);
    expect(fn).not.toBeNull();
    expect(fn[1]).toBe(chars.EMAIL_LETTERS_RULES);
    // and the rules class is the same set as the app's (JS reading of both)
    for (let cp = 0x80; cp < 0x10000; cp++) {
      const c = String.fromCharCode(cp);
      if (new RegExp(`^[${fn[1]}]$`, 'u').test(c) !== allowed.test(c)) throw new Error(`differs at U+${cp.toString(16)}`);
    }
    expect(/emailOk\(e\) \{\s*let l = emailLetters\(\);\s*return e\.matches\('\^\[-a-z0-9[^']*' \+ l \+ '[^']*' \+ l \+ '[^']*' \+ l \+ '[^']*'\)\s*&& emailJoinOk\(e\)/.test(rulesText)).toBe(true); // 1.4.4: + emailJoinOk / emailPartsOk
    expect(rulesText).not.toMatch(/\\\\p\{Lu\}/); // the old deny list is gone
  });

  test('V142-5: every remaining Tester capital (288 RE2 misses) and every non-vetted letter is refused', async () => {
    // all Lu/Lt in Unicode that RE2 might not know, sampled: every 4th of the BMP+SMP capitals, plus Tester's ones
    const caps = [];
    for (let cp = 0x80; cp < 0x20000; cp++) if (/^[\p{Lu}\p{Lt}]$/u.test(String.fromCodePoint(cp))) caps.push(cp);
    const sample = caps.filter((_, i) => i % 12 === 0).concat([0x1c89, 0xa7cb, 0xa7da, 0x10d50, 0x16ea0, 0x1e900]);
    for (const cp of sample) await assertFails(save(`a${String.fromCodePoint(cp)}@x.in`));
    for (const s of ['ⓐ@x.in', 'x@例え.jp', 'محمد@x.in', 'a😀@x.in', 'a℃@x.in', '\u10D0@x.in'])
      await assertFails(save(s));
  });

  test('V142-6: every Cf, Cc, Zs, Zl, Zp character (generated from Unicode data) and Co/Cn samples are refused', async () => {
    const bad = [];
    for (let cp = 0; cp < 0x110000; cp++) {
      if (cp >= 0xd800 && cp <= 0xdfff) continue;
      const c = String.fromCodePoint(cp);
      if (/^[\p{Cf}\p{Cc}\p{Zs}\p{Zl}\p{Zp}]$/u.test(c)) bad.push(c);
    }
    expect(bad.length).toBeGreaterThan(250);
    for (const c of ['\u0378', '\u0A04', '\u{2FFFF}', '\uFDD0']) expect(/^\p{Cn}$/u.test(c)).toBe(true);
    // Co (private use) and Cn (unassigned) cover ~1M code points: block starts/ends and some in between
    bad.push('\uE000', '\uF8FF', '\u{F0000}', '\u{10FFFD}', '\u0378', '\u0A04', '\u{2FFFF}', '\uFDD0', '\uFFFE');
    for (const c of bad) {
      expect(allowed.test(c)).toBe(false);
      await assertFails(save(`ab${c}c@x.in`));
    }
    // Tester's probes: format characters inside the local part, domain and TLD
    for (const c of ['\uFFF9', '\uFFFA', '\uFFFB', '\u0600', '\u0605', '\u{13430}', '\u{1BCA0}', '\u{E0001}']) {
      await assertFails(save(`a${c}b@x.in`));
      await assertFails(save(`ab@x${c}y.in`));
      await assertFails(save(`ab@xy.i${c}n`));
    }
  }, 300000);

  test('V142-5: what the app accepts is accepted – ASCII signs, Latin/Greek/Cyrillic lower case, Indian scripts', async () => {
    for (const s of ["o'brien+tag@x.in", 'a.b_c-d@sub.x-y.in', 'josé@x.in', 'çağrı@x.com.tr', 'οδοσ@x.gr', 'иван@почта.рф', 'राम@उदाहरण.भारत', 'ਪੰਜਾਬ@x.in', 'தமிழ்@x.in', 'ಕನ್ನಡ@x.in', 'x@xn--p1ai.in', 'a1!#$%&*/=?^_`{|}~@x.in'])
      await save(s).catch((e) => { throw new Error(`${s}: ${e.message}`); });
    // all generated letters pass in the local part (in chunks of 40 per address)
    const all = [];
    for (let cp = 0x80; cp < 0x10000; cp++) if (allowed.test(String.fromCharCode(cp))) all.push(String.fromCharCode(cp));
    expect(all.length).toBe(chars.EMAIL_LETTER_COUNT);
    for (let i = 0; i < all.length; i += 40) await assertSucceeds(save(`a${all.slice(i, i + 40).join('')}@x.in`));
  }, 300000);
});

// ================= 1.4.4: Tester's 1.4.3 findings V143-1..5 + the event cap =================
// Firebase no longer trusts the stored summary (firestore.rules "the stored summary is NOT trusted"): every
// probe of qa143.probe.js / qa143b / qa143c is reproduced here and either refused, or accepted with the app
// showing the result REPLAYED from the events (src/core/replay.ts, what firebaseBackend.matchFrom applies).
describe('1.4.4: V143-1..5 – untrusted summary, frozen replay inputs, abandon, create budget, event cap', () => {
  const app = require('./appSource');
  const { buildMatch } = app('src/core/buildMatch.ts');
  const FB = app('src/services/backend/firebaseMatchDoc.ts');
  const { replayStored } = app('src/core/replay.ts');
  const { MAX_EVENTS } = app('src/core/limits.ts');
  const { minWinEvents } = app('src/core/matchGuards.ts');
  const NOW = Date.now();
  let T0 = NOW - 3 * 3600000;
  const mkev = (s, extra = {}) => ({ type: 'point', side: s, at: (T0 += 1000), ...extra });
  const to = (s) => ({ type: 'timeout', side: s, at: (T0 += 1000) });
  const pts = (s, n) => Array.from({ length: n }, () => mkev(s));
  const A12 = ['cap', ...Array.from({ length: 11 }, (_, i) => `a${i + 1}`)];
  const B12 = Array.from({ length: 12 }, (_, i) => `b${i}`);
  const R3 = { ...RULES, bestOf: 3 };
  const seedM = (id, over) => env.withSecurityRulesDisabled((c) => setDoc(doc(c.firestore(), `matches/${id}`),
    matchDoc({ ids: A12 }, { ids: B12 }, { title: 'Final', location: PLACE, startedAt: NOW - 7200000, startedServerAt: new Date(NOW - 7200000), updatedAt: NOW, ...over })));
  const mref = (id, who = 'cap') => doc(ctx(who).firestore(), `matches/${id}`);
  const peek = async (id) => { let v; await env.withSecurityRulesDisabled(async (c) => { v = (await getDoc(doc(c.firestore(), `matches/${id}`))).data(); }); return v; };
  // what the app shows for a stored match (firebaseBackend.matchFrom → core replay)
  const shown = async (id) => { const d = await peek(id); return { ...replayStored(d), status: d.status }; };
  const finFields = () => ({ status: 'finished', finishedAt: Date.now(), finishedServerAt: serverTimestamp() });
  const fake = (base, over) => ({ ...EMPTY_SUMMARY, ...base, ...over });

  test('MAX_EVENTS (src/core/limits.ts) is the cap in firestore.rules; minWinEvents matches the app', () => {
    const rules = fs.readFileSync(path.join(__dirname, '../firestore.rules'), 'utf8');
    expect(MAX_EVENTS).toBe(3000);
    expect(rules).toContain(`return ns <= ${MAX_EVENTS} && (ns > os`);
    expect(rules).toContain(`n.size() <= ${MAX_EVENTS} && appendOk`);
    expect(rules).toMatch(/function minWinEvents\(r\) \{ return \(r\.bestOf \+ 1\) \/ 2 \* r\.pointsPerSet; \}/);
    expect(minWinEvents(RULES)).toBe(75);
    expect(minWinEvents(R3)).toBe(50);
    expect(rules).not.toMatch(/function (summaryStepOk|tallyOk|setDoneOk)\(/);
  });

  test('S (V143-1): set-ending rallies written as plain +1, re-opened sets, forged final summaries – accepted as display hints, the app shows the replay', async () => {
    // S1/S1b: 24:23 + A written as current 25:23, then 26:23
    let ev = [...pts('A', 24), ...pts('B', 23)];
    await seedM('s1', { status: 'live', events: ev, summary: fake({ currentA: 24, currentB: 23 }), rules: RULES });
    const nx = [...ev, mkev('A')];
    await assertSucceeds(updateDoc(mref('s1'), { events: nx, summary: fake({ currentA: 25, currentB: 23 }) }));
    let s = await shown('s1');
    expect(s.summary).toMatchObject({ setsA: 1, setsB: 0, currentA: 0, currentB: 0, setScores: [{ a: 25, b: 23 }] }); // the set IS closed
    expect(s.resultCheck).toBe('summary_mismatch'); // flagged for admin review
    // S4b: a winner claimed while live, and S8b: serving flipped – the app ignores both
    ev = pts('A', 24);
    await seedM('s4', { status: 'live', events: ev, rules: R3, summary: fake({ currentA: 24 }) });
    await assertSucceeds(updateDoc(mref('s4'), { events: [...ev, mkev('A')], summary: fake({ setsA: 2, winner: 'A', currentA: 25 }) }));
    s = await shown('s4');
    expect(s.summary.winner).toBeNull();
    expect(s.summary.setScores).toEqual([{ a: 25, b: 0 }]);
    await assertSucceeds(updateDoc(mref('s4'), { summary: fake({ serving: 'B' }) }));
    expect((await shown('s4')).summary.serving).toBe('B'); // derived from the events: set 2 is served by B (alternating)
    // S5: two rallies at once, a fake undo – still refused (the event step rules)
    ev = pts('A', 10);
    await seedM('s5', { status: 'live', events: ev, rules: RULES });
    await assertFails(updateDoc(mref('s5'), { events: [...ev, mkev('A'), mkev('A')] }));
    await assertFails(updateDoc(mref('s5'), { events: [...ev.slice(0, 4), ...ev.slice(5)] }));
    // S8c / S9: malformed summaries refused; a forged but well-shaped final summary is accepted and ignored
    await assertFails(updateDoc(mref('s5'), { summary: fake({ currentA: '5' }) }));
    ev = [...pts('A', 25), ...pts('A', 24)];
    for (const bad of [fake({ currentA: 'x' }), fake({ currentB: -5 }), fake({ currentA: 199, winner: 'Q' })]) {
      await seedM('s9', { status: 'live', events: ev, rules: R3 });
      await assertFails(updateDoc(mref('s9'), { events: [...ev, mkev('A')], summary: bad, ...finFields() }));
    }
    await seedM('s9', { status: 'live', events: ev, rules: R3 });
    await assertSucceeds(updateDoc(mref('s9'), { events: [...ev, mkev('A')], summary: fake({ setsA: 2, currentA: 199, winner: 'A' }), ...finFields() }));
    s = await shown('s9');
    expect(s.summary).toMatchObject({ setsA: 2, setsB: 0, winner: 'A', currentA: 25, currentB: 0 });
  });

  test('W (V143-1/V143-2): Tester\'s full attack – B wins 25:0 25:0 in the events, the summary claims A 52:50 25:0; the app shows B; no abandon after B\'s win', async () => {
    await seedM('w1', { status: 'live', events: [], rules: R3, summary: EMPTY_SUMMARY });
    let ev = [];
    let sum = { ...EMPTY_SUMMARY };
    const push = async (side, next, extra = {}) => { const nx = [...ev, mkev(side)]; await updateDoc(mref('w1'), { events: nx, summary: next, ...extra }); ev = nx; sum = next; };
    for (let i = 0; i < 50; i++) await push('B', { ...sum, currentB: sum.currentB + 1, serving: 'B' });
    // W1a: the events already have a winner (B) – 50 events = the shortest best-of-3 win, so the scorer can't abandon
    await assertFails(updateDoc(mref('w1'), { status: 'abandoned', finishedAt: Date.now(), updatedAt: Date.now() }));
    for (let i = 0; i < 51; i++) await push('A', { ...sum, currentA: sum.currentA + 1, serving: 'A' });
    await push('A', { setsA: 1, setsB: 0, currentA: 0, currentB: 0, setScores: [{ a: 52, b: 50 }], winner: null, serving: 'A' });
    for (let i = 0; i < 24; i++) await push('A', { ...sum, currentA: sum.currentA + 1, serving: 'A' });
    await push('A', { setsA: 2, setsB: 0, currentA: 25, currentB: 0, setScores: [{ a: 52, b: 50 }, { a: 25, b: 0 }], winner: 'A', serving: 'A' }, finFields());
    const st = await peek('w1');
    expect(st.status).toBe('finished');
    expect(st.summary.winner).toBe('A'); // what the forged client stored…
    const s = await shown('w1');
    expect(s.summary.winner).toBe('B'); // …and what the app shows: the replay (events after the win are ignored)
    expect(s.summary.setScores).toEqual([{ a: 0, b: 25 }, { a: 0, b: 25 }]);
    expect(s.resultCheck).toBe('summary_mismatch');
  });

  test('L (V143-2/V143-3): legacy and create probes; rules frozen once the first rally exists', async () => {
    // L1/L1b: a live create without / with a fake summary is accepted – the app replays the empty log (0-0)
    await assertSucceeds(setDoc(mref('l1'), matchDoc({ ids: ['u1', 'u2', 'u3', 'u4', 'u5', 'u6'] }, { ids: ['cap', 'w1', 'w2', 'w3', 'w4', 'w5', 'w6'] }, { ...liveNow(), summary: null, rules: R3 })));
    await assertSucceeds(setDoc(mref('l1b'), matchDoc({ ids: ['u1', 'u2', 'u3', 'u4', 'u5', 'u6'] }, { ids: ['cap', 'w1', 'w2', 'w3', 'w4', 'w5', 'w6'] }, { ...liveNow(), summary: fake({ setsA: 1, setScores: [{ a: 25, b: 0 }] }), rules: R3 })));
    expect((await shown('l1b')).summary).toMatchObject({ setsA: 0, setScores: [] });
    // L1c: created with events – refused
    await assertFails(setDoc(mref('l1c'), matchDoc({ ids: ['u1', 'u2', 'u3', 'u4', 'u5', 'u6'] }, { ids: ['cap', 'w1', 'w2', 'w3', 'w4', 'w5', 'w6'] }, { ...liveNow(), events: pts('A', 50), rules: R3 })));
    // L2/L2b: a legacy doc without a summary takes the winning rally, but can no longer be abandoned by the scorer
    const e49 = pts('A', 49);
    await env.withSecurityRulesDisabled(async (c) => {
      await setDoc(doc(c.firestore(), 'matches/l2'), matchDoc({ ids: A12 }, { ids: B12 }, { status: 'live', events: e49, rules: R3, startedAt: NOW - 3600000, startedServerAt: new Date(NOW - 3600000) }));
      await updateDoc(doc(c.firestore(), 'matches/l2'), { summary: deleteField() });
    });
    await assertSucceeds(updateDoc(mref('l2'), { events: [...e49, mkev('A')] }));
    await assertFails(updateDoc(mref('l2'), { status: 'abandoned', finishedAt: Date.now() }));
    expect((await shown('l2')).summary.winner).toBe('A');
    // L3/L4: rules-only write mid-match, and rules + rally – refused (V143-3)
    const e10 = pts('B', 10);
    await seedM('l3', { status: 'live', events: e10, rules: R3 });
    await assertFails(updateDoc(mref('l3'), { rules: { ...R3, pointsPerSet: 11 } }));
    await assertFails(updateDoc(mref('l3'), { rules: { ...R3, pointsPerSet: 11 }, events: [...e10, mkev('B')] }));
    await assertFails(updateDoc(mref('l3'), { firstServe: 'B' }));
    // the live doc in F/LV: lineups of a set already stored can't change mid-match; abandon below the shortest win works
    const lv = pts('A', 30);
    await seedM('lv', { status: 'live', events: lv, rules: R3, lineups: { 1: { A: A12.slice(0, 6), B: B12.slice(0, 6) } } });
    await assertFails(updateDoc(mref('lv'), { lineups: { 1: { A: A12.slice(1, 7), B: B12.slice(0, 6) } }, updatedAt: Date.now() }));
    await assertSucceeds(updateDoc(mref('lv'), { lineups: { 1: { A: A12.slice(0, 6), B: B12.slice(0, 6) }, 2: { A: A12.slice(1, 7), B: B12.slice(0, 6) } }, updatedAt: Date.now() }));
    await assertSucceeds(updateDoc(mref('lv'), { status: 'abandoned', finishedAt: Date.now(), updatedAt: Date.now(), abandon: abRec('cap', 30) })); // 30 < 50
  });

  test('V143-2: a premature "finished" (no winner in the events) is accepted only past the shortest win and shows as flagged, never counted', async () => {
    const ev = [...pts('A', 25), ...pts('B', 25)]; // 1-1 in sets, 50 events
    await seedM('pf', { status: 'live', events: ev, rules: R3 });
    await assertSucceeds(updateDoc(mref('pf'), { summary: fake({ setsA: 2, winner: 'A' }), ...finFields() }));
    const s = await shown('pf');
    expect(s.summary.winner).toBeNull();
    expect(s.resultCheck).toBe('finished_without_winner');
    const { isCompleted, resultState, matchFlags } = app('src/core/antifraud.ts');
    const m = { ...(await peek('pf')), ...s, id: 'pf', playerOfMatchId: 'a1', finishedServerAt: Date.now(), startedServerAt: Date.now() - 3600000 };
    expect(isCompleted(m)).toBe(false);
    expect(resultState(m)).toBe('flagged');
    expect(matchFlags(m)).toContain('result_mismatch');
  });

  // ---- V143-5: the create documents the app really writes (firebaseBackend.createMatch → firebaseMatchDoc.ts) ----
  const ids = (k, n) => Array.from({ length: n }, (_, i) => `${k}${i}`);
  const numSide = (k, n) => ({ teamId: null, name: `Side ${k.toUpperCase()}`, color: k === 'u' ? '#123456' : '#654321', players: ids(k, n).map((id) => ({ id, name: id.toUpperCase(), photoURL: null })) });
  const teamSide = (teamId, members) => ({ teamId, name: teamId === 'ta' ? 'Smashers' : 'Blockers', color: teamId === 'ta' ? '#123456' : '#654321', players: members.map((id) => ({ id, name: id.toUpperCase(), photoURL: null })) });
  const BIG_PLACE = { name: 'Siri Fort Sports Complex', lat: 28.55, lng: 77.22 };
  const appDoc = (o) => {
    const m = buildMatch({ rules: RULES, createdBy: 'cap', scorerId: 'cap', ...o });
    return FB.matchCreateDoc(FB.matchCreateChecked({ ...m, teamSizeMode: o.teamSizeMode ?? 'custom' }), Date.now(), serverTimestamp);
  };
  const SHAPES = {
    'start now, by number, 6 a side': () => appDoc({ teamA: numSide('u', 6), teamB: numSide('w', 6), startNow: true, scheduledAt: Date.now(), captains: { A: 'u0', B: 'w0' } }),
    'start now, by number, 12 a side, title + place': () => appDoc({ teamA: numSide('u', 12), teamB: numSide('w', 12), startNow: true, scheduledAt: Date.now(), title: 'Final of the Delhi league', location: BIG_PLACE, captains: { A: 'u0', B: 'w0' } }),
    'start now, by number, 12 a side, best of 3, custom rules': () => appDoc({ teamA: numSide('u', 12), teamB: numSide('w', 12), startNow: true, scheduledAt: Date.now(), rules: { ...RULES, preset: 'custom', bestOf: 3, pointsPerSet: 21, pointCap: 30, sideSwitchEvery: 7, decidingSideSwitchEvery: 5 }, title: 'Final', location: BIG_PLACE, captains: { A: 'u0', B: 'w0' } }),
    'team v team 12 a side, live, title + place': () => appDoc({ teamA: teamSide('ta', ['cap', ...ids('u', 11)]), teamB: teamSide('tb', ids('w', 12)), startNow: true, scheduledAt: Date.now(), title: 'Final of the Delhi league', location: BIG_PLACE, captains: { A: 'cap', B: 'w0' } }),
    'team v team exact 6, scheduled, title + place + time': () => appDoc({ teamA: teamSide('ta', ['cap', ...ids('u', 5)]), teamB: teamSide('tb', ids('w', 6)), scheduledAt: Date.now() + DAY, title: 'League', location: BIG_PLACE, captains: { A: 'cap', B: 'w0' }, teamSizeMode: 'exact' }),
    'scheduled by number 12 a side, title + place + time (custom)': () => appDoc({ teamA: numSide('u', 12), teamB: numSide('w', 12), scheduledAt: Date.now() + DAY, title: 'Final of the Delhi league', location: BIG_PLACE, captains: { A: 'u0', B: 'w0' } }),
    'scheduled by number 6 a side, creator not playing, title + place + time': () => appDoc({ teamA: numSide('u', 6), teamB: numSide('w', 6), scheduledAt: Date.now() + DAY, title: 'Friendly', location: BIG_PLACE, captains: { A: 'u0', B: 'w0' } }),
  };
  const seedCreate = async (e) => e.withSecurityRulesDisabled(async (c) => {
    const db = c.firestore();
    for (const id of [...ids('u', 12), ...ids('w', 12), 'cap']) await setDoc(doc(db, `users/${id}`), { name: id, phone: '+919800000000' });
    await setDoc(doc(db, 'terms/cap'), { version: TERMS_VERSION, acceptedAt: new Date() });
    await setDoc(doc(db, 'teams/ta'), { name: 'Smashers', captainId: 'cap', memberIds: ['cap', ...ids('u', 12)], subIds: [], pendingPhones: [] });
    await setDoc(doc(db, 'teams/tb'), { name: 'Blockers', captainId: 'w0', memberIds: ids('w', 12), subIds: [], pendingPhones: [] });
  });

  test('V143-5: every real create shape, built by the app\'s own builder, is accepted', async () => {
    await seedCreate(env);
    for (const [what, make] of Object.entries(SHAPES)) {
      try { await assertSucceeds(setDoc(doc(ctx('cap').firestore(), `matches/c${Math.random().toString(36).slice(2)}`), make())); } catch (e) { throw new Error(`${what}: ${e.message}`); }
    }
    // and the builder's output still meets the other create checks
    const d = SHAPES['start now, by number, 6 a side']();
    await assertFails(setDoc(doc(ctx('cap').firestore(), 'matches/cx1'), { ...d, startedServerAt: new Date(Date.now() - 3600000) }));
    await assertFails(setDoc(doc(ctx('cap').firestore(), 'matches/cx2'), { ...d, finishedServerAt: serverTimestamp() }));
    await assertFails(setDoc(doc(ctx('cap').firestore(), 'matches/cx3'), { ...d, playerOfMatchId: 'u1' }));
  });

  // Headroom: the same writes under rules padded with ~50 (create) / ~150 (update) extra expressions must still pass,
  // so the real rules keep at least that margin below the 1000-expression limit (emulator count; see RELEASE-1.4.4.md).
  const padRules = (rules, fn, k) => {
    const chunks = []; for (let r = k; r > 0; r -= 50) chunks.push(Math.min(50, r));
    const p = chunks.map((c, i) => `    function pad${fn}${i}() { return ${Array(c).fill('1 == 1').join(' && ')}; }\n`).join('')
      + `    function pad${fn}() { return ${chunks.map((_, i) => `pad${fn}${i}()`).join(' && ')}; }\n`;
    const re = new RegExp(`(\\n\\s*function ${fn}\\(\\) \\{\\n(\\s*let [^\\n]*\\n)*\\s*return )`);
    if (!re.test(rules)) throw new Error(`no ${fn}`);
    return rules.replace(re, (m) => `\n${p}${m.slice(1)}pad${fn}() && `);
  };
  test('V143-5 budget: the create shapes keep ≥ 50 spare expressions; the worst updates (3000 events, 12 v 12 + creator, every extra) ≥ 150', async () => {
    const base = fs.readFileSync(path.join(__dirname, '../firestore.rules'), 'utf8');
    const padded = padRules(padRules(base, 'createAllowed', 10), 'updateAllowed', 30); // 1 pad step ≈ 5 expressions
    const env2 = await initializeTestEnvironment({ projectId: 'demo-headroom', firestore: { rules: padded, ...hostPort(process.env.FIRESTORE_EMULATOR_HOST, 8080) } });
    WRAP_ENV = env2;
    try {
      await env2.clearFirestore();
      await seedCreate(env2);
      const c2 = (uid) => env2.authenticatedContext(uid, { phone_number: '+919000000001' }).firestore();
      for (const [what, make] of Object.entries(SHAPES)) {
        try { await assertSucceeds(setDoc(doc(c2('cap'), `matches/c${Math.random().toString(36).slice(2)}`), make())); } catch (e) { throw new Error(`${what}: ${e.message}`); }
      }
      // worst-case updates: real 28-character uids, MAX_EVENTS credited events
      const U = (k, i) => `${k}${i}`.padEnd(28, 'x');
      const PA = ['cap', ...Array.from({ length: 11 }, (_, i) => U('a', i + 1))];
      const PB = Array.from({ length: 12 }, (_, i) => U('b', i));
      await env2.withSecurityRulesDisabled(async (c) => {
        for (const id of [...PA, ...PB, 'bob']) await setDoc(doc(c.firestore(), `users/${id}`), { name: 'x', phone: '+919800000000' });
        for (const id of ['cap', PB[0]]) await setDoc(doc(c.firestore(), `terms/${id}`), { version: TERMS_VERSION, acceptedAt: new Date() });
      });
      const T = NOW - 6 * 3600000;
      const evs = (n) => Array.from({ length: n }, (_, i) => (i % 7 === 6 ? { type: 'timeout', side: i % 2 ? 'A' : 'B', at: T + i }
        : { type: 'point', side: i % 2 ? 'B' : 'A', at: T + i, playerId: i % 2 ? PB[5] : PA[5], kind: 'kill' }));
      const sideOf = (pl, k) => ({ teamId: null, name: `Side ${k}`, color: '#123456', players: pl.map((id) => ({ id, name: 'N', photoURL: null })) });
      const worst = (over) => ({ title: 'Final of the Delhi league', location: BIG_PLACE, teamA: sideOf(PA, 'A'), teamB: sideOf(PB, 'B'), rules: RULES, firstServe: 'A', events: [], summary: EMPTY_SUMMARY, status: 'live',
        createdBy: 'bob', scorerId: 'cap', participantIds: [...PA, ...PB, 'bob'], scheduledAt: NOW - 7200000, startedAt: NOW - 7200000, startedServerAt: new Date(NOW - 7200000), finishedAt: null,
        tournamentId: 'tn1', fixtureId: 'fx1', challengeId: 'ch1', stream: { provider: 'youtube', playbackUrl: 'https://youtu.be/x', live: true }, interestedIds: [], teamSizeMode: 'custom',
        captains: { A: 'cap', B: PB[0] }, lineups: { 1: { A: PA.slice(0, 6), B: PB.slice(0, 6) } }, updatedAt: NOW, ...over });
      const N = MAX_EVENTS;
      const run = async (what, seed, who, write) => {
        await env2.withSecurityRulesDisabled((c) => setDoc(doc(c.firestore(), 'matches/w'), seed));
        try { await assertSucceeds(updateDoc(doc(c2(who), 'matches/w'), write)); } catch (e) { throw new Error(`${what}: ${e.message}`); }
      };
      const done = { status: 'finished', finishedAt: NOW - 60000, finishedServerAt: new Date(NOW - 60000) };
      const credit = (l, i, p) => l.map((e, j) => (j === i ? { ...e, playerId: p, kind: 'tip' } : e));
      await run('finishing write at MAX_EVENTS', worst({ events: evs(N - 1) }), 'cap', { events: [...evs(N - 1), { type: 'point', side: 'A', at: NOW, playerId: PA[11], kind: 'ace' }], summary: fake({ setsA: 3, winner: 'A' }), ...finFields(), updatedAt: Date.now() });
      await run('rally to MAX_EVENTS', worst({ events: evs(N - 1) }), 'cap', { events: [...evs(N - 1), { type: 'point', side: 'B', at: NOW, playerId: PB[11], kind: 'block' }], updatedAt: Date.now() });
      await run('undo at MAX_EVENTS', worst({ events: evs(N) }), 'cap', { events: evs(N - 1), updatedAt: Date.now() });
      await run('re-credit two of the last 3 (live)', worst({ events: evs(N) }), 'cap', { events: credit(credit(evs(N), N - 2, PA[8]), N - 3, PB[9]), updatedAt: Date.now() });
      await run('re-credit on the finished match', worst({ events: evs(N), ...done }), 'cap', { events: credit(evs(N), N - 3, PB[9]), updatedAt: Date.now() });
      await run('POTM', worst({ events: evs(N), ...done }), 'cap', { playerOfMatchId: PB[11], updatedAt: Date.now() });
      await run('captain B confirms', worst({ events: evs(N), ...done, playerOfMatchId: PA[3] }), PB[0], { verification: { status: 'confirmed', by: PB[0], at: serverTimestamp(), captain: 'confirmed' }, updatedAt: Date.now() });
      await run('next set\'s lineup', worst({ events: evs(N - 10) }), 'cap', { lineups: { 1: { A: PA.slice(0, 6), B: PB.slice(0, 6) }, 2: { A: PA.slice(1, 7), B: PB.slice(0, 6) } }, updatedAt: Date.now() });
      // the event cap itself
      await env2.withSecurityRulesDisabled((c) => setDoc(doc(c.firestore(), 'matches/w'), worst({ events: evs(N) })));
      await assertFails(updateDoc(doc(c2('cap'), 'matches/w'), { events: [...evs(N), { type: 'point', side: 'A', at: NOW }], updatedAt: Date.now() }));
    } finally {
      WRAP_ENV = null;
      await env2.cleanup();
    }
  }, 300000);

  test('Info: the 2001st event of a legal long match is accepted now (Tester\'s B7)', async () => {
    const R99 = { ...RULES, pointsPerSet: 99, decidingSetPoints: 99 };
    const e2 = Array.from({ length: 2000 }, (_, i) => (i % 3 === 2 ? to(i % 2 ? 'A' : 'B') : mkev(i % 2 ? 'B' : 'A')));
    await seedM('b7', { status: 'live', events: e2, rules: R99 });
    await assertSucceeds(updateDoc(mref('b7'), { events: [...e2, mkev('A')] }));
  });
});

describe('1.4.4: V143-6 (unchanged email passes; wide list prepared, inactive) and V143-10 (email structure)', () => {
  const okReg = { dob: '2000-05-20', email: null, pincode: '110001', district: null, state: null };
  const claimId = (e) => e.replace(/%/g, '%25').replace(/\//g, '%2F');
  const L = require('../scripts/emailLists');
  let n = 0;
  // a fresh user on `e` (env), optionally with a stored registration (written as an older build / the console did)
  const user = async (e, stored) => {
    const uid = `v${n++}`;
    PHONES[uid] = `+9197${String(10000000 + n).slice(-8)}`;
    await e.withSecurityRulesDisabled(async (c) => {
      await setDoc(doc(c.firestore(), `terms/${uid}`), { version: TERMS_VERSION, acceptedAt: new Date() });
      if (stored !== undefined) await setDoc(doc(c.firestore(), `users/${uid}/private/registration`), { ...okReg, email: stored });
    });
    return { uid, db: e.authenticatedContext(uid, { phone_number: PHONES[uid] }).firestore() };
  };
  const saveNew = async (e, email) => {
    const { uid, db } = await user(e);
    const b = writeBatch(db);
    b.set(doc(db, `users/${uid}/private/registration`), { ...okReg, email });
    if (email) b.set(doc(db, `emails/${claimId(email)}`), { uid });
    return b.commit();
  };

  test('V143-6: a stored out-of-list / old-format address doesn\'t block a pincode save (Tester\'s probes); changing it to another bad one is refused', async () => {
    for (const legacy of ['张伟@example.com', 'a\u200bb@x.in', 'ab@ex..com', 'a@-x.in', `${'a'.repeat(70)}@x.in`]) {
      const { uid, db } = await user(env, legacy);
      await assertSucceeds(setDoc(doc(db, `users/${uid}/private/registration`), { ...okReg, email: legacy, pincode: '400001' }));
      await assertFails(setDoc(doc(db, `users/${uid}/private/registration`), { ...okReg, email: `x${legacy}`, pincode: '400001' }));
      await assertSucceeds(setDoc(doc(db, `users/${uid}/private/registration`), { ...okReg, email: null, pincode: '400001' }));
    }
    await assertFails(saveNew(env, '张伟@example.com')); // still no new user can use it
  });

  test('V143-10: double/leading/trailing dots, local part > 64, domain labels starting or ending with "-" are refused, like the app', async () => {
    for (const bad of ['.a@x.in', 'a.@x.in', 'a..b@x.in', 'a@x..in', `${'a'.repeat(65)}@x.in`, 'a@-x.in', 'a@x-.in', 'a@x.-in', 'a@x.in-', 'a@.x.in'])
      await assertFails(saveNew(env, bad));
    for (const ok of ['a.b@x.in', `${'a'.repeat(64)}@x.in`, 'a-@x.in', 'a@x-y.in', 'a-.b@x.in', 'अ.ब@उदाहरण.भारत'])
      await assertSucceeds(saveNew(env, ok));
  });

  test('V143-6: the rules carry the ACTIVE list (narrow in 1.4.4) and the generator is up to date', () => {
    const rulesText = fs.readFileSync(path.join(__dirname, '../firestore.rules'), 'utf8');
    expect(L.BLOCK_RE.exec(rulesText)[0]).toBe(L.rulesBlock(false));
    expect(require('child_process').spawnSync(process.execPath, [path.join(__dirname, '../scripts/gen-email-chars.js'), '--check']).status).toBe(0);
  });

  test('V143-6: the prepared WIDE rules (generated block swapped in) accept/refuse exactly like checkEmail(…, true)', async () => {
    const base = fs.readFileSync(path.join(__dirname, '../firestore.rules'), 'utf8');
    const wide = base.replace(L.BLOCK_RE, () => L.rulesBlock(true));
    const env2 = await initializeTestEnvironment({ projectId: 'demo-emailwide', firestore: { rules: wide, ...hostPort(process.env.FIRESTORE_EMULATOR_HOST, 8080) } });
    const { checkEmail } = require('./appSource')('src/core/registration.ts');
    try {
      await env2.clearFirestore();
      const cases = [
        'ᱚᱞᱪᱤᱠᱤ@x.in', 'ᱥᱟᱱᱛᱟᱲᱤ᱑᱒@x.in', 'ꯃꯤꯇꯩ@x.in', 'علی@x.in', 'پاکستان۱۲@x.in', 'کٲشُر@x.in', 'a@ھندی.in',
        'क्\u200Dष@x.in', 'क्\u200Cष@x.in', 'ক্\u200Cষ@x.in', 'a@क्\u200Dष.in', 'क\u200Cख\u200Dग@x.in', 'asha@x.in', 'अ.ब@उदाहरण.भारत',
        'ع\u0600@x.in', 'عـلی@x.in', 'ع٠@x.in', 'ᱚ᱾@x.in', 'ꯃ꯫@x.in', '张@x.in', '\u200Dक@x.in', 'क\u200D@x.in', 'a\u200Db@x.in',
        'क\u200Dক@x.in', 'क\u200C\u200Dख@x.in', 'ع\u200Cع@x.in', 'ᱚ\u200Dᱞ@x.in', 'क\u200D1@x.in', 'a..b@x.in', 'a@-x.in',
      ];
      const wrong = [];
      for (const e of cases) {
        let app = true;
        try { checkEmail(e, true); } catch { app = false; }
        let rules = true;
        try { await assertSucceeds(saveNew(env2, e)); } catch { rules = false; }
        if (app !== rules) wrong.push(`${JSON.stringify(e)} app=${app} rules=${rules}`);
      }
      expect(wrong).toEqual([]);
      // the wide rules' regular expressions stay under Firestore's 4096-character limit
      expect(L.rulesBlock(true).split('\n')[5].length).toBeLessThan(4096);
    } finally {
      await env2.cleanup();
    }
  });
});

// ================= 1.4.5: Tester's 1.4.4 findings V144-1..4, V144-8 and the PRD roster gap =================
// The abandon policy is NOT decided (Akshit): 'review' is the INTERIM default (src/core/abandonPolicy.ts); 'consent'
// is tested under a rules variant with the policy line switched (scripts/gen-abandon-policy.js writes the real one).
describe('1.4.5: abandon (maxEvents, wasWon, record, report, consent), admin resolve, handover, rosters', () => {
  const app = require('./appSource');
  const { ABANDON_POLICY } = app('src/core/abandonPolicy.ts');
  const NOW = Date.now();
  let T0 = NOW - 3 * 3600000;
  const mkev = (s) => ({ type: 'point', side: s, at: (T0 += 1000) });
  const pts = (s, n) => Array.from({ length: n }, () => mkev(s));
  const A12 = ['cap', ...Array.from({ length: 11 }, (_, i) => `a${i + 1}`)];
  const B12 = Array.from({ length: 12 }, (_, i) => `b${i}`);
  const R3 = { ...RULES, bestOf: 3 }; // shortest win 50
  const BO1 = { ...RULES, bestOf: 1, decidingSetPoints: 25 }; // shortest win 25
  const seedM = (id, over, e = env) => e.withSecurityRulesDisabled((c) => setDoc(doc(c.firestore(), `matches/${id}`),
    matchDoc({ ids: A12 }, { ids: B12 }, { title: 'Final', location: PLACE, status: 'live', rules: R3, startedAt: NOW - 7200000, startedServerAt: new Date(NOW - 7200000), updatedAt: NOW, ...over })));
  const as = (who, claims = {}, e = env) => e.authenticatedContext(who, { phone_number: '+919000000009', ...claims }).firestore();
  const mref = (id, who = 'cap', claims, e) => doc(claims || e ? as(who, claims, e) : ctx(who).firestore(), `matches/${id}`);
  const adm = (id, who = 'adm', e) => mref(id, who, { admin: true }, e);
  const peek = async (id) => { let v; await env.withSecurityRulesDisabled(async (c) => { v = (await getDoc(doc(c.firestore(), `matches/${id}`))).data(); }); return v; };
  const ab = (n) => ({ status: 'abandoned', finishedAt: Date.now(), updatedAt: Date.now() });
  const seedTerms = (e, ids) => e.withSecurityRulesDisabled(async (c) => {
    for (const id of ids) await setDoc(doc(c.firestore(), `terms/${id}`), { version: TERMS_VERSION, acceptedAt: new Date() });
  });
  beforeEach(() => seedTerms(env, ['adm', 'b0', 'b1', 'a1']));

  test('policy: the rules carry ABANDON_POLICY (interim "review") and the generator agrees', () => {
    const rules = fs.readFileSync(path.join(__dirname, '../firestore.rules'), 'utf8');
    expect(ABANDON_POLICY).toBe('review');
    expect(rules).toContain(`function abandonPolicy() { return '${ABANDON_POLICY}'; }`);
    expect(require('child_process').spawnSync(process.execPath, [path.join(__dirname, '../scripts/gen-abandon-policy.js'), '--check']).status).toBe(0);
  });

  test('V144-1: every events write states maxEvents = max(stored, new length); undo never lowers it', async () => {
    const e10 = pts('A', 10);
    await seedM('mx', { events: e10 });
    await assertFails(rawUpdateDoc(mref('mx'), { events: [...e10, mkev('B')] })); // missing
    await assertFails(rawUpdateDoc(mref('mx'), { events: [...e10, mkev('B')], maxEvents: 10 })); // too low
    await assertFails(rawUpdateDoc(mref('mx'), { events: [...e10, mkev('B')], maxEvents: 40 })); // inflated
    await assertSucceeds(rawUpdateDoc(mref('mx'), { events: [...e10, mkev('B')], maxEvents: 11 }));
    await assertFails(rawUpdateDoc(mref('mx'), { events: e10, maxEvents: 10 })); // undo lowering it
    await assertSucceeds(rawUpdateDoc(mref('mx'), { events: e10, maxEvents: 11 }));
    await assertFails(rawUpdateDoc(mref('mx'), { maxEvents: 0 })); // alone
    expect((await peek('mx')).maxEvents).toBe(11);
  });

  test('V144-1 (Tester\'s undo bypass): undoing below the shortest win doesn\'t re-open the scorer\'s abandon', async () => {
    const e60 = [...pts('A', 25), ...pts('B', 25), ...pts('A', 10)];
    await seedM('ub', { events: e60, maxEvents: 60 });
    await assertSucceeds(rawUpdateDoc(mref('ub'), { events: e60.slice(0, 59), maxEvents: 60 })); // one undo step
    // … 11 steps later the log is back at 49 (< 50) but maxEvents stays 60
    await seedM('ub', { events: e60.slice(0, 49), maxEvents: 60 });
    await assertFails(updateDoc(mref('ub'), { ...ab(), abandon: abRec('cap', 49) }));
    // an older doc without maxEvents counts its current log
    await seedM('ub2', { events: e60 });
    await assertFails(rawUpdateDoc(mref('ub2'), { events: e60.slice(0, 49), maxEvents: 49 }));
  });

  test('V144-1 (Tester\'s bo1 0:24): the abandon after the first rally needs the review record; never the opposing side', async () => {
    await seedM('b1', { rules: BO1, events: pts('B', 24) });
    await assertFails(updateDoc(mref('b1'), ab())); // no record
    await assertFails(updateDoc(mref('b1'), { ...ab(), abandon: abRec('cap', 24, { mode: 'flag' }) })); // not the policy
    await assertFails(updateDoc(mref('b1'), { ...ab(), abandon: abRec('cap', 24, { review: 'confirmed' }) })); // self-confirmed
    await assertFails(updateDoc(mref('b1'), { ...ab(), abandon: abRec('cap', 20) })); // wrong count
    await assertFails(updateDoc(mref('b1'), { ...ab(), abandon: abRec('cap', 24, { at: new Date() }) })); // client time
    await assertFails(updateDoc(mref('b1'), { ...ab(), abandon: abRec('a1', 24) })); // someone else named
    await assertFails(updateDoc(mref('b1'), { ...ab(), abandon: abRec('cap', 24, { reportedBy: 'b0', reportedAt: serverTimestamp() }) })); // a fake report
    await assertFails(updateDoc(mref('b1'), { ...ab(), abandon: abRec('cap', 24, { reviewedBy: 'adm', reviewedAt: serverTimestamp() }) })); // a fake review
    await assertFails(updateDoc(mref('b1', 'b0'), { ...ab(), abandon: abRec('b0', 24) })); // not the scorer
    await assertSucceeds(updateDoc(mref('b1'), { ...ab(), abandon: abRec('cap', 24, { score: { setsA: 0, setsB: 0, currentA: 0, currentB: 24 }, behind: true }) }));
    const d = await peek('b1');
    expect(d.status).toBe('abandoned');
    expect(d.abandon).toMatchObject({ by: 'cap', events: 24, mode: 'review', review: 'pending', behind: true });
    // before the first rally: abandoned directly, and a record is refused
    await seedM('b2', { rules: BO1, events: [] });
    await assertFails(updateDoc(mref('b2'), { ...ab(), abandon: abRec('cap', 0) }));
    await assertSucceeds(updateDoc(mref('b2'), ab()));
    // the record can't be added outside an abandon
    await seedM('b3', { rules: BO1, events: pts('A', 3) });
    await assertFails(updateDoc(mref('b3'), { abandon: abRec('cap', 3), updatedAt: Date.now() }));
  });

  test('V144-1/V144-4: rules / first serve stay frozen after an undo back to 0 (no raising the shortest win)', async () => {
    await seedM('rz', { rules: BO1, events: [], maxEvents: 24 });
    await assertFails(updateDoc(mref('rz'), { rules: RULES, updatedAt: Date.now() }));
    await assertFails(updateDoc(mref('rz'), { firstServe: 'B', updatedAt: Date.now() }));
    await seedM('rz2', { rules: BO1, events: [] });
    await assertSucceeds(updateDoc(mref('rz2'), { rules: RULES, updatedAt: Date.now() }));
  });

  test('V144-1: wasWon latches – a match that was ever won can\'t be abandoned by its scorer; finishing must set it', async () => {
    const e50 = pts('A', 50);
    await seedM('ww', { events: e50.slice(0, 49), maxEvents: 49 });
    await assertFails(rawUpdateDoc(mref('ww'), { events: e50, maxEvents: 50, summary: EMPTY_SUMMARY, status: 'finished', finishedAt: Date.now(), finishedServerAt: serverTimestamp() }));
    await assertFails(rawUpdateDoc(mref('ww'), { events: e50, maxEvents: 50, wasWon: false, summary: EMPTY_SUMMARY, status: 'finished', finishedAt: Date.now(), finishedServerAt: serverTimestamp() }));
    await assertSucceeds(rawUpdateDoc(mref('ww'), { events: e50, maxEvents: 50, wasWon: true, summary: EMPTY_SUMMARY, status: 'finished', finishedAt: Date.now(), finishedServerAt: serverTimestamp() }));
    await seedM('ww2', { events: pts('A', 20), maxEvents: 20, wasWon: true });
    await assertFails(updateDoc(mref('ww2'), { ...ab(), abandon: abRec('cap', 20) }));
    await assertFails(rawUpdateDoc(mref('ww2'), { wasWon: false, updatedAt: Date.now() })); // never cleared by the scorer
  });

  test('report: the opposing captain sends an abandoned match to admin review; nobody else, once', async () => {
    await seedM('rp', { status: 'abandoned', events: pts('B', 20), maxEvents: 20, finishedAt: NOW - 60000, abandon: { by: 'cap', at: new Date(NOW - 60000), events: 20, mode: 'review', review: 'pending', behind: true } });
    const rep = (who) => updateDoc(mref('rp', who), { abandon: { by: 'cap', at: new Date(NOW - 60000), events: 20, mode: 'review', review: 'pending', behind: true, reportedBy: who, reportedAt: serverTimestamp() }, updatedAt: Date.now() });
    await assertFails(rep('a1')); // same side as the abandoner
    await assertFails(rep('cap'));
    await assertFails(rep('b1')); // not a captain
    await assertSucceeds(rep('b0'));
    await assertFails(rep('b0')); // once
    // 1.4.6 (V145-11): a legacy abandoned match (no record) can't be reported – it is in admin review on its own
    await seedM('rp2', { status: 'abandoned', events: pts('B', 20), finishedAt: NOW - 60000 });
    await assertFails(updateDoc(mref('rp2', 'b0'), { abandon: { mode: 'legacy', events: 20, review: 'pending', reportedBy: 'b0', reportedAt: serverTimestamp() }, updatedAt: Date.now() }));
  });

  test('V144-1/V144-3: an admin who isn\'t part of the match confirms or reinstates; a participant admin can\'t', async () => {
    const rec = { by: 'cap', at: new Date(NOW - 60000), events: 20, mode: 'review', review: 'pending', behind: true };
    await seedM('ar', { status: 'abandoned', events: pts('B', 20), maxEvents: 20, finishedAt: NOW - 60000, abandon: rec });
    const confirm = (ref) => updateDoc(ref, { abandon: { ...rec, review: 'confirmed', reviewedBy: ref.firestore._authCredentials ? 'x' : 'adm', reviewedAt: serverTimestamp() }, updatedAt: Date.now() });
    await assertFails(updateDoc(adm('ar', 'cap'), { abandon: { ...rec, review: 'confirmed', reviewedBy: 'cap', reviewedAt: serverTimestamp() }, updatedAt: Date.now() })); // participant
    await assertFails(updateDoc(adm('ar', 'b0'), { abandon: { ...rec, review: 'confirmed', reviewedBy: 'b0', reviewedAt: serverTimestamp() }, updatedAt: Date.now() })); // captain
    await assertFails(updateDoc(mref('ar', 'bob'), { abandon: { ...rec, review: 'confirmed', reviewedBy: 'bob', reviewedAt: serverTimestamp() }, updatedAt: Date.now() })); // not an admin
    await assertFails(updateDoc(adm('ar'), { abandon: { ...rec, events: 1, review: 'confirmed', reviewedBy: 'adm', reviewedAt: serverTimestamp() }, updatedAt: Date.now() })); // record rewritten
    // reinstate: back to live (no winner in the log)
    await assertSucceeds(updateDoc(adm('ar'), { status: 'live', finishedAt: null, abandon: { ...rec, review: 'reinstated', reviewedBy: 'adm', reviewedAt: serverTimestamp() }, updatedAt: Date.now() }));
    expect((await peek('ar')).status).toBe('live');
    void confirm;
    await seedM('ac', { status: 'abandoned', events: pts('B', 20), maxEvents: 20, finishedAt: NOW - 60000, abandon: rec });
    await assertSucceeds(updateDoc(adm('ac'), { abandon: { ...rec, review: 'confirmed', reviewedBy: 'adm', reviewedAt: serverTimestamp() }, updatedAt: Date.now() }));
    await assertFails(updateDoc(adm('ac'), { status: 'live', finishedAt: null, abandon: { ...rec, review: 'reinstated', reviewedBy: 'adm', reviewedAt: serverTimestamp() }, updatedAt: Date.now() })); // decided
    // an admin abandons a long live match (the scorer can't) – with the admin record
    await seedM('al', { events: pts('A', 60), maxEvents: 60 });
    await assertFails(updateDoc(mref('al'), { ...ab(), abandon: abRec('cap', 60) }));
    await assertFails(updateDoc(adm('al', 'cap'), { ...ab(), abandon: abRec('cap', 60, { mode: 'admin', review: 'confirmed', reviewedBy: 'cap', reviewedAt: serverTimestamp() }) }));
    await assertSucceeds(updateDoc(adm('al'), { ...ab(), abandon: abRec('adm', 60, { mode: 'admin', review: 'confirmed', reviewedBy: 'adm', reviewedAt: serverTimestamp() }) }));
  });

  test('V144-2 / V145-2: a finished match without a winner – the admin reopens it as live, abandons it or voids it', async () => {
    const ev = [...pts('A', 25), ...pts('B', 5)]; // 1-0 in sets, 30 events: shorter than the shortest win (50)
    const fin = { status: 'finished', events: ev, maxEvents: 30, wasWon: true, finishedAt: NOW - 60000, finishedServerAt: new Date(NOW - 60000) };
    await seedM('wl', fin);
    const reopen = (ref, by, over = {}) => updateDoc(ref, { status: 'live', finishedAt: null, finishedServerAt: null, wasWon: false, reopenEpoch: 1, resolution: { action: 'reopened', by, at: serverTimestamp(), epoch: 1 }, updatedAt: Date.now(), ...over });
    await assertFails(reopen(adm('wl', 'cap'), 'cap'));
    await assertFails(reopen(mref('wl', 'bob'), 'bob'));
    await assertFails(updateDoc(adm('wl'), { status: 'live', finishedAt: null, finishedServerAt: null, updatedAt: Date.now() })); // no record
    await assertFails(reopen(adm('wl'), 'adm', { reopenEpoch: 0, resolution: { action: 'reopened', by: 'adm', at: serverTimestamp() } })); // 1.4.6: no new epoch
    await assertSucceeds(reopen(adm('wl'), 'adm'));
    const d = await peek('wl');
    expect(d).toMatchObject({ status: 'live', wasWon: false, reopenEpoch: 1, resolution: { action: 'reopened', by: 'adm', epoch: 1 } });
    await seedM('wl2', fin);
    await assertSucceeds(updateDoc(adm('wl2'), { ...ab(), finishedServerAt: null, abandon: abRec('adm', 30, { mode: 'admin', review: 'confirmed', reviewedBy: 'adm', reviewedAt: serverTimestamp() }) }));
    // 1.4.6 (V145-2): a log as long as the shortest win (50) might be won – only void is left
    const fin50 = { ...fin, events: [...pts('A', 25), ...pts('B', 25)], maxEvents: 50 };
    await seedM('wl4', fin50);
    await assertFails(reopen(adm('wl4'), 'adm'));
    await assertFails(updateDoc(adm('wl4'), { ...ab(), finishedServerAt: null, abandon: abRec('adm', 50, { mode: 'admin', review: 'confirmed', reviewedBy: 'adm', reviewedAt: serverTimestamp() }) }));
    const fin3 = fin50;
    await seedM('wl3', fin3);
    await assertFails(updateDoc(adm('wl3', 'cap'), { verification: { status: 'voided', reviewedBy: 'cap', reviewedAt: serverTimestamp() }, updatedAt: Date.now() }));
    await assertSucceeds(updateDoc(adm('wl3'), { verification: { status: 'voided', reviewedBy: 'adm', reviewedAt: serverTimestamp() }, updatedAt: Date.now() }));
  });

  test('V144-8 (interim): after the first rally scoring is handed only within the scorer\'s side; an admin reassigns with a record; the verdict stays with the side', async () => {
    await seedM('h0', { events: [] });
    // before the first rally: anyone – 1.4.7 (QA V146-3): except the other (verdict) team
    await assertFails(updateDoc(mref('h0'), { scorerId: 'b1', updatedAt: Date.now() }));
    await assertSucceeds(updateDoc(mref('h0'), { scorerId: 'a2', updatedAt: Date.now() }));
    await seedM('h1', { events: pts('A', 5), maxEvents: 5 });
    await assertFails(updateDoc(mref('h1'), { scorerId: 'b1', updatedAt: Date.now() })); // the other side
    await assertSucceeds(updateDoc(mref('h1'), { scorerId: 'a1', updatedAt: Date.now() }));
    await assertFails(updateDoc(mref('h1', 'a1'), { scorerId: 'b1', updatedAt: Date.now() }));
    // a handoff never touches the abandon / verdict state
    await assertFails(updateDoc(mref('h1', 'a1'), { scorerId: 'a2', maxEvents: 0, updatedAt: Date.now() }));
    // admin: anyone among the participants, recorded (from = the original scorer)
    await seedM('h2', { events: pts('A', 5), maxEvents: 5 });
    await assertFails(updateDoc(adm('h2'), { scorerId: 'b1', updatedAt: Date.now() })); // no record
    await assertFails(updateDoc(adm('h2', 'b0'), { scorerId: 'b1', scorerReassign: { from: 'cap', to: 'b1', by: 'b0', at: serverTimestamp() }, updatedAt: Date.now() })); // participant admin
    await assertFails(updateDoc(adm('h2'), { scorerId: 'zz', scorerReassign: { from: 'cap', to: 'zz', by: 'adm', at: serverTimestamp() }, updatedAt: Date.now() })); // not a participant
    // 1.4.7 (QA V146-2): never to the verdict captain's team (B) – the scorer's own side
    await assertFails(updateDoc(adm('h2'), { scorerId: 'b1', scorerReassign: { from: 'cap', to: 'b1', by: 'adm', at: serverTimestamp() }, updatedAt: Date.now() }));
    await assertSucceeds(updateDoc(adm('h2'), { scorerId: 'a1', scorerReassign: { from: 'cap', to: 'a1', by: 'adm', at: serverTimestamp() }, updatedAt: Date.now() }));
    await assertFails(updateDoc(adm('h2'), { scorerId: 'a2', scorerReassign: { from: 'a1', to: 'a2', by: 'adm', at: serverTimestamp() }, updatedAt: Date.now() })); // from stays the original
    await assertSucceeds(updateDoc(adm('h2'), { scorerId: 'a2', scorerReassign: { from: 'cap', to: 'a2', by: 'adm', at: serverTimestamp() }, updatedAt: Date.now() }));
    // verdict: the captain opposite the ORIGINAL scorer (side A) – B's captain answers, A's can't
    const won = { setsA: 2, setsB: 0, currentA: 0, currentB: 0, setScores: [{ a: 25, b: 0 }, { a: 25, b: 0 }], winner: 'A', serving: 'A' };
    await seedM('h3', { status: 'finished', events: pts('A', 50), maxEvents: 50, wasWon: true, summary: won, finishedAt: NOW - 60000, finishedServerAt: new Date(NOW - 60000), playerOfMatchId: 'a1', scorerId: 'b2', scorerReassign: { from: 'cap', to: 'b2', by: 'adm', at: new Date(NOW - 120000) }, createdBy: 'bob', participantIds: [...A12, ...B12, 'bob'] });
    await seedTerms(env, ['bob']);
    const verdict = (who) => updateDoc(mref('h3', who), { verification: { status: 'confirmed', by: who, at: serverTimestamp(), captain: 'confirmed' }, updatedAt: Date.now() });
    await assertFails(verdict('cap'));
    await assertSucceeds(verdict('b0'));
  });

  test('PRD gap: a set\'s lineup is a subset of the participants; one set per write', async () => {
    await seedM('lu', { events: pts('A', 3), maxEvents: 3 });
    await assertFails(updateDoc(mref('lu'), { lineups: { 1: { A: ['cap', 'a1', 'a2', 'a3', 'a4', 'zz'], B: B12.slice(0, 6) } }, updatedAt: Date.now() }));
    await assertFails(updateDoc(mref('lu'), { lineups: { 1: { A: A12.slice(0, 6), B: B12.slice(0, 6) }, 2: { A: A12.slice(0, 6), B: B12.slice(0, 6) } }, updatedAt: Date.now() }));
    await assertSucceeds(updateDoc(mref('lu'), { lineups: { 1: { A: A12.slice(0, 6), B: B12.slice(0, 6) } }, updatedAt: Date.now() }));
  });

  test('PRD gap: the captain of a side built by number must have a profile (also outside the first 3 players)', async () => {
    const A = ['u1', 'u2', 'u3', 'u4', 'u5', 'u6', 'ghost'];
    const B = ['w1', 'w2', 'w3', 'w4', 'w5', 'w6'];
    const mk = (capA) => matchDoc({ ids: A }, { ids: B }, { captains: { A: capA, B: 'w1' }, participantIds: ordered(A, B, ['cap']) });
    await assertFails(setDoc(doc(ctx('cap').firestore(), 'matches/cg1'), mk('ghost')));
    await assertSucceeds(setDoc(doc(ctx('cap').firestore(), 'matches/cg2'), mk('u5')));
    await assertSucceeds(setDoc(doc(ctx('cap').firestore(), 'matches/cg3'), mk('u2')));
    // a side of 2: its captain is one of them (the slice never reaches the other side)
    const two = matchDoc({ ids: ['u1', 'u2'] }, { ids: B }, { captains: { A: 'w1', B: 'w2' } });
    await assertFails(setDoc(doc(ctx('cap').firestore(), 'matches/cg4'), two));
  });

  test('V144-1 \'consent\' (implemented, not the default): a request the opposing captain agrees to; scoring frozen meanwhile', async () => {
    const base = fs.readFileSync(path.join(__dirname, '../firestore.rules'), 'utf8');
    const consent = base.replace("function abandonPolicy() { return 'review'; }", "function abandonPolicy() { return 'consent'; }");
    expect(consent).not.toBe(base);
    const env3 = await initializeTestEnvironment({ projectId: 'demo-consent', firestore: { rules: consent, ...hostPort(process.env.FIRESTORE_EMULATOR_HOST, 8080) } });
    try {
      await env3.clearFirestore();
      await seedTerms(env3, ['cap', 'b0', 'b1', 'a1', 'adm']);
      const e20 = pts('B', 20);
      await seedM('cs', { events: e20, maxEvents: 20 }, env3);
      const r = (who, claims) => doc(as(who, claims, env3), 'matches/cs');
      // the direct abandon with a review record is not this policy's
      await assertFails(rawUpdateDoc(r('cap'), { ...ab(), abandon: abRec('cap', 20) }));
      const ask = (who, side, n, over = {}) => rawUpdateDoc(r(who), { abandonRequest: { by: who, at: serverTimestamp(), side, agreedBy: [] }, abandonRequests: n, abandonRequestAt: serverTimestamp(), updatedAt: Date.now(), ...over });
      await assertFails(ask('cap', 'B', 1)); // wrong side
      await assertFails(ask('a1', 'A', 1)); // not the scorer
      await assertFails(rawUpdateDoc(r('cap'), { abandonRequest: { by: 'cap', at: serverTimestamp(), side: 'A', agreedBy: [] }, updatedAt: Date.now() })); // 1.4.6: uncounted
      await assertFails(ask('cap', 'A', 2)); // 1.4.6: counter skipped
      await assertSucceeds(ask('cap', 'A', 1));
      const stored = (await (async () => { let v; await env3.withSecurityRulesDisabled(async (c) => { v = (await getDoc(doc(c.firestore(), 'matches/cs'))).data(); }); return v; })()).abandonRequest;
      // frozen: no rally, no finish
      await assertFails(rawUpdateDoc(r('cap'), { events: [...e20, mkev('A')], maxEvents: 21 }));
      await assertFails(rawUpdateDoc(r('a1'), { abandonRequest: { ...stored, agreedBy: ['a1'] }, updatedAt: Date.now() })); // not an agreer
      // B's captain declines (null), the scorer asks again, B's captain agrees -> abandoned with the consent record
      await assertSucceeds(rawUpdateDoc(r('b0'), { abandonRequest: null, updatedAt: Date.now() }));
      await assertFails(ask('cap', 'A', 2)); // 1.4.6 (V145-12): within the 2-minute cooldown
      await env3.withSecurityRulesDisabled((c) => rawUpdateDoc(doc(c.firestore(), 'matches/cs'), { abandonRequestAt: new Date(NOW - 180000) }));
      await assertSucceeds(ask('cap', 'A', 2));
      let again; await env3.withSecurityRulesDisabled(async (c) => { again = (await getDoc(doc(c.firestore(), 'matches/cs'))).data().abandonRequest; });
      await assertFails(rawUpdateDoc(r('b0'), { abandonRequest: { ...again, agreedBy: ['b0'] }, updatedAt: Date.now() })); // last agreement must abandon
      await assertSucceeds(rawUpdateDoc(r('b0'), { abandonRequest: { ...again, agreedBy: ['b0'] }, ...ab(), abandon: abRec('cap', 20, { mode: 'consent', review: 'confirmed', agreedBy: ['b0'] }) }));
      let fin; await env3.withSecurityRulesDisabled(async (c) => { fin = (await getDoc(doc(c.firestore(), 'matches/cs'))).data(); });
      expect(fin.status).toBe('abandoned');
      expect(fin.abandon).toMatchObject({ mode: 'consent', review: 'confirmed', by: 'cap', agreedBy: ['b0'] });
      // B's captain agreed: no report afterwards
      await assertFails(rawUpdateDoc(r('b0'), { abandon: { ...fin.abandon, review: 'pending', reportedBy: 'b0', reportedAt: serverTimestamp() }, updatedAt: Date.now() }));
      // an admin rejects a pending request
      await seedM('cs2', { events: e20, maxEvents: 20, abandonRequest: { by: 'cap', at: new Date(NOW - 1000), side: 'A', agreedBy: [] } }, env3);
      await assertFails(rawUpdateDoc(doc(as('a1', { admin: true }, env3), 'matches/cs2'), { abandonRequest: null, updatedAt: Date.now() })); // participant admin (not an agreer)
      await assertSucceeds(rawUpdateDoc(doc(as('adm', { admin: true }, env3), 'matches/cs2'), { abandonRequest: null, status: 'live', updatedAt: Date.now() }));
      await seedM('cs3', { events: e20, maxEvents: 20, abandonRequest: { by: 'cap', at: new Date(NOW - 1000), side: 'A', agreedBy: [] } }, env3);
      await assertFails(rawUpdateDoc(doc(as('adm', { admin: true }, env3), 'matches/cs3'), { ...ab(), abandon: abRec('adm', 20, { mode: 'admin', review: 'confirmed', reviewedBy: 'adm', reviewedAt: serverTimestamp() }) })); // the request must be settled with it
      await assertSucceeds(rawUpdateDoc(doc(as('adm', { admin: true }, env3), 'matches/cs3'), { ...ab(), abandonRequest: null, abandon: abRec('adm', 20, { mode: 'admin', review: 'confirmed', reviewedBy: 'adm', reviewedAt: serverTimestamp() }) }));
    } finally {
      await env3.cleanup();
    }
  }, 120000);
});

// ================= 1.4.6: one lifecycle (src/core/lifecycle.ts) – Tester's 1.4.5 findings V145-1..12 =================
describe('1.4.6: lifecycle walk + V145 items', () => {
  const app = require('./appSource');
  const LC = app('src/core/lifecycle.ts');
  const AB = app('src/core/abandon.ts');
  const AF = app('src/core/antifraud.ts');
  const DOCS = app('src/services/backend/firebaseActionDocs.ts');
  const POLICY = app('src/core/abandonPolicy.ts').ABANDON_POLICY; // V145-9: the walk runs under the current policy
  const NOW = Date.now();
  const T0 = NOW - 3 * 3600000;
  const A12 = ['cap', ...Array.from({ length: 11 }, (_, i) => `a${i + 1}`)];
  const B12 = Array.from({ length: 12 }, (_, i) => `b${i}`);
  const WR = { ...RULES, bestOf: 1, pointsPerSet: 5, decidingSetPoints: 5, winBy: 1 }; // shortest win: 5 events
  const CAST = { scorer: 'cap', oppCaptain: 'b0', bPlayer: 'b1', pastAdmin: 'adm2', teammate: 'a1' };
  const WHO = { scorer: 'cap', oppCaptain: 'b0', teammate: 'a1', admin: 'adm', stranger: 'zz' };
  const fx = { stamp: serverTimestamp(), del: deleteField() };
  const asDb = (who) => env.authenticatedContext(who, { phone_number: '+919000000009', ...(who === 'adm' ? { admin: true } : {}) }).firestore();
  const toTs = (o) => (o && typeof o === 'object' && !Array.isArray(o) ? Object.fromEntries(Object.entries(o).map(([k, v]) => [k, /At$|^at$/.test(k) && typeof v === 'number' ? new Date(v) : v])) : o);
  /** The match (ms times, for core) and the stored doc (Timestamps) of a walk state. */
  const build = (spec, extra = {}) => {
    const f = LC.walkFields(spec, CAST, T0);
    const live = spec.status !== 'scheduled';
    const base = matchDoc({ ids: A12 }, { ids: B12 }, { rules: WR, updatedAt: NOW, ...(live ? { startedAt: T0 - 1000, startedServerAt: new Date(T0 - 1000) } : {}) });
    const fin = spec.status === 'finished' ? { finishedAt: T0 + 60000, finishedServerAt: new Date(T0 + 60000) } : spec.status === 'abandoned' ? { finishedAt: T0 + 60000 } : {};
    const m = { id: 'w', ...base, ...f, ...fin, startedServerAt: live ? T0 - 1000 : null, finishedServerAt: spec.status === 'finished' ? T0 + 60000 : null, ...extra };
    const raw = { ...base, ...f, ...fin, ...extra };
    for (const k of ['abandon', 'verification']) if (raw[k]) raw[k] = toTs(raw[k]);
    for (const k of Object.keys(raw)) if (raw[k] === undefined) delete raw[k];
    return { m, raw };
  };
  const seed = (id, raw) => env.withSecurityRulesDisabled((c) => setDoc(doc(c.firestore(), `matches/${id}`), raw));
  const payload = (action, raw, m, me) => {
    const now = Date.now();
    switch (action) {
      case 'unschedule': return { status: 'scheduled', startedAt: null, startedServerAt: null, updatedAt: now };
      case 'editSetup': return { firstServe: 'B', updatedAt: now };
      case 'abandon': return DOCS.abandonDoc(AB.abandonPlanFor(m, me, now), raw, fx, now);
      case 'report': return raw.abandon ? DOCS.reportDoc(raw, me, fx, now) : { abandon: { mode: 'legacy', events: m.events.length, review: 'pending', reportedBy: me, reportedAt: fx.stamp }, updatedAt: now };
      case 'confirmAbandon': return DOCS.resolveDoc(raw, m, AB.resolveBody(m, me, 'confirm_abandon', now), me, fx, now);
      case 'reinstate': return DOCS.resolveDoc(raw, m, AB.resolveBody(m, me, 'reinstate', now), me, fx, now);
      case 'reopen': return DOCS.resolveDoc(raw, m, AB.resolveBody(m, me, 'reopen', now), me, fx, now);
      case 'adminAbandon': return DOCS.resolveDoc(raw, m, AB.resolveBody(m, me, 'abandon', now), me, fx, now);
      case 'void': return DOCS.reviewDoc(raw, me, 'void', AF.captainVerdict(m), fx, now);
      case 'verdict': return DOCS.verifyDoc(raw, me, 'confirmed', undefined, fx, now);
      case 'repairVerdict': { const VRw = app('src/core/verdictRepair.ts'); return DOCS.repairDoc(VRw.repairBody(m, me, VRw.walkRepairFix(m, 'cap'), now), fx, now); } // 1.4.8 (V147-2); 1.4.13: a captain fix on capMix
      default: throw new Error(action);
    }
  };
  const tryIt = async (id, action, raw, m, me) => {
    const ref = doc(asDb(me), `matches/${id}`);
    try {
      if (action === 'delete') await deleteDoc(ref);
      else await rawUpdateDoc(ref, payload(action, raw, m, me));
      return true;
    } catch (e) {
      if (!/PERMISSION_DENIED|permission/i.test(String(e && (e.code || e.message)))) throw e;
      return false;
    }
  };
  beforeEach(() => env.withSecurityRulesDisabled(async (c) => {
    for (const id of ['adm', 'b0', 'a1', 'zz', 'cap']) await setDoc(doc(c.firestore(), `terms/${id}`), { version: TERMS_VERSION, acceptedAt: new Date() });
  }));

  test('the walk: every action in every state as every role is allowed by the rules exactly when core/lifecycle.ts allows it', async () => {
    const bad = [];
    let n = 0;
    let allowed = 0;
    for (const spec of LC.LC_STATES) {
      const { m, raw } = build(spec);
      for (const action of LC.LC_WALK) {
        if (LC.LC_NOT_ON.firebase.includes(action) || LC.walkSkip(spec, action)) continue;
        for (const w of LC.LC_WALKERS) {
          const me = WHO[w];
          const expectOk = LC.walkExpect(action, m, me, me === 'adm', POLICY, Date.now()) === null;
          const id = `w_${spec.name}_${action}_${w}`;
          await seed(id, raw);
          const got = await tryIt(id, action, raw, m, me);
          n++;
          if (got) allowed++;
          if (got !== expectOk) bad.push(`${spec.name} ${action} as ${w}: rules ${got ? 'allow' : 'refuse'}, lifecycle ${expectOk ? 'allows' : `refuses (${LC.walkExpect(action, m, me, me === 'adm')})`}`);
        }
      }
    }
    expect(bad).toEqual([]);
    expect(n).toBe((LC.LC_STATES.length * LC.LC_WALK.length - LC.LC_STATES.filter((x) => LC.walkSkip(x, 'unschedule')).length) * LC.LC_WALKERS.length);
    expect(allowed).toBeGreaterThan(20);
  }, 900000);

  const spec = (name) => LC.LC_STATES.find((s) => s.name === name);
  test('V145-1: undo to 0 / back to scheduled never re-opens delete; never after a record or a re-open', async () => {
    const { raw } = build(spec('undo0'));
    await seed('d1', raw);
    await assertFails(rawUpdateDoc(doc(asDb('cap'), 'matches/d1'), { status: 'scheduled', startedAt: null, startedServerAt: null, updatedAt: Date.now() }));
    await seed('d2', { ...raw, status: 'scheduled', startedAt: null, startedServerAt: null }); // forged back to scheduled
    await assertFails(deleteDoc(doc(asDb('cap'), 'matches/d2')));
    await assertFails(deleteDoc(doc(asDb('adm'), 'matches/d2')));
    await seed('d3', { ...build(spec('sched0')).raw, reopenEpoch: 1 });
    await assertFails(deleteDoc(doc(asDb('cap'), 'matches/d3')));
    await seed('d4', build(spec('sched0')).raw);
    await assertFails(deleteDoc(doc(asDb('a1'), 'matches/d4'))); // not the creator
    await assertSucceeds(deleteDoc(doc(asDb('cap'), 'matches/d4')));
  });

  test('V145-2: a won + confirmed match can\'t be re-opened or abandoned by an admin (void only); a verdict needs the current epoch', async () => {
    const { m, raw } = build(spec('wonConfirmed'));
    await seed('r1', raw);
    const reopen = { status: 'live', finishedAt: null, finishedServerAt: null, playerOfMatchId: null, wasWon: false, verification: deleteField(), reopenEpoch: 1, resolution: { action: 'reopened', by: 'adm', at: serverTimestamp(), epoch: 1 }, updatedAt: Date.now() };
    await assertFails(rawUpdateDoc(doc(asDb('adm'), 'matches/r1'), reopen));
    await assertFails(rawUpdateDoc(doc(asDb('adm'), 'matches/r1'), payload('adminAbandon', raw, m, 'adm')));
    await assertSucceeds(rawUpdateDoc(doc(asDb('adm'), 'matches/r1'), payload('void', raw, m, 'adm')));
    // after a re-open (epoch 1) a verdict without the epoch is refused, with it accepted
    const w = build(spec('wonPending'), { reopenEpoch: 1 });
    await seed('r2', w.raw);
    await assertFails(rawUpdateDoc(doc(asDb('b0'), 'matches/r2'), { verification: { status: 'confirmed', captain: 'confirmed', by: 'b0', at: serverTimestamp() }, updatedAt: Date.now() }));
    await assertSucceeds(rawUpdateDoc(doc(asDb('b0'), 'matches/r2'), payload('verdict', w.raw, w.m, 'b0')));
  });

  test('V145-3: teams / captains / team size stay locked after undo to 0', async () => {
    const { raw } = build(spec('undo0'));
    await seed('s1', raw);
    const r = doc(asDb('cap'), 'matches/s1');
    await assertFails(rawUpdateDoc(r, { captains: { A: 'a1', B: 'b0' }, updatedAt: Date.now() }));
    await assertFails(rawUpdateDoc(r, { teamSizeMode: 'custom', updatedAt: Date.now() }));
    await assertFails(rawUpdateDoc(r, { teamB: { ...raw.teamB, name: 'Other' }, updatedAt: Date.now() }));
  });

  test('V145-4: the abandon record\'s score is four small ints and behind a bool', async () => {
    const { m, raw } = build(spec('live3'));
    const ok = payload('abandon', raw, m, 'cap');
    const bad = (over) => ({ ...ok, abandon: { ...ok.abandon, ...over } });
    for (const [i, b] of [
      bad({ behind: null }), bad({ behind: 'yes' }), bad({ score: { setsA: 0, setsB: 0, currentA: 0 } }),
      bad({ score: { setsA: 0, setsB: 0, currentA: 0, currentB: 3, pad: 'x'.repeat(5000) } }), bad({ score: { setsA: 0, setsB: 0, currentA: 0, currentB: 1.5 } }),
      bad({ score: { setsA: 9, setsB: 0, currentA: 0, currentB: 3 } }), bad({ score: { setsA: 0, setsB: 0, currentA: 0, currentB: '3' } }), bad({ score: 'big' }),
    ].entries()) {
      await seed(`v4_${i}`, raw);
      await assertFails(rawUpdateDoc(doc(asDb('cap'), `matches/v4_${i}`), b));
    }
    await seed('v4ok', raw);
    await assertSucceeds(rawUpdateDoc(doc(asDb('cap'), 'matches/v4ok'), ok));
  });

  test('V145-5 / V145-10: history is appended (never overwritten); reinstated to finished sets wasWon', async () => {
    const { m, raw } = build(spec('reinstated'));
    await seed('h1', raw);
    const p = payload('adminAbandon', raw, m, 'adm');
    await assertFails(rawUpdateDoc(doc(asDb('adm'), 'matches/h1'), { ...p, abandonHistory: deleteField() })); // dropped
    await assertFails(rawUpdateDoc(doc(asDb('adm'), 'matches/h1'), { ...p, abandonHistory: [] }));
    await assertSucceeds(rawUpdateDoc(doc(asDb('adm'), 'matches/h1'), p));
    expect((await (async () => { let v; await env.withSecurityRulesDisabled(async (c) => { v = (await getDoc(doc(c.firestore(), 'matches/h1'))).data(); }); return v; })()).abandonHistory).toHaveLength(1);
    // pending abandon whose log holds a win (B5) → reinstated as finished must latch wasWon
    const w = build({ ...spec('abPending'), events: 'B5', maxEvents: 5 });
    await seed('h2', w.raw);
    const ri = payload('reinstate', w.raw, w.m, 'adm');
    expect(ri.status).toBe('finished');
    await assertFails(rawUpdateDoc(doc(asDb('adm'), 'matches/h2'), { ...ri, wasWon: deleteField() }));
    await assertSucceeds(rawUpdateDoc(doc(asDb('adm'), 'matches/h2'), ri));
  });

  test('V145-6: an admin can\'t hand scoring to the verdict captain; the current scorer never gives the verdict', async () => {
    const { raw } = build(spec('live3'));
    await seed('v6', raw);
    await assertFails(rawUpdateDoc(doc(asDb('adm'), 'matches/v6'), { scorerId: 'b0', scorerReassign: { from: 'cap', to: 'b0', by: 'adm', at: serverTimestamp() }, updatedAt: Date.now() }));
    // 1.4.7 (QA V146-2): nor anyone on that captain's team; the scorer's own side is fine
    await assertFails(rawUpdateDoc(doc(asDb('adm'), 'matches/v6'), { scorerId: 'b1', scorerReassign: { from: 'cap', to: 'b1', by: 'adm', at: serverTimestamp() }, updatedAt: Date.now() }));
    await assertSucceeds(rawUpdateDoc(doc(asDb('adm'), 'matches/v6'), { scorerId: 'a3', scorerReassign: { from: 'cap', to: 'a3', by: 'adm', at: serverTimestamp() }, updatedAt: Date.now() }));
    // an older doc where the verdict captain already scores: their verdict is refused
    const w = build(spec('wonPending'), { scorerId: 'b0', scorerReassign: { from: 'cap', to: 'b0', by: 'adm', at: new Date(T0) } });
    await seed('v6b', w.raw);
    await assertFails(rawUpdateDoc(doc(asDb('b0'), 'matches/v6b'), payload('verdict', w.raw, w.m, 'b0')));
  });

  test('V145-11: a report needs the stored record and a rally', async () => {
    const { m, raw } = build(spec('abLegacy'));
    await seed('v11', raw);
    await assertFails(rawUpdateDoc(doc(asDb('b0'), 'matches/v11'), payload('report', raw, m, 'b0')));
    const d = build(spec('abDirect'), { abandon: { by: 'cap', at: new Date(T0), events: 0, mode: 'review', review: 'pending', score: { setsA: 0, setsB: 0, currentA: 0, currentB: 0 }, behind: false } });
    await seed('v11b', d.raw);
    await assertFails(rawUpdateDoc(doc(asDb('b0'), 'matches/v11b'), DOCS.reportDoc(d.raw, 'b0', fx, Date.now())));
  });

  // ---------- 1.4.7 (QA V146) ----------
  test('V146-2: an admin reassigns only off the verdict captain\'s team (every B player refused, A players allowed)', async () => {
    const { raw } = build(spec('live3'));
    const re = (to) => ({ scorerId: to, scorerReassign: { from: 'cap', to, by: 'adm', at: serverTimestamp() }, updatedAt: Date.now() });
    for (const to of ['b0', 'b1', 'b5', 'b11']) {
      await seed(`r2_${to}`, raw);
      await assertFails(rawUpdateDoc(doc(asDb('adm'), `matches/r2_${to}`), re(to)));
    }
    for (const to of ['a1', 'a7']) {
      await seed(`r2_${to}`, raw);
      await assertSucceeds(rawUpdateDoc(doc(asDb('adm'), `matches/r2_${to}`), re(to)));
    }
  });
  test('V146-3: before the first rally the creator can\'t hand scoring to the opposing captain or their team', async () => {
    for (const st of ['sched0', 'live0']) {
      const { raw } = build(spec(st));
      for (const to of ['b0', 'b3']) {
        await seed(`r3_${st}_${to}`, raw);
        await assertFails(rawUpdateDoc(doc(asDb('cap'), `matches/r3_${st}_${to}`), { scorerId: to, updatedAt: Date.now() }));
      }
      await seed(`r3_${st}_a2`, raw);
      await assertSucceeds(rawUpdateDoc(doc(asDb('cap'), `matches/r3_${st}_a2`), { scorerId: 'a2', updatedAt: Date.now() }));
    }
  });
  test('V146-3: the verdict invariant – every walk state has a verdict captain; every scorer change the rules accept keeps one', async () => {
    const bad = [];
    let changes = 0;
    const broken = (m) => {
      const caps = AF.verdictCaptains(m);
      if (!caps.length) return 'no verdict captain';
      const ss = AF.sideOfPlayer(m, m.scorerId);
      return caps.includes(m.scorerId) || caps.some((c) => ss !== null && AF.sideOfPlayer(m, c) === ss) ? `scorer ${m.scorerId} on the verdict side` : null;
    };
    for (const st of LC.LC_STATES.filter((x) => !x.noConfirmer && !x.captainMix)) { // (1.4.8: noConfirm* = older data, repaired by an admin)
      const { m, raw } = build(st);
      const p0 = broken(m);
      if (p0) bad.push(`${st.name}: ${p0}`);
      for (const to of ['a1', 'b0', 'b1', 'zz']) {
        for (const how of ['handover', 'reassign']) {
          const id = `r3i_${st.name}_${to}_${how}`;
          await seed(id, raw);
          const body = how === 'handover' ? { scorerId: to, updatedAt: Date.now() } : { scorerId: to, scorerReassign: { from: 'cap', to, by: 'adm', at: serverTimestamp() }, updatedAt: Date.now() };
          const ok = await rawUpdateDoc(doc(asDb(how === 'handover' ? 'cap' : 'adm'), `matches/${id}`), body).then(() => true, () => false);
          if (!ok) continue;
          changes++;
          const after = { ...m, scorerId: to, ...(how === 'reassign' ? { scorerReassign: { from: 'cap', to, by: 'adm', at: NOW } } : {}) };
          const p = broken(after);
          if (p) bad.push(`${st.name} ${how}→${to}: ${p}`);
        }
      }
    }
    expect(bad).toEqual([]);
    expect(changes).toBeGreaterThan(5);
  }, 600000);
  test('V146-5: a hand-built reinstate to live of a wasWon match is refused (finished only)', async () => {
    const p = build(spec('abPending'));
    const live = payload('reinstate', p.raw, p.m, 'adm');
    expect(live.status).toBe('live');
    await seed('r5ok', p.raw);
    await assertSucceeds(rawUpdateDoc(doc(asDb('adm'), 'matches/r5ok'), live)); // control
    await seed('r5', { ...p.raw, wasWon: true });
    await assertFails(rawUpdateDoc(doc(asDb('adm'), 'matches/r5'), live));
    // the won log: core sends it to finished, and the rules accept that
    const w = build(spec('abWonLog'));
    const fin = payload('reinstate', w.raw, w.m, 'adm');
    expect(fin.status).toBe('finished');
    await seed('r5w', w.raw);
    await assertSucceeds(rawUpdateDoc(doc(asDb('adm'), 'matches/r5w'), fin));
  });
  // ---------- 1.4.8 (QA V147-1 / V147-2) ----------
  test('V147-1: create needs someone who can confirm – the scorer on the other team (creator on A) is refused', async () => {
    const A = ['cap', 'u1', 'u2', 'u3', 'u4', 'u5'];
    const B = ['w1', 'w2', 'w3', 'w4', 'w5', 'w6'];
    const mk = (scorerId) => matchDoc({ ids: A }, { ids: B }, { scorerId, participantIds: ordered(A, B, ['cap']) });
    await assertFails(setDoc(doc(asDb('cap'), 'matches/v1a'), mk('w2')));
    await assertSucceeds(setDoc(doc(asDb('cap'), 'matches/v1b'), mk('u2')));
  });
  test('V147-1: a roster edit that moves the scorer to team B (creator stays on A) is refused; the same edit by a scorer-creator is fine', async () => {
    const A2 = A12.filter((x) => x !== 'a2').concat('b11');
    const B2 = B12.slice(0, 11).concat('a2');
    const base = build(spec('sched0')).raw;
    const edit = { teamA: { ...base.teamA, players: A2.map((id) => ({ id, name: id.toUpperCase() })) }, teamB: { ...base.teamB, players: B2.map((id) => ({ id, name: id.toUpperCase() })) }, participantIds: [...A2, ...B2], updatedAt: Date.now() };
    await env.withSecurityRulesDisabled(async (c) => {
      await setDoc(doc(c.firestore(), 'terms/a2'), { version: TERMS_VERSION, acceptedAt: new Date() });
      for (const u of ['cap', 'a1', 'a3', 'b0', 'b1', 'b2']) await setDoc(doc(c.firestore(), `users/${u}`), { name: u }); // by-number sides: profiles
    });
    await seed('v1c', { ...base, scorerId: 'a2' }); // scorer a2 moves to B, creator cap stays on A: nobody confirms
    await assertFails(rawUpdateDoc(doc(asDb('a2'), 'matches/v1c'), edit));
    await seed('v1d', base); // the scorer is the creator (cap, stays on A): B's captain confirms
    await assertSucceeds(rawUpdateDoc(doc(asDb('cap'), 'matches/v1d'), edit));
  });
  test('V147-2: the admin repair – audited, only an admin outside the match, only a broken match, only a valid scorer', async () => {
    const VR = app('src/core/verdictRepair.ts');
    const w = build(spec('noConfirm'));
    const body = (me, fix, over = {}) => { const d = DOCS.repairDoc(VR.repairBody(w.m, me, fix, Date.now()), fx, Date.now()); d.verdictRepair = { ...d.verdictRepair, ...over }; return d; };
    for (const [id, who, fix, over, ok] of [
      ['vr1', 'adm', { scorerId: 'cap' }, {}, true],
      ['vr2', 'b0', { scorerId: 'cap' }, {}, false], // not an admin
      ['vr3', 'adm', { scorerId: 'b2' }, {}, false], // still nobody to confirm
      ['vr4', 'adm', { scorerId: 'zz' }, {}, false], // not a participant
      ['vr5', 'adm', { scorerId: 'cap' }, { prevScorer: 'cap' }, false], // forged audit
      ['vr6', 'adm', { scorerId: 'cap' }, { by: 'adm2' }, false],
      ['vr7', 'adm', { captain: { side: 'B', id: 'b2' } }, {}, false], // a captain change can't fix a side-based exclusion
    ]) {
      await seed(id, w.raw);
      const p = rawUpdateDoc(doc(asDb(who), `matches/${id}`), body(who, fix, over));
      await (ok ? assertSucceeds(p) : assertFails(p));
    }
    // a working match, and a verdict already given: nothing to repair
    const okm = build(spec('wonPending'));
    await seed('vr8', okm.raw);
    await assertFails(rawUpdateDoc(doc(asDb('adm'), 'matches/vr8'), DOCS.repairDoc(VR.repairBody(okm.m, 'adm', { scorerId: 'a1' }, Date.now()), fx, Date.now())));
    // the field can't be written any other way (create / scorer update)
    await seed('vr9', build(spec('live3')).raw);
    await assertFails(rawUpdateDoc(doc(asDb('cap'), 'matches/vr9'), { verdictRepair: { by: 'cap' }, updatedAt: Date.now() }));
  });
  // ---------- 1.4.9 (QA V148-2): one decision in core / demo / API / rules ----------
  // 1.4.10 (QA V149-3): a captain repair only for a side whose captain plays for the other team – rules == core
  test('V148-2 / V149-3 (RP9): captain B is a team-A player – the captain repair is allowed exactly when core allows it', async () => {
    const VR = app('src/core/verdictRepair.ts');
    const w = build(spec('noConfirm'));
    const shapes = {
      rp9: { captains: { ...w.raw.captains, B: 'a1' }, scorerId: w.raw.createdBy }, // RP9: B's captain an A player
      side: { captains: { ...w.raw.captains } }, // the usual broken shape: captains on their sides
    };
    let allowed = 0;
    for (const [k, over] of Object.entries(shapes)) {
      const { scorerReassign: _r1, ...raw0 } = w.raw;
      const { scorerReassign: _r2, ...m0 } = w.m;
      const raw = { ...raw0, ...over };
      const m = { ...m0, ...over };
      for (const fix of [{ captain: { side: 'B', id: 'b2' } }, { captain: { side: 'B', id: 'b1' } }, { captain: { side: 'B', id: 'a2' } }, { captain: { side: 'A', id: 'a2' } }]) {
        const id = `rp9-${k}-${fix.captain.side}-${fix.captain.id}`;
        const ok = VR.repairProblem(m, 'adm', true, fix) === null;
        allowed += ok ? 1 : 0;
        await seed(id, raw);
        const p = rawUpdateDoc(doc(asDb('adm'), `matches/${id}`), DOCS.repairDoc(VR.repairBody(m, 'adm', fix, Date.now()), fx, Date.now()));
        await (ok ? assertSucceeds(p) : assertFails(p)).catch((e) => { throw new Error(`${id} core=${ok}: ${e.message}`); });
      }
    }
    expect(allowed).toBe(2); // RP9: B ← b2 / b1; nothing else
    // a non-admin can't
    const { scorerReassign: _r3, ...rawX } = w.raw;
    await seed('rp9-x', { ...rawX, ...shapes.rp9 });
    await assertFails(rawUpdateDoc(doc(asDb('b0'), 'matches/rp9-x'), DOCS.repairDoc(VR.repairBody({ ...w.m, ...shapes.rp9 }, 'b0', { captain: { side: 'B', id: 'b2' } }, Date.now()), fx, Date.now())));
  });
  test('V148-2 (GU11): an older doc with scorerReassign.from on side B – a roster edit core refuses is refused by the rules too', async () => {
    const AF = app('src/core/antifraud.ts');
    const base = build(spec('sched0')).raw;
    const A2 = A12.filter((x) => x !== 'a2').concat('b11');
    const B2 = B12.slice(0, 11).concat('a2');
    const edit = { teamA: { ...base.teamA, players: A2.map((id) => ({ id, name: id.toUpperCase() })) }, teamB: { ...base.teamB, players: B2.map((id) => ({ id, name: id.toUpperCase() })) }, participantIds: [...A2, ...B2], updatedAt: Date.now() };
    await env.withSecurityRulesDisabled(async (c) => {
      await setDoc(doc(c.firestore(), 'terms/a2'), { version: TERMS_VERSION, acceptedAt: new Date() });
      for (const u of ['cap', 'a1', 'a3', 'b0', 'b1', 'b2']) await setDoc(doc(c.firestore(), `users/${u}`), { name: u });
    });
    const from = { from: 'b2', by: 'adm', at: T0 };
    const after = { ...base, ...edit, scorerReassign: from };
    expect(AF.verdictSetupProblem(after)).toBe(AF.MATCH_NO_VERDICT);
    expect(AF.verdictSetupProblem({ ...base, ...edit })).toBeNull();
    await seed('gu11a', { ...base, scorerReassign: from });
    await assertFails(rawUpdateDoc(doc(asDb('cap'), 'matches/gu11a'), edit));
    await seed('gu11b', base);
    await assertSucceeds(rawUpdateDoc(doc(asDb('cap'), 'matches/gu11b'), edit));
  });
  // ---------- 1.4.10 (QA V149-1): 12-a-side + scorerReassign stays within the expression budget ----------
  test('V149-1: 12-a-side with scorerReassign – a rename and a valid roster edit pass; the GU11 edit is still refused', async () => {
    const AF = app('src/core/antifraud.ts');
    const base = build(spec('sched0')).raw;
    expect(base.teamA.players.length).toBe(12);
    await env.withSecurityRulesDisabled(async (c) => {
      await setDoc(doc(c.firestore(), 'terms/a2'), { version: TERMS_VERSION, acceptedAt: new Date() });
      for (const u of ['cap', 'a1', 'a2', 'a3', 'b0', 'b1', 'b2']) // by-number sides: the first 3 players' profiles
        await setDoc(doc(c.firestore(), `users/${u}`), { name: u });
    });
    const okFrom = { from: 'a3', by: 'adm', at: T0 }; // reference on A, like the scorer and the creator: B confirms
    // a rename only (control: the same rename without scorerReassign)
    await seed('v149z', base);
    await assertSucceeds(rawUpdateDoc(doc(asDb('cap'), 'matches/v149z'), { teamA: { ...base.teamA, name: 'Renamed A' }, updatedAt: Date.now() })).catch((e) => { throw new Error('step 1 ' + e.message); });
    await seed('v149a', { ...base, scorerReassign: okFrom });
    await assertSucceeds(rawUpdateDoc(doc(asDb('cap'), 'matches/v149a'), { teamA: { ...base.teamA, name: 'Renamed A' }, updatedAt: Date.now() })).catch((e) => { throw new Error('step 2 ' + e.message); });
    // a valid roster edit (a2 ↔ b11)
    const A2 = A12.filter((x) => x !== 'a2').concat('b11');
    const B2 = B12.slice(0, 11).concat('a2');
    const edit = { teamA: { ...base.teamA, players: A2.map((id) => ({ id, name: id.toUpperCase() })) }, teamB: { ...base.teamB, players: B2.map((id) => ({ id, name: id.toUpperCase() })) }, participantIds: [...A2, ...B2], updatedAt: Date.now() };
    expect(AF.verdictSetupProblem({ ...base, ...edit, scorerReassign: okFrom })).toBeNull();
    await seed('v149b', { ...base, scorerReassign: okFrom });
    await assertSucceeds(rawUpdateDoc(doc(asDb('cap'), 'matches/v149b'), edit)).catch((e) => { throw new Error('step 3 ' + e.message); });
    // a rename on the GU11 doc (reference on B) is a rename: allowed; the roster edit is refused
    const badFrom = { from: 'b2', by: 'adm', at: T0 };
    await seed('v149c', { ...base, scorerReassign: badFrom });
    await assertSucceeds(rawUpdateDoc(doc(asDb('cap'), 'matches/v149c'), { teamB: { ...base.teamB, name: 'Renamed B' }, updatedAt: Date.now() })).catch((e) => { throw new Error('step 4 ' + e.message); });
    await assertFails(rawUpdateDoc(doc(asDb('cap'), 'matches/v149c'), edit)).catch((e) => { throw new Error('step 5 ' + e.message); });
  });
  // ---------- 1.4.11 (QA V1410-1/2/3) ----------
  test('V1410-1: 12-a-side – the scorer or the creator moving to team B is refused by the logic (no expression-limit error); a valid edit passes', async () => {
    const base = build(spec('sched0')).raw;
    expect(base.teamA.players.length).toBe(12);
    await env.withSecurityRulesDisabled(async (c) => {
      await setDoc(doc(c.firestore(), 'terms/a2'), { version: TERMS_VERSION, acceptedAt: new Date() });
      for (const u of ['cap', 'a1', 'a2', 'a3', 'b0', 'b1', 'b2']) await setDoc(doc(c.firestore(), `users/${u}`), { name: u });
    });
    const roster = (A, B) => ({ teamA: { ...base.teamA, players: A.map((id) => ({ id, name: id.toUpperCase() })) }, teamB: { ...base.teamB, players: B.map((id) => ({ id, name: id.toUpperCase() })) }, participantIds: [...A, ...B], updatedAt: Date.now() });
    const moveA2 = roster(A12.filter((x) => x !== 'a2').concat('b11'), B12.slice(0, 11).concat('a2'));
    const logicDeny = async (p) => {
      const e = await p.then(() => null, (x) => x);
      expect(e && e.code).toBe('permission-denied');
      expect(e.message).not.toMatch(/maximum of 1000 expressions/);
    };
    await seed('v1410a', { ...base, scorerId: 'a2' }); // the scorer a2 moves himself to B, creator cap on A
    await logicDeny(rawUpdateDoc(doc(asDb('a2'), 'matches/v1410a'), moveA2));
    await seed('v1410b', { ...base, scorerId: 'a3' }); // the creator moves to B (scorer a3 stays on A)
    const moveCap = roster(A12.filter((x) => x !== 'cap').concat('b11'), B12.slice(0, 11).concat('cap'));
    await logicDeny(rawUpdateDoc(doc(asDb('a3'), 'matches/v1410b'), { ...moveCap, captains: { A: 'a1', B: base.captains.B } }));
    await seed('v1410c', base); // valid: a2 (not scorer / creator) moves
    await assertSucceeds(rawUpdateDoc(doc(asDb('cap'), 'matches/v1410c'), moveA2));
  });
  test('V1410-2: a rename on an already-broken older doc (GU11) passes in core and the rules; a roster edit there does not', async () => {
    const MG = app('src/core/matchGuards.ts');
    const base = build(spec('sched0')).raw;
    await env.withSecurityRulesDisabled(async (c) => {
      for (const u of ['cap', 'a1', 'a2', 'a3', 'b0', 'b1', 'b2']) await setDoc(doc(c.firestore(), `users/${u}`), { name: u }); // by-number sides
    });
    const gu11 = { ...base, scorerReassign: { from: 'b2', by: 'adm', at: T0 } };
    const rename = { teamB: { ...base.teamB, name: 'Renamed B' } };
    expect(() => MG.guardUpdate(gu11, rename)).not.toThrow();
    expect(MG.verdictSetupChanged(gu11, { ...gu11, ...rename })).toBe(false);
    await seed('v1410d', gu11);
    await assertSucceeds(rawUpdateDoc(doc(asDb('cap'), 'matches/v1410d'), { ...rename, updatedAt: Date.now() }));
  });
  test('V1410-3: a captain repair only when the new captain can confirm – a fix of the scorer\'s side or a repeat is refused, like core', async () => {
    const VR = app('src/core/verdictRepair.ts');
    const w = build(spec('noConfirm'));
    const { scorerReassign: _r, ...raw0 } = w.raw;
    const { scorerReassign: _m, ...m0 } = w.m;
    const over = { captains: { A: 'b3', B: 'a3' }, scorerId: w.raw.createdBy }; // both captains off their sides
    const raw = { ...raw0, ...over };
    const m = { ...m0, ...over };
    const fixA = { captain: { side: 'A', id: 'a1' } };
    const fixB = { captain: { side: 'B', id: 'b2' } };
    expect(VR.repairProblem(m, 'adm', true, fixA)).toBe(VR.REPAIR_INVALID); // A holds the scorer and the creator
    expect(VR.repairProblem(m, 'adm', true, fixB)).toBeNull();
    await seed('v1410e', raw);
    await assertFails(rawUpdateDoc(doc(asDb('adm'), 'matches/v1410e'), DOCS.repairDoc(VR.repairBody(m, 'adm', fixA, Date.now()), fx, Date.now())));
    await assertSucceeds(rawUpdateDoc(doc(asDb('adm'), 'matches/v1410e'), DOCS.repairDoc(VR.repairBody(m, 'adm', fixB, Date.now()), fx, Date.now())));
    // a second captain repair after that (A's captain is still off its side): core says not needed, the rules refuse
    const m2 = { ...m, captains: { A: 'b3', B: 'b2' } };
    expect(VR.repairProblem(m2, 'adm', true, fixA)).not.toBeNull();
    await seed('v1410f', { ...raw, captains: { A: 'b3', B: 'b2' } });
    await assertFails(rawUpdateDoc(doc(asDb('adm'), 'matches/v1410f'), DOCS.repairDoc(VR.repairBody(m2, 'adm', fixA, Date.now()), fx, Date.now())));
  });
  // ---------- 1.4.12 (QA V1411-1/2) ----------
  test('V1411-1/2: 12-a-side broken docs (GU11, GU7, captain mix) – a display-name change or rename passes (ids compared, like core verdictSetupChanged); a roster or captain change is still checked, under the limit', async () => {
    const MG = app('src/core/matchGuards.ts');
    const base = build(spec('sched0')).raw;
    expect(base.teamA.players.length).toBe(12);
    await env.withSecurityRulesDisabled(async (c) => {
      for (const u of ['cap', 'a1', 'a2', 'a3', 'b0', 'b1', 'b2']) await setDoc(doc(c.firestore(), `users/${u}`), { name: u });
    });
    const noLimit = async (p, ok) => {
      const e = await p.then(() => null, (x) => x);
      if (ok) { expect(e && e.message).toBeFalsy(); return; }
      expect(e && e.code).toBe('permission-denied');
      expect(e.message).not.toMatch(/maximum of 1000 expressions/);
    };
    const shown = (t) => ({ ...t, players: t.players.map((p, i) => (i === 3 ? { ...p, name: 'Shown Name' } : p)) });
    const docs = {
      gu11: { ...base, scorerReassign: { from: 'b2', by: 'adm', at: T0 } },
      gu7: { ...base, scorerId: 'b1' }, // older doc: scorer on B, creator on A – nobody can confirm
      capmix: { ...base, captains: { A: base.captains.A, B: 'a1' } }, // team B's captain plays for team A
    };
    const who = { gu11: 'cap', gu7: 'b1', capmix: 'cap' };
    let i = 0;
    for (const [k, d] of Object.entries(docs)) {
      const nameEdit = { teamA: shown(d.teamA), teamB: { ...d.teamB, name: 'Renamed B' } };
      expect(MG.verdictSetupChanged(d, { ...d, ...nameEdit })).toBe(false);
      expect(() => MG.guardUpdate(d, nameEdit)).not.toThrow();
      const id = `v1411${i++}`;
      await seed(id, d);
      await noLimit(rawUpdateDoc(doc(asDb(who[k]), `matches/${id}`), { ...nameEdit, updatedAt: Date.now() }), true);
      // same ids, other order on B: a verdict-setup change → checked (and refused on these broken docs)
      const rb = [...d.teamB.players].reverse();
      await noLimit(rawUpdateDoc(doc(asDb(who[k]), `matches/${id}`), { teamB: { ...d.teamB, players: rb }, participantIds: [...d.teamA.players.map((p) => p.id), ...rb.map((p) => p.id)], updatedAt: Date.now() }), false);
      await noLimit(rawUpdateDoc(doc(asDb(who[k]), `matches/${id}`), { captains: { A: d.captains.A, B: k === 'capmix' ? 'a2' : 'a1' }, updatedAt: Date.now() }), false);
    }
  });
  // ---------- 1.4.13 (QA V1412-1/2/3, KNOWN-GAPS) ----------
  test('V1412-1 (High): captain mix – the team-B captain who plays for A can\'t confirm or dispute (A or B won); the repair works; then the new captain confirms', async () => {
    const VR = app('src/core/verdictRepair.ts');
    const AF = app('src/core/antifraud.ts');
    await env.withSecurityRulesDisabled(async (c) => {
      for (const u of ['a1', 'b0', 'b2']) await setDoc(doc(c.firestore(), `terms/${u}`), { version: TERMS_VERSION, acceptedAt: new Date() });
    });
    const b5 = build(spec('capMix'));
    const aEv = b5.m.events.map((e) => ({ ...e, side: 'A' }));
    const a5 = { m: { ...b5.m, events: aEv, playerOfMatchId: 'a2' }, raw: { ...b5.raw, events: aEv, playerOfMatchId: 'a2' } };
    let i = 0;
    for (const w of [b5, a5]) {
      expect(w.raw.captains).toEqual({ A: 'cap', B: 'a1' });
      expect(AF.confirmProblem(w.m, 'a1')).toBe('not_captain');
      const id = `v1412a${i++}`;
      await seed(id, w.raw);
      await assertFails(rawUpdateDoc(doc(asDb('a1'), `matches/${id}`), DOCS.verifyDoc(w.raw, 'a1', 'confirmed', undefined, fx, Date.now())));
      await assertFails(rawUpdateDoc(doc(asDb('a1'), `matches/${id}`), DOCS.verifyDoc(w.raw, 'a1', 'disputed', 'wrong score', fx, Date.now())));
      await assertFails(rawUpdateDoc(doc(asDb('b0'), `matches/${id}`), DOCS.verifyDoc(w.raw, 'b0', 'confirmed', undefined, fx, Date.now())));
      // the admin's captain repair is allowed (the doc is broken by the side rule now) …
      const fix = { captain: { side: 'B', id: 'b2' } };
      expect(VR.repairProblem(w.m, 'adm', true, fix)).toBeNull();
      await assertSucceeds(rawUpdateDoc(doc(asDb('adm'), `matches/${id}`), DOCS.repairDoc(VR.repairBody(w.m, 'adm', fix, Date.now()), fx, Date.now())));
      // … then b2 confirms and a1 still can't
      const fixedRaw = { ...w.raw, captains: { A: 'cap', B: 'b2' } };
      const id2 = `v1412a${i++}`;
      await seed(id2, fixedRaw);
      await assertFails(rawUpdateDoc(doc(asDb('a1'), `matches/${id2}`), DOCS.verifyDoc(fixedRaw, 'a1', 'confirmed', undefined, fx, Date.now())));
      await assertSucceeds(rawUpdateDoc(doc(asDb('b2'), `matches/${id2}`), DOCS.verifyDoc(fixedRaw, 'b2', 'confirmed', undefined, fx, Date.now())));
    }
  });
  test('KNOWN-GAPS (1.4.13): the rules refuse a repeat captain repair and a repair of a match that isn\'t broken, even for an admin', async () => {
    const VR = app('src/core/verdictRepair.ts');
    const w = build(spec('capMix'));
    const fixed = { ...w.raw, captains: { A: 'cap', B: 'b2' } };
    const fm = { ...w.m, captains: { A: 'cap', B: 'b2' } };
    await seed('kg1', fixed); // repaired once: a second captain repair of B
    expect(VR.repairProblem(fm, 'adm', true, { captain: { side: 'B', id: 'b3' } })).not.toBeNull();
    await assertFails(rawUpdateDoc(doc(asDb('adm'), 'matches/kg1'), DOCS.repairDoc(VR.repairBody(fm, 'adm', { captain: { side: 'B', id: 'b3' } }, Date.now()), fx, Date.now())));
    const ok = build(spec('wonPending')); // healthy: nobody needs a repair
    await seed('kg2', ok.raw);
    await assertFails(rawUpdateDoc(doc(asDb('adm'), 'matches/kg2'), DOCS.repairDoc(VR.repairBody(ok.m, 'adm', { scorerId: 'a1' }, Date.now()), fx, Date.now())));
    const neutral = { ...ok.raw, captains: { A: 'cap', B: 'a1' }, scorerId: 'zz' }; // a neutral scorer, creator on A: A's captain-creator…
    await seed('kg3', { ...neutral, createdBy: 'zz' }); // … not broken in core terms (A's captain cap confirms)
    expect(VR.repairProblem({ ...ok.m, captains: { A: 'cap', B: 'a1' }, scorerId: 'zz', createdBy: 'zz' }, 'adm', true, { captain: { side: 'B', id: 'b2' } })).not.toBeNull();
    await assertFails(rawUpdateDoc(doc(asDb('adm'), 'matches/kg3'), DOCS.repairDoc(VR.repairBody({ ...ok.m, captains: { A: 'cap', B: 'a1' }, scorerId: 'zz', createdBy: 'zz' }, 'adm', { captain: { side: 'B', id: 'b2' } }, Date.now()), fx, Date.now())));
  });
  test('V1412-3: sides come from the rosters – on an older doc with participantIds out of order, moving captain B to A or the reference to B is a set-up change (refused like core)', async () => {
    const MG = app('src/core/matchGuards.ts');
    const base = build(spec('sched0')).raw;
    await env.withSecurityRulesDisabled(async (c) => {
      for (const u of [...A12, ...B12]) await setDoc(doc(c.firestore(), `users/${u}`), { name: u });
    });
    const P = (ids) => ids.map((id) => ({ id, name: id.toUpperCase() }));
    const logicDeny = async (p) => {
      const e = await p.then(() => null, (x) => x);
      expect(e && e.code).toBe('permission-denied');
      expect(e.message).not.toMatch(/maximum of 1000 expressions/);
    };
    // LX1: stored participantIds list B first; the write swaps the rosters to that order (captain B b0 → team A)
    const lx1 = { ...base, participantIds: [...B12, ...A12] };
    const mv1 = { teamA: { ...base.teamA, players: P(B12) }, teamB: { ...base.teamB, players: P(A12) }, updatedAt: Date.now() };
    expect(MG.verdictSetupChanged(lx1, { ...lx1, ...mv1 })).toBe(true);
    await seed('lx1', lx1);
    await logicDeny(rawUpdateDoc(doc(asDb('cap'), 'matches/lx1'), mv1));
    // LX4: a GU11-style reference a2; stored participantIds have a2 and b5 swapped; the write moves a2 to B
    const A2 = A12.map((x) => (x === 'a2' ? 'b5' : x));
    const B2 = B12.map((x) => (x === 'b5' ? 'a2' : x));
    const lx4 = { ...base, participantIds: [...A2, ...B2], scorerReassign: { from: 'a2', by: 'adm', at: T0 } };
    const mv4 = { teamA: { ...base.teamA, players: P(A2) }, teamB: { ...base.teamB, players: P(B2) }, updatedAt: Date.now() };
    expect(MG.verdictSetupChanged(lx4, { ...lx4, ...mv4 })).toBe(true);
    await seed('lx4', lx4);
    await logicDeny(rawUpdateDoc(doc(asDb('cap'), 'matches/lx4'), mv4));
  });
  test('V1412-2: set-up changes on broken GU7 / GU11 docs at 10, 11 and 12 a side are refused by the logic, not the expression limit', async () => {
    const base = build(spec('sched0')).raw;
    await env.withSecurityRulesDisabled(async (c) => {
      for (const u of [...A12, ...B12]) await setDoc(doc(c.firestore(), `users/${u}`), { name: u });
    });
    const P = (ids) => ids.map((id) => ({ id, name: id.toUpperCase() }));
    const logicDeny = async (p, what) => {
      const e = await p.then(() => null, (x) => x);
      expect([what, e && e.code]).toEqual([what, 'permission-denied']);
      expect([what, /maximum of 1000 expressions/.test(e.message)]).toEqual([what, false]);
    };
    let i = 0;
    for (const n of [10, 11, 12]) {
      const A = A12.slice(0, n);
      const B = B12.slice(0, n);
      const sized = { ...base, teamA: { ...base.teamA, players: P(A) }, teamB: { ...base.teamB, players: P(B) }, participantIds: [...A, ...B] };
      for (const [k, d, who] of [['gu7', { ...sized, scorerId: 'b1' }, 'b1'], ['gu11', { ...sized, scorerReassign: { from: 'b2', by: 'adm', at: T0 } }, 'cap']]) {
        const rb = [...B].reverse();
        const edits = {
          captain: { captains: { A: 'cap', B: 'b3' } },
          reorder: { teamB: { ...d.teamB, players: P(rb) }, participantIds: [...A, ...rb] },
          teamId: { teamA: { ...d.teamA, teamId: 'team_x' } },
        };
        for (const [e, body] of Object.entries(edits)) {
          const id = `v1412b${i++}`;
          await seed(id, d);
          await logicDeny(rawUpdateDoc(doc(asDb(who), `matches/${id}`), { ...body, updatedAt: Date.now() }), `${k} ${n} ${e}`);
        }
      }
    }
  });
  test('V1413-1 / V1413-3: on older docs with participantIds out of roster order, a valid swap (LX3) and a plain rename / display-name change (LX2, LX8) are allowed at 6..12 a side, under the expression limit', async () => {
    const MG = app('src/core/matchGuards.ts');
    const base = build(spec('sched0')).raw;
    await env.withSecurityRulesDisabled(async (c) => {
      for (const u of [...A12, ...B12]) await setDoc(doc(c.firestore(), `users/${u}`), { name: u });
    });
    const P = (ids) => ids.map((id) => ({ id, name: id.toUpperCase() }));
    const ok = async (p, what) => {
      const e = await p.then(() => null, (x) => x);
      expect([what, e && e.message]).toEqual([what, null]);
    };
    let i = 0;
    for (let n = 6; n <= 12; n++) {
      const A = A12.slice(0, n);
      const B = B12.slice(0, n);
      const last = A[n - 1];
      // stored rosters canonical, participantIds with a(n-1) and b1 swapped (an older doc)
      const lp = [...A.slice(0, n - 1), 'b1', last, 'b0', ...B.slice(2)];
      const lg = { ...base, teamA: { ...base.teamA, players: P(A) }, teamB: { ...base.teamB, players: P(B) }, participantIds: lp };
      const edits = {
        LX3: { teamA: { ...lg.teamA, players: P(lp.slice(0, n)) }, teamB: { ...lg.teamB, players: P(lp.slice(n)) } },
        LX2: { teamA: { ...lg.teamA, name: 'Renamed' } },
        LX8: { teamA: { ...lg.teamA, players: lg.teamA.players.map((x, k) => (k === 2 ? { ...x, name: 'Zed' } : x)) } },
      };
      for (const [k, e] of Object.entries(edits)) {
        const after = { ...lg, ...e };
        expect([k, n, MG.guardUpdate ? (() => { try { MG.guardUpdate(lg, e); return 'ok'; } catch (x) { return x.message; } })() : 'ok']).toEqual([k, n, 'ok']);
        const id = `lx14_${i++}`;
        await seed(id, lg);
        await ok(rawUpdateDoc(doc(asDb('cap'), `matches/${id}`), { ...e, updatedAt: Date.now() }), `${k} ${n}`);
      }
      // the same swap between two REGISTERED teams (both hold every player): captainsOk + validRoster path, under the limit
      await env.withSecurityRulesDisabled(async (c) => {
        await setDoc(doc(c.firestore(), 'teams/lxta'), { name: 'TA', captainId: 'cap', memberIds: [...A12, ...B12] });
        await setDoc(doc(c.firestore(), 'teams/lxtb'), { name: 'TB', captainId: 'b0', memberIds: [...A12, ...B12] });
      });
      const lt = { ...lg, teamA: { ...lg.teamA, teamId: 'lxta' }, teamB: { ...lg.teamB, teamId: 'lxtb' } };
      const tid = `lx14_${i++}`;
      await seed(tid, lt);
      await ok(rawUpdateDoc(doc(asDb('cap'), `matches/${tid}`), { teamA: { ...lt.teamA, players: P(lp.slice(0, n)) }, teamB: { ...lt.teamB, players: P(lp.slice(n)) }, updatedAt: Date.now() }), `LX3 teams ${n}`);
      // … but not into a registered team the moved player isn't a member of
      await env.withSecurityRulesDisabled((c) => setDoc(doc(c.firestore(), 'teams/lxtc'), { name: 'TC', captainId: 'b0', memberIds: [...B12] }));
      const lc = { ...lt, teamB: { ...lt.teamB, teamId: 'lxtc' } };
      const cid = `lx14_${i++}`;
      await seed(cid, lc);
      const ce = await rawUpdateDoc(doc(asDb('cap'), `matches/${cid}`), { teamA: { ...lc.teamA, players: P(lp.slice(0, n)) }, teamB: { ...lc.teamB, players: P(lp.slice(n)) }, updatedAt: Date.now() }).then(() => null, (x) => x);
      expect([n, ce && ce.code, ce && /maximum of 1000/.test(ce.message)]).toEqual([n, 'permission-denied', false]);
      // the refusal side still holds: a rename that also moves captain B b0 to A is refused by the logic
      const bad = { teamA: { ...lg.teamA, name: 'R', players: P([...A.slice(0, n - 1), 'b0']) }, teamB: { ...lg.teamB, players: P([last, ...B.slice(1)]) } };
      const id = `lx14_${i++}`;
      await seed(id, lg);
      const e = await rawUpdateDoc(doc(asDb('cap'), `matches/${id}`), { ...bad, updatedAt: Date.now() }).then(() => null, (x) => x);
      expect([n, e && e.code]).toEqual([n, 'permission-denied']);
      expect([n, /maximum of 1000 expressions/.test(e.message)]).toEqual([n, false]);
    }
  });
  test('V1414-2: the scorer can\'t write wasWon outside the finishing write (CThwon) – like core (server_field)', async () => {
    const MG = app('src/core/matchGuards.ts');
    const w = build(spec('sched0'));
    expect((() => { try { MG.guardUpdate(w.m, { wasWon: true }); return 'ok'; } catch (e) { return e.message; } })()).not.toBe('ok');
    for (const [k, extra] of [['cthwon', {}], ['cthwon2', { title: 'T2' }]]) {
      await seed(k, w.raw);
      const e = await rawUpdateDoc(doc(asDb('cap'), `matches/${k}`), { wasWon: true, ...extra, updatedAt: Date.now() }).then(() => null, (x) => x);
      expect([k, e && e.code, e && /maximum of 1000/.test(e.message)]).toEqual([k, 'permission-denied', false]);
    }
    // 1.4.16 (optional): wasWon:false added to a scheduled doc without the field is refused too (core: server_field)
    const { wasWon: _ww, ...noWw } = w.raw;
    await seed('cthwon4', noWw);
    const e4 = await rawUpdateDoc(doc(asDb('cap'), 'matches/cthwon4'), { wasWon: false, updatedAt: Date.now() }).then(() => null, (x) => x);
    expect([e4 && e4.code, e4 && /maximum of 1000/.test(e4.message)]).toEqual(['permission-denied', false]);
    await seed('cthwon3', w.raw); // control: the same write without wasWon
    await assertSucceeds(rawUpdateDoc(doc(asDb('cap'), 'matches/cthwon3'), { title: 'T2', updatedAt: Date.now() }));
  });
  test('1.4.15: an older doc with 13 entries on a side (duplicate captain in 13th place) gives no verdict – like core', async () => {
    const AF = app('src/core/antifraud.ts');
    const w = build(spec('wonPending'));
    const raw13 = { ...w.raw, teamA: { ...w.raw.teamA, players: [...w.raw.teamA.players, { id: 'b0', name: 'B0' }] } };
    const m13 = { ...w.m, teamA: { ...w.m.teamA, players: [...w.m.teamA.players, { id: 'b0', name: 'B0' }] } };
    expect(AF.confirmProblem(m13, 'b0')).toBe('not_captain');
    expect(AF.verdictCaptains(m13)).toEqual([]);
    await seed('dup13', raw13);
    await assertFails(rawUpdateDoc(doc(asDb('b0'), 'matches/dup13'), DOCS.verifyDoc(raw13, 'b0', 'confirmed', undefined, fx, Date.now())));
  });
  test('V1413-4: a captain on BOTH rosters (older data) can\'t confirm or dispute – like core (DUPb0)', async () => {
    const AF = app('src/core/antifraud.ts');
    const w = build(spec('wonPending'));
    const dupRaw = { ...w.raw, teamA: { ...w.raw.teamA, players: w.raw.teamA.players.map((x, k) => (k === w.raw.teamA.players.length - 1 ? { id: 'b0', name: 'B0' } : x)) } }; // 12 a side: b0 replaces the last A player on A's roster only
    const dupM = { ...w.m, teamA: { ...w.m.teamA, players: w.m.teamA.players.map((x, k) => (k === w.m.teamA.players.length - 1 ? { id: 'b0', name: 'B0' } : x)) } };
    expect(w.raw.captains.B).toBe('b0');
    expect(AF.confirmProblem(w.m, 'b0')).toBeNull();
    expect(AF.confirmProblem(dupM, 'b0')).toBe('not_captain');
    expect(AF.verdictCaptains(dupM)).toEqual([]);
    await seed('dupb0', dupRaw);
    await assertFails(rawUpdateDoc(doc(asDb('b0'), 'matches/dupb0'), DOCS.verifyDoc(dupRaw, 'b0', 'confirmed', undefined, fx, Date.now())));
    await assertFails(rawUpdateDoc(doc(asDb('b0'), 'matches/dupb0'), DOCS.verifyDoc(dupRaw, 'b0', 'disputed', 'wrong score', fx, Date.now())));
    await seed('dupb0ok', w.raw); // control: the same captain on one roster confirms
    await assertSucceeds(rawUpdateDoc(doc(asDb('b0'), 'matches/dupb0ok'), DOCS.verifyDoc(w.raw, 'b0', 'confirmed', undefined, fx, Date.now())));
  });
  test('minor: a verdict from an earlier epoch does not block a reopen (as in core); one from this epoch does', async () => {
    const stale = build(spec('nowin3'), { reopenEpoch: 1, verification: { status: 'confirmed', by: 'b0', at: T0, captain: 'confirmed', epoch: 0 } });
    await seed('rm1', stale.raw);
    await assertSucceeds(rawUpdateDoc(doc(asDb('adm'), 'matches/rm1'), payload('reopen', stale.raw, stale.m, 'adm')));
    const cur = build(spec('nowin3'), { reopenEpoch: 1, verification: { status: 'confirmed', by: 'b0', at: T0, captain: 'confirmed', epoch: 1 } });
    expect(LC.lifecycleProblem('reopen', cur.m, 'adm', true)).not.toBeNull();
    const body = payload('reopen', stale.raw, stale.m, 'adm');
    await seed('rm2', cur.raw);
    await assertFails(rawUpdateDoc(doc(asDb('adm'), 'matches/rm2'), body));
  });
});

// 1.4.19: tournament admin permissions (src/core/tournamentAdmin.ts): the owner (organizerId) alone edits / deletes
// a tournament and links matches to it; everyone else – app admins too – reads it only.
describe('1.4.19 tournament admin permissions', () => {
  const tour = (over = {}) => ({ name: 'Cup', organizerId: 'cap', format: 'knockout', rules: RULES, startDate: Date.now() + DAY, endDate: Date.now() + 2 * DAY, location: PLACE,
    teams: ['t1', 't2'].map((id) => ({ id, name: id, color: '#123456' })), fixtures: [], status: 'registration', ...over });
  const adm = () => env.authenticatedContext('adm', { phone_number: '+919000000009', admin: true }).firestore();
  const seedT = (data = tour(), id = 'T') => env.withSecurityRulesDisabled((c) => setDoc(doc(c.firestore(), `tournaments/${id}`), data));
  beforeEach(() => env.withSecurityRulesDisabled((c) => setDoc(doc(c.firestore(), 'terms/adm'), { version: TERMS_VERSION, acceptedAt: new Date() })));
  const fx = [{ id: 'f1', round: 1, teamA: 't1', teamB: 't2', matchId: null }];
  const EDITS = [
    ['name', { name: 'Cup 2' }],
    ['rules', { rules: { ...RULES, bestOf: 3 } }],
    ['dates', { startDate: Date.now() + 2 * DAY, endDate: Date.now() + 3 * DAY }],
    ['venue', { location: { name: 'Talkatora', lat: 28.6, lng: 77.2 } }],
    ['teams (remove one / roster change)', { teams: [{ id: 't1', name: 't1', color: '#123456' }, { id: 't2', name: 'Team Two', color: '#654321' }] }],
    ['fixtures / bracket', { fixtures: fx }],
    ['status', { status: 'running' }],
    ['format (groups)', { format: 'league' }],
  ];
  test.each(EDITS)('edit %s: owner yes; player, stranger and app admin no', async (_n, patch) => {
    await seedT();
    for (const db of [ctx('eve').firestore(), ctx('bob').firestore(), adm()]) await assertFails(updateDoc(doc(db, 'tournaments/T'), patch));
    await assertSucceeds(updateDoc(doc(ctx('cap').firestore(), 'tournaments/T'), patch));
  });
  test('the owner cannot hand the tournament over (organizerId fixed)', async () => {
    await seedT();
    await assertFails(updateDoc(doc(ctx('cap').firestore(), 'tournaments/T'), { organizerId: 'eve' }));
    await assertFails(updateDoc(doc(ctx('eve').firestore(), 'tournaments/T'), { organizerId: 'eve' }));
  });
  test('delete: owner only (not a player, a stranger or an app admin)', async () => {
    await seedT();
    for (const db of [ctx('eve').firestore(), ctx('bob').firestore(), adm()]) await assertFails(deleteDoc(doc(db, 'tournaments/T')));
    await assertSucceeds(deleteDoc(doc(ctx('cap').firestore(), 'tournaments/T')));
  });
  test('everyone signed in still reads it', async () => {
    await seedT();
    for (const db of [ctx('eve').firestore(), ctx('bob').firestore(), adm()]) await assertSucceeds(getDoc(doc(db, 'tournaments/T')));
  });
  test('an older doc without an owner: nobody edits or deletes it', async () => {
    const { organizerId: _o, ...legacy } = tour();
    await seedT(legacy);
    for (const db of [ctx('cap').firestore(), ctx('eve').firestore(), adm()]) {
      await assertFails(updateDoc(doc(db, 'tournaments/T'), { name: 'Mine now' }));
      await assertFails(deleteDoc(doc(db, 'tournaments/T')));
    }
  });
  test('match link: fixed after create; only the owner claims a match in a fixture (create has no budget left)', async () => {
    await seedT();
    const m = (by, over) => matchDoc({ teamId: 't1', ids: T1 }, { teamId: 't2', ids: T2 }, { createdBy: by, scorerId: by, participantIds: ordered(T1, T2, [by]), ...over });
    // documented gap: the create rule can't afford the owner check; the app ignores an unclaimed match
    await assertSucceeds(setDoc(doc(ctx('eve').firestore(), 'matches/x1'), m('eve', { tournamentId: 'T', fixtureId: 'f1' })));
    // ...and only the owner can claim it in a fixture
    await assertFails(updateDoc(doc(ctx('eve').firestore(), 'tournaments/T'), { fixtures: [{ ...fx[0], matchId: 'x1' }] }));
    await assertSucceeds(setDoc(doc(ctx('cap').firestore(), 'matches/ok'), m('cap', { tournamentId: 'T', fixtureId: 'f1' })));
    await assertSucceeds(setDoc(doc(ctx('eve').firestore(), 'matches/free'), m('eve', {}))); // a plain match: unchanged
    await assertFails(updateDoc(doc(ctx('cap').firestore(), 'matches/ok'), { fixtureId: 'f2' }));
    await assertFails(updateDoc(doc(ctx('eve').firestore(), 'matches/free'), { tournamentId: 'T' }));
    // scoring inside the tournament is unchanged: the scorer still adds a rally
    await assertSucceeds(updateDoc(doc(ctx('cap').firestore(), 'matches/ok'), { status: 'live', startedAt: Date.now(), startedServerAt: serverTimestamp() }));
  });
});

// 1.4.19 Help Center > Contact us (src/core/support.ts): own tickets only; app admins read all + set status.
describe('1.4.19 support tickets', () => {
  const adm = () => env.authenticatedContext('adm', { phone_number: '+919000000009', admin: true });
  beforeEach(() => env.withSecurityRulesDisabled((c) => setDoc(doc(c.firestore(), 'terms/adm'), { version: TERMS_VERSION, acceptedAt: new Date() })));
  const tk = (over = {}) => ({ userId: 'cap', topic: 'scoring', message: 'The score did not update.', appVersion: '1.4.19 (35)', status: 'open', screenshotPath: null, createdAt: serverTimestamp(), updatedAt: serverTimestamp(), ...over });
  test('create: own, open, valid topic / message / screenshot path', async () => {
    const db = ctx('cap').firestore();
    await assertSucceeds(setDoc(doc(db, 'supportTickets/a'), tk()));
    await assertSucceeds(setDoc(doc(db, 'supportTickets/b'), tk({ screenshotPath: 'support/cap/b.png' })));
    for (const [id, over] of [
      ['c1', { userId: 'eve' }], ['c2', { status: 'closed' }], ['c3', { topic: 'nope' }], ['c4', { message: 'short' }],
      ['c5', { message: 'x'.repeat(2001) }], ['c6', { message: 'hidden \u200b characters here' }], ['c7', { screenshotPath: 'support/eve/c7.png' }],
      ['c8', { screenshotPath: 'support/cap/other.png' }], ['c9', { extra: 1 }], ['c10', { createdAt: 1 }],
    ]) await assertFails(setDoc(doc(db, `supportTickets/${id}`), tk(over)));
  });
  test('read: owner and admin only; list only your own', async () => {
    await env.withSecurityRulesDisabled((c) => setDoc(doc(c.firestore(), 'supportTickets/a'), { ...tk(), createdAt: new Date(), updatedAt: new Date() }));
    await assertSucceeds(getDoc(doc(ctx('cap').firestore(), 'supportTickets/a')));
    await assertSucceeds(getDoc(doc(adm().firestore(), 'supportTickets/a')));
    await assertFails(getDoc(doc(ctx('eve').firestore(), 'supportTickets/a')));
    const { query, where } = require('firebase/firestore');
    await assertSucceeds(getDocs(query(collection(ctx('cap').firestore(), 'supportTickets'), where('userId', '==', 'cap'))));
    await assertFails(getDocs(collection(ctx('cap').firestore(), 'supportTickets')));
    await assertSucceeds(getDocs(collection(adm().firestore(), 'supportTickets')));
  });
  test('status: admins only, only status, only the three values; nobody deletes', async () => {
    await env.withSecurityRulesDisabled((c) => setDoc(doc(c.firestore(), 'supportTickets/a'), { ...tk(), createdAt: new Date(), updatedAt: new Date() }));
    await assertFails(rawUpdateDoc(doc(ctx('cap').firestore(), 'supportTickets/a'), { status: 'closed', updatedAt: serverTimestamp() }));
    await assertFails(rawUpdateDoc(doc(ctx('eve').firestore(), 'supportTickets/a'), { status: 'closed', updatedAt: serverTimestamp() }));
    for (const st of ['replied', 'closed', 'open']) await assertSucceeds(rawUpdateDoc(doc(adm().firestore(), 'supportTickets/a'), { status: st, updatedAt: serverTimestamp() }));
    await assertFails(rawUpdateDoc(doc(adm().firestore(), 'supportTickets/a'), { status: 'deleted', updatedAt: serverTimestamp() }));
    await assertFails(rawUpdateDoc(doc(adm().firestore(), 'supportTickets/a'), { message: 'Edited by the admin', updatedAt: serverTimestamp() }));
    await assertFails(deleteDoc(doc(adm().firestore(), 'supportTickets/a')));
    await assertFails(deleteDoc(doc(ctx('cap').firestore(), 'supportTickets/a')));
  });
  test('screenshot storage: own folder, jpeg/png/webp < 5 MB; owner + admin read', async () => {
    const img = new Uint8Array(120);
    const p = `support/cap/t-${RUN}.png`;
    await assertSucceeds(uploadBytes(ref(ctx('cap').storage(), p), img, { contentType: 'image/png' }));
    await assertFails(uploadBytes(ref(ctx('eve').storage(), `support/cap/e-${RUN}.png`), img, { contentType: 'image/png' }));
    await assertFails(uploadBytes(ref(ctx('cap').storage(), `support/cap/g-${RUN}.gif`), img, { contentType: 'image/gif' }));
    await assertFails(uploadBytes(ref(ctx('cap').storage(), `support/cap/h-${RUN}.html`), img, { contentType: 'text/html' }));
    await assertFails(uploadBytes(ref(ctx('cap').storage(), `support/cap/b-${RUN}.jpg`), new Uint8Array(5 * 1024 * 1024), { contentType: 'image/jpeg' }));
    await assertFails(uploadBytes(ref(ctx('cap').storage(), p), img, { contentType: 'image/png' })); // never replaced
    await assertSucceeds(getMetadata(ref(ctx('cap').storage(), p)));
    await assertSucceeds(getMetadata(ref(adm().storage(), p)));
    await assertFails(getMetadata(ref(ctx('eve').storage(), p)));
  });
});

// 1.4.20 (QA Help Center Lows): the ticket minimum counts trimmed text; a screenshot's name must carry the extension of
// its declared type (no .html / .svg stored as image/png).
describe('1.4.20 support tickets: trim + screenshot name/type', () => {
  const tk = (over = {}) => ({ userId: 'cap', topic: 'scoring', message: 'The score did not update.', appVersion: '1.4.20 (36)', status: 'open', screenshotPath: null, createdAt: serverTimestamp(), updatedAt: serverTimestamp(), ...over });
  test('whitespace-padded short message refused; real one accepted', async () => {
    const db = ctx('cap').firestore();
    await assertFails(setDoc(doc(db, 'supportTickets/w1'), tk({ message: '      short      ' })));
    await assertFails(setDoc(doc(db, 'supportTickets/w2'), tk({ message: '\n\n\n\n\n\n\n\n\n\nab' })));
    await assertSucceeds(setDoc(doc(db, 'supportTickets/w3'), tk({ message: '  Ten chars!  ' })));
  });
  test('extension must match the content type; odd names refused', async () => {
    const img = new Uint8Array(120);
    const st = ctx('cap').storage();
    await assertFails(uploadBytes(ref(st, `support/cap/x-${RUN}.html`), img, { contentType: 'image/png' }));
    await assertFails(uploadBytes(ref(st, `support/cap/y-${RUN}.svg`), img, { contentType: 'image/png' }));
    await assertFails(uploadBytes(ref(st, `support/cap/z-${RUN}.jpg`), img, { contentType: 'image/png' }));
    await assertFails(uploadBytes(ref(st, `support/cap/a.b-${RUN}.png`), img, { contentType: 'image/png' }));
    await assertSucceeds(uploadBytes(ref(st, `support/cap/ok-${RUN}.webp`), img, { contentType: 'image/webp' }));
    await assertSucceeds(uploadBytes(ref(st, `support/cap/ok-${RUN}.jpg`), img, { contentType: 'image/jpeg' }));
  });
});
