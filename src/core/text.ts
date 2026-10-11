/**
 * Name / free-text checks shared by the app, the API server and (as a regex) firestore.rules.
 *  - zero-width characters (ZWSP, ZWNJ, ZWJ, word joiner, BOM, soft hyphen) are removed;
 *  - control characters (C0/C1, incl. NUL) are rejected, except newline/tab in multi-line text;
 *  - bidi overrides/isolates/marks are rejected (they can make "\u202Eevil" display reversed);
 *  - text is NFC-normalised and trimmed; a required name needs at least one letter or digit,
 *    so "   " or "\u200B\u200B" or punctuation-only is empty.
 *  - invisible "filler" characters (Hangul fillers U+3164, U+FFA0, U+115F, U+1160, braille blank
 *    U+2800) are trimmed like spaces and don't count as a letter, so a name made only of them is
 *    empty; U+180E (Mongolian vowel separator) is removed like the zero-width characters
 *    (QA retest 217 #4);
 *  - trimming removes every JavaScript whitespace character (incl. no-break space U+00A0, line /
 *    paragraph separators U+2028/2029, ideographic space); firestore.rules reject the same set at
 *    the start or end (QA retest 217 #7);
 *  - lengths are counted in UTF-16 code units, exactly like the rules' string size() and the web
 *    inputs' maxLength, so an emoji counts 2 (QA retest 217 #6): nothing the app accepts can be
 *    refused by the rules for its length.
 * ZWJ/ZWNJ are also used in Devanagari conjuncts: in names (fields with min > 0) they are kept
 * between two Devanagari characters (1.3.9, V138-4) and removed anywhere else.
 * The full hidden-character list is HIDDEN_CHARS below (1.3.9, V138-4).
 */
import { LIMITS, type LimitKey, type TextLimit } from './limits';

/**
 * 1.3.9 (V138-4): THE hidden-character set, one list for every backend (app, demo, API server) and –
 * as hidden() in firestore.rules (rules-tests compare the two) – for feedback, facts and names:
 * C0 and C1 controls (U+0000–001F, U+007F–009F), soft hyphen U+00AD, Arabic letter mark U+061C,
 * Mongolian vowel separator U+180E, U+200B–200F (zero-width space/non-joiner/joiner, LRM, RLM),
 * line/paragraph separators U+2028/2029, bidi embeddings/overrides U+202A–202E, word joiner and
 * invisible operators U+2060–2064, bidi isolates U+2066–2069, BOM U+FEFF.
 * What happens to each (the three groups below cover the set exactly; a jest test checks it):
 *  - CONTROL_RE (C0/C1 except newline/tab, U+2028/2029): refused ('control'); multi-line text allows newline/tab;
 *  - BIDI_RE: refused ('bidi');
 *  - INVISIBLE_RE: removed – except ZWNJ/ZWJ between two Devanagari characters in a NAME (क्‍ष), where
 *    they shape a conjunct; anywhere else they are removed too.
 */
export const HIDDEN_CHARS = '\\u0000-\\u001F\\u007F-\\u009F\\u00AD\\u061C\\u180E\\u200B-\\u200F\\u2028\\u2029\\u202A-\\u202E\\u2060-\\u2064\\u2066-\\u2069\\uFEFF';
export const HIDDEN_RE = new RegExp(`[${HIDDEN_CHARS}]`);
/** Removes every hidden character; `multiline` keeps newline and tab (feedback text). */
export function stripHidden(raw: string, opts: { multiline?: boolean } = {}): string {
  const s = opts.multiline ? raw.replace(/\r\n?/g, '\n') : raw;
  return s.replace(new RegExp(`[${HIDDEN_CHARS}]`, 'g'), (c) => (opts.multiline && (c === '\n' || c === '\t') ? c : ''));
}
export const INVISIBLE_RE = /[\u00AD\u180E\u200B-\u200D\u2060-\u2064\uFEFF]/g;
const DEVANAGARI_RE = /[\u0900-\u097F]/;
const isDeva = (c: string | undefined) => !!c && DEVANAGARI_RE.test(c);
/** INVISIBLE_RE removed; in a name, ZWNJ/ZWJ directly between two Devanagari characters are kept. */
export function removeInvisible(raw: string, opts: { name?: boolean } = {}): string {
  const s = raw.replace(/[\u00AD\u180E\u200B\u2060-\u2064\uFEFF]/g, '');
  return s.replace(/[\u200C\u200D]/g, (c, i: number) => (opts.name && isDeva(s[i - 1]) && isDeva(s[i + 1]) ? c : ''));
}
/** Invisible characters that Unicode classes as letters/symbols: trimmed and never "visible". */
export const FILLER_CHARS = '\u115F\u1160\u3164\uFFA0\u2800';
const EDGE_RE = new RegExp(`^[\\s${FILLER_CHARS}]+|[\\s${FILLER_CHARS}]+$`, 'gu');
export const CONTROL_RE = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F\u2028\u2029]/;
export const NEWLINE_TAB_RE = /[\u0009\u000A]/;
export const BIDI_RE = /[\u200E\u200F\u061C\u202A-\u202E\u2066-\u2069]/;
/** A letter or digit that is not a filler. */
export const VISIBLE_RE = /\p{N}|(?![\u115F\u1160\u3164\uFFA0])\p{L}/u;

export type TextProblem = 'empty' | 'tooShort' | 'tooLong' | 'control' | 'bidi';

/**
 * NFC, without zero-width characters, trimmed of whitespace and fillers. What we store. `name`
 * (1.3.9, V138-4): ZWNJ/ZWJ between two Devanagari characters are kept (firestore.rules nameMatch).
 */
export function cleanText(raw: string, opts: { name?: boolean } = {}): string {
  return removeInvisible(raw.normalize('NFC'), opts).replace(EDGE_RE, '');
}

/**
 * QA B121-7: a typed or pasted value cut to `max` UTF-16 units (as maxLength would), with `cut` true
 * when something was dropped, so the field can say so instead of truncating silently. A surrogate
 * pair is never split.
 */
export function clampInput(raw: string, max: number): { value: string; cut: boolean } {
  if (raw.length <= max) return { value: raw, cut: false };
  let end = max;
  const c = raw.charCodeAt(end - 1);
  if (c >= 0xd800 && c <= 0xdbff) end -= 1;
  return { value: raw.slice(0, end), cut: true };
}

/** Length in UTF-16 code units, as firestore.rules size() and web maxLength (an emoji counts 2). */
export const textLength = (s: string) => s.length;

export function textProblem(raw: unknown, limit: TextLimit, opts: { multiline?: boolean } = {}): TextProblem | null {
  if (raw === undefined || raw === null) return limit.min > 0 ? 'empty' : null;
  if (typeof raw !== 'string') return 'empty';
  if (BIDI_RE.test(raw)) return 'bidi';
  // 1.3.9 (V138-4): U+2028/2029 are refused INSIDE the text; at the edges they are trimmed like other
  // spaces (cleanText), as before – so the check skips edge separators/spaces (not newline/tab/C0 controls)
  const inner = raw.replace(/^[\u2028\u2029\p{Zs}]+|[\u2028\u2029\p{Zs}]+$/gu, '');
  if (CONTROL_RE.test(inner) || (!opts.multiline && NEWLINE_TAB_RE.test(raw))) return 'control';
  // a required field (min > 0) is a name: firestore.rules checks it with nameRe/nameMatch
  const s = cleanText(raw, { name: limit.min > 0 });
  if (s === '') return limit.min > 0 ? 'empty' : null;
  if (limit.min > 0 && !VISIBLE_RE.test(s)) return 'empty';
  const n = textLength(s);
  if (n < limit.min) return 'tooShort';
  if (n > limit.max) return 'tooLong';
  return null;
}

export const fieldProblem = (raw: unknown, key: LimitKey, opts?: { multiline?: boolean }) => textProblem(raw, LIMITS[key], opts);

/** Error codes the server returns (HttpError code) and the app translates (i18n errors.*). */
export const TEXT_ERROR_CODES: Record<TextProblem, string> = {
  empty: 'text_empty',
  tooShort: 'text_too_short',
  tooLong: 'text_too_long',
  control: 'text_control',
  bidi: 'text_bidi',
};
