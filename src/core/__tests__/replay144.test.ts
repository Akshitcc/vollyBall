/**
 * 1.4.4 (QA V143-1/2/3/4): on Firebase the stored summary is untrusted – the app replays the events (core/replay.ts)
 * and flags a disagreeing summary / a 'finished' without a winner for admin review; firebaseUpdateProblem mirrors the
 * rules' abandon limit and setup freeze. The rules side of the same probes is in rules-tests/rules.test.js ("1.4.4").
 */
import { replayStored, replayedSummary } from '../replay';
import { firebaseUpdateProblem, minWinEvents, ABANDON_NEEDS_ADMIN, MATCH_SETUP_LOCKED } from '../matchGuards';
import { makeRules, INDOOR_RULES } from '../rules';
import { isCompleted, isEligible, matchFlags, resultState, type CountableMatch } from '../antifraud';
import { replayMatchData } from '../../services/backend/firebaseMatchDoc';
import { MAX_EVENTS } from '../limits';
import type { MatchEvent, Side } from '../scoring';

jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));

const R3 = makeRules(INDOOR_RULES, { bestOf: 3, pointsPerSet: 25 });
const pts = (side: Side, n: number, t0 = 1): MatchEvent[] => Array.from({ length: n }, (_, i) => ({ type: 'point', side, at: t0 + i }));
const bWins = [...pts('B', 25), ...pts('B', 25, 100)];

describe('V143-1: the replay, not the stored summary', () => {
  it("Tester's 52:50 probe: events say B 25:0 25:0, the summary claims A – the app shows B and flags it", () => {
    const forged = { setsA: 2, setsB: 0, currentA: 0, currentB: 0, serving: 'A', winner: 'A', setScores: [{ a: 52, b: 50 }, { a: 25, b: 0 }] };
    const r = replayStored({ rules: R3, events: bWins, firstServe: 'A', status: 'finished', summary: forged });
    expect(r.summary.winner).toBe('B');
    expect(r.summary.setsB).toBe(2);
    expect(r.summary.setScores.map((s) => [s.a, s.b])).toEqual([[0, 25], [0, 25]]);
    expect(r.resultCheck).toBe('summary_mismatch');
  });
  it('a summary that matches the replay (serving ignored) is not flagged; a missing one (legacy) is not either', () => {
    const s = replayedSummary({ rules: R3, events: bWins, firstServe: 'A' });
    expect(replayStored({ rules: R3, events: bWins, firstServe: 'A', status: 'finished', summary: { ...s, serving: s.serving === 'A' ? 'B' : 'A' } }).resultCheck).toBeNull();
    expect(replayStored({ rules: R3, events: bWins, firstServe: 'A', status: 'finished', summary: null }).resultCheck).toBeNull();
  });
  it("'finished' with no winner in the events is flagged finished_without_winner", () => {
    expect(replayStored({ rules: R3, events: pts('A', 30), firstServe: 'A', status: 'finished', summary: null }).resultCheck).toBe('finished_without_winner');
  });
  it('a document whose events cannot be replayed is flagged, not crashed on (replayMatchData)', () => {
    expect(replayMatchData({ rules: null, events: 'x' })).toEqual({ resultCheck: 'summary_mismatch' });
  });
});

describe('V143-1: a flagged result never counts; a premature finish shows as flagged', () => {
  const base = {
    id: 'm', status: 'finished', rules: R3, events: bWins, firstServe: 'A', createdBy: 'c', scorerId: 'c',
    teamA: { name: 'A', players: [] }, teamB: { name: 'B', players: [] }, playerOfMatchId: 'p',
    startedServerAt: 0, finishedServerAt: 60 * 60 * 1000,
    verification: { status: 'confirmed' },
  } as unknown as CountableMatch;
  it('result_mismatch is an automatic flag (not eligible until an admin approves)', () => {
    const m = { ...base, resultCheck: 'summary_mismatch' } as CountableMatch;
    expect(matchFlags(m)).toContain('result_mismatch');
    expect(isEligible(m)).toBe(false);
    expect(resultState(m)).toBe('flagged');
    expect(matchFlags(base)).not.toContain('result_mismatch');
  });
  it("'finished' without a winner: never completed, badge 'flagged'", () => {
    const m = { ...base, events: pts('A', 30), resultCheck: 'finished_without_winner' } as CountableMatch;
    expect(isCompleted(m)).toBe(false);
    expect(resultState(m)).toBe('flagged');
  });
});

describe('V143-2/V143-3: firebaseUpdateProblem mirrors the rules', () => {
  const m = (n: number, extra: Record<string, unknown> = {}) =>
    ({ rules: R3, firstServe: 'A', events: pts('A', n), teamA: { name: 'A', players: [] }, teamB: { name: 'B', players: [] }, lineups: null, ...extra }) as never;
  it('minWinEvents = sets to win × points per set (same formula as firestore.rules)', () => {
    expect(minWinEvents(R3)).toBe(50);
    expect(minWinEvents({ bestOf: 5, pointsPerSet: 25 })).toBe(75);
    expect(minWinEvents({ bestOf: 1, pointsPerSet: 15 })).toBe(15);
  });
  it('the scorer may abandon only below the shortest win; above it only an admin', () => {
    expect(firebaseUpdateProblem(m(49), { status: 'abandoned' })).toBeNull();
    expect(firebaseUpdateProblem(m(50), { status: 'abandoned' })).toBe(ABANDON_NEEDS_ADMIN);
  });
  it('rules, first server, teams are frozen after the first rally; stored lineups are add-only', () => {
    expect(firebaseUpdateProblem(m(0), { rules: makeRules(R3, { pointsPerSet: 15 }) })).toBeNull();
    expect(firebaseUpdateProblem(m(1), { rules: makeRules(R3, { pointsPerSet: 15 }) })).toBe(MATCH_SETUP_LOCKED);
    expect(firebaseUpdateProblem(m(1), { firstServe: 'B' })).toBe(MATCH_SETUP_LOCKED);
    expect(firebaseUpdateProblem(m(1), { teamB: { name: 'X', players: [] } } as never)).toBe(MATCH_SETUP_LOCKED);
    expect(firebaseUpdateProblem(m(1), { firstServe: 'A' })).toBeNull();
    const l1 = { '1': { A: ['a'], B: ['b'] } };
    expect(firebaseUpdateProblem(m(1, { lineups: l1 }), { lineups: { ...l1, '2': { A: ['a'], B: ['b'] } } } as never)).toBeNull();
    expect(firebaseUpdateProblem(m(1, { lineups: l1 }), { lineups: { '1': { A: ['z'], B: ['b'] } } } as never)).toBe(MATCH_SETUP_LOCKED);
    expect(firebaseUpdateProblem(m(1, { lineups: l1 }), { lineups: null } as never)).toBe(MATCH_SETUP_LOCKED);
  });
});

describe('Info: the event cap', () => {
  it('MAX_EVENTS is 3000 (worst legal best-of-5 with long deuces fits; rules memory measured at 3000)', () => {
    expect(MAX_EVENTS).toBe(3000);
  });
});
