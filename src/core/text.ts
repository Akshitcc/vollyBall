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
 * ZWJ/ZWNJ are also used in Devanagari conjuncts; removing them only changes the rendering of a
 * few ligatures, never the letters, so it is safe for Hindi names.
 */
import { LIMITS, type LimitKey, type TextLimit } from './limits';

export const INVISIBLE_RE = /[\u200B-\u200D\u2060\uFEFF\u00AD\u180E]/g;
/** Invisible characters that Unicode classes as letters/symbols: trimmed and never "visible". */
export const FILLER_CHARS = '\u115F\u1160\u3164\uFFA0\u2800';
const EDGE_RE = new RegExp(`^[\\s${FILLER_CHARS}]+|[\\s${FILLER_CHARS}]+$`, 'gu');
export const CONTROL_RE = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/;
export const NEWLINE_TAB_RE = /[\u0009\u000A]/;
export const BIDI_RE = /[\u200E\u200F\u061C\u202A-\u202E\u2066-\u2069]/;
/** A letter or digit that is not a filler. */
export const VISIBLE_RE = /\p{N}|(?![\u115F\u1160\u3164\uFFA0])\p{L}/u;

export type TextProblem = 'empty' | 'tooShort' | 'tooLong' | 'control' | 'bidi';

/** NFC, without zero-width characters, trimmed of whitespace and fillers. What we store. */
export function cleanText(raw: string): string {
  return raw.normalize('NFC').replace(INVISIBLE_RE, '').replace(EDGE_RE, '');
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
  if (CONTROL_RE.test(raw) || (!opts.multiline && NEWLINE_TAB_RE.test(raw))) return 'control';
  const s = cleanText(raw);
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
