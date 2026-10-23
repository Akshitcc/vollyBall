/**
 * 1.5.2 (Tester F151-4): the reworked PII masker – the Tester's v58 leak / keep lists, property + fuzz tests over random
 * ids (0 corrupted), random phone formats (all masked) and score / number lists (all kept), and filterPii leaving id
 * fields alone.
 */
import { maskPii, normalizeForPii, isPhoneShape, reachableScoreLine } from '../pii';
import { filterPii, ID_KEY } from '../ask/tools';
import { sourceOf } from '../ask';

// deterministic PRNG (mulberry32)
function rng(seed: number) {
  return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const R = rng(152);
const pick = <T,>(a: readonly T[]) => a[Math.floor(R() * a.length)];
const hex = (n: number) => Array.from({ length: n }, () => '0123456789abcdef'[Math.floor(R() * 16)]).join('');
const uuid = () => `${hex(8)}-${hex(4)}-4${hex(3)}-${pick(['8', '9', 'a', 'b'])}${hex(3)}-${hex(12)}`;
const digits = (n: number) => Array.from({ length: n }, () => String(Math.floor(R() * 10))).join('');
const HIDDEN = /\[(phone|email) hidden\]/;

// 1.5.5 (F154-2): five single-digit score pairs that spell a phone and can't be a real match are masked by rule
const pairPhone = (sets: string[]) => { const d = sets.join('').replace(/[^0-9]/g, ''); return sets.length === 5 && d.length === 10 && isPhoneShape(d, false) && !reachableScoreLine(d); };

const POS: string[] = [
  'My number is +919812345678 ok', 'call 919812345678 now', 'call 09812345678', 'call 098123 45678', 'call 091-9812345678', 'call 091 98123 45678',
  'call 0091 98123 45678', '00919812345678', '+91 98123 45678', '+91-98123-45678', '98.123.456.78', '+91.98123.45678', '98 12 34 56 78',
  '(+91) 98123 45678', '(91) 9812345678', '(981) 234-5678', '+91 (98123) 45678', '+91 - 98123 45678', '98123  45678', '98123/45678', '9812345678',
  'मेरा नंबर ९८१२३४५६७८ है', '+९१ ९८१२३ ४५६७८', '９８１２３４５６７８', '＋９１９８１２３４５６７８', '98123\u200b45678', '9\u200d8\u200d1\u200d2\u200d3\u200d4\u200d5\u200d6\u200d7\u200d8',
  '+91\u200c9812345678', '98123\u00ad45678', '+91\u00a098123\u00a045678', '98123–45678', '98123—45678', '+91 22 2345 6789', '+1 415 555 0134',
  'nine eight one two three four five six seven eight', '98१२३45678', '৯৮১২৩৪৫৬৭৮', 'mail me at rohan.k@example.com', 'rohan+volley@gmail.com',
  'rāhul@example.com', 'rahul@exämple.com', 'राहुल@उदाहरण.भारत', 'rohan @ example . com', 'ROHAN@EXAMPLE.IN', 'a_b-c@mail.co.uk', 'rohan＠example.com',
  'ro\u200bhan@exa\u200bmple.com', 'rohan [at] example [dot] com', '"rohan k"@example.com', 'Call ९८१२३४५६३१ XI', 'Call ９８１２３４５６３２',
];
const NEG: string[] = [
  'Final 25-23 25-20 15-13', 'Sets 25-23, 23-25, 15-12', 'Score was 2-1 (15-12 11-15 11-8)', 'Match on 2026-10-21 at 18:30', '21/10/2026', '21.10.2026 18:30',
  'timestamp 1729500000000', 'pincode 400049', 'Born 1996-04-12', 'team won 3 matches 7 days ago', 'rally 9 8 7', 'set scores 8-6 5-7 9-7 6-8 8-6',
  // 1.5.3 (Tester F152-1): 'points 6 7 8 9 6 7 8 9 6 7' moved out – 10 spaced single digits starting 6-9 are phone-SHAPED
  // and are now masked by rule (see pii153.test.ts); since 1.5.4 phone-shaped comma lists too (pii154.test.ts); shorter lists stay.
  'points 6 7 8 9 6 7 8 9 6', 'id 7f3a9c12-8b4e', 'version 1.5.1 build 46', 'rank #9 of 1234567890 players? no', 'price ₹9,812,345', 'order 9812-3456',
  '2026 10 21 18 30 00', '15–13 15–11', 'max 12 players and 6 subs', 'Juhu Chargers 25 - 23 Bandra 25 - 20', 'सेट २५-२३ २५-२०', 'u_8196753097ab12cd34ef5678',
  'e39eaa5c-4ad9-4fbf-81f3-8196753097dd', '70901100-48f2-4fbf-81f3-8196753097dd', 'Mark Fernandes stats',
];

describe('F151-4: the Tester\'s v58 lists', () => {
  it.each(POS)('masks %j', (s) => {
    const m = maskPii(s);
    expect(m).toMatch(HIDDEN);
    expect(m.replace(/\[phone hidden\]/g, '')).not.toMatch(/\d{4}/);
    expect(normalizeForPii(m).text.replace(/\[(phone|email) hidden\]/g, '')).not.toMatch(/[0-9]{4}|@|\[at\]/);
  });
  it.each(NEG)('keeps %j', (s) => expect(maskPii(s)).toBe(s));
  it('only the PII span changes – the rest of the text (incl. other Devanagari digits) is kept as written', () => {
    expect(maskPii('सेट ३-१ से जीते, नंबर ९८१२३४५६७८ पर कॉल करें')).toBe('सेट ३-१ से जीते, नंबर [phone hidden] पर कॉल करें');
    expect(maskPii('call 98123\u200b45678 now')).toBe('call [phone hidden] now');
    // an e-mail at the end of a sentence doesn't swallow the next word
    expect(maskPii('mail desk＠example.com. Example line: 8-6 5-7 9-7 6-8 8-6')).toBe('mail [email hidden]. Example line: 8-6 5-7 9-7 6-8 8-6');
    expect(maskPii('write to a@b.co. Thanks')).toBe('write to [email hidden]. Thanks');
    expect(maskPii('मेल rāhul@exämple.com। धन्यवाद')).toBe('मेल [email hidden]। धन्यवाद');
  });
  it('phone-shape rule', () => {
    expect(isPhoneShape('9812345678', false)).toBe(true);
    expect(isPhoneShape('5812345678', false)).toBe(false); // Indian mobiles start 6-9
    expect(isPhoneShape('09812345678', false)).toBe(true);
    expect(isPhoneShape('919812345678', false)).toBe(true);
    expect(isPhoneShape('8675976486', false)).toBe(true); // shape alone – the 1-digit-group rule keeps set scores
    expect(isPhoneShape('14155550134', true)).toBe(true);
  });
});

describe('F151-4: property / fuzz', () => {
  it('20 000 random uuids and OTP user ids: 0 corrupted by maskPii', () => {
    let bad = 0;
    for (let i = 0; i < 10_000; i++) {
      const u = uuid();
      const o = `u_${hex(24)}`;
      if (maskPii(u) !== u) bad++;
      if (maskPii(o) !== o) bad++;
    }
    expect(bad).toBe(0);
  });
  it('20 000 random ids in card id fields: 0 corrupted by filterPii (even phone-looking ones)', () => {
    let bad = 0;
    for (let i = 0; i < 5_000; i++) {
      const ids = { matchId: uuid(), teamId: `team_${digits(10)}`, tournamentId: uuid(), playerId: `dev_+91${pick(['9', '8', '7'])}${digits(9)}` };
      const card = { type: 'fixtures', title: 'x', items: [{ id: ids.matchId, ...ids, label: 'Group A', home: 'A', away: 'B', status: 'finished' }], uid: ids.playerId, teamIds: [ids.teamId] };
      const out = filterPii(card) as typeof card;
      const it0 = out.items[0] as unknown as Record<string, string>;
      for (const [k, v] of Object.entries(ids)) if (it0[k] !== v) bad++;
      if (it0.id !== ids.matchId || out.uid !== ids.playerId || out.teamIds[0] !== ids.teamId) bad++;
    }
    expect(bad).toBe(0);
  });
  const SEPS = [' ', '-', '.', '/', '–', '  ', ' - ', '\u00a0', '\u200b', ''];
  const SCRIPTS = [0x30, 0x966, 0xff10, 0x9e6, 0x660]; // ASCII, Devanagari, full-width, Bengali, Arabic-Indic
  const inScript = (s: string, z: number) => s.replace(/[0-9]/g, (d) => String.fromCodePoint(z + Number(d)));
  it('5 000 random Indian mobiles in random formats / digit scripts / prefixes: all masked, nothing left over', () => {
    const leaks: string[] = [];
    for (let i = 0; i < 5_000; i++) {
      const n = pick(['6', '7', '8', '9']) + digits(9);
      const sep = pick(SEPS);
      const split = pick([[5, 5], [3, 3, 4], [2, 2, 2, 2, 2], [4, 3, 3], [10]]);
      let k = 0;
      const body = split.map((len) => { const p = n.slice(k, k + len); k += len; return p; }).join(sep);
      const pre = pick(['', '+91 ', '+91', '0', '0091 ', '91 ', '(+91) ', '+91-']);
      const grouped = pick([body, `(${n.slice(0, 5)}) ${n.slice(5)}`]);
      const phone = inScript(pre + grouped, pick(SCRIPTS));
      const text = `${pick(['call me on', 'मेरा नंबर', 'number:', 'Team', 'reach'])} ${phone} ${pick(['today', 'है', 'XI', 'ok'])}`;
      const m = maskPii(text);
      if (!HIDDEN.test(m) || /[0-9]{3}/.test(normalizeForPii(m.replace(/\[phone hidden\]/g, '')).text)) leaks.push(`${JSON.stringify(text)} → ${m}`);
    }
    expect(leaks).toEqual([]);
  });
  it('5 000 random volleyball score lines / number lists: all kept', () => {
    const changed: string[] = [];
    for (let i = 0; i < 5_000; i++) {
      const sets = Array.from({ length: 2 + Math.floor(R() * 4) }, () => { const w = pick([25, 15, 21, 11, 8, 7, 9, 6]); const l = Math.max(0, w - 2 - Math.floor(R() * 10)); return `${w}${pick(['-', '–', ':'])}${l}`; });
      const ds = Array.from({ length: 3 + Math.floor(R() * 10) }, () => String(Math.floor(R() * 10)));
      const sep = pick([' ', ', ']);
      const list = ds.join(sep);
      // 1.5.3 (Tester F152-1) / 1.5.4 (F153-1): a space- OR comma-separated single-digit list that is phone-SHAPED is
      // masked by rule (both directions are checked in pii153/pii154.test.ts); everything else here must stay
      // 1.5.7 (F156-1): display = stored, so a 10+ space-separated single-digit list is masked too
      if (isPhoneShape(ds.join(''), false) || (sep === ' ' && ds.length >= 10)) { if (!HIDDEN.test(maskPii(`points ${list}`))) changed.push(`not masked: ${list}`); }
      else if (maskPii(`points ${list}`) !== `points ${list}`) changed.push(`points ${list}`);
      for (const s of [`Final ${sets.join(' ')}`, `set scores ${sets.join(', ')}`]) if (pairPhone(sets) ? !HIDDEN.test(maskPii(s)) : maskPii(s) !== s) changed.push(s);
    }
    expect(changed).toEqual([]);
  });
});

describe('F151-4: display text only', () => {
  it('ID_KEY covers ids and routing params, not display fields', () => {
    for (const k of ['id', 'uid', 'matchId', 'teamId', 'tournamentId', 'playerId', 'challengeId', 'teamIds', 'route', 'params', 'user_id']) expect(ID_KEY.test(k)).toBe(true);
    for (const k of ['name', 'title', 'label', 'home', 'away', 'subtitle', 'value', 'answer', 'champion']) expect(ID_KEY.test(k)).toBe(false);
  });
  it('team names (display) are masked; the team id stays', () => {
    const card = { type: 'roster', teamId: 'team_9812345678', name: 'Call ९८१२३४५६३१ XI', color: '#123456', players: [{ id: 'dev_+919812345678', name: 'Riya', captain: true, sub: false }] };
    const out = filterPii(card);
    expect(out.teamId).toBe('team_9812345678');
    expect(out.players[0].id).toBe('dev_+919812345678');
    expect(out.name).toBe('Call [phone hidden] XI');
  });
  it('an admin-written source title is masked; its id / url are not', () => {
    const s = sourceOf({ id: 'custom:desk-9812345678:en#0', kind: 'custom', lang: 'en', title: 'Desk ９８１２３４５６２０', text: 'x', url: '/help' } as never);
    expect(s.title).toBe('Desk [phone hidden]');
    expect(s.id).toBe('custom:desk-9812345678');
  });
});
