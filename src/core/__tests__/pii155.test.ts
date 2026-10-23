/**
 * 1.5.5 (Tester F154-1 / F154-2): no separator allow-list – 10+ single digits joined by ANY run of non-alphanumeric
 * characters are phone-shaped (display: phone-shaped; stored: any 10+ run; comma lists only when phone-shaped), incl.
 * | # * ~ + ; • · \ ' [9][8] {9}{8} and random mixes; five score pairs that spell a phone are masked after a phone cue or
 * when they can't be a real match. Set scores, short lists, dates, versions, ids stay. Property-style, seeded.
 */
import { maskPii, maskPiiStored, isPhoneShape, normalizeForPii, reachableScoreLine } from '../pii';
import { filterPii } from '../ask/tools';

function rng(seed: number) {
  return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const R = rng(155);
const pick = <T,>(a: readonly T[]) => a[Math.floor(R() * a.length)];
const digits = (n: number) => Array.from({ length: n }, () => String(Math.floor(R() * 10))).join('');
const mobile = () => pick(['6', '7', '8', '9']) + digits(9);
const HIDDEN = /\[phone hidden\]/;
const left = (m: string) => normalizeForPii(m.replace(/\[phone hidden\]/g, '')).text.replace(/[^0-9]/g, '');
const both = (s: string) => [maskPii(s), maskPiiStored(s)];

// every printable non-letter / non-digit character class: ASCII punctuation, Unicode punctuation, symbols, spaces
const ASCII_PUNCT = [...'!"#$%&\'()*+,-./:;<=>?@[\\]^_`{|}~'];
const UNI = [...'•·…‐‑‒–—―−′″‹›«»¡¿§¶†‡※⁂→←↑↓★☆♦♣♠♥✓✔✗☎📞✆°±×÷¦¬¤€£¥₹©®'];
// (™ / ℠ are left out on purpose: NFKC turns them into the LETTERS "TM" / "SM", which end a digit run – documented Info)
const SPACES = [' ', '\t', '\u00a0', '\u2009', '\u3000'];
const POOL = [...ASCII_PUNCT, ...UNI, ...SPACES];
const sepRun = () => Array.from({ length: 1 + Math.floor(R() * 3) }, () => pick(POOL)).join('');

describe('F154-1: the Tester\'s separators', () => {
  const SHAPES = ['9|8|7|6|5|4|3|2|1|0', '9#8#7#6#5#4#3#2#1#0', '9*8*7*6*5*4*3*2*1*0', '9~8~7~6~5~4~3~2~1~0', '9+8+7+6+5+4+3+2+1+0',
    '9;8;7;6;5;4;3;2;1;0', '9•8•7•6•5•4•3•2•1•0', '9·8·7·6·5·4·3·2·1·0', '9\\8\\7\\6\\5\\4\\3\\2\\1\\0', "9'8'7'6'5'4'3'2'1'0",
    '[9][8][7][6][5][4][3][2][1][0]', '{9}{8}{7}{6}{5}{4}{3}{2}{1}{0}', '9–8|7:6#5—4_3/2.1-0', '+91|9|8|7|6|5|4|3|2|1|0', '9 | 8 | 7 | 6 | 5 | 4 | 3 | 2 | 1 | 0',
    '<9><8><7><6><5><4><3><2><1><0>', '9 ★ 8 ★ 7 ★ 6 ★ 5 ★ 4 ★ 3 ★ 2 ★ 1 ★ 0', '9…8…7…6…5…4…3…2…1…0'];
  it.each(SHAPES)('display and stored mask %j (no digit left)', (s) => {
    for (const m of both(`my number is ${s} ok`)) { expect(m).toMatch(HIDDEN); expect(left(m)).toBe(''); }
  });
  it('team names (display) with these separators are masked; ids stay', () => {
    for (const name of ['Pipe 9|8|7|6|5|4|3|2|1|0', 'Hash 9#8#7#6#5#4#3#2#1#0', 'Br [9][8][7][6][5][4][3][2][1][0]']) {
      const out = filterPii({ type: 'roster', teamId: 'team_1530aa00-48f2-4fbf-81f3-9876543210aa', name });
      expect(out.teamId).toBe('team_1530aa00-48f2-4fbf-81f3-9876543210aa');
      expect(out.name).toMatch(HIDDEN); expect(left(out.name as string)).toBe('');
    }
  });
});

describe('F154-1 property: random separator runs (seeded)', () => {
  it('10 000 mobiles as single digits joined by random runs of 1–3 random non-alphanumerics (± prefix, ± brackets): 0 leaks', () => {
    const leaks: string[] = [];
    for (let i = 0; i < 10_000; i++) {
      const fixed = R() < 0.5 ? sepRun() : null;
      const br = R() < 0.15 ? pick(['[]', '{}', '()', '<>']) : '';
      const body = [...mobile()].map((d, j) => (j ? (fixed ?? sepRun()) : '') + (br ? `${br[0]}${d}${br[1]}` : d)).join('');
      const s = `${pick(['', '+91', '+91-', '+91 ', '91|', '+'])}${body}`;
      for (const m of both(`call ${s} please`)) if (!HIDDEN.test(m) || left(m) !== '') leaks.push(`${JSON.stringify(s)} → ${m}`);
    }
    expect(leaks.slice(0, 10)).toEqual([]);
  });
  it('10 000 random 10+ single-digit runs with random separators: stored always masked; display = stored (1.5.7 F156-1)', () => {
    const bad: string[] = [];
    for (let i = 0; i < 10_000; i++) {
      const d = digits(10 + Math.floor(R() * 3));
      const s = `ref ${[...d].join(pick([...ASCII_PUNCT.filter((c) => c !== ','), '•', '·', '|', ' | ', '★']))} ok`;
      if (!HIDDEN.test(maskPiiStored(s))) bad.push(`stored ${s}`);
      const disp = maskPii(s);
      if (disp !== maskPiiStored(s)) bad.push(`display ${s} → ${disp}`);
    }
    expect(bad.slice(0, 10)).toEqual([]);
  });
  it('10 000 keeps: < 10 single digits with random separators, multi-digit runs, reachable score lines, dates / versions', () => {
    const bad: string[] = [];
    for (let i = 0; i < 10_000; i++) {
      const short = [...digits(2 + Math.floor(R() * 8))].join(sepRun());
      const multi = Array.from({ length: 4 + Math.floor(R() * 6) }, () => String(10 + Math.floor(R() * 16))).join(sepRun()); // "25 23 15 …"
      const P = 3 + Math.floor(R() * 7); // reachable single-digit score line: winners P..9, losers per the rules
      // 1.5.6 (F155-2): winners follow a best-of-5 progression – no set after the match is over
      const n = 2 + Math.floor(R() * 4);
      let wins: boolean[];
      do { wins = Array.from({ length: n }, () => R() < 0.5); } while (wins.some((_, k) => k < n - 1 && Math.max(wins.slice(0, k + 1).filter(Boolean).length, wins.slice(0, k + 1).filter((w) => !w).length) >= 3));
      const sets = wins.map((w) => { const hi = P + Math.floor(R() * (10 - P)); const lo = hi === P ? Math.floor(R() * (P - 1)) : hi - 2; return w ? `${hi}-${lo}` : `${lo}-${hi}`; });
      const date = `${1 + Math.floor(R() * 28)}${pick(['/', '-', '.'])}${1 + Math.floor(R() * 12)}${pick(['/', '-', '.'])}20${10 + Math.floor(R() * 30)}`;
      for (const s of [`a ${short} b`, `Final ${multi}`, `sets ${sets.join(pick([' ', ', ']))}`, `on ${date} at 18:30`, `v 1.5.${Math.floor(R() * 10)}`]) {
        if (!(maskPii(s) === s && maskPiiStored(s) === s)) bad.push(s);
      }
    }
    expect(bad.slice(0, 10)).toEqual([]);
  });
});

describe('F154-2: five score pairs that spell a phone', () => {
  it.each(['9-8 7-6 5-4 3-2 1-0', '9–8 7–6 5–4 3–2 1–0', '9:8 7:6 5:4 3:2 1:0', '9-8, 7-6, 5-4, 3-2, 1-0'])('%j can\'t be a match → masked everywhere', (s) => {
    expect(reachableScoreLine(s.replace(/[^0-9]/g, ''))).toBe(false);
    for (const m of both(`my number is ${s}`)) expect(m).toBe('my number is [phone hidden]');
    for (const m of both(s)) expect(m).toBe('[phone hidden]');
  });
  it.each(['number', 'phone no.', 'mobile:', 'call me on', 'whatsapp', 'contact', 'mera number', 'nambar hai', 'फोन', 'मेरा नंबर है', 'reach me at'])('after %j even a reachable line is masked', (cue) => {
    const s = `${cue} 8-6 5-7 9-7 6-8 8-6`;
    for (const m of both(s)) { expect(m).toMatch(HIDDEN); expect(left(m)).toBe(''); }
  });
  it.each(['sets 8-6 5-7 9-7 6-8 8-6', '8-6, 5-7, 9-7, 6-8, 8-6', '8:6 5:7 9:7 6:8 8:6', 'Set 1 9-8, set 2 7-6', 'scores 1-0 2-1 3-2', 'we won 8-6 5-7 9-7 6-8 8-6, number one!'])('reachable / short score lines stay: %j', (s) => {
    expect(both(s)).toEqual([s, s]);
  });
  it('reachability: one points target (± cap) for all but the last set', () => {
    expect(reachableScoreLine('8657976886')).toBe(true); // P = 6, 2-2 then decider (1.5.6 progression)
    expect(reachableScoreLine('8675976486')).toBe(false); // 1.5.6: one side wins every set – match over after 3
    expect(reachableScoreLine('9876543210')).toBe(false);
    expect(reachableScoreLine('9768754653')).toBe(true); // 9-7 6-8 7-5 4-6 + decider 5-3
    expect(reachableScoreLine('9786756453')).toBe(false); // 1.5.6: 9-7 8-6 7-5 already ends a best-of-5
  });
});
