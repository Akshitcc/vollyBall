/**
 * PII mask for text meant for DISPLAY or the audit (Ask answers, card display strings, the audit question / tools text,
 * the stored chat-history question). Never run it over ids, routing params or keys – see `filterPii` in ask/tools.ts,
 * which skips id fields.
 *
 * 1.5.1 (F150-4) first version; 1.5.2 (Tester F151-4) rework:
 * - Matching runs on a NORMALISED copy: NFKC (full-width digits, ＋, ＠, NBSP), every Unicode decimal digit
 *   (Devanagari ९८…, Bengali, Arabic-Indic, …) → ASCII, format characters (zero-width, soft hyphen, …) removed, and
 *   spelled-out English digits. Matches are mapped back to the original text, so the rest of the text is unchanged.
 * - Phones: digit groups joined by spaces, dots, dashes (incl. – —), slashes and brackets, e.g. "+91 (98123) 45607".
 *   Phone-SHAPE rules (so set scores and number lists are kept): a group sequence counts as a phone when it is
 *   10 digits starting 6-9 (Indian mobile), or that with a 0 / 91 / 091 / 0091 prefix, or starts with + and has
 *   8-15 digits. A 1-digit group is never part of a phone (except a leading 0 or +country code), so "8-6 7-5 9-7 6-4 8-6" or
 *   "6 7 8 9 6 7 8 9 6 7" stay. A run glued to an ASCII letter or digit ("81f3-8196753097dd", hex ids) is not a phone.
 * - E-mails: Unicode / IDN local parts and domains ("rāhul@exämple.com", "राहुल@उदाहरण.भारत"), full-width ＠,
 *   spaces around @ and dots, a quoted local part, and "name [at] domain [dot] com".
 */
export const PHONE_MASK = '[phone hidden]';
export const EMAIL_MASK = '[email hidden]';

const DIGIT_WORDS: Record<string, string> = { zero: '0', oh: '0', one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8', nine: '9' };

/** Value of a Unicode decimal digit (\p{Nd}): its offset from the start of its run of ten. */
function digitValue(ch: string): string {
  let cp = ch.codePointAt(0)!;
  let n = 0;
  while (n < 9 && /\p{Nd}/u.test(String.fromCodePoint(cp - 1))) { cp--; n++; }
  // runs of decimal digits are blocks of ten (0-9); adjacent blocks (e.g. mathematical digits) are handled by %10
  return String(n % 10);
}

interface Norm { text: string; start: number[]; end: number[] }
/** Normalised copy of `s` plus, for every normalised UTF-16 unit, the original [start, end) it came from. */
export function normalizeForPii(s: string): Norm {
  let text = '';
  const start: number[] = [];
  const end: number[] = [];
  for (let i = 0; i < s.length; ) {
    const cp = s.codePointAt(i)!;
    const ch = String.fromCodePoint(cp);
    const len = ch.length;
    if (!/\p{Cf}/u.test(ch)) {
      let out = ch.normalize('NFKC');
      out = out.replace(/\p{Nd}/gu, (d) => (/[0-9]/.test(d) ? d : digitValue(d)));
      for (let k = 0; k < out.length; k++) { start.push(i); end.push(i + len); }
      text += out;
    }
    i += len;
  }
  // 1.5.2 (F152-2): "plus91…" / "plus 91…" written as a word = "+" (same length, so the index map stays valid)
  text = text.replace(/(?<![A-Za-z])plus(?=\s?\+?[0-9])/gi, '   +');
  return { text, start, end };
}

/** Does this digit string (with/without a leading +) have a phone shape? */
export function isPhoneShape(digits: string, plus: boolean): boolean {
  if (plus) return digits.length >= 8 && digits.length <= 15 && digits[0] !== '0';
  return /^(?:|0|91|091|0091)[6-9][0-9]{9}$/.test(digits);
}

// 1.5.6 (Tester F155-1): ONE grouped-phone detector with the same separator rule as single digits – digit groups
// joined by ANY run of characters that are neither letters nor digits ("98765|43210", "987#654#3210", "98765 • 43210",
// "+91·98765·43210", "98|76|54|32|10", "98765-43210", "(+91) 98123 45607" …). The separators are stripped, the digit
// total and phone shape are checked (10 digits starting 6-9, optional 0 / 91 / 091 / 0091 or + prefix). A 1-digit group
// is only allowed as a leading 0 / +CC (single-digit runs have their own pass below). Before detection, valid dates,
// times, IPv4 addresses and UUIDs are blanked, and score / time pair lines ("25-23, 25-20", "06:30, 07:45") are kept
// unless a phone cue comes right before them.
const RUN = /(?<![\p{L}\p{N}])[(\[{]?\+?[0-9]+(?:[^\p{L}\p{N}]+[0-9]+)*(?![\p{L}\p{N}])/gu;
const DATE_RE = /(?<![\p{L}\p{N}.\-\/])(?:(\d{1,2})[.\-\/](\d{1,2})[.\-\/]((?:19|20)\d\d)|((?:19|20)\d\d)[.\-\/](\d{1,2})[.\-\/](\d{1,2}))(?![\p{L}\p{N}]|[.\-\/]\d)/gu;
const TIME_RE = /(?<![\p{L}\p{N}:.])([01]?\d|2[0-3])[:.]([0-5]\d)(?::([0-5]\d))?(?![\p{L}\p{N}]|[:.]\d)/gu;
const IPV4_RE = /(?<![\p{L}\p{N}.])(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})(?![\p{L}\p{N}]|\.\d)/gu;
const blank = (t: string, re: RegExp, ok: (m: RegExpMatchArray) => boolean) => t.replace(re, (...args) => { const m = args.slice(0, -2) as unknown as RegExpMatchArray; return ok(m) ? 'x'.repeat(m[0].length) : m[0]; });
/** Same-length copy of `t` with dates, times, IPv4 addresses and UUIDs replaced by letters (they then end a digit run). */
function blankNonPhones(t: string): string {
  let u = blank(t, DATE_RE, (m) => { const d = +(m[1] ?? m[6]), mo = +(m[2] ?? m[5]); return d >= 1 && d <= 31 && mo >= 1 && mo <= 12 || (d >= 1 && d <= 12 && mo >= 1 && mo <= 31); });
  u = blank(u, TIME_RE, (m) => !!m[0]);
  u = blank(u, IPV4_RE, (m) => [m[1], m[2], m[3], m[4]].every((x) => +x <= 255));
  return u.replace(UUID_RE, (m) => 'x'.repeat(m.length));
}
/** Only IPv4 addresses and UUIDs blanked – used to catch a phone whose inner groups happen to look like a time / date. */
function blankIdsOnly(t: string): string {
  return blank(t, IPV4_RE, (m) => [m[1], m[2], m[3], m[4]].every((x) => +x <= 255)).replace(UUID_RE, (m) => 'x'.repeat(m.length));
}
/** "25-23, 25-20" / "8-6 5-7" / "06:30, 07:45" – score / time pairs: groups ≤ 2 digits, a pair sign and a gap alternating. */
function isPairLine(seps: string[], groups: string[]): boolean {
  return groups.length >= 4 && groups.length % 2 === 0 && groups.every((g) => g.length <= 2) &&
    seps.every((x, i) => (i % 2 === 0 ? /^\s?[-:/.\u2010-\u2015\u2212]\s?$/.test(x) : /^[\s,;|()\[\]]+$/.test(x)));
}
/** "Jersey 66 | 77 | 88 | 99 | 10", "Seeds 7, 8, 9, 10, 11" – a labelled list of ≤ 2-digit numbers with spaced separators. */
const LIST_WORD = /(?:jerseys?|shirts?|kits?|seeds?|seeding|players?|courts?|rall(?:y|ies)|rounds?|pools?|groups?|ranks?|ranking|standings|positions?|rotation|bibs?|lineup|roster|nums|numbers\s+(?:on|of)\s+(?:the\s+)?(?:jerseys?|shirts?|bibs?))\s*[:\-–]?\s*$/i;
function isNumberList(t: string, at: number, seps: string[], groups: string[]): boolean {
  return groups.length >= 5 && groups.every((g) => g.length <= 2) && seps.every((x) => /\s|,/.test(x)) &&
    LIST_WORD.test(t.slice(Math.max(0, at - 30), at));
}
// 1.5.7 (Tester F156-1): a 1-digit group may be part of a phone when the window also holds a group of 3+ digits
// ("9-876543210", "9.876.543.210", "987654321-0", "+91 9-876543210", "9-7 6-9 9-5 4321"); windows made only of
// 1- / 2-digit groups stay with the single-digit / score-line rules. A "+" only counts at the start of a run.
// 1.5.7 (F156-3 / F156-4): a phone cue BEFORE or AFTER the run ("… is my number", "call me …") overrides the
// pair-line / labelled-list / IPv4 / time / date exceptions: the un-blanked run is then masked when its digits are
// phone-shaped (or 0 + 9 digits).
function windowHits(groups: { s: number; e: number; d: string }[], plusAtStart: boolean): [number, number][] {
  const hits: [number, number][] = [];
  for (let i = 0; i < groups.length; ) {
    let hit = -1;
    let digits = '';
    let single = false;
    let long = false;
    for (let j = i; j < groups.length; j++) {
      const g = groups[j];
      digits += g.d;
      if (digits.length > 15) break;
      if (g.d.length === 1 && !(j === i && (g.d === '0' || (i === 0 && plusAtStart)))) single = true;
      if (g.d.length >= 3) long = true;
      if ((!single || long) && isPhoneShape(digits, i === 0 && plusAtStart)) hit = j;
    }
    if (hit >= 0) { hits.push([i, hit]); i = hit + 1; } else i++;
  }
  return hits;
}
const cuedShape = (d: string, plus: boolean) => isPhoneShape(d, plus) || /^0[6-9][0-9]{8}$/.test(d);
function phoneRanges(t: string): [number, number][] {
  const out: [number, number][] = [];
  const push = (s: number, e: number) => {
    if (/[(\[{]/.test(t[s - 1] ?? '')) s--; // "(+91) …"
    else if (t[s - 1] === '+') s--;
    if (/[)\]}]/.test(t[e] ?? '') && /[(\[{]/.test(t[s] ?? '')) e++;
    if (out.some(([a, b]) => a <= s && b >= e)) return;
    for (let k = out.length - 1; k >= 0; k--) if (out[k][0] >= s && out[k][1] <= e) out.splice(k, 1);
    out.push([s, e]);
  };
  const groupsOf = (run: string, at: number) => [...run.matchAll(/[0-9]+/g)].map((g) => ({ s: at + g.index!, e: at + g.index! + g[0].length, d: g[0] }));
  const u = blankNonPhones(t);
  for (const m of u.matchAll(RUN)) {
    const at = m.index!;
    const plus = /^[(\[{]?\+/.test(m[0]);
    const groups = groupsOf(m[0], at);
    const seps = groups.slice(1).map((g, k) => t.slice(groups[k].e, g.s));
    if ((isPairLine(seps, groups.map((g) => g.d)) || isNumberList(t, at, seps, groups.map((g) => g.d))) && !cueNear(t, at, at + m[0].length)) continue;
    for (const [i, j] of windowHits(groups, plus)) push(i === 0 && plus ? groups[0].s - 1 : groups[i].s, groups[j].e);
  }
  // second look: a WHOLE run that is exactly one phone ("9876 12:34 98") even though a part of it looks like a time /
  // date; and (1.5.7) any run next to a phone cue, with nothing blanked but UUIDs ("call me 98.212.143.21",
  // "Jersey 98 | 76 | 54 | 32 | 10 is my number", "09:87:65:43:21 – my number")
  const v = t.replace(UUID_RE, (x) => 'x'.repeat(x.length));
  const w = blankIdsOnly(t);
  for (const [src, cuedOnly] of [[w, false], [v, true]] as const) {
    for (const m of src.matchAll(RUN)) {
      const s0 = m.index!, e0 = s0 + m[0].length;
      const groups = groupsOf(m[0], s0);
      if (groups.length < 2) continue;
      const plus = /^[(\[{]?\+/.test(m[0]);
      const d = groups.map((g) => g.d).join('');
      const cued = cueNear(t, s0, e0);
      if (cuedOnly && !cued) continue;
      if (cued ? !cuedShape(d, plus) : !isPhoneShape(d, plus)) continue;
      if (!cued) {
        const single = groups.some((g, k) => g.d.length === 1 && !(k === 0 && (g.d === '0' || plus)));
        if (single && !groups.some((g) => g.d.length >= 3)) continue;
        const seps = groups.slice(1).map((g, k) => t.slice(groups[k].e, g.s));
        if (isPairLine(seps, groups.map((g) => g.d)) || isNumberList(t, s0, seps, groups.map((g) => g.d))) continue;
      }
      push(plus ? groups[0].s - 1 : groups[0].s, groups[groups.length - 1].e);
    }
  }
  return out;
}

const L = '[\\p{L}\\p{M}\\p{N}_%+\\-]';
const EMAIL = new RegExp(
  // a dot with spaces counts only as " . " (spaced-out address), so a sentence's ". Next" isn't taken as a domain part
  `(?:"[^"@\\n]{1,64}"|${L}+(?:\\.${L}+)*)\\s?@\\s?[\\p{L}\\p{M}\\p{N}\\-]+(?:(?:\\.|\\s\\.\\s)[\\p{L}\\p{M}\\p{N}\\-]+)*(?:\\.|\\s\\.\\s)[\\p{L}\\p{M}]{2,}(?![\\p{L}\\p{M}])`,
  'gu',
);
const EMAIL_OBF = /[\p{L}\p{N}._%+-]+\s*[[(]\s*at\s*[\])]\s*[\p{L}\p{N}-]+(?:\s*(?:[[(]\s*dot\s*[\])]|\.)\s*[\p{L}\p{N}-]+)+/giu;
const WORD_DIGITS = new RegExp(`\\b(?:plus\\s+)?(?:(?:${Object.keys(DIGIT_WORDS).join('|')})[\\s,-]+){7,14}(?:${Object.keys(DIGIT_WORDS).join('|')})\\b`, 'gi');

function wordPhoneRanges(t: string): [number, number][] {
  const out: [number, number][] = [];
  for (const m of t.matchAll(WORD_DIGITS)) {
    const plus = /^plus/i.test(m[0]);
    const digits = m[0].toLowerCase().split(/[\s,-]+/).filter((w) => w in DIGIT_WORDS).map((w) => DIGIT_WORDS[w]).join('');
    if (isPhoneShape(digits, plus)) out.push([m.index!, m.index! + m[0].length]);
  }
  return out;
}

// ---------- 1.5.3 (Tester F152-1 / F152-2): digit TOKEN runs ----------
// A run of whitespace-separated digit tokens: digit groups, a leading "+", and digit WORDS in English, Hindi and
// Hinglish ("nine", "double nine", "नौ", "nau", …). Hyphens / commas / colons end a run, so "8-6 7-5" and
// "6, 7, 8" are never one run.
const TOKEN_WORDS: Record<string, string> = {
  zero: '0', oh: '0', one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8', nine: '9',
  'शून्य': '0', 'सिफ़र': '0', 'सिफर': '0', 'एक': '1', 'दो': '2', 'तीन': '3', 'चार': '4', 'पाँच': '5', 'पांच': '5', 'छह': '6', 'छः': '6', 'छे': '6', 'सात': '7', 'आठ': '8', 'नौ': '9',
  shunya: '0', sunya: '0', sifar: '0', ek: '1', do: '2', teen: '3', tin: '3', char: '4', chaar: '4', 'chār': '4', paanch: '5', panch: '5', paach: '5', chhe: '6', chhah: '6', chah: '6', che: '6', cheh: '6', saat: '7', sat: '7', aath: '8', ath: '8', aat: '8', nau: '9', nao: '9',
};
const MULT: Record<string, number> = { double: 2, triple: 3, 'डबल': 2, 'ट्रिपल': 3 };
interface TokenRun { s: number; e: number; digits: string; plus: boolean; words: boolean; allSingle: boolean }
function tokenRuns(t: string): TokenRun[] {
  const runs: TokenRun[] = [];
  let cur: TokenRun | null = null;
  let mult = 1;
  let multAt = -1;
  const close = () => { if (cur && cur.digits.length) runs.push(cur); cur = null; mult = 1; };
  const toks = [...t.matchAll(/\S+/gu)];
  const coreOf = (raw: string) => raw.replace(/^[(\["'“‘]+/u, '').replace(/[)\]"'”’.,;:!?।]+$/u, '').toLocaleLowerCase();
  const isDigitTok = (c: string) => /^\+?[0-9]+$/.test(c) || (c !== 'no' && c in TOKEN_WORDS);
  for (let ti = 0; ti < toks.length; ti++) {
    const m = toks[ti];
    const raw = m[0];
    const core = raw.replace(/^[(\["'“‘]+/u, '').replace(/[)\]"'”’.,;:!?।]+$/u, '');
    const trailingStop = core !== raw.replace(/^[(\["'“‘]+/u, '');
    const low = core.toLocaleLowerCase();
    const at = m.index! + raw.indexOf(core);
    let d: string | null = null;
    let isWord = false;
    let plus = false;
    if (/^\+?[0-9]+$/.test(core)) { d = core.replace('+', ''); plus = core.startsWith('+'); }
    else if (core === '+') { plus = true; d = ''; }
    // 1.5.4 (Tester F153-2): Hinglish "no" (= nau) counts only INSIDE a digit-word run: next to a digit / digit word
    else if (low === 'no') { const nx = toks[ti + 1] ? coreOf(toks[ti + 1][0]) : ''; if ((cur && cur.digits.length) || isDigitTok(nx)) { d = '9'; isWord = true; } }
    else if (low in TOKEN_WORDS) { d = TOKEN_WORDS[low]; isWord = true; }
    else if (low in MULT) { mult = MULT[low]; multAt = at; if (!cur) cur = { s: at, e: at + core.length, digits: '', plus: false, words: true, allSingle: true }; continue; }
    if (d === null) { close(); continue; }
    if (mult > 1) { d = d.repeat(mult); mult = 1; }
    if (!cur) cur = { s: at, e: at + core.length, digits: '', plus, words: false, allSingle: true };
    else if (plus && cur.digits.length) { close(); cur = { s: at, e: at + core.length, digits: '', plus, words: false, allSingle: true }; }
    const lead = cur.digits === '';
    cur.digits += d;
    cur.e = at + core.length;
    if (isWord || multAt >= 0) cur.words = true;
    // a leading country / trunk prefix ("+91 9 8 1 …", "0091 9 8 …") doesn't stop a single-digit run
    if (!isWord && d.length > 1 && !(lead && /^(?:91|091|0091)$/.test(d))) cur.allSingle = false;
    multAt = -1;
    if (trailingStop) close();
  }
  close();
  return runs;
}
/** Display: a token run that is phone-SHAPED and made of single digits and/or digit words ("9 8 7 6 5 4 3 2 1 0", "nau aath …"). */
function tokenPhoneRanges(t: string): [number, number][] {
  return tokenRuns(t).filter((r) => (r.allSingle || r.words) && (isPhoneShape(r.digits, false) || (r.plus && /^91[6-9][0-9]{9}$/.test(r.digits)))).map((r) => [r.s, r.e]);
}
/** Stored history / audit: ANY run of 10+ digits made of single digits or containing digit words (best effort). */
function tokenStoredRanges(t: string): [number, number][] {
  return tokenRuns(t).filter((r) => r.digits.length >= 10 && (r.allSingle || r.words || isPhoneShape(r.digits, r.plus))).map((r) => [r.s, r.e]);
}

// ---------- 1.5.4 (F153-1) / 1.5.5 (Tester F154-1): single digits joined by ANY non-alphanumeric run ----------
// No separator allow-list: between two single digits any run of characters that are neither letters nor digits
// ("-", ".", "|", "#", "*", "~", "+", ";", "•", "·", "\", "'", "][", "}{", ") (", " - ", mixes …). Brackets around the
// first / last digit ("[9]", "{0}") are part of the run. Optional "+91" / "091" / "0091" / "+" prefix.
// Kept: set-score lines (a score sign and a gap alternating strictly, pair by pair), unless F154-2 says otherwise.
const SEPRUN = String.raw`[^\p{L}\p{N}]+`; // 1.5.6 (F155-2): any length ("9----------8…")
const OPEN = String.raw`[\[({<]?`;
const CLOSE = String.raw`[\])}>]?`;
const SINGLE_SEP_RUN = new RegExp(String.raw`(?<![\p{L}\p{N}+])((?:\+\s?)?(?:0{1,2}\s?)?9\s?1(?:${SEPRUN})?|\+\s?)?${OPEN}[0-9](?:${SEPRUN}[0-9]){9,}(?![\p{L}\p{N}])${CLOSE}`, 'gu');
interface SepRun { s: number; e: number; digits: string; plus: boolean; seps: string[] }
function sepRuns(t: string): SepRun[] {
  const out: SepRun[] = [];
  for (const m of t.matchAll(SINGLE_SEP_RUN)) {
    const all = m[0];
    const pre = m[1] ?? '';
    const body = all.slice(pre.length);
    const digits = pre.replace(/[^0-9]/g, '') + body.replace(/[^0-9]/g, '');
    const seps = body.split(/[0-9]/).slice(1, -1);
    out.push({ s: m.index!, e: m.index! + all.length, digits, plus: pre.includes('+'), seps });
  }
  return out;
}
/** "8-6 7-5 …" / "25:23, …" style: score sign, gap, score sign, gap … (even digit count, ≤ 5 sets = 10 digits). */
const isScoreLine = (r: SepRun) => !r.plus && r.digits.length % 2 === 0 && r.digits.length <= 10 && r.seps.every((x, i) => (i % 2 === 0 ? /^\s?[-:/\u2010-\u2015\u2212]\s?$/.test(x) : /^\s*,?\s*$/.test(x) && x.length > 0));
const commaOnly = (r: SepRun) => r.seps.every((x) => /^\s*,\s*$/.test(x));
const sepPhoneShaped = (r: SepRun) => isPhoneShape(r.digits, false) || (r.plus && /^91[6-9][0-9]{9}$/.test(r.digits));

// ---------- 1.5.5 (F154-2) / 1.5.6 (F155-2): five score pairs that spell a phone ----------
// "9-8 7-6 5-4 3-2 1-0" is masked when a phone cue comes shortly before it, or when it can't be a real match. A real
// match is played set by set: the side with more points wins the set, no set is played once a side has won the match
// (best of 3 / 5), the non-deciding sets share one points target (optionally with a point cap, win by 2) and the
// deciding set has its own target. Configurable; defaults below.
export const SCORE_LINE_RULES = { bestOf: [3, 5] as number[], maxTarget: 9, winBy: 2, allowCap: true };
const PHONE_CUE_WORD = String.raw`(?:number|numbr|nmbr|no\.|num|ph|ph\.|phone|fone|tel|tel\.|telephone|mobile|mob|cell|call|ring|dial|whatsapp|whats app|wa|contact|reach|text|sms|dm|msg|message|ping|nambar|numbar|nambr|नंबर|नम्बर|फोन|फ़ोन|मोबाइल|कॉल|संपर्क|व्हाट्सएप|मैसेज|मेसेज|डीएम|पिंग)`;
// cue + up to 6 filler words (no digits) right before the line: "ph", "tel:", "DM me", "msg me on", "ping me on",
// "call me later, …", "mera number hai", "मुझे मैसेज करो"
const PHONE_CUE = new RegExp(String.raw`(?:^|[^\p{L}\p{N}])${PHONE_CUE_WORD}(?:[^\p{L}\p{N}]+[\p{L}\p{M}']+){0,6}[^\p{L}\p{N}]*$`, 'iu');
const setOk = (hi: number, lo: number, P: number, C: number | null, winBy: number) =>
  hi !== lo && ((hi === P && lo <= P - winBy) || (hi > P && lo === hi - winBy && (C === null || hi <= C)) || (C !== null && hi === C && C > P && lo >= C - winBy + 1 && lo === C - 1));
function fitsOneTarget(sets: [number, number][], r = SCORE_LINE_RULES): boolean {
  if (!sets.length) return true;
  const caps: (number | null)[] = [null, ...(r.allowCap ? Array.from({ length: r.maxTarget }, (_, i) => i + 1) : [])];
  for (let P = 1; P <= r.maxTarget; P++) for (const C of caps) if (sets.every(([a, b]) => setOk(Math.max(a, b), Math.min(a, b), P, C, r.winBy))) return true;
  return false;
}
/** Could this single-digit line ("a-b c-d …", left side first) be a real match? */
export function reachableScoreLine(digits: string, r = SCORE_LINE_RULES): boolean {
  const sets: [number, number][] = [];
  for (let i = 0; i + 1 < digits.length; i += 2) sets.push([+digits[i], +digits[i + 1]]);
  for (const bo of r.bestOf) {
    const need = Math.ceil(bo / 2);
    if (sets.length > bo) continue;
    let wa = 0, wb = 0, ok = true;
    for (const [a, b] of sets) {
      if (a === b || wa === need || wb === need) { ok = false; break; } // a tie, or the match was already over
      if (a > b) wa++; else wb++;
    }
    if (!ok) continue;
    const decider = sets.length === bo ? sets.slice(-1) : [];
    const main = sets.length === bo ? sets.slice(0, -1) : sets;
    if (fitsOneTarget(main, r) && fitsOneTarget(decider, r)) return true;
  }
  return false;
}
const cueBefore = (t: string, s: number) => PHONE_CUE.test(t.slice(Math.max(0, s - 60), s));
// 1.5.7 (Tester F156-4): a cue AFTER the line counts too – "… is my number", "… call me", "… (whatsapp)", "… mera number
// hai", "… 👈 call": up to 3 filler words, then a cue word that is not the start of a longer word ("called")
const TRAIL_CUE = new RegExp(String.raw`^[^\p{L}\p{N}]*(?:[\p{L}\p{M}']+[^\p{L}\p{N}]+){0,3}${PHONE_CUE_WORD}(?![\p{L}\p{M}])(?!\s*(?:one|1|wan|of|two|2|plate|ones)(?![\p{L}\p{N}]))`, 'iu');
const cueAfter = (t: string, e: number) => TRAIL_CUE.test(t.slice(e, e + 50));
const cueNear = (t: string, s: number, e: number) => cueBefore(t, s) || cueAfter(t, e);
/** A score-shaped run that should still be masked (F154-2). */
const scorePairPhone = (t: string, r: SepRun) => r.digits.length === 10 && isPhoneShape(r.digits, false) && (cueNear(t, r.s, r.e) || !reachableScoreLine(r.digits));
/** Display: a phone-SHAPED single-digit run with any separators (score lines only when F154-2 applies). */
function sepPhoneRanges(t: string): [number, number][] {
  return sepRuns(t).filter((r) => (isScoreLine(r) ? scorePairPhone(t, r) : sepPhoneShaped(r))).map((r) => [r.s, r.e]);
}
/** Stored: any 10+ single-digit run (comma lists only when phone-shaped; score lines only when F154-2 applies). */
function sepStoredRanges(t: string): [number, number][] {
  return sepRuns(t).filter((r) => (isScoreLine(r) ? scorePairPhone(t, r) : commaOnly(r) ? sepPhoneShaped(r) : r.digits.length >= 10)).map((r) => [r.s, r.e]);
}
// 1.5.4 (Tester F153-1 Info): a phone hidden in a UUID-SHAPED display token – every other digit zero-padding
// ("00000000-0000-0000-0000-009812345678", "…-0000-919812345678"). Real UUIDs are never padded like that, so they stay.
function uuidPhoneRanges(t: string): [number, number][] {
  const out: [number, number][] = [];
  for (const m of t.matchAll(UUID_RE)) {
    const g = m[0].split('-');
    if (/^0+$/.test(g.slice(0, 4).join('')) && /^(?:0{2}[6-9][0-9]{9}|91[6-9][0-9]{9}|0{1,2}91[6-9][0-9]{7,8})$/.test(g[4]) && isPhoneShape(g[4].replace(/^0+/, ''), false)) out.push([m.index!, m.index! + m[0].length]);
  }
  return out;
}

/** Masks every phone number and e-mail address in display text `s`. */
export function maskPii(s: string): string {
  // 1.5.7 (Tester F156-1): display, bubble and response use EXACTLY the stored masker – no display-only gaps
  return maskWith(s, true);
}
/**
 * 1.5.3 (Tester F152-1 / F152-2): the copy the server KEEPS (ask_history question, ask_audit question / tools, the
 * history API): everything maskPii hides plus every run of 10+ spaced single digits or digit words, phone-shaped or not.
 */
export function maskPiiStored(s: string): string {
  return maskWith(s, true);
}
const UUID_RE = /(?<![0-9A-Za-z])[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?![0-9A-Za-z])/gi;
function maskWith(s: string, stored: boolean): string {
  if (!s) return s;
  const n = normalizeForPii(s);
  const t = n.text;
  const ranges: { s: number; e: number; mask: string }[] = [];
  const add = (rs: Iterable<[number, number]>, mask: string) => {
    for (const [a, b] of rs) {
      if (b <= a) continue;
      let st = n.start[a];
      // a "plus" word read as "+" (F152-2): hide the whole word, not just its last letter
      if (/^plus$/i.test(s.slice(st - 3, st + 1))) st -= 3;
      else { const m = /plus\s?\+?$/i.exec(s.slice(Math.max(0, st - 6), st)); if (m) st -= m[0].length; }
      ranges.push({ s: st, e: n.end[b - 1], mask });
    }
  };
  add([...t.matchAll(EMAIL)].map((m) => [m.index!, m.index! + m[0].length] as [number, number]), EMAIL_MASK);
  add([...t.matchAll(EMAIL_OBF)].map((m) => [m.index!, m.index! + m[0].length] as [number, number]), EMAIL_MASK);
  // 1.5.3: a UUID (8-4-4-4-12 hex) is an id even in display text / routes – an all-digit one can hold a phone-shaped
  // middle ("…-9196-4074-8140-…" = 91 + 9640748140); found by the Tester's fuzz59 run on the local build
  const ids = [...t.matchAll(UUID_RE)].map((m) => [m.index!, m.index! + m[0].length] as [number, number]);
  const notInId = (rs: [number, number][]) => rs.filter(([a, b]) => !ids.some(([x, y]) => a < y && b > x));
  add(notInId(phoneRanges(t)), PHONE_MASK);
  add(notInId(wordPhoneRanges(t)), PHONE_MASK);
  add(notInId(tokenPhoneRanges(t)), PHONE_MASK);
  if (stored) add(notInId(tokenStoredRanges(t)), PHONE_MASK);
  add(notInId(sepPhoneRanges(t)), PHONE_MASK);
  if (stored) add(notInId(sepStoredRanges(t)), PHONE_MASK);
  add(uuidPhoneRanges(t), PHONE_MASK); // display tokens only – filterPii never passes id fields here
  if (!ranges.length) return s;
  ranges.sort((a, b) => a.s - b.s || b.e - a.e);
  let out = '';
  let pos = 0;
  for (const r of ranges) {
    if (r.s < pos) { // overlaps the previous mask (an e-mail with digits in it): extend
      if (r.e > pos) pos = r.e;
      continue;
    }
    out += s.slice(pos, r.s) + r.mask;
    pos = r.e;
  }
  return out + s.slice(pos);
}

/** True if `s` contains something maskPii would hide. */
export const hasPii = (s: string): boolean => maskPii(s) !== s;
