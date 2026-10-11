import { INDOOR_RULES, type RuleSet } from '../rules';
import { addPoint, type MatchEvent, type Side } from '../scoring';
import {
  ANTI_FRAUD,
  MIN_MATCH_MS,
  captainsProblem,
  confirmProblem,
  countMatches,
  countedTotals,
  expectedConfirmer,
  isEligible,
  isTerminal,
  istDayKey,
  istWeekKey,
  matchFlags,
  needsReview,
  pairKey,
  resultState,
  statusMoveOk,
  walletFromTotals,
  winBonus,
  winsToNextBonus,
  type CountableMatch,
} from '../antifraud';
import { TERMS_IS_DRAFT, TERMS_VERSION, termsAccepted } from '../terms';
import { rankingPoints } from '../ranking';

const QUICK: RuleSet = { ...INDOOR_RULES, bestOf: 1, pointsPerSet: 3, winBy: 1, pointCap: null, sideSwitchEvery: null, decidingSideSwitchEvery: null, decidingSwitchAt: null } as RuleSet;
const win = (side: Side, who?: string): MatchEvent[] => {
  let ev: MatchEvent[] = [];
  for (let i = 0; i < 3; i++) ev = addPoint(QUICK, ev, side, { at: 1, playerId: who });
  return ev;
};
const side = (prefix: string, teamId: string | null = null) => ({ teamId, name: prefix, color: '#000000', players: ['1', '2', '3'].map((n) => ({ id: `${prefix}${n}`, name: `${prefix}${n}` })) });
// 2026-10-12 is a Monday. 10:00 IST = 04:30 UTC.
const MON_10_IST = Date.UTC(2026, 9, 12, 4, 30);
const HOUR = 3_600_000;
let n = 0;
function mk(over: Partial<CountableMatch> = {}, at = MON_10_IST): CountableMatch {
  n++;
  return {
    id: `m${String(n).padStart(3, '0')}`,
    status: 'finished',
    rules: QUICK,
    events: win('A', 'a1'),
    firstServe: 'A',
    teamA: side('a'),
    teamB: side('b'),
    createdBy: 'a1',
    scorerId: 'a1',
    captains: { A: 'a1', B: 'b1' },
    verification: { status: 'confirmed', by: 'b1', at },
    playerOfMatchId: 'a1',
    startedServerAt: at - 20 * 60_000,
    finishedServerAt: at,
    ...over,
  } as CountableMatch;
}

describe('core config (Akshit defaults)', () => {
  it('has the agreed numbers in one place', () => {
    expect(ANTI_FRAUD).toMatchObject({ MIN_MATCH_MINUTES: 10, MAX_COUNTED_PER_PLAYER_PER_DAY: 3, MAX_COUNTED_PER_PAIR_PER_WEEK: 2, IST_OFFSET_MINUTES: 330, BONUS_EVERY_WINS: 5, BONUS_POINTS: 100, REJECT_REASON_MAX: 200 });
    expect(Object.isFrozen(ANTI_FRAUD)).toBe(true);
    expect(MIN_MATCH_MS).toBe(600_000);
  });
  it('T&C version is a draft and only the exact version is accepted', () => {
    expect(TERMS_IS_DRAFT).toBe(true);
    expect(TERMS_VERSION).toMatch(/draft/);
    expect(termsAccepted(TERMS_VERSION)).toBe(true);
    expect(termsAccepted(TERMS_VERSION + ' ')).toBe(false);
    expect(termsAccepted('2025-01')).toBe(false);
    expect(termsAccepted(null)).toBe(false);
  });
});

describe('IST day and week', () => {
  it('day boundaries are midnight IST, not UTC', () => {
    const lastMinuteSun = Date.UTC(2026, 9, 11, 18, 29); // 23:59 IST Sunday
    const firstMinuteMon = Date.UTC(2026, 9, 11, 18, 30); // 00:00 IST Monday
    expect(istDayKey(lastMinuteSun)).toBe('2026-10-11');
    expect(istDayKey(firstMinuteMon)).toBe('2026-10-12');
    expect(istWeekKey(lastMinuteSun)).toBe('2026-10-05');
    expect(istWeekKey(firstMinuteMon)).toBe('2026-10-12');
    expect(istWeekKey(Date.UTC(2026, 9, 18, 18, 29))).toBe('2026-10-12'); // Sunday 23:59 IST
  });
  it('does not depend on the device time zone', () => {
    expect(istDayKey(0)).toBe('1970-01-01');
    expect(istWeekKey(Date.UTC(2026, 0, 1, 12))).toBe('2025-12-29');
  });
});

describe('win bonus (derived only)', () => {
  it('+100 per 5 counted wins', () => {
    expect([0, 4, 5, 9, 10, 14, 15].map(winBonus)).toEqual([0, 0, 100, 100, 200, 200, 300]);
    expect(winBonus(-3)).toBe(0);
    expect(winsToNextBonus(0)).toBe(5);
    expect(winsToNextBonus(4)).toBe(1);
    expect(winsToNextBonus(5)).toBe(5);
  });
  it('wallet = ranking points + bonus, balance only', () => {
    const w = walletFromTotals({ points: 7, wins: 5, potm: 1, matches: 6 });
    expect(w.matchPoints).toBe(rankingPoints({ points: 7, wins: 5, potm: 1 }));
    expect(w.bonus).toBe(100);
    expect(w.balance).toBe(w.matchPoints + 100);
    expect(Object.keys(w).join(',')).not.toMatch(/redeem|cash|rupee|inr|upi|withdraw/i);
    expect(walletFromTotals(null).balance).toBe(0);
  });
});

describe('what counts', () => {
  it('a confirmed, completed, long-enough match counts', () => {
    const m = mk();
    expect(isEligible(m)).toBe(true);
    expect(resultState(m)).toBe('confirmed');
    expect(countMatches([m]).counted.get(m.id)?.size).toBe(6);
  });
  it('POTM is required (finished without POTM = awaiting POTM, never counted)', () => {
    const m = mk({ playerOfMatchId: null });
    expect(resultState(m)).toBe('awaiting_potm');
    expect(countMatches([m]).excluded.get(m.id)).toBe('not_completed');
  });
  it('finished without a winner never counts', () => {
    const m = mk({ events: [] });
    expect(countMatches([m]).excluded.get(m.id)).toBe('not_completed');
  });
  it('pending (not yet confirmed) does not count', () => {
    const m = mk({ verification: null });
    expect(resultState(m)).toBe('awaiting_confirmation');
    expect(countMatches([m]).excluded.get(m.id)).toBe('unverified');
  });
  it('under MIN_MATCH_MINUTES is flagged and excluded until an admin approves it', () => {
    const short = mk({ startedServerAt: MON_10_IST - 9 * 60_000 });
    expect(matchFlags(short)).toEqual(['too_short']);
    expect(needsReview(short)).toBe(true);
    expect(resultState(short)).toBe('flagged');
    expect(countMatches([short]).excluded.get(short.id)).toBe('flagged');
    const approved = { ...short, verification: { status: 'approved' as const, reviewedBy: 'admin1', reviewedAt: MON_10_IST } };
    expect(needsReview(approved)).toBe(false);
    // 1.3.7 (F135-1): approval clears the flag; the opposing captain's confirmation still decides
    expect(countMatches([approved]).counted.has(approved.id)).toBe(false);
    const approvedConfirmed = { ...short, verification: { ...approved.verification, captain: 'confirmed' as const, by: 'capB', at: MON_10_IST } };
    expect(countMatches([approvedConfirmed]).counted.has(approved.id)).toBe(true);
    const voided = { ...short, verification: { status: 'voided' as const } };
    expect(countMatches([voided]).excluded.get(voided.id)).toBe('voided');
  });
  it('exactly MIN_MATCH_MINUTES is long enough', () => {
    expect(matchFlags(mk({ startedServerAt: MON_10_IST - MIN_MATCH_MS }))).toEqual([]);
  });
  it('missing server times are flagged (client times are never used)', () => {
    const m = mk({ startedServerAt: null, startedAt: MON_10_IST - 2 * HOUR } as Partial<CountableMatch>);
    expect(matchFlags(m)).toEqual(['no_server_times']);
    expect(isEligible(m)).toBe(false);
  });
  it('a disputed (rejected) result is flagged', () => {
    const m = mk({ verification: { status: 'disputed', by: 'b1', reason: 'wrong score' } });
    expect(matchFlags(m)).toContain('disputed');
    expect(resultState(m)).toBe('flagged');
    expect(isEligible(m)).toBe(false);
  });
});

describe('caps', () => {
  it('same team pair: at most 2 counted per IST week, in finish order', () => {
    const ms = [0, 1, 2].map((i) => mk({}, MON_10_IST + i * HOUR));
    const r = countMatches(ms.reverse());
    expect([...r.counted.keys()].sort()).toEqual([ms[2].id, ms[1].id].sort());
    expect(r.excluded.get(ms[0].id)).toBe('pair_weekly_cap');
  });
  it('the pair key is order-independent and the cap resets on Monday 00:00 IST', () => {
    const sun = Date.UTC(2026, 9, 18, 18, 0); // Sun 23:30 IST
    const mon = Date.UTC(2026, 9, 18, 18, 30); // Mon 00:00 IST
    const a = mk({}, sun - HOUR);
    const b = mk({ teamA: side('b'), teamB: side('a'), captains: { A: 'b1', B: 'a1' } }, sun - 2 * HOUR);
    expect(pairKey(a)).toBe(pairKey(b));
    const c = mk({}, sun);
    const d = mk({}, mon);
    const r = countMatches([a, b, c, d]);
    expect(r.excluded.get(c.id)).toBe('pair_weekly_cap');
    expect(r.counted.has(d.id)).toBe(true);
  });
  it('registered teams pair by team id; built sides by captain', () => {
    expect(pairKey(mk({ teamA: side('a', 'T1'), teamB: side('b', 'T2') }))).toBe('team:T1 v team:T2');
    expect(pairKey(mk())).toBe('captain:a1 v captain:b1');
  });
  it('a player counts at most 3 matches per IST day; other players are unaffected', () => {
    // a-side plays 4 different opponents the same day.
    const opp = ['c', 'd', 'e', 'f'];
    const ms = opp.map((o, i) => mk({ teamB: side(o), captains: { A: 'a1', B: `${o}1` } }, MON_10_IST + i * HOUR));
    const r = countMatches(ms);
    expect(r.counted.get(ms[3].id)?.has('a1')).toBe(false);
    expect(r.counted.get(ms[3].id)?.has('f1')).toBe(true);
    expect(r.playerExcluded.has(`${ms[3].id}|a1`)).toBe(true);
    // next IST day counts again
    const next = mk({ teamB: side('g'), captains: { A: 'a1', B: 'g1' } }, MON_10_IST + 24 * HOUR);
    expect(countMatches([...ms, next]).counted.get(next.id)?.has('a1')).toBe(true);
  });
  it('countedTotals sums only counted players and matches', () => {
    const opp = ['c', 'd', 'e', 'f'];
    const ms = opp.map((o, i) => mk({ teamB: side(o), captains: { A: 'a1', B: `${o}1` } }, MON_10_IST + i * HOUR));
    const t = countedTotals([...ms, mk({ verification: null })]);
    expect(t.find((x) => x.playerId === 'a1')).toMatchObject({ matches: 3, wins: 3, points: 9, potm: 3 });
    expect(t.find((x) => x.playerId === 'f1')).toMatchObject({ matches: 1, wins: 0 });
  });
});

describe('captains and confirmation', () => {
  const base = mk();
  it('both captains required, different, on their side (built) or the team captain (registered)', () => {
    expect(captainsProblem({ ...base, captains: null })).toBe('captains_required');
    expect(captainsProblem({ ...base, captains: { A: 'a1', B: 'a1' } })).toBe('captains_same');
    expect(captainsProblem({ ...base, captains: { A: 'a1', B: 'a2' } })).toBe('captain_not_on_side');
    expect(captainsProblem(base)).toBeNull();
    const reg = { ...base, teamA: side('a', 'T1') };
    expect(captainsProblem(reg, { A: 'zz' })).toBe('captain_not_team_captain');
    expect(captainsProblem({ ...reg, captains: { A: 'zz', B: 'b1' } }, { A: 'zz' })).toBeNull();
  });
  it('only the opposing captain confirms; never the scorer, the creator or their side', () => {
    const m = mk({ verification: null });
    expect(confirmProblem(m, 'b1')).toBeNull();
    expect(confirmProblem(m, 'a1')).toBe('scoring_side');
    expect(confirmProblem(m, 'b2')).toBe('not_captain');
    expect(confirmProblem(m, 'zz')).toBe('not_captain');
    expect(expectedConfirmer(m)).toBe('b1');
    // scorer handed to a B player: B is now a scoring side too, nobody can confirm
    const both = mk({ verification: null, scorerId: 'b2' });
    expect(confirmProblem(both, 'b1')).toBe('scoring_side');
    expect(expectedConfirmer(both)).toBeNull();
    // the B captain scoring can't confirm
    expect(confirmProblem(mk({ verification: null, scorerId: 'b1' }), 'b1')).toBe('scoring_side');
  });
  it('only once, only on a completed match', () => {
    expect(confirmProblem(mk(), 'b1')).toBe('already_reviewed');
    expect(confirmProblem(mk({ verification: null, playerOfMatchId: null }), 'b1')).toBe('not_completed');
    expect(confirmProblem(mk({ verification: null, status: 'live' }), 'b1')).toBe('not_completed');
  });
});

describe('terminal statuses only move one way', () => {
  it('abandoned and completed are terminal', () => {
    expect(isTerminal({ status: 'abandoned' })).toBe(true);
    expect(isTerminal({ status: 'finished', playerOfMatchId: 'a1' })).toBe(true);
    expect(isTerminal({ status: 'finished', playerOfMatchId: null })).toBe(false);
  });
  it('allowed moves', () => {
    const ok = (from: string, potm: string | null, to: string) => statusMoveOk({ status: from as never, playerOfMatchId: potm }, to as never);
    expect(ok('scheduled', null, 'live')).toBe(true);
    expect(ok('scheduled', null, 'finished')).toBe(false);
    expect(ok('live', null, 'finished')).toBe(true);
    expect(statusMoveOk({ status: 'live', events: [] }, 'scheduled')).toBe(true); // before the first rally
    expect(statusMoveOk({ status: 'live', events: [{}] }, 'scheduled')).toBe(false);
    expect(ok('finished', null, 'live')).toBe(true); // undo while awaiting POTM
    expect(ok('finished', null, 'abandoned')).toBe(false);
    expect(ok('finished', 'a1', 'live')).toBe(false);
    expect(ok('abandoned', null, 'finished')).toBe(false);
    expect(ok('abandoned', null, 'live')).toBe(false);
  });
});
