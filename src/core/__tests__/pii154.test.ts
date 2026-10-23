/**
 * 1.5.4 (Tester F153-1 / F153-2): single digits joined by ANY separator (dash, dot, slash, underscore, brackets, comma,
 * mixed, "+91-" prefix) are masked in display (phone-SHAPED) and stored (any 10+ run; comma lists only when phone-shaped);
 * a phone in a zero-padded UUID-shaped display token is masked; set scores, dates, versions, short lists and real
 * ids stay. Hinglish "ath", "chah", "chār" and "no" (only inside a digit-word run). Seeded fuzz both ways.
 */
import { maskPii, maskPiiStored, isPhoneShape, normalizeForPii, reachableScoreLine } from '../pii';
import { filterPii } from '../ask/tools';

function rng(seed: number) {
  return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const R = rng(154);
const pick = <T,>(a: readonly T[]) => a[Math.floor(R() * a.length)];
const digits = (n: number) => Array.from({ length: n }, () => String(Math.floor(R() * 10))).join('');
const hex = (n: number) => Array.from({ length: n }, () => '0123456789abcdef'[Math.floor(R() * 16)]).join('');
const mobile = () => pick(['6', '7', '8', '9']) + digits(9);
const HIDDEN = /\[phone hidden\]/;

// 1.5.5 (F154-2): five single-digit score pairs that spell a phone and can't be a real match are masked by rule
const pairPhone = (sets: string[]) => { const d = sets.join('').replace(/[^0-9]/g, ''); return sets.length === 5 && d.length === 10 && isPhoneShape(d, false) && !reachableScoreLine(d); };
const left = (m: string) => normalizeForPii(m.replace(/\[phone hidden\]/g, '')).text.replace(/[^0-9]/g, '');
const both = (s: string) => [maskPii(s), maskPiiStored(s)];

const LEAKS = [
  '9-8-7-6-5-4-3-2-1-0', '9.8.7.6.5.4.3.2.1.0', '9/8/7/6/5/4/3/2/1/0', '9_8_7_6_5_4_3_2_1_0', '(9)(8)(7)(6)(5)(4)(3)(2)(1)(0)',
  '9 8-7.6 5\t4 3-2.1 0', '9 8 7 6 5-4 3 2 1 0', '+91-9-8-7-6-5-4-3-2-1-0', '+91 9-8-7-6-5-4-3-2-1-0', '91-9-8-7-6-5-4-3-2-1-0',
  '9–8–7–6–5–4–3–2–1–0', '9 . 8 . 7 . 6 . 5 . 4 . 3 . 2 . 1 . 0', '9,8,7,6,5,4,3,2,1,0', '9, 8, 7, 6, 5, 4, 3, 2, 1, 0',
  'points 6, 7, 8, 9, 6, 7, 8, 9, 6, 7', '９-８-７-６-５-４-３-２-１-０', '९-८-७-६-५-४-३-२-१-०', 'plus 91-9-8-7-6-5-4-3-2-1-0',
];
const KEEP = [
  'sets 8-6 5-7 9-7 6-8 8-6', '8-6, 5-7, 9-7, 6-8, 8-6', '8:6 5:7 9:7 6:8 8:6', 'Final 25-23 25-20 15-13', 'Final 25 23 25 20 15 13 11 9',
  'scores 1, 2, 3, 4, 5, 6, 7, 8, 9, 0', 'jerseys 1 2 3 4 5 6 7 8 9 10 11 12', '1-2-3-4-5-6-7-8-9-10', 'match on 21/10/2026 at 18:30',
  'match on 21-10-2026', 'v 1.5.4 build 49', '21.10.2026 6.30 pm', 'pincode 110001', 'won 9 lost 8 drew 7', '5 4 3 2 1 0 countdown',
  'ip 192.168.1.10', '1.2.3.4.5', '9-8-7-6-5', '88862915-9196-4074-8140-207759575477', '00000000-0000-0000-0000-000000000000',
  'what was the score 25-23 set', 'no thanks', 'I have no 2 3 players', 'no, 9 players', 'say no to 9 8 7',
];

describe('F153-1: single digits joined by any separator', () => {
  it.each(LEAKS)('display and stored mask %j (no digit left)', (s) => {
    for (const m of both(`my number is ${s} ok`)) { expect(m).toMatch(HIDDEN); expect(left(m)).toBe(''); }
  });
  it.each(KEEP)('display and stored keep %j', (s) => { expect(both(s)).toEqual([s, s]); });
  it('a non-phone-shaped 10-digit dashed / dotted run is masked in display and stored (1.5.7 F156-1: one masker)', () => {
    expect(maskPiiStored('1-2-3-4-5-6-7-8-9-0')).toMatch(HIDDEN);
    expect(maskPii('1-2-3-4-5-6-7-8-9-0')).toBe(maskPiiStored('1-2-3-4-5-6-7-8-9-0'));
    expect(maskPiiStored('code 1.2.3.4.5.6.7.8.9.0.1')).toMatch(HIDDEN);
  });
  it('a phone in a zero-padded UUID-shaped DISPLAY token is masked; ids stay in id fields', () => {
    for (const u of ['00000000-0000-0000-0000-009812345678', '00000000-0000-0000-0000-919812345678']) {
      expect(maskPii(`Open ${u}`)).toBe('Open [phone hidden]');
      expect(maskPiiStored(u)).toBe('[phone hidden]');
      const out = filterPii({ type: 'match', matchId: u, id: u, title: `Match ${u}` });
      expect(out.matchId).toBe(u); expect(out.id).toBe(u); expect(out.title).toBe('Match [phone hidden]');
    }
  });
  it('team names (display) are masked, team ids stay', () => {
    const out = filterPii({ type: 'roster', teamId: 'team_1530aa00-48f2-4fbf-81f3-9876543210aa', name: 'Club 9-8-7-6-5-4-3-2-1-0' });
    expect(out.teamId).toBe('team_1530aa00-48f2-4fbf-81f3-9876543210aa');
    expect(out.name).toBe('Club [phone hidden]');
  });
});

describe('F153-1 fuzz (seeded)', () => {
  const SEPS = ['-', '.', '/', '_', ' - ', '–', '—', '−', ' . ', ', ', ','];
  it('5 000 mobiles as single digits with random / mixed separators (+ optional +91 prefix): 0 leaks', () => {
    const leaks: string[] = [];
    for (let i = 0; i < 5_000; i++) {
      const mixed = R() < 0.5;
      const sep0 = pick(SEPS);
      const body = [...mobile()].map((d, j) => (j ? (mixed ? pick([...SEPS, ' ', '\t']) : sep0) : '') + (R() < 0.05 ? `(${d})` : d)).join('');
      const s = `${pick(['', '+91-', '+91 ', '91-', '+'])}${body}`;
      for (const m of both(`call ${s} please`)) if (!HIDDEN.test(m) || left(m) !== '') leaks.push(`${s} → ${m}`);
    }
    expect(leaks).toEqual([]);
  });
  it('5 000 single-digit set-score lines (dash / en dash / colon / slash, space or comma gaps): unchanged unless F154-2 applies', () => {
    const bad: string[] = [];
    for (let i = 0; i < 5_000; i++) {
      const sign = pick(['-', '–', ':', '/']);
      const gap = pick([' ', ', ', ',']);
      const sets = Array.from({ length: 2 + Math.floor(R() * 4) }, () => `${Math.floor(R() * 10)}${sign}${Math.floor(R() * 10)}`);
      const s = `sets ${sets.join(gap)}`;
      if (pairPhone(sets) ? !HIDDEN.test(maskPii(s)) || !HIDDEN.test(maskPiiStored(s)) : maskPii(s) !== s || maskPiiStored(s) !== s) bad.push(s);
    }
    expect(bad).toEqual([]);
  });
  it('5 000 non-phone-shaped separated runs: display = stored (1.5.7 F156-1); real uuids stay everywhere', () => {
    const bad: string[] = [];
    for (let i = 0; i < 5_000; i++) {
      let d = digits(10); while (isPhoneShape(d, false)) d = digits(10);
      const s = `ref ${[...d].join(pick(SEPS))}`;
      if (maskPii(s) !== maskPiiStored(s)) bad.push(s);
      const u = `${hex(8)}-${hex(4)}-4${hex(3)}-${pick(['8', '9', 'a', 'b'])}${hex(3)}-${hex(12)}`;
      for (const v of [u, `Open match ${u}`]) for (const m of both(v)) if (m !== v) bad.push(`${v} → ${m}`);
    }
    expect(bad).toEqual([]);
  });
});

describe('F153-2: Hinglish ath / chah / chār / no', () => {
  it.each([
    'nau ath ek do teen char paanch chhe saat aath', 'no ath ek do teen chār paanch chah saat aath',
    'nau aath ek do teen chaar paanch chah saat ath', 'mera number no aath saat chhe paanch char teen do ek shunya hai',
    'nau no no ek do teen char paanch chhe saat',
  ])('masks %j in display and stored', (s) => { for (const m of both(s)) expect(m).toMatch(HIDDEN); });
  it('"no" on its own (or beside one short number) is never a digit', () => {
    for (const s of ['no', 'no thanks', 'No, I am not the captain', 'say no to 9 8 7', 'is there no match today?', 'yes or no']) expect(both(s)).toEqual([s, s]);
  });
});
