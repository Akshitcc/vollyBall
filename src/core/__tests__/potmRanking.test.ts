import { INDOOR_RULES, type RuleSet } from '../rules';
import { addPoint, computeState, type MatchEvent, type Side } from '../scoring';
import { POTM_WINDOW_MS, decidingSetPoints, pickPlayerOfMatch, potmLines, potmProblem } from '../potm';
import {
  MIN_RANKED_MATCHES,
  RANKING_POINTS_PER_POTM,
  RANKING_POINTS_PER_WIN,
  rankMatches,
  rankPlayers,
  rankingPoints,
  rowFor,
  totalsFromMatches,
  winPct,
  type PlayerTotals,
} from '../ranking';
import { canAddMatchPhoto } from '../photos';

// Short sets so whole matches fit in a test: best of 3, sets to 3, deciding set to 2, win by 1.
const QUICK: RuleSet = { ...INDOOR_RULES, bestOf: 3, pointsPerSet: 3, decidingSetPoints: 2, winBy: 1, pointCap: null, sideSwitchEvery: null, decidingSideSwitchEvery: null, decidingSwitchAt: null } as RuleSet;

const play = (seq: [Side, string?][], rules = QUICK): MatchEvent[] => {
  let ev: MatchEvent[] = [];
  for (const [side, who] of seq) ev = addPoint(rules, ev, side, { at: 1, playerId: who });
  return ev;
};
const team = (...ids: string[]) => ({ players: ids.map((id) => ({ id, name: id.toUpperCase() })) });
const A = team('a1', 'a2');
const B = team('b1', 'b2');
const match = (events: MatchEvent[], extra: Record<string, unknown> = {}) => ({ rules: QUICK, events, firstServe: 'A' as Side, teamA: A, teamB: B, status: 'finished', ...extra });


describe('Player of the Match – auto pick and tie-breaks', () => {
  it('picks the player with the most credited points', () => {
    const ev = play([['A', 'a1'], ['A', 'a2'], ['A', 'a1'], ['A', 'a1'], ['A', 'a2'], ['A', 'a1']]); // 2-0 in sets
    expect(computeState(QUICK, ev).finished).toBe(true);
    expect(pickPlayerOfMatch(match(ev))).toBe('a1');
    expect(potmLines(match(ev))[0]).toEqual({ playerId: 'a1', points: 4, decidingPoints: 0, errors: 0 });
  });

  it('a losing-team player can be POTM', () => {
    const ev = play([
      ['A'], ['B', 'b1'], ['A'], ['B', 'b1'], ['A'], // 3-2 A
      ['A'], ['A'], ['B', 'b1'], ['A'], // 3-1 A
    ]);
    expect(computeState(QUICK, ev).winner).toBe('A');
    expect(pickPlayerOfMatch(match(ev))).toBe('b1');
  });

  it('tie on points → more points in the deciding set wins', () => {
    // Sets 3-0 A, 0-3 B, 2-0 A. a1 and b1 both have 3 points; a1 scored 1 of them in the decider.
    const ev2 = play([['A', 'a1'], ['A', 'a1'], ['A'], ['B', 'b1'], ['B', 'b1'], ['B', 'b1'], ['A', 'a1'], ['A']]);
    expect(computeState(QUICK, ev2).sets.length).toBe(3);
    const lines = potmLines(match(ev2));
    expect(lines.find((l) => l.playerId === 'a1')).toMatchObject({ points: 3, decidingPoints: 1 });
    expect(lines.find((l) => l.playerId === 'b1')).toMatchObject({ points: 3, decidingPoints: 0 });
    expect(pickPlayerOfMatch(match(ev2))).toBe('a1');
  });

  it('deciding-set points are 0 for everyone when the match ends without a decider', () => {
    const ev = play([['A', 'a1'], ['A'], ['A'], ['A'], ['A'], ['A', 'a1']]);
    expect(decidingSetPoints(QUICK, ev)).toEqual({});
  });

  it('then fewer errors (when tracked), then player id', () => {
    // a2 and a1: 2 points each, no decider.
    const ev = play([['A', 'a2'], ['A', 'a1'], ['A'], ['A', 'a2'], ['A', 'a1'], ['A']]);
    expect(pickPlayerOfMatch(match(ev))).toBe('a1'); // id order: 'a1' < 'a2'
    expect(pickPlayerOfMatch(match(ev), { errors: { a1: 3, a2: 1 } })).toBe('a2'); // fewer errors
    expect(pickPlayerOfMatch(match(ev), { errors: { a1: 1, a2: 1 } })).toBe('a1');
  });

  it('no pick when nobody was credited; credits to non-players are ignored', () => {
    const ev = play([['A'], ['A'], ['A'], ['A'], ['A'], ['A', 'ghost']]);
    expect(pickPlayerOfMatch(match(ev))).toBeNull();
    expect(potmLines(match(ev)).map((l) => l.playerId)).toEqual(['a1', 'a2', 'b1', 'b2']);
  });

  it('potmProblem: only the scorer, only finished, within the window, once, a player of the match', () => {
    const now = 10_000_000_000;
    const ev = play([['A', 'a1'], ['A'], ['A'], ['A'], ['A'], ['A']]);
    const m = { ...match(ev), scorerId: 'sc', finishedAt: now - 1000, playerOfMatchId: null };
    expect(potmProblem(m, 'sc', 'a1', now)).toBeNull();
    // INFO (retest 1.1.0): a player with 0 credited points can't be chosen while others scored
    expect(potmProblem(m, 'sc', 'b2', now)).toBe('potm_no_points');
    // with no credits at all, any player of the match may be chosen
    const none = { ...match(play([['A'], ['A'], ['A'], ['A'], ['A'], ['A']])), scorerId: 'sc', finishedAt: now - 1000, playerOfMatchId: null };
    expect(potmProblem(none, 'sc', 'b2', now)).toBeNull();
    expect(potmProblem(m, 'a1', 'a1', now)).toBe('potm_not_scorer');
    expect(potmProblem(m, null, 'a1', now)).toBe('potm_not_scorer');
    expect(potmProblem({ ...m, status: 'live' }, 'sc', 'a1', now)).toBe('potm_not_finished');
    expect(potmProblem({ ...m, finishedAt: now - POTM_WINDOW_MS }, 'sc', 'a1', now)).toBe('potm_window');
    expect(potmProblem({ ...m, playerOfMatchId: 'a2' }, 'sc', 'a1', now)).toBe('potm_already_set');
    expect(potmProblem(m, 'sc', 'sc', now)).toBe('potm_not_player');
    expect(potmProblem(m, 'sc', 'ghost', now)).toBe('potm_not_player');
  });
});

describe('Rankings – maths, minimum matches and tie order', () => {
  const t = (playerId: string, matches: number, wins: number, points: number, potm: number): PlayerTotals => ({ playerId, matches, wins, points, potm });

  it('weights and minimum are the documented constants', () => {
    expect(RANKING_POINTS_PER_WIN).toBe(10);
    expect(RANKING_POINTS_PER_POTM).toBe(25);
    expect(MIN_RANKED_MATCHES).toBe(3);
    expect(rankingPoints({ points: 7, wins: 2, potm: 1 })).toBe(7 + 20 + 25);
    expect(winPct({ wins: 2, matches: 3 })).toBe(67);
    expect(winPct({ wins: 0, matches: 0 })).toBe(0);
  });

  it('players under the minimum are not ranked; rowFor still returns their own numbers', () => {
    const r = rankPlayers([t('x', 2, 2, 100, 2), t('y', 3, 0, 1, 0), t('z', 5, 1, 0, 0)]);
    expect(r.ranked.map((x) => x.playerId)).toEqual(['z', 'y']);
    expect(r.total).toBe(2);
    expect(rowFor(r, 'x', t('x', 2, 2, 100, 2))).toMatchObject({ rank: null, rankingPoints: 100 + 20 + 50, winPct: 100 });
    expect(rowFor(r, 'y')).toMatchObject({ rank: 2, rankingPoints: 1 });
    expect(rowFor(r, 'nobody')).toBeNull();
  });

  it('tie order: points, then wins, then POTM, then credited points, then fewer matches, then id', () => {
    // all 50 ranking points
    const rows = rankPlayers([
      t('e', 4, 2, 30, 0), // 30+20
      t('d', 3, 0, 25, 1), // 25+25 (0 wins)
      t('c', 3, 2, 30, 0), // 30+20, fewer matches than e
      t('b', 3, 5, 0, 0), // 0+50, most wins
      t('a', 3, 0, 25, 1), // same as d → id
      t('f', 3, 2, 5, 1), // 5+20+25: 2 wins, 1 POTM
    ]).ranked.map((r) => [r.playerId, r.rank]);
    expect(rows).toEqual([['b', 1], ['f', 2], ['c', 3], ['e', 4], ['a', 5], ['d', 6]]);
  });

  it('totals come from finished matches only (live/abandoned/unfinished ignored), with wins and POTM', () => {
    const win = play([['A', 'a1'], ['A'], ['A'], ['A'], ['A', 'a2'], ['A']]); // A 2-0
    const loss = play([['B', 'b1'], ['B'], ['B'], ['B'], ['B'], ['B', 'b1']]); // B 2-0
    const ms = [
      match(win, { playerOfMatchId: 'a1' }),
      match(loss, { playerOfMatchId: 'b1' }),
      match(win, { playerOfMatchId: 'a2' }),
      match(win, { status: 'live' }),
      match(win, { status: 'abandoned' }),
      match(play([['A', 'a1']]), { status: 'finished' }), // not actually over
    ];
    const totals = Object.fromEntries(totalsFromMatches(ms).map((x) => [x.playerId, x]));
    expect(totals.a1).toMatchObject({ matches: 3, wins: 2, points: 2, potm: 1, name: 'A1' });
    expect(totals.a2).toMatchObject({ matches: 3, wins: 2, points: 2, potm: 1 });
    expect(totals.b1).toMatchObject({ matches: 3, wins: 1, points: 2, potm: 1 });
    const r = rankMatches(ms);
    expect(r.total).toBe(4);
    // a1 and a2: 2 + 20 + 25 = 47, tie → id; b1: 2 + 10 + 25 = 37; b2: 10
    expect(r.ranked.map((x) => [x.playerId, x.rankingPoints])).toEqual([['a1', 47], ['a2', 47], ['b1', 37], ['b2', 10]]);
    // only 2 finished → nobody ranked
    expect(rankMatches(ms.slice(0, 2)).total).toBe(0);
  });
});

describe('Match photos – who can add them', () => {
  const m = { teamA: A, teamB: B, scorerId: 'sc', createdBy: 'boss' };
  it('players of either team and the scorer; not the creator or anyone else', () => {
    expect(canAddMatchPhoto(m, 'a1')).toBe(true);
    expect(canAddMatchPhoto(m, 'b2')).toBe(true);
    expect(canAddMatchPhoto(m, 'sc')).toBe(true);
    expect(canAddMatchPhoto(m, 'boss')).toBe(false);
    expect(canAddMatchPhoto(m, 'x')).toBe(false);
    expect(canAddMatchPhoto(m, null)).toBe(false);
  });
});

describe('formatPhone (1.2.0 visual pass)', () => {
  const { formatPhone } = require('../phone');
  it('shows +91 XXXXX XXXXX; other values unchanged', () => {
    expect(formatPhone('+919000000010')).toBe('+91 90000 00010');
    expect(formatPhone('+15551234567')).toBe('+15551234567');
    expect(formatPhone(null)).toBe('');
  });
});
