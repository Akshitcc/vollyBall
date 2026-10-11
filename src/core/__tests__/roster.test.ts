import { assertRoster, canStartScoring, missingPlayers, orderedParticipants, rosterErrors } from '../roster';

const team = (prefix: string, n: number) => ({ players: Array.from({ length: n }, (_, i) => ({ id: `${prefix}${i + 1}`, name: `${prefix} ${i + 1}` })) });

describe('match roster rules', () => {
  it('6 registered players per team can start scoring', () => {
    expect(canStartScoring({ teamA: team('a', 6), teamB: team('b', 6) })).toBe(true);
    expect(canStartScoring({ teamA: team('a', 12), teamB: team('b', 7) })).toBe(true);
  });
  it('fewer than 6 blocks scoring (but is a valid draft)', () => {
    expect(rosterErrors(team('a', 5), team('b', 6))).toEqual([]);
    expect(missingPlayers(team('a', 5), team('b', 0))).toEqual([
      { code: 'needPlayers', side: 'A', count: 5 },
      { code: 'needPlayers', side: 'B', count: 0 },
    ]);
    expect(() => assertRoster({ teamA: team('a', 5), teamB: team('b', 6) }, true)).toThrow('at least 6 players');
    expect(() => assertRoster({ teamA: team('a', 5), teamB: team('b', 6) }, false)).not.toThrow();
  });
  it('more than 12 is rejected', () => {
    expect(rosterErrors(team('a', 13), team('b', 6))).toContainEqual({ code: 'tooMany', side: 'A' });
  });
  it('typed names and old guest ids are not players', () => {
    const a = { players: [...team('a', 5).players, { id: 'Rahul Kumar', name: 'Rahul Kumar' }] };
    const b = { players: [...team('b', 5).players, { id: 'guest:b0', name: 'Guest' }] };
    expect(rosterErrors(a, b).map((p) => p.code)).toEqual(['notUser', 'notUser']);
  });
  it('no duplicates and nobody on both teams', () => {
    const a = { players: [...team('a', 6).players, { id: 'a1', name: 'again' }] };
    const b = { players: [...team('b', 5).players, { id: 'a2', name: 'switched' }] };
    expect(rosterErrors(a, b)).toEqual([
      { code: 'duplicate', side: 'A', playerId: 'a1' },
      { code: 'bothTeams', playerId: 'a2' },
    ]);
  });
  it('orders participants as team A, team B, then extras without repeats', () => {
    expect(orderedParticipants(team('a', 2), team('b', 1), ['me', 'a1'])).toEqual(['a1', 'a2', 'b1', 'me']);
  });
});
