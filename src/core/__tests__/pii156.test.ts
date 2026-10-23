/**
 * 1.5.6 (Tester F155-1 / F155-2): ONE grouped-phone detector – digit groups joined by ANY run of non-alphanumeric
 * characters (any length), 10 digits in total, any grouping, optional +91 / 0 / 91 prefix, masked everywhere; score
 * lines follow a real match progression (best-of-3/5, decider target), new cues (ph, tel, DM, msg me, ping me on + HI).
 * Property-style, seeded: random groupings × random separator runs must be masked; set scores, short lists, dates, times,
 * IPv4 lists, UUID lists, seeds, brackets, jersey lists and versions must stay.
 */
import { maskPii, maskPiiStored, normalizeForPii, reachableScoreLine, SCORE_LINE_RULES } from '../pii';
import { filterPii } from '../ask/tools';

function rng(seed: number) {
  return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const R = rng(156);
const int = (a: number, b: number) => a + Math.floor(R() * (b - a + 1));
const pick = <T,>(a: readonly T[]) => a[Math.floor(R() * a.length)];
const digits = (n: number) => Array.from({ length: n }, () => String(Math.floor(R() * 10))).join('');
const mobile = () => pick(['6', '7', '8', '9']) + digits(9);
const HIDDEN = /\[phone hidden\]/;
const left = (m: string) => normalizeForPii(m.replace(/\[phone hidden\]/g, '')).text.replace(/[^0-9]/g, '');
const both = (s: string) => [maskPii(s), maskPiiStored(s)];

const ASCII_PUNCT = [...'!"#$%&\'()*+,-./:;<=>?@[\\]^_`{|}~'];
const UNI = [...'•·…‐‑‒–—―−′″‹›«»¡¿§¶†‡※⁂→←↑↓★☆♦♣♠♥✓✔✗☎📞✆°±×÷¦¬¤€£¥₹©®'];
const SPACES = [' ', '\t', '\u00a0', '\u2009', '\u3000'];
const POOL = [...ASCII_PUNCT, ...UNI, ...SPACES];
const sepRun = (max = 12) => Array.from({ length: int(1, max) }, () => pick(POOL)).join('');
const GROUPINGS = [[5, 5], [3, 3, 4], [4, 3, 3], [3, 4, 3], [2, 2, 2, 2, 2], [4, 6], [6, 4], [2, 4, 4], [4, 4, 2], [2, 3, 2, 3], [3, 3, 2, 2], [10]];
const split = (d: string, g: number[]) => { const out: string[] = []; let i = 0; for (const n of g) { out.push(d.slice(i, i + n)); i += n; } return out; };

describe('F155-1: the Tester\'s grouped phones', () => {
  it.each(['call 98765|43210', '+91|98765|43210', '987#654#3210', '98765 • 43210', '+91·98765·43210', '98|76|54|32|10', '9876*543*210', '98765~43210',
    '98765+43210', '91|98765|43210', '0|98765|43210', '0 98765 43210', '+91 (98765) 43210', '98765 ¦ 43210', '98765 ★★ 43210', '987📞654📞3210', '98765\t\t43210',
    '98765 ---------------- 43210', '98 76 54 32 10', '9876 12:34 98'])('%j is masked everywhere', (p) => {
    for (const m of both(p)) { expect(m).toMatch(HIDDEN); expect(left(m)).toBe(''); }
    for (const m of both(`reach me on ${p} today`)) { expect(m).toMatch(/^reach me on .*\[phone hidden\].* today$/); expect(left(m)).toBe(''); }
    expect(filterPii({ text: `no: ${p}` }).text).toMatch(HIDDEN);
  });
});

describe('F155-1 property: random groupings × random separator runs (seeded)', () => {
  it('20 000 phones with a random grouping, random separators (1–12 chars) and an optional +91 / 0 / 91 prefix are masked', () => {
    const bad: string[] = [];
    for (let i = 0; i < 20_000; i++) {
      const groups = split(mobile(), pick(GROUPINGS));
      const prefix = pick(['', '', '+91', '0', '91']);
      const sep = R() < 0.5 ? sepRun() : null; // one separator reused, or a fresh random run between every group
      let p = groups.map((g, k) => (k === 0 ? g : (sep ?? sepRun()) + g)).join('');
      if (prefix) p = prefix + (R() < 0.2 && prefix !== '0' ? '' : sepRun(4)) + p;
      const s = pick(['', 'call ', 'my number is ', 'text me ', 'yo ']) + p + pick(['', ' thanks', ' ok?', '.']);
      for (const m of both(s)) if (!HIDDEN.test(m) || left(m) !== '') { bad.push(s); break; }
    }
    expect(bad.slice(0, 10)).toEqual([]);
  });
});

describe('F155-1 keeps (property, seeded): nothing that is not a phone changes', () => {
  const G: Record<string, () => string> = {
    timeList: () => Array.from({ length: int(2, 6) }, () => `${String(int(0, 23)).padStart(R() < 0.5 ? 2 : 1, '0')}:${String(int(0, 59)).padStart(2, '0')}`).join(pick([', ', ' | ', ' / ', ' · ', ' '])),
    dateList: () => Array.from({ length: int(2, 4) }, () => { const sp = pick(['/', '-', '.']); return R() < 0.5 ? `${String(int(1, 28)).padStart(2, '0')}${sp}${String(int(1, 12)).padStart(2, '0')}${sp}20${int(10, 39)}` : `20${int(10, 39)}-${String(int(1, 12)).padStart(2, '0')}-${String(int(1, 28)).padStart(2, '0')}`; }).join(pick([', ', ' | ', ' and '])),
    ipList: () => Array.from({ length: int(1, 4) }, () => [int(0, 255), int(0, 255), int(0, 255), int(0, 255)].join('.')).join(pick([' | ', ', ', ' '])),
    uuidList: () => Array.from({ length: int(1, 3) }, () => { const h = () => digits(4); return `${h()}${h()}-${h()}-4${digits(3)}-8${digits(3)}-${h()}${h()}${h()}`; }).join(' | '),
    scoreLine: () => {
      const n = int(2, 5); let w: boolean[];
      do { w = Array.from({ length: n }, () => R() < 0.5); } while (w.some((_, k) => k < n - 1 && Math.max(w.slice(0, k + 1).filter(Boolean).length, w.slice(0, k + 1).filter((x) => !x).length) >= 3) || (n === 5 && w.slice(0, 4).filter(Boolean).length !== 2));
      const P = int(5, 9);
      return 'sets ' + w.map((x) => { const hi = int(P, 9); const lo = hi === P ? int(0, P - 2) : hi - 2; return x ? `${hi}-${lo}` : `${lo}-${hi}`; }).join(pick([' ', ', ']));
    },
    bigScores: () => 'Final ' + Array.from({ length: int(2, 5) }, () => `${int(15, 30)}-${int(10, 30)}`).join(pick([', ', ' ', ' | '])),
    seeds: () => 'Seeds ' + Array.from({ length: int(4, 16) }, (_, k) => String(k + 1)).join(pick(['|', ', ', ' · ', ' ', '][', ' / '])),
    bracket: () => 'bracket ' + Array.from({ length: int(2, 8) }, () => `${int(1, 16)} v ${int(1, 16)}`).join(', '),
    jersey: () => pick(['Jersey ', 'Jerseys: ', 'Shirts ', 'Players ']) + Array.from({ length: int(3, 9) }, () => String(int(1, 99))).join(pick([' | ', ', ', ' · '])),
    version: () => `v${Array.from({ length: int(2, 5) }, () => int(0, 20)).join('.')}`,
    shortList: () => `rally ${Array.from({ length: int(2, 9) }, () => int(0, 9)).join(sepRun(3))}`,
  };
  it.each(Object.keys(G))('5 000 random %s lines stay (display and stored)', (k) => {
    const bad: string[] = [];
    for (let i = 0; i < 5_000; i++) { const s = G[k](); if (maskPii(s) !== s || maskPiiStored(s) !== s) bad.push(s); }
    expect(bad.slice(0, 10)).toEqual([]);
  });
  it.each(['8-6 5-7 9-7 6-8 8-6', 'Final 3-2 (25-23, 25-20, 18-25, 23-25, 15-13)', 'Pool 1: 3-0, 2-1, 1-2, 0-3', 'Final 2-1 (9-7, 5-7, 7-5)', 'Sets: 1-0, 2-0, 2-1, 3-1',
    'score 9-8 7-6 5-4', 'QF1: 1v8, QF2: 4v5', 'bracket 1 v 16, 8 v 9', 'Round of 16: 1-16, 8-9, 4-13, 5-12', 'Seeds 1|2|3|4|5|6|7|8', 'Seeds [1][2][3][4]', '#1 #2 #3 #4 #5 #6 #7 #8',
    '4/15/32 teams', 'Groups A|B|C|D: 4|4|4|3 teams', 'Jersey 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12', 'Rally 1, 2, 3, 4, 5, 6, 7, 8, 9', 'Court 1 | Court 2 | Court 3',
    'Mon 9 | Tue 8 | Wed 7', 'R1 9 · R2 8 · R3 7 · R4 6', 'won 9 lost 8 drew 7', '10 9 8 7 6 5 4 3 2 1 go', 'Standings: 1. Juhu 2. Bandra 3. Andheri', '21/10/2026', '2026-10-21T18:30:00Z',
    '18:30–20:30', '12:30, 13:45, 15:00', '06:30, 07:45, 09:00', '09/10/2026, 07/11/2026', 'v1.2.3.4.5', '192.168.1.10', '10.0.0.1:8080', '0.0.0.0 | 64.120.64.128',
    '88862915-9196-4074-8140-207759575477', 'u_3f9a2c7e1b4d', 'pincode 400049', 'Jersey 66 | 77 | 88 | 99 | 10'])('%j stays', (s) => {
    expect(both(s)).toEqual([s, s]);
  });
});

describe('F155-2: score lines follow a match progression', () => {
  it('a set after the match is over makes a line impossible → masked', () => {
    for (const s of ['9-7 9-6 6-9 9-5 5-3', '8-6 7-5 9-7 6-4 8-6', '9-7 8-6 7-5 6-4 5-3']) {
      expect(reachableScoreLine(s.replace(/[^0-9]/g, ''))).toBe(false);
      for (const m of both(s)) expect(m).toBe('[phone hidden]');
    }
  });
  it('a realistic 2-2 + decider line stays without a cue, and is masked after one', () => {
    const s = '9-7 6-9 9-5 7-9 5-3';
    expect(reachableScoreLine('9769957953')).toBe(true);
    expect(both(s)).toEqual([s, s]);
    for (const cue of ['ph', 'ph.', 'tel', 'tel:', 'DM me', 'dm', 'msg me', 'ping me on', 'call me later, the score was', 'My contact is below\n', 'फ़ोन', 'डीएम करो', 'मैसेज करो', 'पिंग करो', 'msg karo', 'ping karna'])
      for (const m of both(`${cue} ${s}`)) { expect(m).toMatch(HIDDEN); expect(left(m)).toBe(''); }
  });
  it('the rules are configurable with sane defaults', () => {
    expect(SCORE_LINE_RULES.bestOf).toEqual([3, 5]);
    expect(reachableScoreLine('9769957953', { ...SCORE_LINE_RULES, bestOf: [3] })).toBe(false); // 5 sets can't be best-of-3
    expect(reachableScoreLine('976997', { ...SCORE_LINE_RULES, bestOf: [3] })).toBe(true); // 9-7 6-9 + decider 9-7
    expect(reachableScoreLine('979797', { ...SCORE_LINE_RULES, bestOf: [3] })).toBe(false); // over after 2 sets
    expect(reachableScoreLine('979797')).toBe(true); // best-of-5: 3-0 is a finished match
    expect(reachableScoreLine('97', SCORE_LINE_RULES)).toBe(true); // a match in progress
  });
  it('separator runs of any length (10+) between single digits are masked', () => {
    for (const n of [10, 15, 30]) {
      const s = [...'9876543210'].join('-'.repeat(n));
      for (const m of both(s)) expect(m).toBe('[phone hidden]');
      const t = [...'9876543210'].join(Array.from({ length: n }, () => pick(POOL)).join(''));
      for (const m of both(`call ${t}`)) { expect(m).toMatch(HIDDEN); expect(left(m)).toBe(''); }
    }
  });
});
