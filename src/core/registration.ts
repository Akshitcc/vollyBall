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
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
/** Latin (incl. accented, no × ÷) and Devanagari letters/marks (no digits or dandas), space, apostrophe, hyphen. */
const NAME_CHARS = /^[A-Za-z\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u024F\u0900-\u0963\u0971-\u097F' \-\u2019]+$/;
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
  const len = [...s].length;
  if (len < NAME_MIN || len > NAME_MAX) throw regError('name_length', field, { min: NAME_MIN, max: NAME_MAX });
  if (!NAME_CHARS.test(s) || !NAME_START.test(s) || /['\-\u2019 ]{2,}/.test(s)) throw regError('name_chars', field);
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

/** Throws dob_invalid / dob_future / age_too_young / age_too_old. */
export function checkDob(raw: unknown, minAge = DEFAULT_MIN_AGE, now = Date.now()): string {
  const s = String(raw ?? '').trim();
  if (!isRealDate(s)) throw regError('dob_invalid', 'dob');
  const today = todayIST(now);
  if (s >= today) throw regError('dob_future', 'dob');
  const age = ageOn(s, today);
  if (age < minAge) throw regError('age_too_young', 'dob', { min: minAge });
  if (age > MAX_AGE) throw regError('age_too_old', 'dob', { max: MAX_AGE });
  return s;
}

/** Optional: '' / null → null; otherwise a plausible address (trimmed). */
export function checkEmail(raw: unknown): string | null {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  if (s.length > EMAIL_MAX || !EMAIL_RE.test(s)) throw regError('email_invalid', 'email');
  return s;
}

export function checkPincode(raw: unknown): string {
  const s = String(raw ?? '').trim();
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
    const clip = (x: unknown) => String(x ?? '').trim().slice(0, 60);
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
export function demoPincodeLookup(pin: string): PincodeInfo {
  if (!PINCODE_RE.test(pin)) return { status: 'invalid' };
  const hit = DEMO_PINCODES[pin];
  return hit ? { status: 'ok', ...hit } : { status: 'unknown' };
}

export interface RegistrationFields {
  firstName: string;
  lastName: string;
  dob: string;
  email: string | null;
  pincode: string;
}
/** All registration fields at once (first problem throws). */
export function checkRegistration(p: { firstName?: unknown; lastName?: unknown; dob?: unknown; email?: unknown; pincode?: unknown }, minAge = DEFAULT_MIN_AGE, now = Date.now()): RegistrationFields {
  return {
    firstName: checkPersonName(p.firstName, 'firstName'),
    lastName: checkPersonName(p.lastName, 'lastName'),
    dob: checkDob(p.dob, minAge, now),
    email: checkEmail(p.email),
    pincode: checkPincode(p.pincode),
  };
}

/** Existing users from before 1.3.6 are asked to complete these. */
export function profileComplete(p: { firstName?: string | null; lastName?: string | null; dob?: string | null; pincode?: string | null } | null | undefined, minAge = DEFAULT_MIN_AGE, now = Date.now()): boolean {
  if (!p) return false;
  try {
    checkRegistration({ ...p, email: null }, minAge, now);
    return true;
  } catch {
    return false;
  }
}

/** Display name stored in `name` (teams, matches, rankings keep using it). */
export const fullName = (first: string, last: string) => `${first} ${last}`.slice(0, 60);
