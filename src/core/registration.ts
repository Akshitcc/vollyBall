/**
 * 1.3.6 registration fields, shared by the app, the demo backend and the API server:
 * first/last name, date of birth (age from it, in IST), optional email, Indian pincode.
 * Errors are CodedErrors (field + code), translated by i18n/format.
 */
import { CodedError } from './codedError';

export const NAME_MIN = 2;
export const NAME_MAX = 40;
export const DEFAULT_MIN_AGE = 10;
export const MAX_AGE = 100;
export const PINCODE_RE = /^[1-9][0-9]{5}$/;
export const EMAIL_MAX = 254;
export const EMAIL_LOCAL_MAX = 64;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
/** 1.3.7 (R136-9): control, zero-width, soft-hyphen, bidi and BOM characters are never part of an address. */
const EMAIL_BAD_CHARS = /[\u0000-\u001F\u007F-\u009F\u00AD\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/;
/**
 * Latin (incl. accented, no × ÷) and Devanagari letters/marks (no digits or dandas), space, apostrophe,
 * hyphen; 1.3.7 (R136-10): ZWNJ/ZWJ (U+200C/U+200D) only between two Devanagari characters.
 */
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
 * Optional: '' / null → null; otherwise a plausible address, trimmed and lower-cased (1.3.7, R136-9:
 * no control/zero-width characters, local part ≤ 64, no leading/trailing/double dots).
 */
export function checkEmail(raw: unknown): string | null {
  const s = String(raw ?? '').trim().toLowerCase();
  if (!s) return null;
  const local = s.slice(0, s.lastIndexOf('@'));
  if (s.length > EMAIL_MAX || !EMAIL_RE.test(s) || EMAIL_BAD_CHARS.test(s) || local.length > EMAIL_LOCAL_MAX
    || /^\.|\.$|\.\./.test(local) || /\.\./.test(s.slice(s.lastIndexOf('@') + 1))) throw regError('email_invalid', 'email');
  return s;
}

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
    const clip = (x: unknown) => String(x ?? '').replace(/[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFEFF]/g, '').trim().slice(0, 60);
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
  run('email', () => checkEmail(v.email));
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
    checkRegistration({ ...p, email: null }, minAge, now, false);
    return true;
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
export const hasStoredRegistration = (s: RegStored) => !!(s && s.firstName && s.lastName && s.dob && s.pincode);

/**
 * 1.3.7 (R136-2/R136-3): a save is checked as a whole. The fields sent replace the stored ones, then
 * every field is validated (a partial save such as email-only can't store an unchecked value, and can't
 * remove a required one). The age range is checked when the DOB is new or changed (R136-8).
 */
export function checkRegistrationUpdate(sent: RegInput, stored: RegStored, minAge = DEFAULT_MIN_AGE, now = Date.now()): RegistrationFields {
  const pick = <K extends keyof RegistrationFields>(k: K) => (sent[k] !== undefined ? sent[k] : stored?.[k]);
  const merged = { firstName: pick('firstName'), lastName: pick('lastName'), dob: pick('dob'), email: pick('email'), pincode: pick('pincode') };
  const dobChanged = !stored?.dob || String(merged.dob ?? '').trim() !== stored.dob;
  return checkRegistration(merged, minAge, now, dobChanged);
}
