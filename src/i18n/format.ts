import type { TournamentDisplayStatus } from '../core/tournament';
/**
 * Translated versions of display helpers whose English originals live in
 * src/core (pure, unit-tested, also used for stored data). The core functions
 * are unchanged; screens use these so the UI follows the chosen language.
 */
import { MAX_PHOTOS_PER_MATCH } from '../core/limits';
import type { TFunction } from 'i18next';
import { INVALID_PHONE_CODE, INVALID_PHONE_MESSAGE } from '../core/phone';
import {
  CHALLENGE_CAPTAIN_MESSAGE,
  CHALLENGE_SAME_TEAM_MESSAGE,
  MAX_PLAYERS,
  MIN_PLAYERS,
  PARTICIPANTS_MESSAGE,
  ROSTER_LOCKED_MESSAGE,
  ROSTER_MESSAGES,
  TEAM_TOO_SMALL_MESSAGE,
  TOURNAMENT_ORGANIZER_MESSAGE,
  TOURNAMENT_TEAMS_MESSAGE,
} from '../core/roster';
import { CHALLENGE_MATCH_TITLE } from '../core/types';
import type { RuleSet } from '../core/rules';
import { computeState, type MatchEvent, type Side } from '../core/scoring';
import { formatDistance } from '../core/geo';
import { acceptedEvents, longestRun } from '../core/stats';
import type { Court, Match, Position, Tournament } from '../core/types';
import i18n, { currentLanguage, dateLocale } from './index';

/** Default translator (current language) for non-React callers. */
const tr = ((key: string, opts?: Record<string, unknown>) => i18n.t(key, opts)) as unknown as TFunction;

export function describeRulesT(r: RuleSet, t: TFunction = tr): string {
  const name = r.preset === 'beach' ? t('rules.presetBeach') : r.preset === 'indoor' ? t('rules.presetIndoor') : t('rules.presetCustom');
  return t('rules.describe', {
    name,
    bestOf: r.bestOf,
    points: r.pointsPerSet,
    decider: r.bestOf > 1 ? t('rules.describeDecider', { n: r.decidingSetPoints }) : '',
    winBy: r.winBy,
  });
}

export function roundNameT(round: number, totalRounds: number, t: TFunction = tr): string {
  const fromEnd = totalRounds - round;
  if (fromEnd === 0) return t('rounds.final');
  if (fromEnd === 1) return t('rounds.semi');
  if (fromEnd === 2) return t('rounds.quarter');
  return t('rounds.round', { n: round });
}

export const positionLabel = (p: Position | undefined | null, t: TFunction = tr) => (p ? t(`positions.${p}`) : '');
export const surfaceLabel = (s: Court['surface'], t: TFunction = tr) => t(`surfaces.${s}`);
export const tournamentStatusLabel = (s: Tournament['status'] | TournamentDisplayStatus, t: TFunction = tr) => t(`tournamentStatus.${s}`);
export const matchStatusLabel = (s: Match['status'], t: TFunction = tr) => t(`matchStatus.${s}`);
/** Part of the day for an hour 0-23 (Hindi names it instead of am/pm: रात/सुबह/दोपहर/शाम/रात). */
export function dayPeriod(h: number): 'early' | 'morning' | 'afternoon' | 'evening' | 'night' {
  if (h < 4) return 'early';
  if (h < 12) return 'morning';
  if (h < 16) return 'afternoon';
  if (h < 20) return 'evening';
  return 'night';
}
export const hourLabel = (h: number, t: TFunction = tr) => t(`time.${dayPeriod(h)}`, { h: h % 12 || 12 });

/** Short date-time used on cards. English output is identical to the original formatWhen. */
export function formatWhenT(ts?: number | null): string {
  if (!ts) return '';
  const d = new Date(ts);
  if (currentLanguage() !== 'hi') {
    // hour 'numeric': "7:00 pm", not "07:00 pm" (fix re-test 204)
    return d.toLocaleString(dateLocale(), { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
  }
  // Intl's hi-IN output keeps a Latin "am/pm" ("शनि, 10 अक्तू॰, 06:30 pm"), so build the time part
  // ourselves: "शनि, 10 अक्तू॰, शाम 6:30" (QA bug J).
  const date = d.toLocaleDateString(dateLocale(), { weekday: 'short', day: 'numeric', month: 'short' });
  const h = d.getHours();
  const time = `${tr(`timeParts.${dayPeriod(h)}`)} ${h % 12 || 12}:${String(d.getMinutes()).padStart(2, '0')}`;
  return `${date}, ${time}`;
}
/**
 * 1.4.7 (QA V146-8): the device zone's short label for `ts` – "IST" at +5:30, "UTC" at 0, else "UTC+h:mm". Times are
 * epoch ms (the API reads DATETIME as UTC, knex timezone 'Z'; Firestore Timestamps) and are always shown in the
 * device's zone; the label makes a browser / phone set to another zone obvious (the 1.4.6 browser pass ran in a UTC
 * Chrome: "2:19 am" was 07:49 IST shown in UTC).
 */
/** 1.4.9 (QA V148-4): legacy IANA ids (links kept by tzdata) → the current zone, so the city reads as today's name. */
export const LEGACY_ZONES: Record<string, string> = {
  'Asia/Katmandu': 'Asia/Kathmandu', 'Asia/Calcutta': 'Asia/Kolkata', 'Asia/Saigon': 'Asia/Ho_Chi_Minh', 'Asia/Rangoon': 'Asia/Yangon',
  'Asia/Dacca': 'Asia/Dhaka', 'Asia/Thimbu': 'Asia/Thimphu', 'Asia/Ulan_Bator': 'Asia/Ulaanbaatar', 'Asia/Macao': 'Asia/Macau',
  'Asia/Ujung_Pandang': 'Asia/Makassar', 'Asia/Chongqing': 'Asia/Shanghai', 'Asia/Chungking': 'Asia/Shanghai', 'Asia/Harbin': 'Asia/Shanghai',
  'Asia/Tel_Aviv': 'Asia/Jerusalem', 'Asia/Ashkhabad': 'Asia/Ashgabat', 'Europe/Kiev': 'Europe/Kyiv', 'Atlantic/Faeroe': 'Atlantic/Faroe',
  'America/Godthab': 'America/Nuuk', 'Pacific/Enderbury': 'Pacific/Kanton', 'Pacific/Truk': 'Pacific/Chuuk', 'Pacific/Ponape': 'Pacific/Pohnpei',
  'America/Buenos_Aires': 'America/Argentina/Buenos_Aires', 'Africa/Asmera': 'Africa/Asmara', 'Africa/Timbuktu': 'Africa/Bamako',
};
export function zoneLabel(ts: number, zone?: string): string {
  const off = -new Date(ts).getTimezoneOffset();
  const a = Math.abs(off);
  const offset = off === 0 ? 'UTC' : `UTC${off < 0 ? '−' : '+'}${Math.floor(a / 60)}${a % 60 ? `:${String(a % 60).padStart(2, '0')}` : ''}`;
  // 1.4.8 (QA V147-6): the device's real zone, not "any +5:30 is IST" (Colombo is +5:30 too): IST only for India's
  // zone; otherwise the zone's own abbreviation (PDT, UTC, CET…), or – when it only has "GMT+x" – the offset plus the
  // zone's city ("UTC+5:30 (Colombo)").
  let tz = zone;
  let abbr: string | undefined;
  try {
    tz = tz ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (tz && LEGACY_ZONES[tz]) tz = LEGACY_ZONES[tz];
    abbr = new Intl.DateTimeFormat('en-US', { timeZoneName: 'short', ...(tz ? { timeZone: tz } : {}) }).formatToParts(new Date(ts)).find((p) => p.type === 'timeZoneName')?.value;
  } catch {
    abbr = undefined;
  }
  if (tz === 'Asia/Kolkata') return 'IST'; // Asia/Calcutta is mapped above
  if (abbr && /^[A-Z]{2,5}$/.test(abbr) && abbr !== 'GMT') return abbr;
  if (off === 0) return 'UTC';
  const city = tz && tz.includes('/') && !tz.startsWith('Etc/') ? tz.split('/').pop()!.replace(/_/g, ' ') : null;
  return city ? `${offset} (${city})` : offset;
}
/** formatWhenT plus the zone label: "Mon, 12 Oct, 7:49 am IST". */
export function formatWhenZoneT(ts?: number | null): string {
  return ts ? `${formatWhenT(ts)} ${zoneLabel(ts)}` : '';
}
/** "15 Oct 2026" (hi: "15 अक्तू॰ 2026"). */
export const formatDateT = (ts: number) => new Date(ts).toLocaleDateString(dateLocale(), { day: 'numeric', month: 'short', year: 'numeric' });
/** "15 Oct – 17 Oct 2026"; one date for a one-day event; both years when they differ. */
export function formatDateRangeT(start: number, end?: number | null): string {
  const a = new Date(start);
  const b = end ? new Date(end) : a;
  if (a.toDateString() === b.toDateString()) return formatDateT(start);
  if (a.getFullYear() !== b.getFullYear()) return `${formatDateT(start)} – ${formatDateT(b.getTime())}`;
  const dayMonth = a.toLocaleDateString(dateLocale(), { day: 'numeric', month: 'short' });
  return `${dayMonth} – ${formatDateT(b.getTime())}`;
}
export const formatDayChipT = (ts: number) => new Date(ts).toLocaleDateString(dateLocale(), { weekday: 'short', day: 'numeric' });

/**
 * Fixed English labels that the app itself writes into data (demo seed,
 * challenge matches). Shown translated; user-typed text is never touched.
 */
const DATA_LABELS: Record<string, string> = {
  'Sunday league': 'demo.sundayLeague',
  [CHALLENGE_MATCH_TITLE]: 'demo.challengeMatch', // stored on challenge matches, shown in each viewer's language
  'New Delhi': 'demo.newDelhi',
  'Team A': 'common.teamA', // older matches created before team names were required
  'Team B': 'common.teamB',
};
export function dataLabel(s: string | null | undefined, t: TFunction = tr): string {
  if (!s) return '';
  const key = DATA_LABELS[s];
  if (key) return t(key);
  // Tournament fixtures are titled "<tournament> · <round>" (core roundName, English).
  const m = s.match(/^(.*) · (?:(Final)|(Semi-finals)|(Quarter-finals)|Round (\d+))$/);
  if (m) {
    const round = m[2] ? t('rounds.final') : m[3] ? t('rounds.semi') : m[4] ? t('rounds.quarter') : t('rounds.round', { n: Number(m[5]) });
    return `${m[1]} · ${round}`;
  }
  return s;
}

/** Map known (English) backend / Firebase errors to the current language. Unknown messages pass through. */
/** Error codes from src/core/validate.ts, the API server (`error` in the JSON body) and the app. */
const CODED = new Set([
  'text_empty', 'text_too_short', 'text_too_long', 'text_control', 'text_bidi', 'time_in_past', 'time_invalid', 'end_before_start',
  'photo_type', 'photo_empty', 'photo_truncated', 'color_invalid', 'photo_too_large', 'photo_url', 'photo_upload_failed', 'rules_invalid', 'team_name_mismatch',
  'need_two_teams', 'duplicate_teams', 'too_many_teams', 'place_invalid', 'events_invalid',
  'photo_not_allowed', 'potm_not_scorer', 'potm_not_finished', 'potm_window', 'potm_already_set', 'potm_not_player', 'potm_no_points', 'match_no_winner', 'potm_use_endpoint', 'photo_unreadable', 'photo_wrong_account',
  // 1.3.4
  'photo_duplicate', 'photo_limit', 'not_on_court',
  // 1.3.0 T&C / anti-fraud
  'terms_not_accepted', 'terms_version_mismatch', 'match_bad_status', 'match_terminal', 'match_finished', 'match_status_move', 'server_time', 'server_field', 'match_delete_forbidden', 'captains_required', 'captains_same', 'captain_not_team_captain', 'captain_not_on_side', 'not_completed', 'not_captain', 'scoring_side', 'already_reviewed', 'no_captains', 'admin_only', 'potm_required',
  // 1.3.1 (QA C130-2)
  'rate_limited',
  'support_message_type',
  'ask_question_type',
  'ask_sign_in',
  'ask_question_short',
  'ask_question_long',
  'ask_unavailable',
  // launch prep: server-side SMS OTP
  'otp_expired', 'otp_too_many_attempts', 'otp_send_failed', 'otp_use_device', 'own_match',
  // 1.3.6 registration
  'name_empty', 'name_length', 'name_chars', 'dob_invalid', 'dob_future', 'age_too_young', 'age_too_old', 'email_invalid', 'email_chars', 'pincode_invalid', 'pincode_unknown',
  // 1.3.7 (R136-2/9)
  'profile_incomplete', 'email_taken',
  // 1.3.7 feedback + fact of the day
  'feedback_stars', 'feedback_too_long', 'daily_invalid',
  // 1.3.7 (R136-17) pincode order: required → digits → format
  'pincode_required', 'pincode_digits',
  // 1.4.4 (QA V143-2/3/8)
  'abandon_needs_admin', 'match_setup_locked', 'match_rules_end',
  // 1.4.5
  'abandon_pending', 'abandon_no_request', 'abandon_not_allowed', 'resolve_not_allowed', 'handover_side',
  // 1.4.6
  'abandon_rate_limited', 'reassign_verdict_captain', 'handover_no_verdict',
  // 1.4.8
  'match_no_verdict', 'repair_invalid', 'repair_not_needed',
  // 1.4.16 (QA V1415-1)
  'team_too_large',
  'team_invalid',
  'not_tournament_admin',
  'support_topic',
  'support_message_short',
  'support_message_long',
  'support_image_type',
  'support_image_size',
  'support_image_exists',
  'support_status',
]);
/** "teamA.name" -> errors.fields.teamA; unknown fields read "This field". */
function fieldLabel(field: string | undefined, t: TFunction): string {
  const key = (field ?? '').split('.')[0];
  const known = ['name', 'city', 'title', 'teamA', 'teamB', 'message', 'location', 'q', 'firstName', 'lastName'];
  return t(`errors.fields.${known.includes(key) ? key : 'field'}`);
}

/** 1.3.7 (R136-21): the field name inside a sentence (Hindi oblique case: "पहले नाम में"). */
function fieldInLabel(field: string | undefined, t: TFunction): string {
  const key = (field ?? '').split('.')[0];
  return key === 'firstName' || key === 'lastName' ? t(`errors.fieldsIn.${key}`) : fieldLabel(field, t);
}

/** Translated text for a coded error (ValidationError, ApiError), or null. */
export function translateCode(e: unknown, t: TFunction = tr): string | null {
  const err = (e ?? {}) as { code?: unknown; field?: string; min?: number; max?: number; retryAfter?: number; attemptsLeft?: number };
  const code = typeof err.code === 'string' ? err.code : null;
  if (!code) return null;
  if (code === INVALID_PHONE_CODE) return t('errors.invalidPhone');
  if (code === 'rate_limited') {
    // 1.4.20 (QA V1419-6): the real wait – minutes when it is 2 minutes or more
    const s0 = Math.max(1, Math.ceil(err.retryAfter ?? 1));
    return s0 >= 120 ? t('errors.codes.rate_limited_min', { minutes: Math.ceil(s0 / 60) }) : t('errors.codes.rate_limited', { seconds: s0 });
  }
  const secs = Math.max(1, Math.ceil(err.retryAfter ?? 1));
  if (code === 'otp_resend_wait') return t('errors.codes.otp_resend_wait', { seconds: secs });
  if (code === 'otp_too_many') return t('errors.codes.otp_too_many', { minutes: Math.max(1, Math.ceil(secs / 60)) });
  if (code === 'otp_invalid') return typeof err.attemptsLeft === 'number' ? t('errors.codes.otp_invalid', { left: err.attemptsLeft }) : t('errors.wrongCode');
  if (CODED.has(code)) return t(`errors.codes.${code}`, { field: fieldLabel(err.field, t), fieldIn: fieldInLabel(err.field, t), min: err.min, max: err.max ?? (code === 'photo_limit' ? MAX_PHOTOS_PER_MATCH : undefined) });
  return null;
}

/** Message for a failed photo upload: the specific reason when known, else "couldn't upload". */
export function photoErrorMessage(e: unknown, t: TFunction = tr): string {
  const coded = translateCode(e, t);
  if (coded) return coded;
  console.warn('[photo upload]', e instanceof Error ? e.message : String(e));
  return t('errors.codes.photo_upload_failed');
}

export function translateError(e: unknown, t: TFunction = tr): string {
  const coded = translateCode(e, t);
  if (coded) return coded;
  // API server errors end with the rule id, e.g. "... [teams.update.captain]", may start with the
  // invalid field ("Invalid request: teamB.players.0.id – …") and may end with the ids involved
  // ("…: dev_9199…"). Match on the message itself; ids are never shown to the user.
  const msg = (e instanceof Error ? e.message : String(e))
    .replace(/ \[[a-z][\w.]*\]$/, '')
    .replace(/^Invalid request: [\w.]+ [–-] /, '');
  if (msg.includes('invalid-verification-code')) return t('errors.wrongCode');
  if (msg.includes('too-many-requests')) return t('errors.tooMany');
  if (msg.includes('invalid-phone-number') || msg.includes(INVALID_PHONE_CODE) || msg === INVALID_PHONE_MESSAGE) return t('errors.invalidPhone');
  if (msg.includes('operation-not-allowed')) return t('errors.phoneDisabled');
  const demo = msg.match(/^Wrong code\. In demo mode the code is (\d+)\.$/);
  if (demo) return t('errors.demoWrongCode', { code: demo[1] });
  const exact: Record<string, string> = {
    'Team not found': 'errors.teamNotFound',
    [ROSTER_MESSAGES.notUser]: 'errors.notUser',
    [ROSTER_MESSAGES.needPlayers]: 'errors.needPlayers',
    [ROSTER_MESSAGES.tooMany]: 'errors.tooManyPlayers',
    [ROSTER_MESSAGES.tooManyExact]: 'errors.tooManyExact',
    [PARTICIPANTS_MESSAGE]: 'errors.participants',
    [TOURNAMENT_ORGANIZER_MESSAGE]: 'errors.organizerOnly',
    [CHALLENGE_CAPTAIN_MESSAGE]: 'errors.challengeCaptain',
    [CHALLENGE_SAME_TEAM_MESSAGE]: 'errors.challengeSameTeam',
    [ROSTER_MESSAGES.duplicate]: 'errors.playerTwice',
    [TOURNAMENT_TEAMS_MESSAGE]: 'errors.tournamentTeams',
    [TEAM_TOO_SMALL_MESSAGE]: 'errors.teamTooSmall',
    [ROSTER_LOCKED_MESSAGE]: 'errors.rosterLocked',
    'Match not found': 'errors.matchNotFound',
    "This number isn't on VolleyLive yet. Ask them to register first.": 'errors.notRegistered',
    'Only the assigned scorer can change the score': 'errors.onlyScorer',
    'reCAPTCHA verifier not ready': 'errors.recaptchaNotReady',
    'reCAPTCHA expired': 'errors.recaptchaExpired',
    'reCAPTCHA failed': 'errors.recaptchaFailed',
    'Verification cancelled': 'errors.verificationCancelled',
    // core/tournament.ts
    'Duplicate team ids': 'errors.duplicateTeams',
    'Need at least 2 teams': 'errors.needTwoTeams',
    // core/rules.ts validateRules
    'bestOf must be 1, 3 or 5': 'errors.rulesBestOf',
    'points per set must be positive': 'errors.rulesPoints',
    'winBy must be at least 1': 'errors.rulesWinBy',
    'pointCap must be >= pointsPerSet': 'errors.rulesCap',
    'timeoutsPerSet cannot be negative': 'errors.rulesTimeouts',
  };
  const vars = { min: MIN_PLAYERS, max: MAX_PLAYERS };
  if (exact[msg]) return t(exact[msg], vars);
  // "<known message>: <ids>" (server lists the offending ids)
  const head = msg.replace(/: [^:]+$/, '');
  if (head !== msg && exact[head]) return t(exact[head], vars);
  if (/^Not a member of team /.test(msg)) return t('errors.notMember');
  if (/^Unknown team /.test(msg)) return t('errors.teamNotFound');
  if (/^Event \d+: .+ is not a player of team [AB]$/.test(msg)) return t('errors.pointNotOnTeam');
  // Anything else: a translated message, never raw English from a server or SDK (QA G16).
  const code = (e as { code?: unknown } | null)?.code;
  console.warn('[error]', msg);
  if (/insufficient permissions|permission[-_]denied/i.test(msg) || code === 'permission_denied' || code === 'permission-denied') return t('errors.permissionDenied');
  if (code === 'bad_request' || /^Invalid request/.test(msg)) return t('errors.badRequest');
  if (code === 'conflict') return t('errors.conflict');
  return t('errors.generic');
}

/** Same content as core/stats shareText, in the current language. English output is identical. */
export function shareTextT(
  nameA: string,
  nameB: string,
  rules: RuleSet,
  events: readonly MatchEvent[],
  firstServe: Side = 'A',
  extra?: { location?: string },
  t: TFunction = tr,
): string {
  const st = computeState(rules, events, firstServe);
  const sets = st.sets.map((s) => `${s.a}-${s.b}`);
  if (!st.finished && (st.current.a || st.current.b)) sets.push(`${st.current.a}-${st.current.b}*`);
  const head = st.finished
    ? t('share.beat', {
        winner: st.winner === 'A' ? nameA : nameB,
        loser: st.winner === 'A' ? nameB : nameA,
        hi: Math.max(st.setsWon.A, st.setsWon.B),
        lo: Math.min(st.setsWon.A, st.setsWon.B),
      })
    : t('share.live', { a: nameA, sa: st.setsWon.A, sb: st.setsWon.B, b: nameB });
  const run = longestRun(acceptedEvents(rules, events, firstServe));
  const lines = [head, t('share.sets', { sets: sets.join(', ') || '—' })];
  if (run.best.side) lines.push(t('share.longestRun', { n: run.best.length, team: run.best.side === 'A' ? nameA : nameB }));
  lines.push(describeRulesT(rules, t));
  if (extra?.location) lines.push(`📍 ${extra.location}`);
  lines.push(t('share.footer'));
  return lines.join('\n');
}

/** core formatDistance with Hindi units (English output unchanged). */
export function formatDistanceT(km: number): string {
  const s = formatDistance(km);
  return currentLanguage() === 'hi' ? s.replace(/ km$/, ' किमी').replace(/ m$/, ' मी') : s;
}

/**
 * Devanagari joins letters with a headline (शिरोरेखा); extra letterSpacing
 * breaks it apart, so spacing is dropped in Hindi.
 */
export const letterSpacing = (n: number) => (currentLanguage() === 'hi' ? 0 : n);

/** QA C130-9 (1.3.1): the spoken name of a team colour swatch ("Red" / "लाल"); unknown colours say their hex. */
export function colourName(hex: string, t: TFunction = tr): string {
  const key = `colours.c_${hex.replace('#', '').toUpperCase()}`;
  const name = t(key);
  return name && name !== key ? name : t('colours.other', { hex });
}
/** Accessible name of a colour swatch: "Team colour: Red". */
export const swatchLabel = (hex: string, t: TFunction = tr): string => t('colours.swatchLabel', { name: colourName(hex, t) });
