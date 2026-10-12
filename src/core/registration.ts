/**
 * 1.3.6 registration fields, shared by the app, the demo backend and the API server:
 * first/last name, date of birth (age from it, in IST), optional email, Indian pincode.
 * Errors are CodedErrors (field + code), translated by i18n/format.
 */
import { CodedError } from './codedError';
import { HIDDEN_CHARS, HIDDEN_RE } from './text';
import { EMAIL_LETTERS } from './emailChars';
import { EMAIL_JOIN_RE, EMAIL_LETTERS_WIDE } from './emailCharsWide';
import { EMAIL_WIDE_ACTIVE } from './emailPolicy';

export const NAME_MIN = 2;
export const NAME_MAX = 40;
export const DEFAULT_MIN_AGE = 10;
export const MAX_AGE = 100;
export const PINCODE_RE = /^[1-9][0-9]{5}$/;
export const EMAIL_MAX = 254;
export const EMAIL_LOCAL_MAX = 64;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
/** 1.3.7 (R136-9): control, zero-width, soft-hyphen, bidi and BOM characters are never part of an address. */
const EMAIL_BAD_CHARS = HIDDEN_RE; // 1.3.9 (V138-4): the shared set (core/text.ts)
/**
 * 1.4.2 (QA V141-5): invisible characters that look like nothing in an address – every Unicode
 * Default_Ignorable_Code_Point (Hangul fillers U+115F/U+1160/U+3164/U+FFA0, combining grapheme joiner U+034F,
 * zero-width and bidi format characters, variation selectors, tags…) plus the Braille blank U+2800. Listed as
 * ranges (Unicode 15 DerivedCoreProperties.txt), the same list as firestore.rules registrationOk.
 */
export const EMAIL_INVISIBLE_RE =
  /[\u00AD\u034F\u061C\u115F\u1160\u17B4\u17B5\u180B-\u180F\u200B-\u200F\u202A-\u202E\u2060-\u206F\u2800\u3164\uFE00-\uFE0F\uFEFF\uFFA0\uFFF0-\uFFF8]|\uD82F[\uDCA0-\uDCA3]|\uD834[\uDD73-\uDD7A]|[\uDB40-\uDB43][\uDC00-\uDFFF]/;
/**
 * Latin (incl. accented, no × ÷) and Devanagari letters/marks (no digits or dandas), space, apostrophe,
 * hyphen; 1.3.7 (R136-10): ZWNJ/ZWJ (U+200C/U+200D) only between two Devanagari characters.
 */
/**
 * 1.4.3 (QA V142-5/V142-6): an ALLOW list instead of more deny lists. After folding, an address may only contain
 * ASCII lower-case letters, digits and the RFC 5322 "atext" signs in the local part (! # $ % & ' * + - / = ? ^ _ `
 * { | } ~ and dots), letters, digits, hyphens and dots in the domain, plus the vetted letters of
 * core/emailChars.ts (lower-case Latin/Greek/Cyrillic, Indian scripts). Every format (Cf – U+FFF9–FFFB, U+0600–0605,
 * U+13430…), control, private-use, unassigned and separator character is outside it. firestore.rules uses the same
 * class (rules-tests compare them), so Firebase never refuses an address the app accepted.
 */
const allowedRe = (l: string) => new RegExp(`^[-a-z0-9!#$%&'*+/=?^_\`{|}~.${l}]+@[-a-z0-9.${l}]+\\.[-a-z0-9${l}]{2,}$`);
/** The 1.4.3 list (always this list unless emailPolicy.ts switches the wider one on). */
export const EMAIL_ALLOWED_NARROW_RE = allowedRe(EMAIL_LETTERS);
/** 1.4.4 (QA V143-6): the prepared wider list (+ ZWNJ/ZWJ, which EMAIL_JOIN_RE then restricts). Inactive in 1.4.4. */
export const EMAIL_ALLOWED_WIDE_RE = allowedRe(`${EMAIL_LETTERS_WIDE}\u200C\u200D`);
/** The ACTIVE list (core/emailPolicy.ts EMAIL_WIDE_ACTIVE; the 1.4.3 list in 1.4.4). */
export const EMAIL_ALLOWED_RE = EMAIL_WIDE_ACTIVE ? EMAIL_ALLOWED_WIDE_RE : EMAIL_ALLOWED_NARROW_RE;
const NAME_CHARS = /^[A-Za-z\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u024F\u0900-\u0963\u0971-\u097F\u200C\u200D' \-\u2019]+$/;
const ZW_MISPLACED = /(^|[^\u0900-\u097F])[\u200C\u200D]|[\u200C\u200D]($|[^\u0900-\u097F])/;
/** A name starts with a letter (not a vowel sign or punctuation). */
const NAME_START = /^[A-Za-z\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u024F\u0904-\u0939\u0950\u0958-\u0961\u0972-\u097F]/;
const DOB_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export type RegField = 'firstName' | 'lastName' | 'dob' | 'email' | 'pincode';
export const regError = (code: string, field: RegField, extra: Record<string, unknown> = {}) =>
  Object.assign(new CodedError(code, `Invalid ${field} (${code})`), { field, ...extra });

/** Trim, collapse inner spaces; throws name_empty / name_length / name_chars. */
export function checkPersonName(raw: unknown, field: 'firstName' | 'lastName'): string {
  const s = String(raw ?? '').normalize('NFC').trim().replace(/\s+/g, ' ');
  if (!s) throw regError('name_empty', field);
  // 1.3.7 (R136-18): emoji / symbols / digits say "letters only" first (a lone emoji used to get the
  // length message); then the length; then the separator rules.
  if (!NAME_CHARS.test(s)) throw regError('name_chars', field);
  const len = [...s].length;
  if (len < NAME_MIN || len > NAME_MAX) throw regError('name_length', field, { min: NAME_MIN, max: NAME_MAX });
  if (!NAME_START.test(s) || /['\-\u2019 ]{2,}/.test(s) || /['\-\u2019]$/.test(s)
    || ZW_MISPLACED.test(s) || /[\u200C\u200D]{2,}/.test(s) || /\u094D{2,}/.test(s)) throw regError('name_chars', field);
  return s;
}

/** Today's calendar date in India (UTC+5:30, no DST) as YYYY-MM-DD. */
export function todayIST(now = Date.now()): string {
  return new Date(now + 330 * 60_000).toISOString().slice(0, 10);
}

/** A real calendar date (rejects 2023-02-29, 2024-13-01 …). */
export function isRealDate(ymd: string): boolean {
  const m = DOB_RE.exec(ymd);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return y >= 1900 && dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

/** Whole years from dob to `today` (both YYYY-MM-DD). A 29 Feb birthday is reached on 1 Mar in other years. */
export function ageOn(dob: string, today: string): number {
  const [y1, m1, d1] = dob.split('-').map(Number);
  const [y2, m2, d2] = today.split('-').map(Number);
  return y2 - y1 - (m2 < m1 || (m2 === m1 && d2 < d1) ? 1 : 0);
}

export function ageFromDob(dob: string, now = Date.now()): number | null {
  return isRealDate(dob) ? ageOn(dob, todayIST(now)) : null;
}

/**
 * Throws dob_invalid / dob_future / age_too_young / age_too_old. `checkAge: false` (1.3.7, R136-8) only
 * requires a real past date: a saved DOB that has since left the range (turned 101, or MIN_AGE raised)
 * doesn't lock the user out of their own profile.
 */
export function checkDob(raw: unknown, minAge = DEFAULT_MIN_AGE, now = Date.now(), checkAge = true): string {
  const s = String(raw ?? '').trim();
  if (!isRealDate(s)) throw regError('dob_invalid', 'dob');
  const today = todayIST(now);
  if (s >= today) throw regError('dob_future', 'dob');
  if (!checkAge) return s;
  const age = ageOn(s, today);
  if (age < minAge) throw regError('age_too_young', 'dob', { min: minAge });
  if (age > MAX_AGE) throw regError('age_too_old', 'dob', { max: MAX_AGE });
  return s;
}

/**
 * 1.4.1 (QA V140-4): characters whose lower case is not their case fold (Unicode CaseFolding.txt, status C,
 * single character): JS toLowerCase keeps final sigma ς, so ΟΔΟΣ@ (→ οδος@) and οδοσ@ were two accounts.
 * Only these simple folds – NOT the full ones (ß stays ß: straße@ ≠ strasse@, as the API index compares).
 */
const CASE_FOLD: Readonly<Record<string, string>> = Object.freeze({
  '\u03C2': '\u03C3', // ς → σ (final sigma)
  '\u017F': 's', // ſ long s
  '\u00B5': '\u03BC', // µ micro sign → μ
  '\u03D0': '\u03B2', '\u03D1': '\u03B8', '\u03D5': '\u03C6', '\u03D6': '\u03C0', // ϐ ϑ ϕ ϖ
  '\u03F0': '\u03BA', '\u03F1': '\u03C1', '\u03F5': '\u03B5', // ϰ ϱ ϵ
  '\u1E9B': '\u1E61', // ẛ → ṡ
  '\u1FBE': '\u03B9', // ι prosgegrammeni → ι
  '\u0345': '\u03B9', // 1.4.2 (QA info): combining ypogegrammeni → ι
});
const CASE_FOLD_RE = /[\u03C2\u017F\u00B5\u03D0\u03D1\u03D5\u03D6\u03F0\u03F1\u03F5\u1E9B\u1FBE\u0345]/g;

/**
 * The one form every backend validates, compares and stores: NFC, trimmed, lower-cased, case-folded, NFC.
 * 1.4.0 (QA V139-2): NFC first (e + U+0301 is the same address as é), again after lower-casing (which can
 * decompose, e.g. İ → i̇). 1.4.1 (V140-4): plus the simple case folds above.
 */
export function emailFold(raw: string): string {
  return raw.normalize('NFC').trim().toLowerCase().replace(CASE_FOLD_RE, (c) => CASE_FOLD[c] ?? c).normalize('NFC');
}

/**
 * Optional: '' / null → null; otherwise a plausible address, NFC, trimmed and lower-cased (1.3.7, R136-9:
 * no control/zero-width characters, local part ≤ 64, no leading/trailing/double dots).
 */
export function checkEmail(raw: unknown, wide: boolean = EMAIL_WIDE_ACTIVE): string | null {
  // 1.4.0 (QA V139-2) / 1.4.1 (V140-4): emailFold, so every backend validates, compares and stores one form.
  const s = emailFold(String(raw ?? ''));
  if (!s) return null;
  const local = s.slice(0, s.lastIndexOf('@'));
  const domain = s.slice(s.lastIndexOf('@') + 1);
  // 1.4.4 (QA V143-6, wider list only – inactive in 1.4.4): ZWNJ/ZWJ between two letters of one Indic script are
  // part of the word; the invisible-character checks below then look at the address without them. Anywhere
  // else they stay invisible characters (email_invalid).
  const t = wide && EMAIL_JOIN_RE.test(s) ? s.replace(/[\u200C\u200D]/g, '') : s;
  // 1.4.1 (V140-6): a letter that is still upper/title case after folding (e.g. ℂ, which has no lower case)
  // is refused, as firestore.rules refuses it. 1.4.4 (QA V143-10): no domain label starts or ends with '-'
  // (firestore.rules emailPartsOk makes the same checks).
  if (s.length > EMAIL_MAX || !EMAIL_RE.test(s) || EMAIL_BAD_CHARS.test(t) || EMAIL_INVISIBLE_RE.test(t) || /[\p{Lu}\p{Lt}]/u.test(s) || local.length > EMAIL_LOCAL_MAX
    || /^\.|\.$|\.\./.test(local) || /\.\./.test(domain) || /^[-.]|[-.]$|\.-|-\./.test(domain)) throw regError('email_invalid', 'email');
  // 1.4.3 (QA V142-5): a character outside the allow list (symbols, emoji, scripts the rules can't check) gets
  // its own message, on every backend
  if (!(wide ? EMAIL_ALLOWED_WIDE_RE : EMAIL_ALLOWED_NARROW_RE).test(s)) throw regError('email_chars', 'email');
  return s;
}

/**
 * 1.4.0 (QA V139-3): the key two accounts may not share – NFC, trimmed, lower-case (case/spaces only; accents
 * and widths count, as the API's utf8mb4_bin index). '' / null → null. Also the Firebase `emails/{key}` id.
 */
export function emailKey(raw: unknown): string | null {
  const s = emailFold(String(raw ?? ''));
  return s || null;
}

/** 1.4.0 (QA V139-3): Firestore doc id of an email claim (firestore.rules emailClaimId): % and / escaped. */
export const emailClaimId = (key: string) => key.replace(/%/g, '%25').replace(/\//g, '%2F');

/** 1.3.7 (R136-14): Devanagari (०-९) and other Unicode decimal digits typed in a number field become ASCII. */
export function asciiDigits(raw: string): string {
  return raw.replace(/[\u0966-\u096F]/g, (d) => String(d.charCodeAt(0) - 0x0966))
    .replace(/[\uFF10-\uFF19]/g, (d) => String(d.charCodeAt(0) - 0xFF10));
}

export function checkPincode(raw: unknown): string {
  const s = asciiDigits(String(raw ?? '')).trim();
  if (!PINCODE_RE.test(s)) throw regError('pincode_invalid', 'pincode');
  return s;
}

/** Result of a pincode lookup: found, definitively unknown, or couldn't tell (accept on format). */
export type PincodeInfo = { status: 'ok'; district: string; state: string; city?: string } | { status: 'invalid' } | { status: 'unknown' };

/** Parse an api.postalpincode.in response. Only an explicit "No records found" error counts as invalid. */
export function parsePincodeResponse(body: unknown): PincodeInfo {
  const r = Array.isArray(body) ? (body[0] as { Status?: string; Message?: string; PostOffice?: { Name?: string; District?: string; State?: string; Block?: string }[] | null }) : null;
  if (!r || typeof r !== 'object') return { status: 'unknown' };
  if (r.Status === 'Success' && Array.isArray(r.PostOffice) && r.PostOffice.length) {
    const po = r.PostOffice[0];
    // 1.3.7 (R136-13): upstream text is stripped of control/zero-width characters like client text
    const clip = (x: unknown) => String(x ?? '').replace(new RegExp(`[${HIDDEN_CHARS}]`, 'g'), '').trim().slice(0, 60);
    if (!po.District || !po.State) return { status: 'unknown' };
    return { status: 'ok', district: clip(po.District), state: clip(po.State), city: clip(po.Block && po.Block !== 'NA' ? po.Block : po.Name) || undefined };
  }
  if (r.Status === 'Error' && (!r.PostOffice || !r.PostOffice.length) && /no records/i.test(String(r.Message ?? ''))) return { status: 'invalid' };
  return { status: 'unknown' };
}

/** Demo builds: a small bundled sample (no network). Other valid-format pincodes are accepted as unknown. */
export const DEMO_PINCODES: Record<string, { district: string; state: string }> = {
  '110001': { district: 'New Delhi', state: 'Delhi' },
  '400001': { district: 'Mumbai', state: 'Maharashtra' },
  '560001': { district: 'Bengaluru', state: 'Karnataka' },
  '600001': { district: 'Chennai', state: 'Tamil Nadu' },
  '700001': { district: 'Kolkata', state: 'West Bengal' },
  '500001': { district: 'Hyderabad', state: 'Telangana' },
  '226001': { district: 'Lucknow', state: 'Uttar Pradesh' },
  '302001': { district: 'Jaipur', state: 'Rajasthan' },
  '411001': { district: 'Pune', state: 'Maharashtra' },
  '380001': { district: 'Ahmedabad', state: 'Gujarat' },
};
/**
 * 1.3.7 (R136-16): first two PIN digits in use by India Post's civilian postal circles (Wikipedia
 * "Postal Index Number", sorting-district table): 11–28, 30–34, 36–53, 56–85. 9x is the Army Postal
 * Service (field post offices); 10, 29, 35, 54, 55 and 86–89 are not allocated.
 */
const PIN_PREFIX_RANGES: readonly [number, number][] = [[11, 28], [30, 34], [36, 53], [56, 85]];
export const isApsPincode = (pin: string) => /^9\d{5}$/.test(pin);
export function pincodePrefixOk(pin: string): boolean {
  if (!PINCODE_RE.test(pin)) return false;
  const p = Number(pin.slice(0, 2));
  return PIN_PREFIX_RANGES.some(([a, b]) => p >= a && p <= b);
}

/**
 * Demo builds (no network): the bundled sample gives a district; an unallocated prefix (e.g. 999999,
 * 100001) is definitively invalid, like India Post's "No records found" on the API; any other
 * well-formed pincode can't be verified offline and is saved as entered, without a district.
 */
export function demoPincodeLookup(pin: string): PincodeInfo {
  if (!PINCODE_RE.test(pin)) return { status: 'invalid' };
  const hit = DEMO_PINCODES[pin];
  if (hit) return { status: 'ok', ...hit };
  return pincodePrefixOk(pin) ? { status: 'unknown' } : { status: 'invalid' };
}

/**
 * 1.3.7 (R136-15/17/18): every registration problem at once, one per field, for inline errors under
 * each field (the backends still validate with checkRegistrationUpdate). Pincode order: empty →
 * pincode_required; not digits → pincode_digits; bad format → pincode_invalid.
 */
export type FieldProblem = { code: string; field: RegField; min?: number; max?: number };
export function registrationFieldErrors(
  v: { firstName?: unknown; lastName?: unknown; dob?: unknown; email?: unknown; pincode?: unknown },
  stored: RegStored,
  minAge = DEFAULT_MIN_AGE,
  now = Date.now(),
): Partial<Record<RegField, FieldProblem>> {
  const out: Partial<Record<RegField, FieldProblem>> = {};
  const run = (field: RegField, f: () => unknown) => {
    try {
      f();
    } catch (e) {
      const x = e as { code: string; min?: number; max?: number };
      out[field] = { code: x.code, field, ...(x.min != null ? { min: x.min } : {}), ...(x.max != null ? { max: x.max } : {}) };
    }
  };
  run('firstName', () => checkPersonName(v.firstName, 'firstName'));
  run('lastName', () => checkPersonName(v.lastName, 'lastName'));
  const dob = String(v.dob ?? '').trim();
  run('dob', () => checkDob(dob, minAge, now, !stored?.dob || dob !== stored.dob));
  // 1.4.4 (QA V143-6): the stored address, unchanged, is never an inline error (the save keeps it)
  if (!emailUnchanged(v.email, stored?.email)) run('email', () => checkEmail(v.email));
  const pin = asciiDigits(String(v.pincode ?? '')).trim();
  if (!pin) out.pincode = { code: 'pincode_required', field: 'pincode' };
  else if (/\D/.test(pin)) out.pincode = { code: 'pincode_digits', field: 'pincode' };
  else run('pincode', () => checkPincode(pin));
  return out;
}

export interface RegistrationFields {
  firstName: string;
  lastName: string;
  dob: string;
  email: string | null;
  pincode: string;
}
/** All registration fields at once (first problem throws). */
export function checkRegistration(p: { firstName?: unknown; lastName?: unknown; dob?: unknown; email?: unknown; pincode?: unknown }, minAge = DEFAULT_MIN_AGE, now = Date.now(), checkAge = true): RegistrationFields {
  return {
    firstName: checkPersonName(p.firstName, 'firstName'),
    lastName: checkPersonName(p.lastName, 'lastName'),
    dob: checkDob(p.dob, minAge, now, checkAge),
    email: checkEmail(p.email),
    pincode: checkPincode(p.pincode),
  };
}

/**
 * Existing users from before 1.3.6 are asked to complete these. 1.3.7 (R136-8): the age range is checked
 * when the DOB is saved, not here, so turning 101 or a raised MIN_AGE never sends a user back to the
 * completion screen (where their real DOB couldn't be saved). `minAge` is kept for callers.
 */
export function profileComplete(p: { firstName?: string | null; lastName?: string | null; dob?: string | null; pincode?: string | null } | null | undefined, minAge = DEFAULT_MIN_AGE, now = Date.now()): boolean {
  if (!p) return false;
  try {
    const f = checkRegistration({ ...p, email: null }, minAge, now, false);
    // 1.3.9 (QA V138-6): an allocated prefix (or Army Postal Service 9xxxxx), as a save requires
    return pincodePrefixOk(f.pincode) || isApsPincode(f.pincode);
  } catch {
    return false;
  }
}

/** Display name stored in `name` (teams, matches, rankings keep using it). */
export const fullName = (first: string, last: string) => `${first} ${last}`.slice(0, 60);

type RegInput = { firstName?: unknown; lastName?: unknown; dob?: unknown; email?: unknown; pincode?: unknown; district?: unknown; state?: unknown };
type RegStored = { firstName?: string | null; lastName?: string | null; dob?: string | null; email?: string | null; pincode?: string | null } | null | undefined;
export const REG_KEYS = ['firstName', 'lastName', 'dob', 'email', 'pincode', 'district', 'state'] as const;
/** The save carries at least one registration field. */
export const sentRegistration = (p: RegInput) => REG_KEYS.some((k) => p[k] !== undefined);
/** The stored profile already has every required registration field. */
/**
 * The stored profile has every required registration field, each valid by the registration validators.
 * 1.3.9 (QA V138-6): not just present – a legacy row with a blank / whitespace-only name or a pincode
 * like 000000 or an unallocated prefix doesn't pass (same check as profileComplete, which the app uses
 * to send the user to the completion screen).
 */
export const hasStoredRegistration = (s: RegStored) => profileComplete(s ?? null);

/**
 * 1.3.7 (R136-2/R136-3): a save is checked as a whole. The fields sent replace the stored ones, then
 * every field is validated (a partial save such as email-only can't store an unchecked value, and can't
 * remove a required one). The age range is checked when the DOB is new or changed (R136-8).
 */
export function checkRegistrationUpdate(sent: RegInput, stored: RegStored, minAge = DEFAULT_MIN_AGE, now = Date.now()): RegistrationFields {
  const pick = <K extends keyof RegistrationFields>(k: K) => (sent[k] !== undefined ? sent[k] : stored?.[k]);
  const merged = { firstName: pick('firstName'), lastName: pick('lastName'), dob: pick('dob'), email: pick('email'), pincode: pick('pincode') };
  const dobChanged = !stored?.dob || String(merged.dob ?? '').trim() !== stored.dob;
  // 1.4.4 (QA V143-6): the account's own UNCHANGED stored email always passes, on every backend (API, demo,
  // Firebase client; firestore.rules registrationOk skips the format check for d.email == oldEmail too). An
  // address saved before a stricter check (an out-of-list character, a 1.3.x format) used to block every
  // profile save (pincode, name) until it was removed. A valid one is still returned folded (as before); an
  // invalid one is kept byte for byte. A NEW or changed address gets the full check.
  if (emailUnchanged(merged.email, stored?.email)) {
    const f = checkRegistration({ ...merged, email: null }, minAge, now, dobChanged);
    let email: string | null;
    try {
      email = checkEmail(stored!.email);
    } catch {
      email = stored!.email!;
    }
    return { ...f, email };
  }
  return checkRegistration(merged, minAge, now, dobChanged);
}

/** 1.4.4 (QA V143-6): the sent email is the stored one (up to case/spaces/NFC, as emailKey compares). */
export function emailUnchanged(sent: unknown, stored: string | null | undefined): boolean {
  return !!stored && (sent === stored || (emailKey(sent) !== null && emailKey(sent) === emailKey(stored)));
}
