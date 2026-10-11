/** Registered-players re-test: participants, legacy abandon, tournament/challenge checks, optional shot type. */
import { attributePoint, type MatchEvent } from '../scoring';
import {
  CHALLENGE_CAPTAIN_MESSAGE,
  CHALLENGE_SAME_TEAM_MESSAGE,
  challengeProblem,
  isAbandonOnly,
  participantsMatchRoster,
  TEAM_TOO_SMALL_MESSAGE,
  TOURNAMENT_TEAMS_MESSAGE,
  tournamentTeamsProblem,
} from '../roster';

const side = (ids: string[]) => ({ players: ids.map((id) => ({ id, name: id })) });
const A = ['a1', 'a2', 'a3', 'a4', 'a5', 'a6'];
const B = ['b1', 'b2', 'b3', 'b4', 'b5', 'b6'];
const six = (cap: string) => ({ captainId: cap, memberIds: [cap, 'x2', 'x3', 'x4', 'x5', 'x6'] });

describe('participantsMatchRoster (QA retest #1)', () => {
  const m = (participantIds: string[], createdBy = 'a1', scorerId = 'a1') => ({ teamA: side(A), teamB: side(B), participantIds, createdBy, scorerId });
  test('both rosters, optionally plus creator/scorer', () => {
    expect(participantsMatchRoster(m([...A, ...B]))).toBe(true);
    expect(participantsMatchRoster(m([...A, ...B, 'ref'], 'ref', 'ref'))).toBe(true);
    expect(participantsMatchRoster(m([...B, ...A]))).toBe(true); // order is the Firestore rules' concern
  });
  test('missing players, outsiders and duplicates are rejected', () => {
    expect(participantsMatchRoster(m(['a1']))).toBe(false);
    expect(participantsMatchRoster(m([...A, ...B, 'seed20']))).toBe(false);
    expect(participantsMatchRoster(m([...A, ...B, 'a1']))).toBe(false);
  });
});

test('isAbandonOnly (QA retest #2)', () => {
  expect(isAbandonOnly(['status'], 'abandoned')).toBe(true);
  expect(isAbandonOnly(['status', 'finishedAt', 'updatedAt'], 'abandoned')).toBe(true);
  expect(isAbandonOnly(['status', 'events'], 'abandoned')).toBe(false);
  expect(isAbandonOnly(['status'], 'finished')).toBe(false);
  expect(isAbandonOnly(['status', 'teamA'], 'abandoned')).toBe(false);
});

test('tournamentTeamsProblem (QA retest #4)', () => {
  const teams: Record<string, { memberIds: string[] }> = { t1: six('c1'), t2: six('c2'), small: { memberIds: ['c3'] } };
  const look = (id: string) => teams[id];
  expect(tournamentTeamsProblem([{ id: 't1' }, { id: 't2' }], look)).toBeNull();
  expect(tournamentTeamsProblem([{ id: 't1' }], look)).toBe('Need at least 2 teams');
  expect(tournamentTeamsProblem([{ id: 't1' }, { id: 't1' }], look)).toBe('Duplicate team ids');
  expect(tournamentTeamsProblem([{ id: 't1' }, { id: 'ext_1' }], look)).toBe(TOURNAMENT_TEAMS_MESSAGE);
  expect(tournamentTeamsProblem([{ id: 't1' }, { id: 'small' }], look)).toBe(TEAM_TOO_SMALL_MESSAGE);
});

test('challengeProblem (QA retest #4)', () => {
  const c = { fromTeamId: 't1', toTeamId: 't2', fromCaptainId: 'c1', toCaptainId: 'c2' };
  expect(challengeProblem(c, six('c1'), six('c2'), 'c1')).toBeNull();
  expect(challengeProblem(c, null, six('c2'), 'c1')).toBe('Team not found');
  expect(challengeProblem({ ...c, toTeamId: 't1' }, six('c1'), six('c1'), 'c1')).toBe(CHALLENGE_SAME_TEAM_MESSAGE);
  expect(challengeProblem(c, six('c1'), six('c2'), 'someone')).toBe(CHALLENGE_CAPTAIN_MESSAGE);
  expect(challengeProblem({ ...c, toCaptainId: 'wrong' }, six('c1'), six('c2'), 'c1')).toBe(CHALLENGE_CAPTAIN_MESSAGE);
  expect(challengeProblem(c, six('c1'), { captainId: 'c2', memberIds: ['c2'] }, 'c1')).toBe(TEAM_TOO_SMALL_MESSAGE);
});

test('attributePoint: shot type is optional and can be added or cleared later', () => {
  const ev: MatchEvent[] = [{ type: 'point', side: 'A', at: 1 }];
  const credited = attributePoint(ev, 0, 'a1', undefined, A);
  expect(credited[0]).toEqual({ type: 'point', side: 'A', at: 1, playerId: 'a1' });
  const withKind = attributePoint(credited, 0, 'a1', 'ace', A);
  expect(withKind[0]).toMatchObject({ playerId: 'a1', kind: 'ace' });
  expect(attributePoint(withKind, 0, 'a2', undefined, A)[0]).toEqual({ type: 'point', side: 'A', at: 1, playerId: 'a2' });
});
