/** Follow-ups from Tester's build-217 retest (fixes-retest.md "Build 217"), app/shared side. */
import { isSingleStep, planEventSteps, MAX_APPEND_PER_WRITE } from '../eventSteps';
import { computeState, summarize, type MatchEvent } from '../scoring';
import { HEX_COLOR_RE, MAX_TOURNAMENT_TEAMS } from '../limits';
import { cleanText, textLength, textProblem, VISIBLE_RE } from '../text';
import { LIMITS } from '../limits';
import { checkColor, checkMatchFields, checkTeamFields, checkTournamentFields } from '../validate';
import { imageTruncated, MIN_IMAGE_BYTES_BY_TYPE } from '../photos';
import { INDOOR_RULES } from '../rules';

const pt = (side: 'A' | 'B', at: number, extra: Partial<MatchEvent> = {}): MatchEvent => ({ type: 'point', side, at, ...extra } as MatchEvent);
const log = (n: number) => Array.from({ length: n }, (_, i) => pt(i % 3 ? 'A' : 'B', 1000 + i));
const codeOf = (f: () => unknown) => {
  try {
    f();
    return null;
  } catch (e) {
    return (e as { code?: string }).code ?? String(e);
  }
};

describe('#1 G1: one scorer step per Firestore write (src/core/eventSteps.ts = firestore.rules eventsStepOk)', () => {
  test('single steps: append 1, undo 1, re-credit one of the last 3', () => {
    const o = log(10);
    expect(MAX_APPEND_PER_WRITE).toBe(1);
    expect(isSingleStep(o, [...o, pt('A', 2000)])).toBe(true);
    expect(isSingleStep(o, [...o, ...log(2)])).toBe(false);
    expect(isSingleStep(o, o.slice(0, 9))).toBe(true);
    expect(isSingleStep(o, o.slice(0, 8))).toBe(false);
    const credited = o.map((e, i) => (i === 8 ? { ...e, playerId: 'p1', kind: 'ace' as const } : e));
    expect(isSingleStep(o, credited)).toBe(true);
    const old = o.map((e, i) => (i === 2 ? { ...e, playerId: 'p1' } : e));
    expect(isSingleStep(o, old)).toBe(false); // too far back
    const flipped = o.map((e, i) => (i === 9 ? { ...e, side: e.side === 'A' ? 'B' : 'A' } : e)) as MatchEvent[];
    expect(isSingleStep(o, flipped)).toBe(false); // a credit edit may not change the rally
    const rewritten = [pt('B', 1), ...o.slice(1), pt('A', 3000)];
    expect(isSingleStep(o, rewritten)).toBe(false); // history must stay the same
  });
  test('a big change becomes a sequence of single steps ending in the target', () => {
    const o = log(12);
    const n = [...o.slice(0, 7), ...log(11).map((e) => ({ ...e, at: e.at + 5000 }))]; // undo 5, add 11
    const steps = planEventSteps(o, n);
    expect(steps[steps.length - 1]).toEqual(n);
    let prev = o;
    for (const s of steps) {
      expect(isSingleStep(prev, s)).toBe(true);
      prev = s;
    }
    expect(steps.length).toBe(5 + 11);
    expect(planEventSteps(o, o)).toEqual([]);
    expect(planEventSteps([], log(3)).map((s) => s.length)).toEqual([1, 2, 3]);
  });
  test('each step moves the summary by at most one rally per appended event', () => {
    const quick = { ...INDOOR_RULES, bestOf: 3 as const, pointsPerSet: 3, decidingSetPoints: 2, winBy: 1 };
    const target = log(9);
    let prev: MatchEvent[] = [];
    const rallies = (ev: MatchEvent[]) => {
      const m = summarize(computeState(quick, ev, 'A'));
      return m.setScores.reduce((s, x) => s + x.a + x.b, 0) + (m.winner ? 0 : m.currentA + m.currentB);
    };
    for (const s of planEventSteps([], target)) {
      const d = rallies(s) - rallies(prev);
      expect(d).toBeGreaterThanOrEqual(0);
      expect(d).toBeLessThanOrEqual(s.length - prev.length);
      prev = s;
    }
  });
});

describe('#2 G8: tournament team cap = what the rules can check', () => {
  test('10 teams everywhere, duplicates refused', () => {
    expect(MAX_TOURNAMENT_TEAMS).toBe(10);
    const teams = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `t${i}`, name: `T${i}` }));
    const base = { name: 'Monsoon Cup', startDate: 2e12, endDate: 2e12 + 1 };
    expect(codeOf(() => checkTournamentFields({ ...base, teams: teams(10) }))).toBeNull();
    expect(codeOf(() => checkTournamentFields({ ...base, teams: teams(11) }))).toBe('too_many_teams');
    expect(codeOf(() => checkTournamentFields({ ...base, teams: [...teams(9), { id: 't0', name: 'again' }] }))).toBe('duplicate_teams');
  });
});

describe('#4/#7: invisible fillers and Unicode whitespace at the edges', () => {
  const fillers = ['\u3164', '\uFFA0', '\u115F', '\u1160', '\u2800', '\u180E'];
  test.each(fillers.map((f) => [f.codePointAt(0)!.toString(16).toUpperCase()]))('a name made only of U+%s is empty', (hex) => {
    const f = String.fromCodePoint(parseInt(hex, 16));
    expect(textProblem(f.repeat(3), LIMITS.profileName)).toBe('empty');
    expect(textProblem(`${f} ${f}`, LIMITS.teamName)).toBe('empty');
    expect(VISIBLE_RE.test(f)).toBe(false);
  });
  test('fillers and Unicode spaces are trimmed; inside a name they stay', () => {
    expect(cleanText('\u3164Arun\u3164')).toBe('Arun');
    expect(cleanText('\u00A0Arun\u2028')).toBe('Arun');
    expect(cleanText('\u2800\u3000Arun Kumar\u205F')).toBe('Arun Kumar');
    expect(cleanText('Ar\u180Eun')).toBe('Arun'); // removed like zero-width characters
    expect(textProblem('\u00A0\u2028', LIMITS.profileName)).toBe('empty');
    expect(textProblem('आरव शर्मा', LIMITS.profileName)).toBeNull();
    expect(textProblem('한국 팀', LIMITS.teamName)).toBeNull(); // real Hangul is fine
  });
});

describe('#5 team colours #RRGGBB only (app = API = rules)', () => {
  test('pattern and checks', () => {
    for (const ok of ['#FF6B00', '#2b2b2b']) expect(HEX_COLOR_RE.test(ok)).toBe(true);
    for (const bad of ['#FFF', '#FF6B0', '#FF6B00AA', 'red', 'FF6B00', '#GG0000', '#FF6B00\n']) expect(HEX_COLOR_RE.test(bad)).toBe(false);
    expect(codeOf(() => checkColor('color', '#abc'))).toBe('color_invalid');
    expect(codeOf(() => checkTeamFields({ name: 'Smashers', color: 'javascript:1' }))).toBe('color_invalid');
    expect(codeOf(() => checkMatchFields({ teamA: { name: 'A', color: '#12345' } }))).toBe('color_invalid');
    expect(codeOf(() => checkTournamentFields({ name: 'Cup x', startDate: 1, endDate: 2, teams: [{ id: 'a', name: 'A', color: '#000000' }, { id: 'b', name: 'B', color: '#000' }] }))).toBe('color_invalid');
  });
});

describe('#6 lengths: UTF-16 units like the rules size()', () => {
  test('an emoji counts 2, so the app never accepts a name the rules refuse', () => {
    expect(textLength('😀')).toBe(2);
    expect(textProblem('😀a'.repeat(13) + 'b', LIMITS.teamName)).toBeNull(); // 40 units
    expect(textProblem('😀a'.repeat(14), LIMITS.teamName)).toBe('tooLong'); // 42 units, rules deny > 40
    expect(textProblem('अ'.repeat(40), LIMITS.teamName)).toBeNull(); // Devanagari is 1 unit per letter
  });
});

describe('#9 images that are only a header', () => {
  const gifHeader = Uint8Array.from(Buffer.from('GIF89a'));
  const gifScreen = Uint8Array.from(Buffer.from('474946383961010001008000', 'hex'));
  const gif1x1 = Uint8Array.from(Buffer.from('47494638396101000100800000ffffff00000021f90401000000002c00000000010001000002024401003b', 'hex'));
  test('too small or no GIF trailer = truncated; a real 1x1 GIF passes', () => {
    expect(imageTruncated('image/gif', gifHeader)).toBe(true);
    expect(imageTruncated('image/gif', gifScreen)).toBe(true);
    expect(imageTruncated('image/gif', gif1x1)).toBe(false);
    expect(imageTruncated('image/gif', gif1x1.slice(0, gif1x1.length - 1))).toBe(true);
    expect(imageTruncated('image/png', new Uint8Array(20))).toBe(true);
    expect(MIN_IMAGE_BYTES_BY_TYPE['image/gif']).toBe(26);
  });
});

describe('browser pass #1: tournament status from the dates (fake clock)', () => {
  const { tournamentDisplayStatus } = require('../tournament') as typeof import('../tournament');
  const start = Date.parse('2026-10-18T03:30:00Z');
  afterEach(() => jest.useRealTimers());
  test('Upcoming before the start even when stored as running; Running once started; Finished', () => {
    jest.useFakeTimers({ now: start - 60_000 });
    expect(tournamentDisplayStatus({ status: 'running', startDate: start })).toBe('upcoming');
    expect(tournamentDisplayStatus({ status: 'registration', startDate: start })).toBe('upcoming');
    jest.setSystemTime(start);
    expect(tournamentDisplayStatus({ status: 'running', startDate: start })).toBe('running');
    jest.setSystemTime(start + 3 * 86_400_000);
    expect(tournamentDisplayStatus({ status: 'running', startDate: start })).toBe('running');
    expect(tournamentDisplayStatus({ status: 'finished', startDate: start })).toBe('finished');
    jest.setSystemTime(start - 86_400_000);
    expect(tournamentDisplayStatus({ status: 'finished', startDate: start })).toBe('finished');
  });
});

describe('browser pass #2: Hindi challenge / invite wording', () => {
  const hi = require('../../i18n/locales/hi').default ?? require('../../i18n/locales/hi').hi;
  test('"{{team}} के आपकी …" is gone; no "{{x}} के/की आप…" in home, challenge or team strings', () => {
    const strings = JSON.stringify([hi.home, hi.challenge, hi.team, hi.notifications]);
    expect(strings).not.toMatch(/\}\} (के|की) आप/);
    expect(hi.home.waiting).toBe('{{team}} द्वारा आपकी चुनौती स्वीकार किए जाने का इंतज़ार है ({{when}})।');
    expect(hi.tournamentStatus.upcoming).toBe('आगामी');
  });
});
