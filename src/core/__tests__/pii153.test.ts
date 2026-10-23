/**
 * 1.5.3 (Tester F152-1 / F152-2): spaced single-digit phones, "plus91…" glued, digits mixed with words and spelled-out
 * digits (English / Hindi / Hinglish). maskPii = display text (phone-SHAPED runs only); maskPiiStored = the copy kept in
 * ask_history / ask_audit / returned by the history API (any run of 10+ single digits or digit words). Seeded fuzz in
 * both directions; ids never change.
 */
import { maskPii, maskPiiStored, normalizeForPii, isPhoneShape, reachableScoreLine } from '../pii';
import { filterPii } from '../ask/tools';

function rng(seed: number) {
  return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const R = rng(153);
const pick = <T,>(a: readonly T[]) => a[Math.floor(R() * a.length)];
const hex = (n: number) => Array.from({ length: n }, () => '0123456789abcdef'[Math.floor(R() * 16)]).join('');
const uuid = () => `${hex(8)}-${hex(4)}-4${hex(3)}-${pick(['8', '9', 'a', 'b'])}${hex(3)}-${hex(12)}`;
const digits = (n: number) => Array.from({ length: n }, () => String(Math.floor(R() * 10))).join('');
const mobile = () => pick(['6', '7', '8', '9']) + digits(9);
const HIDDEN = /\[phone hidden\]/;

// 1.5.5 (F154-2): five single-digit score pairs that spell a phone and can't be a real match are masked by rule
const pairPhone = (sets: string[]) => { const d = sets.join('').replace(/[^0-9]/g, ''); return sets.length === 5 && d.length === 10 && isPhoneShape(d, false) && !reachableScoreLine(d); };
const left = (m: string) => normalizeForPii(m.replace(/\[phone hidden\]/g, '')).text.replace(/[^0-9]/g, '');

describe('F152-1: spaced single digits', () => {
  const BOTH: [string, string][] = [
    ['my number is 9 8 7 6 5 4 3 2 1 0, what are my teams?', 'my number is [phone hidden], what are my teams?'],
    ['+ 9 1 9 8 7 6 5 4 3 2 1 0', '[phone hidden]'],
    ['+91 9 8 7 6 5 4 3 2 1 0 call', '[phone hidden] call'],
    ['0 9 8 7 6 5 4 3 2 1 0', '[phone hidden]'],
    ['Club 9 8 7 6 5 4 3 2 1 0', 'Club [phone hidden]'],
    ['मेरा नंबर ९ ८ ७ ६ ५ ४ ३ २ १ ० है', 'मेरा नंबर [phone hidden] है'],
  ];
  it.each(BOTH)('display + stored mask %j', (s, want) => { expect(maskPii(s)).toBe(want); expect(maskPiiStored(s)).toBe(want); });
  const STORED_ONLY = ['1 2 3 4 5 6 7 8 9 0', 'code 5 5 5 1 2 3 4 5 6 7 8', '0 1 2 3 4 5 6 7 8 9 0 1'];
  it.each(STORED_ONLY)('10+ spaced single digits are masked: %j (1.5.7 F156-1: display uses the stored masker)', (s) => {
    expect(maskPiiStored(s)).toMatch(HIDDEN);
    expect(left(maskPiiStored(s))).toBe('');
    expect(maskPii(s)).toBe(maskPiiStored(s));
  });
  const KEEP = ['sets 8-6 5-7 9-7 6-8 8-6', '8-6 7-5', 'Final 25 23 25 20 15 13', 'points 6, 7, 8, 9, 6, 7, 8, 9', '9 8 7 6 5', 'players 6 7 8 9 6 7 8 9 6', 'Final 25-23 25-20 15-13', 'match on 21 10 2026 at 6 pm'];
  it.each(KEEP)('display and stored keep %j', (s) => { expect(maskPii(s)).toBe(s); expect(maskPiiStored(s)).toBe(s); });
  it('team names in Ask cards: display fields masked, id fields never', () => {
    const card = { type: 'roster', teamId: 'team_9876543210', name: 'Club 9 8 7 6 5 4 3 2 1 0', route: '/team/9 8 7 6 5 4 3 2 1 0', players: [{ id: 'dev_919876543210', name: 'Riya' }] };
    for (const out of [filterPii(card), filterPii(card, '', true)]) {
      expect(out.name).toBe('Club [phone hidden]');
      expect(out.teamId).toBe('team_9876543210');
      expect(out.route).toBe('/team/9 8 7 6 5 4 3 2 1 0');
      expect(out.players[0].id).toBe('dev_919876543210');
    }
  });
});

describe('F152-2: glued "plus", mixed and spelled-out digits', () => {
  const BOTH = ['plus919812345678', 'call plus 91 98123 45678', 'PLUS 919812345678 ok', 'my number is plus 91 9 8 1 2 3 4 5 6 7 8',
    '98 one two three 45678', 'double nine eight one two three four five six seven', 'nine eight one two three four five six seven eight',
    'नौ आठ एक दो तीन चार पाँच छह सात आठ', 'मेरा नंबर नौ आठ एक दो तीन चार पांच छह सात आठ है', 'nau aath ek do teen char paanch chhe saat aath',
    'mera number nau aath double ek do teen char paanch chhe saat hai', 'triple nine 8 1 2 3 4 5 6'];
  it.each(BOTH)('masks %j (display and stored)', (s) => {
    for (const m of [maskPii(s), maskPiiStored(s)]) { expect(m).toMatch(HIDDEN); expect(left(m)).toBe(''); expect(m).not.toMatch(/\b(?:nine|eight|nau|aath)\b|नौ|आठ/); }
  });
  it('stored copy: 10+ digit tokens mixed / spelled even when not phone-shaped', () => {
    for (const s of ['one two three four five six seven eight nine zero', 'ek do teen char paanch chhe saat aath nau shunya', '12 three 45 six 7890']) {
      expect(maskPiiStored(s)).toMatch(HIDDEN);
    }
  });
  const KEEP = ['plus one', 'plus two players', 'nine eight', 'kar do ek baar', 'do teen match khele', 'मैंने दो तीन मैच खेले', 'one two three, go!', 'double the points', 'won 25 to 23 and 25 to 20', 'Team Nine Eight Seven'];
  it.each(KEEP)('keeps %j', (s) => { expect(maskPii(s)).toBe(s); expect(maskPiiStored(s)).toBe(s); });
});

const WORDS = { en: ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'], hi: ['शून्य', 'एक', 'दो', 'तीन', 'चार', 'पाँच', 'छह', 'सात', 'आठ', 'नौ'], hn: ['shunya', 'ek', 'do', 'teen', 'char', 'paanch', 'chhe', 'saat', 'aath', 'nau'] };
const asTokens = (n: string, words: string[] | null, mix: number) => [...n].map((d) => (words && R() < mix ? words[Number(d)] : d)).join(' ');

describe('F152-1 / F152-2 fuzz: phones are hidden (seeded)', () => {
  it('6 000 random mobiles as spaced single digits / digit words (EN, HI, Hinglish, mixed) with prefixes: masked in display AND stored, nothing left', () => {
    const leaks: string[] = [];
    for (let i = 0; i < 6_000; i++) {
      const words = pick([null, WORDS.en, WORDS.hi, WORDS.hn]);
      const body = asTokens(mobile(), words, pick([0, 0.5, 1]));
      const pre = pick(['', '+ 9 1 ', '+91 ', '0 ', '91 ', 'plus 91 ', 'plus 9 1 ']);
      const text = `${pick(['call me on', 'मेरा नंबर', 'number:', 'Club', 'mera number'])} ${pre}${body} ${pick(['today', 'है', 'XI', 'ok', 'hai'])}`;
      for (const m of [maskPii(text), maskPiiStored(text)]) {
        if (!HIDDEN.test(m) || left(m).length > 0 || /\b(?:one|two|three|four|five|six|seven|eight|nine|zero|aath|nau|saat|paanch|chhe|teen)\b/.test(m.replace(/^(?:call me on|number:|Club|mera number)/, ''))) leaks.push(`${JSON.stringify(text)} → ${m}`);
      }
    }
    expect(leaks).toEqual([]);
  });
  it('3 000 random 10–15 spaced single digits (any start): the stored copy always hides them', () => {
    const leaks: string[] = [];
    for (let i = 0; i < 3_000; i++) {
      const s = `q ${[...digits(10 + Math.floor(R() * 6))].join(' ')} ?`;
      const m = maskPiiStored(s);
      if (!HIDDEN.test(m) || left(m).length > 0) leaks.push(`${s} → ${m}`);
    }
    expect(leaks).toEqual([]);
  });
});

describe('F152-1 / F152-2 fuzz: non-phones and ids stay (seeded)', () => {
  it('5 000 set-score lines, short / comma lists, multi-digit score runs: unchanged in display and stored', () => {
    const changed: string[] = [];
    for (let i = 0; i < 5_000; i++) {
      const sets = Array.from({ length: 2 + Math.floor(R() * 4) }, () => { const w = pick([25, 15, 21, 11, 8, 7, 9, 6]); const l = Math.max(0, w - 2 - Math.floor(R() * 10)); return `${w}${pick(['-', '–', ':'])}${l}`; });
      const short = [...digits(3 + Math.floor(R() * 7))].join(' '); // < 10 single digits
      // 1.5.4 (F153-1): a phone-SHAPED comma list is masked now (pii154.test.ts); the others stay
      let cd = digits(10 + Math.floor(R() * 5)); while (isPhoneShape(cd, false)) cd = digits(cd.length);
      const comma = [...cd].join(', ');
      const multi = Array.from({ length: 3 + Math.floor(R() * 4) }, () => String(10 + Math.floor(R() * 16))).join(' '); // "25 23 15 …"
      for (const s of [`Final ${sets.join(' ')}`, `set scores ${sets.join(', ')}`, `points ${short}`, `points ${comma}`, `Final ${multi}`]) {
        if (s.includes(sets.join(' ')) || s.includes(sets.join(', '))) { if (pairPhone(sets) ? !HIDDEN.test(maskPii(s)) || !HIDDEN.test(maskPiiStored(s)) : maskPii(s) !== s || maskPiiStored(s) !== s) changed.push(s); continue; }
        if (maskPii(s) !== s || maskPiiStored(s) !== s) changed.push(s);
      }
    }
    expect(changed).toEqual([]);
  });
  it('5 000 non-phone-shaped 10-digit spaced lists (start 1-5): display = stored (masked) – 1.5.7 F156-1', () => {
    const changed: string[] = [];
    for (let i = 0; i < 5_000; i++) {
      const s = `points ${[pick(['1', '2', '3', '4', '5']), ...digits(9)].join(' ')}`;
      if (maskPii(s) !== maskPiiStored(s) || !HIDDEN.test(maskPii(s))) changed.push(s);
    }
    expect(changed).toEqual([]);
  });
  it('20 000 ALL-DIGIT uuids (bare, in text, in a route) – their middle groups can look like 91 + a mobile: 0 corrupted', () => {
    const bad: string[] = [];
    expect(maskPii('88862915-9196-4074-8140-207759575477')).toBe('88862915-9196-4074-8140-207759575477'); // found by fuzz59
    for (let i = 0; i < 5_000; i++) {
      const u = `${digits(8)}-${pick(['9196', '9198', '0919', digits(4)])}-${digits(4)}-${digits(4)}-${digits(12)}`;
      for (const v of [u, `Open match ${u} now`, `/match/${u}`]) for (const m of [maskPii(v), maskPiiStored(v)]) if (m !== v) bad.push(`${v} → ${m}`);
    }
    expect(bad).toEqual([]);
    expect(maskPii('call +91 96407 48140, match 88862915-9196-4074-8140-207759575477')).toBe('call [phone hidden], match 88862915-9196-4074-8140-207759575477');
  });
  it('20 000 ids (uuids, OTP uids, team ids, dev uids) bare and in id fields: 0 corrupted by either mask', () => {
    let bad = 0;
    for (let i = 0; i < 5_000; i++) {
      const u = uuid();
      const o = `u_${hex(24)}`;
      for (const v of [u, o]) if (maskPii(v) !== v || maskPiiStored(v) !== v) bad++;
      const ids = { matchId: uuid(), teamId: `team_${[...mobile()].join(' ')}`, playerId: `dev_91${mobile()}`, challengeId: uuid() };
      const out = filterPii({ items: [{ ...ids, name: 'x' }], uid: ids.playerId, teamIds: [ids.teamId] }, '', true);
      for (const [k, v] of Object.entries(ids)) if ((out.items[0] as Record<string, string>)[k] !== v) bad++;
      if (out.uid !== ids.playerId || out.teamIds[0] !== ids.teamId) bad++;
    }
    expect(bad).toBe(0);
  });
});
