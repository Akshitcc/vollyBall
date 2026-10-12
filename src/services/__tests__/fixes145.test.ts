/**
 * 1.4.5 demo backend (API / Firebase parity): the abandon action (interim 'review' policy: recorded, waits for an
 * admin), the opposing captain's report, an admin's resolutions (reinstate / confirm / reopen / abandon / void),
 * V144-3 (no admin action on an admin's own match), V144-4 (setup lock), V144-8 (interim scorer handoff).
 */
import { DemoBackend } from '../backend/demoBackend';
import type { Match } from '../../core/types';
import { addPoint, computeState } from '../../core/scoring';

jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('../backend/firebaseBackend', () => ({ FirebaseBackend: class {} }));

const made: DemoBackend[] = [];
afterEach(() => {
  for (const b of made.splice(0)) clearInterval((b as unknown as { simTimer: ReturnType<typeof setInterval> }).simTimer);
});
async function signedIn(phone = '+919000000010') {
  jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
  const b = new DemoBackend();
  made.push(b);
  const otp = b.sendOtp(phone);
  await jest.advanceTimersByTimeAsync(500);
  const done = (await otp).confirm('123456');
  await jest.advanceTimersByTimeAsync(500);
  await done;
  jest.useRealTimers();
  await b.acceptTerms((b as unknown as { authUser: { uid: string } }).authUser.uid, require('../../core/terms').TERMS_VERSION);
  return b;
}
async function admin() {
  const b = await signedIn('+919000000001'); // the demo admin seed (in no match)
  await (b as unknown as { setDemoAdmin: (on: boolean) => Promise<void> }).setDemoAdmin(true);
  return b;
}
const dbOf = (b: DemoBackend) => (b as unknown as { db: { matches: Record<string, Match> } }).db;
const uidOf = (b: DemoBackend) => (b as unknown as { authUser: { uid: string } }).authUser.uid;
const codeOf = (p: Promise<unknown>) => p.then(() => null, (e: { code?: string }) => e.code ?? String(e));

/** A live match on `b` with `me` as A's first player, captain and scorer; `n` rallies for B (bo1 to 25). */
function seed(b: DemoBackend, me: string, n: number, over: Partial<Match> = {}): Match {
  const base = dbOf(b).matches.match_live;
  const rules = { ...base.rules, bestOf: 1 as const, decidingSetPoints: 25, pointsPerSet: 25 };
  const pa = [{ id: me, name: 'Me' }, ...base.teamA.players.filter((p) => p.id !== me).slice(0, 5)];
  const pb = base.teamB.players.filter((p) => p.id !== me).slice(0, 6);
  let ev: Match['events'] = [];
  for (let i = 0; i < n; i++) ev = addPoint(rules, ev, 'B', { at: 1_000 + i });
  const m: Match = {
    ...base, id: 'm145', rules, firstServe: 'A', events: ev, maxEvents: n, wasWon: false, status: 'live',
    teamA: { ...base.teamA, teamId: null, players: pa }, teamB: { ...base.teamB, teamId: null, players: pb },
    captains: { A: me, B: pb[0].id }, createdBy: me, scorerId: me, participantIds: [...pa, ...pb].map((p) => p.id),
    lineups: undefined, abandon: null, abandonRequest: null, finishedAt: null, finishedServerAt: null, playerOfMatchId: null, verification: undefined,
    ...over,
  } as Match;
  dbOf(b).matches.m145 = m;
  return m;
}

describe('V144-1: the abandon action (interim review policy)', () => {
  it("Tester's bo1 0:24: abandoned, recorded (who, score, side behind), waiting for an admin; listed for review", async () => {
    const b = await signedIn();
    const me = uidOf(b);
    seed(b, me, 24);
    expect(await b.abandonMatch('m145')).toBe('abandoned');
    const m = dbOf(b).matches.m145;
    expect(m.status).toBe('abandoned');
    expect(m.abandon).toMatchObject({ by: me, events: 24, mode: 'review', review: 'pending', behind: true, score: { currentA: 0, currentB: 24 } });
    const a = await admin();
    dbOf(a).matches.m145 = m;
    expect((await a.listFlagged()).map((x) => x.id)).toContain('m145');
  });
  it('updateMatch({status: abandoned}) is the same action; undo below the shortest win doesn\'t re-open it', async () => {
    const b = await signedIn();
    const me = uidOf(b);
    seed(b, me, 3);
    await b.updateMatch('m145', { status: 'abandoned' });
    expect(dbOf(b).matches.m145.abandon?.review).toBe('pending');
    seed(b, me, 10, { maxEvents: 25 });
    expect(await codeOf(b.abandonMatch('m145'))).toBe('abandon_needs_admin');
    seed(b, me, 3, { wasWon: true });
    expect(await codeOf(b.abandonMatch('m145'))).toBe('match_finished');
  });
  it('saveMatchProgress keeps maxEvents (undo never lowers it) and a finishing write latches wasWon', async () => {
    const b = await signedIn();
    const me = uidOf(b);
    const m = seed(b, me, 10);
    await b.saveMatchProgress('m145', { events: m.events.slice(0, 9), status: 'live', summary: null as never });
    expect(dbOf(b).matches.m145.maxEvents).toBe(10);
    let ev = m.events;
    let t = 5_000;
    while (!computeState(m.rules, ev, 'A').finished) ev = addPoint(m.rules, ev, 'B', { at: ++t });
    await b.saveMatchProgress('m145', { events: ev, status: 'finished', summary: null as never });
    expect(dbOf(b).matches.m145).toMatchObject({ status: 'finished', wasWon: true, maxEvents: ev.length });
  });
});

describe('report and admin resolutions (V144-1/2/3)', () => {
  it('the opposing captain reports; the abandoner\'s side can\'t', async () => {
    const b = await signedIn();
    const me = uidOf(b);
    const m = seed(b, me, 10);
    // me as B's captain this time: the abandon was A's scorer
    const other = m.teamA.players[1].id;
    dbOf(b).matches.m145 = { ...m, status: 'abandoned', scorerId: other, captains: { A: other, B: me }, teamB: { ...m.teamB, players: [{ id: me, name: 'Me' }, ...m.teamB.players.slice(1)] }, teamA: { ...m.teamA, players: m.teamA.players.slice(1).concat(m.teamB.players[0]) }, abandon: { by: other, at: 1, events: 10, mode: 'review', review: 'pending', behind: true } } as Match;
    dbOf(b).matches.m145.participantIds = [...dbOf(b).matches.m145.teamA.players, ...dbOf(b).matches.m145.teamB.players].map((p) => p.id);
    await b.reportAbandon('m145');
    expect(dbOf(b).matches.m145.abandon).toMatchObject({ reportedBy: me, review: 'pending' });
    expect(await codeOf(b.reportAbandon('m145'))).toBe('abandon_not_allowed');
  });
  it('an admin reinstates / confirms; a participant admin can\'t; non-admins never', async () => {
    const b = await signedIn();
    const me = uidOf(b);
    seed(b, me, 10);
    await b.abandonMatch('m145');
    expect(await codeOf(b.resolveMatch('m145', 'reinstate'))).toBe('admin_only');
    const a = await admin();
    dbOf(a).matches.m145 = dbOf(b).matches.m145;
    await a.resolveMatch('m145', 'reinstate');
    expect(dbOf(a).matches.m145).toMatchObject({ status: 'live', finishedAt: null, abandon: { review: 'reinstated' } });
    // an admin who plays in it
    const adm = uidOf(a);
    dbOf(a).matches.m145 = { ...dbOf(a).matches.m145, status: 'abandoned', abandon: { by: me, at: 1, events: 10, mode: 'review', review: 'pending' }, participantIds: [...dbOf(a).matches.m145.participantIds, adm] } as Match;
    expect(await codeOf(a.resolveMatch('m145', 'confirm_abandon'))).toBe('own_match');
  });
  it('V144-2: finished without a winner → listed; reopen / abandon / void', async () => {
    const a = await admin();
    const fin = (): Match => ({ ...seed(a, 'pX', 10), status: 'finished', wasWon: true, finishedAt: 5, finishedServerAt: 5, playerOfMatchId: null } as Match);
    dbOf(a).matches.m145 = fin();
    expect((await a.listFlagged()).map((x) => x.id)).toContain('m145');
    await a.resolveMatch('m145', 'reopen');
    expect(dbOf(a).matches.m145).toMatchObject({ status: 'live', wasWon: false, resolution: { action: 'reopened' } });
    dbOf(a).matches.m145 = fin();
    await a.resolveMatch('m145', 'abandon');
    expect(dbOf(a).matches.m145).toMatchObject({ status: 'abandoned', abandon: { mode: 'admin', review: 'confirmed' } });
    dbOf(a).matches.m145 = fin();
    await a.reviewMatch('m145', 'void');
    expect(dbOf(a).matches.m145.verification?.status).toBe('voided');
    expect((await a.listFlagged()).map((x) => x.id)).not.toContain('m145');
  });
});

describe('V144-4 / V144-8 on the demo backend', () => {
  it('rules and first serve are locked after the first rally (also after undo to 0)', async () => {
    const b = await signedIn();
    const me = uidOf(b);
    const m = seed(b, me, 2);
    expect(await codeOf(b.updateMatch('m145', { firstServe: 'B' }))).toBe('match_setup_locked');
    seed(b, me, 0, { maxEvents: 2 });
    expect(await codeOf(b.updateMatch('m145', { rules: { ...m.rules, bestOf: 5 } }))).toBe('match_setup_locked');
  });
  it('handoff after the first rally: own side only; an admin reassigns off the verdict team (recorded, verdict side kept)', async () => {
    const b = await signedIn();
    const me = uidOf(b);
    const m = seed(b, me, 2);
    const opp = m.teamB.players[1].id;
    const mate = m.teamA.players[1].id;
    expect(await codeOf(b.updateMatch('m145', { scorerId: opp }))).toBe('handover_side');
    await b.updateMatch('m145', { scorerId: mate });
    expect(dbOf(b).matches.m145.scorerId).toBe(mate);
    expect(await codeOf(b.reassignScorer('m145', opp))).toBe('admin_only');
    const a = await admin();
    dbOf(a).matches.m145 = { ...dbOf(b).matches.m145 };
    // 1.4.7 (QA V146-2): never to the verdict captain's team; another player of the scorer's side is fine
    expect(await codeOf(a.reassignScorer('m145', opp))).toBe('reassign_verdict_captain');
    const mate2 = m.teamA.players[2].id;
    await a.reassignScorer('m145', mate2);
    expect(dbOf(a).matches.m145).toMatchObject({ scorerId: mate2, scorerReassign: { from: mate, to: mate2, by: uidOf(a) } });
    expect(dbOf(a).matches.m145.maxEvents).toBe(2);
  });
});
