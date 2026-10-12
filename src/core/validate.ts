/**
 * Input checks shared by every backend: the API server (on top of zod), the demo backend and the
 * Firebase backend (before writing, so users get a translated message instead of a rules denial).
 * firestore.rules enforce the same table (src/core/limits.ts). Each failure is a ValidationError
 * with a stable `code` the app translates (i18n errors.codes.*) and the server returns as
 * `{ error: code, field, min, max }` with HTTP 400.
 * All checks are for writes only; stored documents are never rewritten.
 */
import { HEX_COLOR_RE, LIMITS, MAX_EVENTS, MAX_TOURNAMENT_TEAMS, type LimitKey } from './limits';
import { cleanText, textProblem, TEXT_ERROR_CODES } from './text';
import { END_BEFORE_START_CODE, isPastStart, PAST_TIME_CODE } from './dates';
import { validateRules, type RuleSet } from './rules';
import type { Place } from './geo';

export class ValidationError extends Error {
  readonly code: string;
  readonly field?: string;
  readonly min?: number;
  readonly max?: number;
  constructor(code: string, field?: string, extra: { min?: number; max?: number } = {}) {
    super(field ? `${code} (${field})` : code);
    this.name = 'ValidationError';
    this.code = code;
    this.field = field;
    this.min = extra.min;
    this.max = extra.max;
  }
}

export const RULES_INVALID_CODE = 'rules_invalid';
export const DUPLICATE_TEAMS_CODE = 'duplicate_teams';
export const NEED_TWO_TEAMS_CODE = 'need_two_teams';
export const TOO_MANY_TEAMS_CODE = 'too_many_teams';
export const COLOR_INVALID_CODE = 'color_invalid';
export const TEAM_NAME_MISMATCH_CODE = 'team_name_mismatch';
export const PLACE_INVALID_CODE = 'place_invalid';
export const EVENTS_INVALID_CODE = 'events_invalid';
/** 1.4.1 (V140-10): a time that is not epoch ms (string, NaN, fraction, negative). */
export const TIME_INVALID_CODE = 'time_invalid';

/** Cleaned text (NFC, no zero-width, trimmed), or throws. Optional + empty gives undefined. */
export function checkText(field: string, raw: unknown, key: LimitKey, opts: { multiline?: boolean } = {}): string | undefined {
  const limit = LIMITS[key];
  const p = textProblem(raw, limit, opts);
  if (p) throw new ValidationError(TEXT_ERROR_CODES[p], field, { min: limit.min, max: limit.max });
  if (raw == null) return undefined;
  const s = cleanText(raw as string, { name: limit.min > 0 }); // 1.3.9 (V138-4): names keep Devanagari joiners
  return s === '' ? undefined : s;
}

export function checkPlace(field: string, p: Place | null | undefined, required = true): Place | null | undefined {
  if (p == null) {
    if (required) throw new ValidationError(PLACE_INVALID_CODE, field);
    return p;
  }
  const ok = typeof p.lat === 'number' && typeof p.lng === 'number' && Number.isFinite(p.lat) && Number.isFinite(p.lng)
    && p.lat >= -90 && p.lat <= 90 && p.lng >= -180 && p.lng <= 180;
  if (!ok) throw new ValidationError(PLACE_INVALID_CODE, field);
  return { lat: p.lat, lng: p.lng, name: checkText(`${field}.name`, p.name, 'placeName')! };
}

export function checkRules(r: RuleSet): RuleSet {
  try {
    if (!r || typeof r !== 'object') throw new Error('rules');
    const ints = [r.bestOf, r.pointsPerSet, r.decidingSetPoints, r.winBy, r.timeoutsPerSet];
    if (ints.some((n) => !Number.isInteger(n))) throw new Error('rules');
    if (r.pointsPerSet > 99 || r.decidingSetPoints > 99 || r.winBy > 5 || r.timeoutsPerSet > 9) throw new Error('rules');
    for (const n of [r.pointCap, r.sideSwitchEvery, r.decidingSideSwitchEvery, r.decidingSwitchAt]) {
      if (n != null && (!Number.isInteger(n) || n < 1 || n > 99)) throw new Error('rules');
    }
    return validateRules(r);
  } catch {
    throw new ValidationError(RULES_INVALID_CODE, 'rules');
  }
}

/** 1.4.2 (QA V141-7): a new scheduled time is at most 2 years ahead. */
export const MAX_SCHEDULE_AHEAD_MS = 2 * 366 * 86_400_000;
/** Epoch ms that is a safe, non-negative integer within the JS Date range (8.64e15). */
export const scheduleMsOk = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 && v <= 8.64e15;

/** QA G9: a new start time can't already be over (PAST_GRACE_MS grace). */
export function checkNotPast(field: string, ts: number | null | undefined, now = Date.now()) {
  if (ts == null) return;
  if (!Number.isInteger(ts) || ts < 0 || isPastStart(ts, now)) throw new ValidationError(PAST_TIME_CODE, field);
}

/** QA G8 / G13: an end can't be before its start. */
export function checkOrder(field: string, start: number | null | undefined, end: number | null | undefined) {
  if (start != null && end != null && end < start) throw new ValidationError(END_BEFORE_START_CODE, field);
}

export function checkProfileFields<T extends { name: string; city?: string | null }>(p: T): T {
  return { ...p, name: checkText('name', p.name, 'profileName')!, city: checkText('city', p.city, 'city') ?? '' };
}

export function checkColor(field: string, c: unknown): void {
  if (typeof c !== 'string' || !HEX_COLOR_RE.test(c)) throw new ValidationError(COLOR_INVALID_CODE, field);
}
export function checkTeamFields<T extends { name?: string; city?: string | null; color?: string }>(t: T): T {
  const out = { ...t };
  if (t.color !== undefined) checkColor('color', t.color);
  if (t.name !== undefined) out.name = checkText('name', t.name, 'teamName')!;
  if (t.city !== undefined) out.city = checkText('city', t.city, 'city') ?? '';
  return out;
}

export function checkCourtFields<T extends { name?: string; location?: Place }>(c: T): T {
  const out = { ...c };
  if (c.name !== undefined) out.name = checkText('name', c.name, 'courtName')!;
  if (c.location !== undefined) out.location = checkPlace('location', c.location)!;
  return out;
}

/** Side names, title, rules, place, times and event count of a match being created or changed. */
export function checkMatchFields<T extends {
  title?: string | null; teamA?: { name: string; color?: string }; teamB?: { name: string; color?: string }; rules?: RuleSet; location?: Place | null;
  startedAt?: number | null; finishedAt?: number | null; scheduledAt?: number | null; status?: string; events?: unknown[];
}>(m: T, opts: { now?: number; scheduleChanged?: boolean; status?: string } = {}): T {
  const out = { ...m };
  if (m.title !== undefined) out.title = (checkText('title', m.title, 'matchTitle') ?? null) as T['title'];
  if (m.teamA) out.teamA = { ...m.teamA, name: checkText('teamA.name', m.teamA.name, 'sideName')! };
  if (m.teamB) out.teamB = { ...m.teamB, name: checkText('teamB.name', m.teamB.name, 'sideName')! };
  if (m.teamA?.color !== undefined) checkColor('teamA.color', m.teamA.color);
  if (m.teamB?.color !== undefined) checkColor('teamB.color', m.teamB.color);
  if (m.rules) checkRules(m.rules);
  if (m.location !== undefined) out.location = checkPlace('location', m.location, false) as T['location'];
  if (m.events && m.events.length > MAX_EVENTS) throw new ValidationError(EVENTS_INVALID_CODE, 'events', { max: MAX_EVENTS });
  checkOrder('finishedAt', m.startedAt, m.finishedAt);
  // 1.4.1 (QA V140-10): a scheduled time is epoch ms (a whole number) on every status – the demo stored "1" (a
  // string) and NaN on live matches; the API answers 400 for those
  // 1.4.2 (QA V141-7): and a sane one – a safe integer (1e300 and 2^53 were accepted), and a newly set time at
  // most 2 years ahead. time_invalid is answered before time_in_past.
  if (m.scheduledAt != null && !scheduleMsOk(m.scheduledAt)) throw new ValidationError(TIME_INVALID_CODE, 'scheduledAt');
  if (opts.scheduleChanged && m.scheduledAt != null && m.scheduledAt > (opts.now ?? Date.now()) + MAX_SCHEDULE_AHEAD_MS)
    throw new ValidationError(TIME_INVALID_CODE, 'scheduledAt');
  // (a patch without a status uses the stored one; core/matchGuards.ts guardUpdate checks it too)
  if (opts.scheduleChanged && (m.status ?? opts.status) === 'scheduled') checkNotPast('scheduledAt', m.scheduledAt, opts.now);
  return out;
}

export function checkChallengeFields<T extends { when: number; location: Place; message?: string | null; rules: RuleSet }>(c: T, now = Date.now()): T {
  checkNotPast('when', c.when, now);
  checkRules(c.rules);
  return { ...c, location: checkPlace('location', c.location)!, message: checkText('message', c.message, 'challengeMessage', { multiline: true }) ?? '' };
}

/** QA G19: names on a challenge are the team documents' names. */
export function checkChallengeNames(c: { fromTeamName?: string; toTeamName?: string }, from: { name: string }, to: { name: string }) {
  if ((c.fromTeamName !== undefined && c.fromTeamName !== from.name) || (c.toTeamName !== undefined && c.toTeamName !== to.name))
    throw new ValidationError(TEAM_NAME_MISMATCH_CODE, c.fromTeamName !== from.name ? 'fromTeamName' : 'toTeamName');
}

export function checkTournamentFields<T extends {
  name?: string; startDate?: number; endDate?: number; teams?: { id: string; name: string; color?: string }[]; rules?: RuleSet; location?: Place;
}>(t: T, opts: { now?: number; startChanged?: boolean } = {}): T {
  const out = { ...t };
  if (t.name !== undefined) out.name = checkText('name', t.name, 'tournamentName')!;
  if (t.rules) checkRules(t.rules);
  if (t.location !== undefined) out.location = checkPlace('location', t.location)!;
  if (opts.startChanged) checkNotPast('startDate', t.startDate, opts.now);
  checkOrder('endDate', t.startDate, t.endDate);
  if (t.teams) {
    const ids = t.teams.map((x) => x.id);
    if (new Set(ids).size !== ids.length) throw new ValidationError(DUPLICATE_TEAMS_CODE, 'teams');
    if (ids.length < 2) throw new ValidationError(NEED_TWO_TEAMS_CODE, 'teams', { min: 2 });
    if (ids.length > MAX_TOURNAMENT_TEAMS) throw new ValidationError(TOO_MANY_TEAMS_CODE, 'teams', { max: MAX_TOURNAMENT_TEAMS });
    t.teams.forEach((x, i) => x.color !== undefined && checkColor(`teams.${i}.color`, x.color));
  }
  return out;
}
