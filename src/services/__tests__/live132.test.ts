/**
 * 1.3.2 "tap a player to score" (live match v2, design-spec §11.3): one atomic event, undo, rotation,
 * the per-player counts flowing into stats / Profile / rankings / POTM / wallet, team-only points,
 * and the scorer-only rule on the demo backend (the API server and firestore.rules have their own
 * suites: server/tests/live132.test.ts and the rules suite).
 */
import { DemoBackend } from '../backend/demoBackend';
import { TERMS_VERSION } from '../../core/terms';
import { INDOOR_RULES, type RuleSet } from '../../core/rules';
import { addPoint, computeState, playerPoint, summarize, undo, type MatchEvent, type Side } from '../../core/scoring';
import { rotationState } from '../../core/rotation';
import { careerStats, playerPointCounts, playerStats } from '../../core/stats';
import { pickPlayerOfMatch, potmNoPoints, potmProblem } from '../../core/potm';
import { MIN_MATCH_MS, countedTotals, playerWallet, walletHistory } from '../../core/antifraud';
import type { Match } from '../../core/types';

jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));

const A = ['a1', 'a2', 'a3', 'a4', 'a5', 'a6'];
const B = ['b1', 'b2', 'b3', 'b4', 'b5', 'b6'];
const R = { ...INDOOR_RULES, bestOf: 1, pointsPerSet: 3, winBy: 1, pointCap: null, sideSwitchEvery: null, decidingSideSwitchEvery: null, decidingSwitchAt: null } as RuleSet;
const rosters = { A, B };
const onCourt = (ev: MatchEvent[], side: Side) => rotationState(R, ev, 'A', rosters, null).positions[side];
const tap = (ev: MatchEvent[], side: Side, id: string) => playerPoint(R, ev, side, id, { roster: rosters[side], onCourt: onCourt(ev, side), firstServe: 'A', at: 1 });

describe('the atomic tap event', () => {
  it('one event gives the player AND the team the point; undo reverts both', () => {
    const ev = tap([], 'A', 'a3');
    expect(ev).toHaveLength(1);
    expect(ev[0]).toEqual({ type: 'point', side: 'A', at: 1, playerId: 'a3' });
    const st = computeState(R, ev, 'A');
    expect(st.current).toEqual({ a: 1, b: 0 });
    expect(playerPointCounts(R, ev, 'A')).toEqual({ a3: 1 });
    const back = undo(ev);
    expect(computeState(R, back, 'A').current).toEqual({ a: 0, b: 0 });
    expect(playerPointCounts(R, back, 'A')).toEqual({});
  });
  it('only players of that team who are on court; nothing after the match is over', () => {
    expect(tap([], 'A', 'b1')).toEqual([]); // other team
    expect(playerPoint(R, [], 'A', 'a3', { roster: A, onCourt: ['a1', 'a2', null, null, null, null] })).toEqual([]); // bench
    let ev: MatchEvent[] = [];
    for (let i = 0; i < 3; i++) ev = tap(ev, 'A', 'a1');
    expect(computeState(R, ev, 'A').finished).toBe(true);
    expect(tap(ev, 'A', 'a1')).toHaveLength(3);
  });
  it('a team-only point (opponent error) credits nobody and never helps the Player of the Match', () => {
    const ev = addPoint(R, [], 'B', { at: 1, firstServe: 'A' });
    expect(ev[0]).toEqual({ type: 'point', side: 'B', at: 1 });
    expect(playerPointCounts(R, ev, 'A')).toEqual({});
  });
});

describe('rotation after a tapped point', () => {
  it('side-out: the receiving team wins the serve and rotates, exactly as a team point', () => {
    const start = rotationState(R, [], 'A', rosters, null);
    expect(start.server).toBe(start.positions.A[0]);
    const tapped = tap([], 'B', start.positions.B[2]!);
    const plain = addPoint(R, [], 'B', { at: 1, firstServe: 'A' });
    const rt = rotationState(R, tapped, 'A', rosters, null);
    expect(rt).toEqual(rotationState(R, plain, 'A', rosters, null));
    expect(computeState(R, tapped, 'A').serving).toBe('B');
    // B rotated one place clockwise: the old position 2 player now serves from position 1
    expect(rt.positions.B[0]).toBe(start.positions.B[1]);
    expect(rt.server).toBe(start.positions.B[1]);
    // A point won while serving: no rotation
    const again = tap(tapped, 'B', rt.positions.B[0]!);
    expect(rotationState(R, again, 'A', rosters, null).positions.B).toEqual(rt.positions.B);
    // undo restores serve and rotation
    expect(rotationState(R, undo(tapped), 'A', rosters, null)).toEqual(start);
  });
});

describe('per-player counts flow into stats, Profile, rankings, POTM and the wallet', () => {
  const DAY = 86_400_000;
  const T0 = Date.UTC(2026, 8, 7, 6, 0);
  const finished = (i: number, ev: MatchEvent[], potm: string | null = null): Match => {
    const fin = T0 + i * DAY;
    return {
      id: `m${i}`,
      status: 'finished',
      teamA: { teamId: 'tA', name: 'Delhi', color: '#D93636', players: A.map((id) => ({ id, name: id })) },
      teamB: { teamId: `tB${i}`, name: `Opp ${i}`, color: '#001F4D', players: B.map((id) => ({ id, name: id })) },
      captains: { A: 'a1', B: 'b1' },
      rules: R,
      firstServe: 'A',
      events: ev,
      summary: summarize(computeState(R, ev, 'A')),
      createdBy: 'a1',
      scorerId: 'a1',
      playerOfMatchId: potm,
      verification: { status: 'confirmed', by: 'b1', at: fin },
      startedServerAt: fin - MIN_MATCH_MS - 60_000,
      finishedServerAt: fin,
      finishedAt: fin,
      startedAt: fin - MIN_MATCH_MS - 60_000,
      createdAt: 1,
      updatedAt: fin,
      participantIds: [...A, ...B],
    } as unknown as Match;
  };
  // a2 taps twice, b1 once (tapped), then an opponent error for A
  let ev: MatchEvent[] = [];
  ev = tap(ev, 'A', 'a2');
  ev = tap(ev, 'B', 'b1');
  ev = tap(ev, 'A', 'a2');
  ev = addPoint(R, ev, 'A', { at: 1, firstServe: 'A' });

  it('match stats and the live counts are the same numbers', () => {
    expect(computeState(R, ev, 'A').winner).toBe('A');
    expect(playerPointCounts(R, ev, 'A', finished(1, ev))).toEqual({ a2: 2, b1: 1 });
    expect(playerStats(R, ev, 'A', finished(1, ev)).a2.points).toBe(2);
  });
  it('POTM: the auto-pick is the top tapped scorer; a 0-point player is refused; opp. errors credit nobody', () => {
    const m = finished(1, ev);
    expect(pickPlayerOfMatch(m)).toBe('a2');
    expect(potmNoPoints(m, 'a5')).toBe(true);
    expect(potmProblem({ ...m, playerOfMatchId: null } as Match, 'a1', 'a5', m.finishedServerAt! + 1000)).toBe('potm_no_points');
    expect(potmNoPoints(m, 'a2')).toBe(false);
  });
  it('Profile career, rankings totals and the wallet use the tapped counts', () => {
    const ms = [finished(1, ev, 'a2'), finished(2, ev, 'a2')];
    expect(careerStats('a2', ms).points).toBe(4);
    expect(careerStats('b1', ms).points).toBe(2);
    const t = countedTotals(ms).find((x) => x.playerId === 'a2')!;
    expect(t).toMatchObject({ points: 4, wins: 2, potm: 2, matches: 2 });
    expect(playerWallet(ms, 'a2').points).toBe(4);
    const hist = walletHistory(ms.map((m) => ({ matchId: m.id, at: m.finishedServerAt!, opponent: m.teamB.name, won: true, potm: true, credited: playerStats(R, m.events, 'A', m).a2.points })));
    expect(hist.filter((h) => h.kind === 'match')).toHaveLength(2);
    expect(countedTotals(ms).find((x) => x.playerId === 'a5')?.points ?? 0).toBe(0);
  });
});

describe('scorer-only on the demo backend', () => {
  const phoneOf = (n: number) => `+9190000000${String(n + 9).padStart(2, '0')}`;
  async function signedIn(n: number) {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
    const b = new DemoBackend();
    const otp = b.sendOtp(phoneOf(n));
    await jest.advanceTimersByTimeAsync(500);
    const done = (await otp).confirm('123456');
    await jest.advanceTimersByTimeAsync(500);
    await done;
    jest.useRealTimers();
    await b.acceptTerms(`seed${n}`, TERMS_VERSION);
    return b;
  }
  const db = (b: DemoBackend) => (b as unknown as { db: { matches: Record<string, Match> } }).db;
  beforeEach(async () => {
    const AS = require('@react-native-async-storage/async-storage');
    await (AS.default ?? AS).clear();
  });
  it('only the assigned scorer can save a tapped point; the credit must be on the scoring team', async () => {
    const scorer = await signedIn(1);
    const m = db(scorer).matches.match_live;
    expect(m.scorerId).toBe('seed1');
    const ids = { A: m.teamA.players.map((p) => p.id), B: m.teamB.players.map((p) => p.id) };
    const pos = rotationState(m.rules, m.events, m.firstServe, ids, m.lineups);
    const next = playerPoint(m.rules, m.events, 'A', pos.positions.A[0]!, { roster: ids.A, onCourt: pos.positions.A, firstServe: m.firstServe });
    expect(next).toHaveLength(m.events.length + 1);
    const summary = summarize(computeState(m.rules, next, m.firstServe));

    const other = await signedIn(7);
    (other as unknown as { db: unknown }).db = db(scorer);
    await expect(other.saveMatchProgress('match_live', { events: next, summary, status: 'live' })).rejects.toThrow(/scorer/i);

    await scorer.saveMatchProgress('match_live', { events: next, summary, status: 'live' });
    expect(db(scorer).matches.match_live.events.at(-1)).toMatchObject({ type: 'point', side: 'A', playerId: pos.positions.A[0] });

    const wrong = [...next, { type: 'point', side: 'A', at: Date.now(), playerId: ids.B[0] } as MatchEvent];
    await expect(scorer.saveMatchProgress('match_live', { events: wrong, summary, status: 'live' })).rejects.toThrow();
  });
});
