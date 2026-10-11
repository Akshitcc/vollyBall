/** 1.3.8 core fixes: V137-1 (legacy captain confirmation), V137-13 (badge state), V137-4 (review trigger), V137-3 (daily merge / IST midnight), V137-7 (licences). */
import { INDOOR_RULES, type RuleSet } from '../rules';
import { addPoint, type MatchEvent, type Side } from '../scoring';
import { captainVerdict, confirmProblem, countMatches, LEGACY_VERDICT_BEFORE, resultState, type CountableMatch } from '../antifraud';
import { REVIEW_RULES, reviewTriggered } from '../reviewPrompt';
import { BUNDLED_DAILY_ITEMS, mergeDailyItems, msUntilNextIstDay, pickDaily, type DailyItem } from '../dailyItems';
import { filterLicenses, licenseText, type LicenseData } from '../licenses';

const QUICK: RuleSet = { ...INDOOR_RULES, bestOf: 1, pointsPerSet: 3, winBy: 1, pointCap: null, sideSwitchEvery: null, decidingSideSwitchEvery: null, decidingSwitchAt: null } as RuleSet;
const win = (side: Side, who?: string): MatchEvent[] => {
  let ev: MatchEvent[] = [];
  for (let i = 0; i < 3; i++) ev = addPoint(QUICK, ev, side, { at: 1, playerId: who });
  return ev;
};
const side = (prefix: string) => ({ teamId: null, name: prefix, color: '#000000', players: ['1', '2', '3'].map((n) => ({ id: `${prefix}${n}`, name: `${prefix}${n}` })) });
const AT = Date.UTC(2026, 9, 12, 4, 30);
let n = 0;
function mk(over: Partial<CountableMatch> = {}): CountableMatch {
  n++;
  return {
    id: `x${n}`,
    status: 'finished',
    rules: QUICK,
    events: win('A', 'a1'),
    firstServe: 'A',
    teamA: side('a'),
    teamB: side('b'),
    createdBy: 'a1',
    scorerId: 'a1',
    captains: { A: 'a1', B: 'b1' },
    verification: { status: 'confirmed', by: 'b1', at: AT },
    playerOfMatchId: 'a1',
    startedServerAt: AT - 2 * 60_000, // short match → flagged, so it needs an admin
    finishedServerAt: AT,
    ...over,
  } as CountableMatch;
}

describe('V137-1: a 1.3.6 captain confirmation (no `captain` field) survives admin approval', () => {
  // 1.3.6: captain confirmed (by/at set), then the admin approved: status 'approved', no `captain`.
  // 1.3.9 (V138-3): legacy = the captain answered before 1.3.7 (LEGACY_VERDICT_BEFORE)
  const OLD = LEGACY_VERDICT_BEFORE - 86_400_000;
  const legacy = () => mk({ verification: { status: 'approved', by: 'b1', at: OLD, reviewedBy: 'adm', reviewedAt: AT + 1000 } as CountableMatch['verification'] });
  it('captainVerdict reads the older fields', () => {
    expect(captainVerdict(legacy())).toBe('confirmed');
    expect(captainVerdict(mk({ verification: { status: 'approved', by: 'b1', at: OLD, reason: 'wrong score', reviewedBy: 'adm' } as CountableMatch['verification'] }))).toBe('rejected');
    expect(captainVerdict(mk({ verification: { status: 'approved', reviewedBy: 'adm' } as CountableMatch['verification'] }))).toBeNull();
    expect(captainVerdict(mk({ verification: { status: 'approved', by: 'b1', captain: 'rejected' } as CountableMatch['verification'] }))).toBe('rejected');
    expect(captainVerdict(mk({ verification: { status: 'confirmed', by: 'b1' } }))).toBe('confirmed');
    expect(captainVerdict(mk({ verification: { status: 'disputed', by: 'b1', reason: 'x' } }))).toBe('rejected');
    expect(captainVerdict(mk({ verification: null }))).toBeNull();
  });
  it('the match counts and shows as confirmed; the captain is not asked again', () => {
    const m = legacy();
    expect(resultState(m)).toBe('confirmed');
    expect(confirmProblem(m, 'b1')).toBe('already_reviewed');
    expect(countMatches([m]).counted.has(m.id)).toBe(true);
  });
  it('approved without any captain verdict still waits for the opposing captain (who may confirm)', () => {
    const m = mk({ verification: { status: 'approved', reviewedBy: 'adm', reviewedAt: AT } as CountableMatch['verification'] });
    expect(resultState(m)).toBe('approved_awaiting_confirmation');
    expect(confirmProblem(m, 'b1')).toBeNull();
    expect(countMatches([m]).counted.has(m.id)).toBe(false);
  });
});

describe('V137-13: the badge shows the latest state', () => {
  it('approved + captain confirmed → confirmed (not "Approved by an admin")', () => {
    expect(resultState(mk({ verification: { status: 'approved', captain: 'confirmed', by: 'b1', reviewedBy: 'adm' } as CountableMatch['verification'] }))).toBe('confirmed');
    expect(resultState(mk({ verification: { status: 'approved', captain: 'rejected', by: 'b1', reviewedBy: 'adm' } as CountableMatch['verification'] }))).toBe('approved_rejected');
  });
});

describe('V137-4: the rating prompt fires only right after finishing or confirming', () => {
  const now = AT + 60 * 60_000;
  const base = { openedFinished: true, openedWithPotm: true, finished: true, hasPotm: true, now };
  it('opening an old finished match never asks', () => {
    expect(reviewTriggered({ ...base, finishedAt: AT })).toBe(false);
    expect(reviewTriggered({ ...base, finishedAt: null })).toBe(false);
  });
  it('asks when the match finished on this screen, POTM was just set, it finished minutes ago, or the user confirmed', () => {
    expect(reviewTriggered({ ...base, openedFinished: false, finishedAt: AT })).toBe(true);
    expect(reviewTriggered({ ...base, openedWithPotm: false, finishedAt: AT })).toBe(true);
    expect(reviewTriggered({ ...base, finishedAt: now - (REVIEW_RULES.RECENT_MINUTES - 1) * 60_000 })).toBe(true);
    expect(reviewTriggered({ ...base, finishedAt: now - (REVIEW_RULES.RECENT_MINUTES + 1) * 60_000 })).toBe(false);
    expect(reviewTriggered({ ...base, finishedAt: AT, confirmedNow: true })).toBe(true);
    expect(reviewTriggered({ ...base, finished: false, openedFinished: false, finishedAt: null })).toBe(false);
  });
});

describe('V137-3: admin items are added to the 60 bundled facts; the card rolls over at IST midnight', () => {
  const extra: DailyItem = { id: 'srv1', type: 'fact', textEn: 'Admin fact', textHi: 'एडमिन तथ्य', attribution: 'FIVB', sourceUrl: null, active: true };
  it('merges by id (a server copy of a bundled id replaces that one item only)', () => {
    const edited = { ...BUNDLED_DAILY_ITEMS[0], textEn: 'Edited' };
    const merged = mergeDailyItems([extra, edited]);
    expect(merged).toHaveLength(61);
    expect(merged.find((i) => i.id === BUNDLED_DAILY_ITEMS[0].id)?.textEn).toBe('Edited');
    expect(merged.find((i) => i.id === 'srv1')).toBeTruthy();
    expect(mergeDailyItems([])).toHaveLength(60);
    // one admin item no longer shows every day
    const days = new Set(Array.from({ length: 10 }, (_, d) => pickDaily(merged, AT + d * 86_400_000, 0)?.id));
    expect(days.size).toBe(10);
  });
  it('msUntilNextIstDay', () => {
    const istMidnight = Date.UTC(2026, 9, 12, 18, 30); // 13 Oct 00:00 IST
    expect(msUntilNextIstDay(istMidnight - 1000)).toBe(1000);
    expect(msUntilNextIstDay(istMidnight)).toBe(86_400_000);
    expect(msUntilNextIstDay(istMidnight + 3_600_000)).toBe(23 * 3_600_000);
  });
});

describe('V137-7: licence data helpers', () => {
  const data: LicenseData = { packages: [{ name: 'react', version: '19', license: 'MIT', repository: null, text: 0 }, { name: 'semver', version: '7', license: 'ISC', repository: null, text: null }], texts: ['MIT License\nCopyright Meta'] };
  it('filters by name or licence and resolves shared texts', () => {
    expect(filterLicenses(data.packages, 'ISC').map((p) => p.name)).toEqual(['semver']);
    expect(filterLicenses(data.packages, ' REA ').map((p) => p.name)).toEqual(['react']);
    expect(filterLicenses(data.packages, '')).toHaveLength(2);
    expect(licenseText(data, data.packages[0])).toMatch(/Copyright Meta/);
    expect(licenseText(data, data.packages[1])).toBeNull();
  });
});
