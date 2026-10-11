/**
 * Indian mobile numbers (the only kind VolleyLive accepts).
 *
 * - The UI shows a fixed "+91" and keeps just the 10 national digits (`sanitizePhoneInput`).
 * - A number is valid when those digits match ^[6-9]\d{9}$ (Indian mobiles start with 6-9).
 * - Numbers are stored and sent as E.164: "+91" + 10 digits, i.e. ^\+91[6-9]\d{9}$. The server
 *   (server/src/domain/schemas.ts) and firestore.rules enforce the same pattern on every write.
 *
 * Devanagari digits (०-९, typed on Hindi keyboards) are converted to 0-9 first. Any other
 * non-ASCII digit (full-width ０-９, Bengali, Arabic-Indic …) is rejected, as are letters and
 * emoji: they make the input invalid, they are never silently stripped. `\d` in JS is ASCII-only.
 */
export const COUNTRY_CODE = '91';
export const NATIONAL_LENGTH = 10;
export const MOBILE_RE = /^[6-9]\d{9}$/;
export const E164_IN_RE = /^\+91[6-9]\d{9}$/;
/** Same pattern as a string, for places that need source text (firestore.rules uses '^[+]91[6-9][0-9]{9}$'). */
export const E164_IN_PATTERN = '^\\+91[6-9]\\d{9}$';
/** Error code returned by the API for a bad phone field (HTTP 400). */
export const INVALID_PHONE_CODE = 'invalid_phone';
export const INVALID_PHONE_MESSAGE = 'Phone must be an Indian mobile number in E.164 format: +91 followed by 10 digits starting with 6-9';

/** Spaces (incl. no-break), dashes (incl. Unicode dashes), brackets and dots people paste between digits. */
const SEPARATORS = /[\s\u00A0\u2010-\u2015\u2212\-().[\]{}]/g;
/** Devanagari digits ०-९ (U+0966–U+096F) → ASCII 0-9. */
export const devanagariToAscii = (s: string) => s.replace(/[\u0966-\u096F]/g, (d) => String(d.charCodeAt(0) - 0x0966));
/** 1.3.9 (QA V138-8): fullwidth digits ０-９ and ＋ (CJK keyboards) → ASCII. Used by the as-you-type filter only. */
export const fullwidthToAscii = (s: string) => s.replace(/[\uFF10-\uFF19]/g, (d) => String(d.charCodeAt(0) - 0xff10)).replace(/\uFF0B/g, '+');

/**
 * Cleans typed or pasted text down to the national digits (at most 10), or returns null when the
 * text can't be a number we accept (letters, non-ASCII digits, another country code, more than
 * 10 digits). Input fields keep their previous value on null, so a bad paste changes nothing.
 *
 * Converts Devanagari digits, strips separators, then one leading "+91", "0091", "91" (only when exactly 10 digits remain)
 * or "0".
 */
export function sanitizePhoneInput(raw: string): string | null {
  if (typeof raw !== 'string') return null;
  let s = devanagariToAscii(raw).replace(SEPARATORS, '');
  if (s === '') return '';
  if (!/^\+?[0-9]*$/.test(s)) return null;
  if (s.startsWith('+')) {
    if (!s.startsWith('+' + COUNTRY_CODE)) return null; // +1, +44, +0091 …
    s = s.slice(1 + COUNTRY_CODE.length);
  } else if (s.startsWith('00' + COUNTRY_CODE)) {
    s = s.slice(2 + COUNTRY_CODE.length);
  } else if (s.startsWith('00')) {
    return null; // 00 + another country code
  } else if (s.startsWith(COUNTRY_CODE) && s.length === COUNTRY_CODE.length + NATIONAL_LENGTH) {
    s = s.slice(COUNTRY_CODE.length);
  } else if (s.startsWith('0')) {
    s = s.slice(1);
  }
  if (s.length > NATIONAL_LENGTH) return null;
  return s;
}

/**
 * The start of a country code being typed: "+", "+9", "+91", "00", "009", "0091" (separators
 * ignored). Not an error yet (QA N3): the field shows it and waits for the digits.
 */
export function isPartialPrefix(raw: string): boolean {
  if (typeof raw !== 'string') return false;
  const s = devanagariToAscii(raw).replace(SEPARATORS, '');
  return /^(\+(9(1)?)?|00(9(1)?)?)$/.test(s);
}

/** True for exactly 10 ASCII digits starting with 6-9. */
export const isValidMobile = (national: string): boolean => typeof national === 'string' && MOBILE_RE.test(national);

/** True for a stored/sent number: +91 followed by a valid mobile. */
export const isValidE164 = (phone: unknown): phone is string => typeof phone === 'string' && E164_IN_RE.test(phone);

/** Valid national digits → "+91XXXXXXXXXX", otherwise null. */
export const toE164 = (national: string): string | null => (isValidMobile(national) ? `+${COUNTRY_CODE}${national}` : null);

/** Any typed/pasted form → E.164, or null when it isn't a valid Indian mobile number. */
export function normalizePhone(input: string): string | null {
  const s = sanitizePhoneInput(input);
  return s === null ? null : toE164(s);
}

/**
 * Display form of a stored number (1.2.0 visual pass): "+919000000010" → "+91 90000 00010".
 * Storage and the API stay E.164; anything that isn't a valid Indian mobile is shown unchanged.
 */
export function formatPhone(e164: string | null | undefined): string {
  if (!e164) return '';
  if (!isValidE164(e164)) return e164;
  const n = e164.slice(3);
  return `+${COUNTRY_CODE} ${n.slice(0, 5)} ${n.slice(5)}`;
}

export function maskPhone(e164: string): string {
  if (e164.length < 6) return e164;
  return e164.slice(0, 3) + ' ' + '•'.repeat(Math.max(0, e164.length - 7)) + e164.slice(-4);
}

/** One digit (ASCII or Devanagari). */
const DIGIT_RE = /^[0-9\u0966-\u096F]$/;

/**
 * True when `raw` is `shown` with exactly one character inserted and that character is a digit:
 * a key press (or a one-character paste, which can't be told apart and behaves the same).
 */
export function isOneDigitTyped(shown: string, raw: string): boolean {
  if (raw.length !== shown.length + 1) return false;
  let i = 0;
  while (i < shown.length && raw[i] === shown[i]) i++;
  return DIGIT_RE.test(raw[i]) && raw.slice(0, i) + raw.slice(i + 1) === shown;
}

export interface PhoneFieldState {
  /** The national digits (at most 10). */
  value: string;
  /** Text shown instead of the value (a partly typed "+91", or refused text), or null. */
  display: string | null;
  /** Show the "enter a valid mobile" error for refused text. */
  rejected: boolean;
}

/**
 * The phone field's reaction to a change, the same on every platform (web, Android, iOS):
 *  - the digits never exceed 10: with 10 digits in the field, a further typed digit is ignored
 *    (field unchanged, no error), so typing digit by digit can never get past 10;
 *  - anything else (a paste, autofill, a typed separator) is cleaned first with
 *    sanitizePhoneInput; up to 10 digits are used as the value;
 *  - text that can't be cleaned to at most 10 digits (12 digits, letters, another country code)
 *    stays visible with the error so the user sees why, and the value keeps its last digits;
 *  - a country code being typed ("+", "+9", "+91") is shown with no error and no digits.
 */
export function nextPhoneField(cur: { value: string; display: string | null }, raw: string): PhoneFieldState {
  const shown = cur.display ?? cur.value;
  if (isPartialPrefix(raw)) return { value: '', display: raw, rejected: false };
  const next = sanitizePhoneInput(raw);
  if (next !== null) return { value: next, display: null, rejected: false };
  if (cur.display === null && cur.value.length >= NATIONAL_LENGTH && isOneDigitTyped(shown, raw)) {
    return { value: cur.value, display: null, rejected: false }; // 11th digit typed: ignored
  }
  return { value: cur.value, display: raw, rejected: true };
}

/**
 * QA B121-8 (1.3.1): the add-player field filters as you type. Like `nextPhoneField`, but anything
 * that isn't a digit (or a leading "+") is dropped instead of being kept on screen next to an error:
 * "98a" -> "98". Digits that still can't be a mobile after that (12 digits, another country code) are
 * shown as digits next to the usual error, so the user sees why. `dropped` is true when something was
 * removed (the field says "digits only").
 */
export function filterPhoneTyping(cur: { value: string; display: string | null }, raw: string): PhoneFieldState & { dropped: boolean } {
  const direct = nextPhoneField(cur, raw);
  if (!direct.rejected) return { ...direct, dropped: false };
  // 1.3.9 (V138-8): fullwidth digits are converted here too (the strict parsers still refuse them)
  const ascii = fullwidthToAscii(devanagariToAscii(raw));
  const stripped = (ascii.trimStart().startsWith('+') ? '+' : '') + ascii.replace(/[^0-9]/g, '');
  const next = nextPhoneField(cur, stripped);
  return { ...next, dropped: stripped !== raw };
}
