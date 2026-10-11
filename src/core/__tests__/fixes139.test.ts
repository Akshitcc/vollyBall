/**
 * 1.3.9 core fixes: V138-3 (legacy verdict only before 1.3.7), V138-4 (one hidden-character set),
 * V138-5 (licences incl. native peers), V138-6 (complete-profile gate), V138-7 (stable daily pick),
 * V138-8 (fullwidth digits), V138-11 (confirmedAt / match date), V138-14 (Hindi sources).
 */
import { byMatchDateDesc, captainVerdict, confirmedAtOf, isLegacyAnswer, LEGACY_VERDICT_BEFORE, matchDate } from '../antifraud';
import { HIDDEN_CHARS, HIDDEN_RE, cleanText, removeInvisible, stripHidden, textProblem } from '../text';
import { checkFeedback } from '../reviewPrompt';
import { hasStoredRegistration, profileComplete } from '../registration';
import { ATTRIBUTION_HI, BUNDLED_DAILY_ITEMS, dailyAttribution, istDayStart, mergeDailyItems, pickDaily, type DailyItem } from '../dailyItems';
import { devanagariToAscii, filterPhoneTyping, fullwidthToAscii } from '../phone';

const BEFORE = LEGACY_VERDICT_BEFORE - 86_400_000;
const AFTER = LEGACY_VERDICT_BEFORE + 86_400_000;

describe('V138-3: "approved + by, no captain" is a confirmation only for pre-1.3.7 answers', () => {
  it('legacy (answered before 1.3.7): no reason = confirmed, a reason = rejected', () => {
    expect(captainVerdict({ verification: { status: 'approved', by: 'b1', at: BEFORE } })).toBe('confirmed');
    expect(captainVerdict({ verification: { status: 'approved', by: 'b1', at: BEFORE, reason: 'wrong score' } })).toBe('rejected');
    expect(captainVerdict({ verification: { status: 'voided', by: 'b1', at: BEFORE } })).toBe('confirmed');
  });
  it('1.3.7+ shape without `captain` (an outdated admin client) is NOT a confirmation', () => {
    expect(captainVerdict({ verification: { status: 'approved', by: 'b1', at: AFTER } })).toBeNull();
    expect(captainVerdict({ verification: { status: 'approved', by: 'b1', at: AFTER, reason: 'x' } })).toBeNull();
    expect(captainVerdict({ verification: { status: 'approved', by: 'b1' } })).toBeNull(); // no time = no marker
    expect(captainVerdict({ verification: { status: 'approved', by: 'b1', at: LEGACY_VERDICT_BEFORE } })).toBeNull(); // boundary
  });
  it('an explicit verdict always wins', () => {
    expect(captainVerdict({ verification: { status: 'approved', by: 'b1', at: AFTER, captain: 'confirmed' } })).toBe('confirmed');
    expect(captainVerdict({ verification: { status: 'approved', by: 'b1', at: BEFORE, captain: 'rejected' } })).toBe('rejected');
    expect(isLegacyAnswer({ at: BEFORE })).toBe(true);
    expect(isLegacyAnswer({ at: null })).toBe(false);
  });
});

describe('V138-4: one hidden-character set everywhere', () => {
  const listed = [
    ...Array.from({ length: 0x20 }, (_, i) => i), 0x7f, ...Array.from({ length: 0x20 }, (_, i) => 0x80 + i),
    0xad, 0x61c, 0x180e, 0x200b, 0x200c, 0x200d, 0x200e, 0x200f, 0x2028, 0x2029,
    0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x2060, 0x2061, 0x2062, 0x2063, 0x2064,
    0x2066, 0x2067, 0x2068, 0x2069, 0xfeff,
  ];
  it('HIDDEN_RE matches exactly the agreed set (and nothing next to it)', () => {
    for (const cp of listed) expect([cp.toString(16), HIDDEN_RE.test(String.fromCodePoint(cp))]).toEqual([cp.toString(16), true]);
    for (const cp of [0x20, 0x7e, 0xa0, 0xae, 0x61b, 0x180d, 0x200a, 0x2010, 0x2027, 0x202f, 0x205f, 0x2065, 0x206a, 0xfefe, 0x0915])
      expect([cp.toString(16), HIDDEN_RE.test(String.fromCodePoint(cp))]).toEqual([cp.toString(16), false]);
    const inSet = new Set(listed);
    for (let cp = 0; cp < 0x10000; cp++) if (HIDDEN_RE.test(String.fromCharCode(cp)) !== inSet.has(cp)) throw new Error(cp.toString(16));
    expect(HIDDEN_CHARS).toContain('\\u2060-\\u2064');
  });
  it('feedback: every hidden char goes (newline/tab stay); only-ZWSP feedback is empty', () => {
    const r = checkFeedback({ stars: 4, text: 'Gr\u2060e\u00ADa\u0085t\u2028!\u061C\u180E\u009B\u200B\nok\tyes', appVersion: '1.3.9\u202E (15)\u0000' });
    expect(r.text).toBe('Great!\nok\tyes');
    expect(r.appVersion).toBe('1.3.9 (15)');
    expect(checkFeedback({ stars: 5, text: '\u200B\u200B' }).text).toBe('');
    expect(stripHidden('a\u2029b')).toBe('ab');
  });
  it('names: ZWJ/ZWNJ kept only between Devanagari characters', () => {
    expect(removeInvisible('क्\u200Dष', { name: true })).toBe('क्\u200Dष');
    expect(removeInvisible('क\u200Cष', { name: true })).toBe('क\u200Cष');
    expect(removeInvisible('A\u200DB', { name: true })).toBe('AB');
    expect(removeInvisible('क\u200D', { name: true })).toBe('क');
    expect(removeInvisible('\u200Dक', { name: true })).toBe('क');
    expect(removeInvisible('क\u200Dz', { name: true })).toBe('कz');
    expect(removeInvisible('क\u200Dष')).toBe('कष'); // not a name: removed
    expect(cleanText('Ra\u2060vi\u00AD', { name: true })).toBe('Ravi');
  });
  it('text checks refuse what is left of the set (C1, separators, bidi)', () => {
    const lim = { min: 1, max: 40 };
    expect(textProblem('Ra\u0085vi', lim)).toBe('control');
    expect(textProblem('Ra\u2028vi', lim)).toBe('control');
    expect(textProblem('\u00A0Ravi\u2028', lim)).toBeNull(); // at the edge: trimmed (cleanText), as before
    expect(cleanText('\u00A0Ravi\u2028')).toBe('Ravi');
    expect(textProblem('Ravi\u0001', lim)).toBe('control'); // a C0 control at the edge is still refused
    expect(textProblem('Ra\u061Cvi', lim)).toBe('bidi');
    expect(textProblem('Ra\u2066vi', lim)).toBe('bidi');
    expect(textProblem('Ra\u2063vi', lim)).toBeNull(); // removed by cleanText, not an error
  });
});

describe('V138-5: the licence list includes autolinked native packages', () => {
  it('react-native-gesture-handler is listed with its MIT licence', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const data = require('../../generated/licenses.json') as { packages: { name: string; license: string }[] };
    const gh = data.packages.find((p) => p.name === 'react-native-gesture-handler');
    expect(gh?.license).toBe('MIT');
    for (const n of ['react-native-reanimated', 'react-native-screens', 'react-native-safe-area-context', 'react-native-svg', 'react-native-webview', 'react-native-maps', 'react-native-worklets', '@react-native-async-storage/async-storage', '@react-native-masked-view/masked-view'])
      expect([n, data.packages.some((p) => p.name === n)]).toEqual([n, true]);
  });
});

describe('V138-6: the complete-profile gate uses the registration validators', () => {
  const ok = { firstName: 'Ravi', lastName: 'Kumar', dob: '1990-01-01', pincode: '110001' };
  it('accepts a real profile', () => expect(hasStoredRegistration(ok)).toBe(true));
  it.each([
    ['blank first name', { ...ok, firstName: ' ' }],
    ['whitespace last name', { ...ok, lastName: '\u3000 ' }],
    ['pincode 000000', { ...ok, pincode: '000000' }],
    ['pincode 012345', { ...ok, pincode: '012345' }],
    ['unallocated prefix 10', { ...ok, pincode: '100001' }],
    ['pincode 12345', { ...ok, pincode: '12345' }],
    ['no dob', { ...ok, dob: null }],
  ])('refuses %s', (_l, p) => expect(hasStoredRegistration(p)).toBe(false));
  it('APS pincodes (9xxxxx) count as complete', () => expect(profileComplete({ ...ok, pincode: '930001' })).toBe(true));
});

describe('V138-7: stable daily selection', () => {
  const NOW = Date.UTC(2026, 9, 12, 6, 0); // 11:30 IST
  const item = (id: string, createdAt: number | null): DailyItem => ({ id, type: 'fact', textEn: id, textHi: id, attribution: null, sourceUrl: null, active: true, createdAt });
  it('adding a fact today does not change today\'s fact (any id, even one that sorts first)', () => {
    const today = pickDaily(BUNDLED_DAILY_ITEMS, NOW)!.id;
    for (const id of ['a0', 'b30x', 'zz', 'b00']) {
      const merged = mergeDailyItems([item(id, NOW - 60_000)]);
      expect([id, pickDaily(merged, NOW)!.id]).toEqual([id, today]);
      expect(pickDaily(merged, NOW + 6 * 3600_000)!.id).toBe(today); // still today (17:30 IST)
    }
  });
  it('a new fact shows up within the next cycle (n days)', () => {
    const merged = mergeDailyItems([item('b30x', NOW)]);
    const start = istDayStart(NOW) + 86_400_000;
    const seen = new Set(Array.from({ length: merged.length }, (_, d) => pickDaily(merged, start + d * 86_400_000 + 3600_000)!.id));
    expect(seen.has('b30x')).toBe(true);
    expect(seen.size).toBe(merged.length); // every item once per cycle
  });
  it('items without createdAt (bundled, pre-1.3.9 docs) are always in the rotation', () => {
    const merged = mergeDailyItems([item('a0', null)]);
    const days = new Set(Array.from({ length: merged.length }, (_, d) => pickDaily(merged, NOW + d * 86_400_000)!.id));
    expect(days.has('a0')).toBe(true);
  });
  it('istDayStart is IST midnight', () => {
    expect(new Date(istDayStart(NOW)).toISOString()).toBe('2026-10-11T18:30:00.000Z');
  });
});

describe('V138-8: fullwidth digits', () => {
  it('the typing filter converts ０-９ and ＋; the strict helpers are unchanged', () => {
    expect(fullwidthToAscii('９８７６５４３２１０')).toBe('9876543210');
    expect(fullwidthToAscii('＋９１')).toBe('+91');
    expect(devanagariToAscii('９')).toBe('９');
    expect(filterPhoneTyping({ value: '', display: null }, '＋９１ ９８７６５ ４３２１０').value).toBe('9876543210');
    const r = filterPhoneTyping({ value: '', display: null }, '９８７６５４３２１０');
    expect(r.value).toBe('9876543210');
  });
});

describe('V138-11: confirming never changes the match date', () => {
  const base = { id: 'm1', createdAt: 100, scheduledAt: null, startedAt: 1_000, finishedAt: 5_000 };
  it('confirmedAt is separate; matchDate ignores it and updatedAt', () => {
    const confirmed = { ...base, updatedAt: 99_999, confirmedAt: 99_999, verification: { status: 'confirmed' as const, by: 'b1', at: 99_999, captain: 'confirmed' as const } };
    expect(matchDate(confirmed)).toBe(5_000);
    expect(confirmedAtOf(confirmed)).toBe(99_999);
    expect(confirmedAtOf({ verification: { status: 'confirmed', by: 'b1', at: 7 } })).toBe(7);
    expect(confirmedAtOf({ verification: { status: 'disputed', by: 'b1', at: 7, reason: 'x' } })).toBeNull();
  });
  it('lists sort by the match date, newest first, whatever was confirmed last', () => {
    const older = { ...base, id: 'old', finishedAt: 2_000, confirmedAt: 9_000_000 };
    const newer = { ...base, id: 'new', finishedAt: 3_000 };
    const live = { ...base, id: 'live', finishedAt: null, startedAt: 4_000 };
    expect([older, newer, live].sort(byMatchDateDesc).map((m) => m.id)).toEqual(['live', 'new', 'old']);
  });
});

describe('V138-14: Hindi source names', () => {
  it('FIVB rules are shown in Hindi, other attributions as written', () => {
    const rules = BUNDLED_DAILY_ITEMS.find((i) => i.id === 'b05')!;
    expect(dailyAttribution(rules, 'hi')).toBe('एफआईवीबी के आधिकारिक वॉलीबॉल नियम');
    expect(dailyAttribution(rules, 'en')).toBe('FIVB Official Volleyball Rules');
    expect(dailyAttribution({ attribution: 'Some coach' }, 'hi')).toBe('Some coach');
    for (const a of new Set(BUNDLED_DAILY_ITEMS.map((i) => i.attribution))) expect([a, !!ATTRIBUTION_HI[a!]]).toEqual([a, true]);
  });
});
