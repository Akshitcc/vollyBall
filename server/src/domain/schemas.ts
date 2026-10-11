/** Request validation (zod). Unknown keys are stripped. */
import { z } from 'zod';
import { MAX_PLAYERS, ROSTER_MESSAGES, USER_ID_RE } from '../../../src/core/roster';
import { badRequest, HttpError } from '../errors';
import { E164_IN_RE, INVALID_PHONE_CODE, INVALID_PHONE_MESSAGE } from '../../../src/core/phone';
import { HEX_COLOR_RE, LIMITS, MAX_EVENTS, MAX_TOURNAMENT_TEAMS, MAX_URL_LENGTH, type LimitKey } from '../../../src/core/limits';
import { cleanText, textProblem, TEXT_ERROR_CODES } from '../../../src/core/text';
import { checkRules, EVENTS_INVALID_CODE, RULES_INVALID_CODE } from '../../../src/core/validate';
import { END_BEFORE_START_CODE } from '../../../src/core/dates';
/** #RRGGBB only, as firestore.rules colorOk / sideOk (QA retest 217 #5). */
const hexColor = z.string().regex(HEX_COLOR_RE, 'Colours are #RRGGBB');

/**
 * Indian mobile numbers only, as E.164: ^\+91[6-9]\d{9}$ (shared with the app, src/core/phone.ts, and
 * mirrored in firestore.rules). Used for profiles, team invites and lookups. A failure is a 400 with
 * code "invalid_phone". Existing rows are not touched: this is checked on write / lookup only.
 */
export const phoneE164 = z.string().regex(E164_IN_RE, INVALID_PHONE_MESSAGE);
const id = z.string().min(1).max(128);
const ms = z.number().int().nonnegative();

/** Issue messages that are input codes (src/core/validate.ts); parse() turns them into a 400 with that code. */
const INPUT_CODES = new Set<string>([...Object.values(TEXT_ERROR_CODES), RULES_INVALID_CODE, EVENTS_INVALID_CODE, END_BEFORE_START_CODE]);
/**
 * Text field checked with the shared table (src/core/limits.ts) and helper (src/core/text.ts):
 * zero-width removed, control/bidi characters rejected, NFC, trimmed, a letter or digit required
 * for names, lengths in code points. Stores the cleaned value.
 */
const text = (key: LimitKey, opts: { multiline?: boolean } = {}) =>
  z.string().superRefine((v, ctx) => {
    const p = textProblem(v, LIMITS[key], opts);
    if (p) ctx.addIssue({ code: 'custom', message: TEXT_ERROR_CODES[p], params: { min: LIMITS[key].min, max: LIMITS[key].max } });
  }).transform((v) => cleanText(v, { name: LIMITS[key].min > 0 })); // 1.3.9 (V138-4)
/** Optional text: null/undefined/blank ("   ") all become undefined, never whitespace (QA B3). */
const optText = (key: LimitKey, opts: { multiline?: boolean } = {}) =>
  text(key, opts).nullish().transform((v) => (v ? v : undefined));
const nullableInt = (min: number, max: number) => z.number().int().min(min).max(max).nullable();

export const placeSchema = z.object({
  name: text('placeName'),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});

export const ruleSetSchema = z.object({
  preset: z.enum(['indoor', 'beach', 'custom']),
  bestOf: z.union([z.literal(1), z.literal(3), z.literal(5)]),
  pointsPerSet: z.number().int().min(1).max(99),
  decidingSetPoints: z.number().int().min(1).max(99),
  winBy: z.number().int().min(1).max(5),
  pointCap: nullableInt(1, 99),
  timeoutsPerSet: z.number().int().min(0).max(9),
  sideSwitchEvery: nullableInt(1, 99),
  decidingSideSwitchEvery: nullableInt(1, 99),
  decidingSwitchAt: nullableInt(1, 99),
}).superRefine((r, ctx) => {
  // QA G12: the app's own rule check (src/core/rules.ts validateRules), incl. cross-field limits.
  try {
    checkRules(r as never);
  } catch {
    ctx.addIssue({ code: 'custom', message: RULES_INVALID_CODE });
  }
});

/** Event times: not negative and not more than a day ahead of the server clock. */
const eventAt = ms.refine((v) => v <= Date.now() + 86_400_000, { message: EVENTS_INVALID_CODE });
export const eventSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('point'),
    side: z.enum(['A', 'B']),
    at: eventAt,
    playerId: z.string().min(1).max(140).optional(),
    kind: z.enum(['kill', 'block', 'ace', 'tip']).optional(),
  }),
  z.object({ type: z.literal('timeout'), side: z.enum(['A', 'B']), at: eventAt }),
]);
export const eventsSchema = z.array(eventSchema).max(MAX_EVENTS, EVENTS_INVALID_CODE);

/** Players are registered users referenced by user id (typed names / guest ids are rejected). */
export const matchPlayerSchema = z.object({
  id: z.string().regex(USER_ID_RE, ROSTER_MESSAGES.notUser),
  name: z.string().trim().min(1).max(LIMITS.playerName.max), // replaced by the stored user name
  photoURL: z.string().max(MAX_URL_LENGTH).nullable().optional(),
});
export const matchTeamSchema = z.object({
  teamId: z.string().max(64).nullable().optional(),
  name: text('sideName'), // 40, as firestore.rules sideOk (QA G15)
  color: hexColor,
  players: z.array(matchPlayerSchema).max(MAX_PLAYERS, ROSTER_MESSAGES.tooMany),
});

const slot = z.string().min(1).max(140).nullable();
export const lineupsSchema = z
  .record(z.string().regex(/^[1-5]$/, 'Lineup keys are set numbers 1-5'), z.object({ A: z.array(slot).length(6), B: z.array(slot).length(6) }))
  .nullable();

export const streamSchema = z
  .object({
    provider: z.enum(['none', 'rtmp', 'webrtc', 'youtube']),
    playbackUrl: z.string().max(1024).optional(),
    ingestUrl: z.string().max(1024).optional(),
    live: z.boolean(),
  })
  .nullable();

/** Fields a match document can have (create and patch). */
export const matchFields = {
  title: optText('matchTitle'),
  teamA: matchTeamSchema,
  teamB: matchTeamSchema,
  rules: ruleSetSchema,
  firstServe: z.enum(['A', 'B']),
  events: eventsSchema,
  status: z.enum(['scheduled', 'live', 'finished', 'abandoned']),
  createdBy: id,
  scorerId: id,
  participantIds: z.array(z.string().min(1).max(140)).max(100),
  location: placeSchema.nullable().optional(),
  scheduledAt: ms.nullable().optional(),
  startedAt: ms.nullable().optional(),
  finishedAt: ms.nullable().optional(),
  tournamentId: z.string().max(64).nullable().optional(),
  fixtureId: z.string().max(64).nullable().optional(),
  challengeId: z.string().max(64).nullable().optional(),
  stream: streamSchema.optional(),
  interestedIds: z.array(id).max(500).optional(),
  lineups: lineupsSchema.optional(),
  /** 1.3.0: captains of side A and B (core/antifraud.ts captainsProblem). Fixed at creation. */
  captains: z.object({ A: id, B: id }).strict().nullable().optional(),
  /** 1.3.6: exact = 6 per side, custom = 6-12 (core/roster.ts maxPlayersFor). */
  teamSizeMode: z.enum(['exact', 'custom']).nullable().optional(),
};
// QA G13: finish on or after start (patches are checked against the stored match in domain/matches.ts).
export const newMatchSchema = z.object(matchFields).refine((m) => m.startedAt == null || m.finishedAt == null || m.finishedAt >= m.startedAt, {
  message: END_BEFORE_START_CODE,
  path: ['finishedAt'],
});
export const matchPatchSchema = z.object(matchFields).partial();
/** PUT /matches/:id/player-of-match – the Player of the Match (a player id of this match). */
export const potmSchema = z.object({ playerId: z.string().regex(/^[A-Za-z0-9_:-]{1,140}$/) }).strict();

export const progressSchema = z.object({
  events: eventsSchema,
  status: z.enum(['scheduled', 'live', 'finished', 'abandoned']).optional(),
  startedAt: ms.nullable().optional(),
  finishedAt: ms.nullable().optional(),
});

/** POST /me/terms/accept – exactly the current version (checked in domain/terms.ts). */
export const termsAcceptSchema = z.object({ version: z.string().max(40) }).strict();
/** POST /matches/:id/reject – optional reason, plain one-line text, max 200. */
export const rejectSchema = z.object({ reason: optText('rejectReason') }).strict();
/** POST /admin/matches/:id/review */
export const reviewSchema = z.object({ decision: z.enum(['approve', 'void']) }).strict();

export const profileSchema = z.object({
  id,
  // 1.3.7 (R136-12): optional and ignored – the server stores first + last as the display name
  name: z.string().max(200).optional(),
  // Indian format is enforced in users.saveProfile when the number is set or changed; a profile
  // registered before build 216 with another format can still be saved unchanged (fix-retest N4).
  phone: z.string().min(1).max(20),
  photoURL: z.string().max(MAX_URL_LENGTH).nullable().optional(),
  position: z.enum(['setter', 'outside', 'middle', 'opposite', 'libero', 'any']).default('any'),
  city: optText('city'),
  // 1.3.6 registration (checked by core/registration.ts in users.saveProfile; optional so a client
  // from before 1.3.6 can still save, and the app asks for them).
  firstName: z.string().max(200).optional(),
  lastName: z.string().max(200).optional(),
  dob: z.string().max(20).optional(),
  email: z.string().max(300).nullable().optional(),
  pincode: z.string().max(20).optional(),
  district: z.string().max(200).nullable().optional(),
  state: z.string().max(200).nullable().optional(),
});

export const pushTokenSchema = z.object({ token: z.string().min(10).max(255), platform: z.string().max(16).optional() });

export const newTeamSchema = z.object({
  name: text('teamName'),
  color: hexColor,
  captainId: id,
  memberIds: z.array(id),
  subIds: z.array(id).default([]),
  pendingPhones: z.array(phoneE164).default([]),
  city: optText('city'),
});
export const teamPatchSchema = z
  .object({
    name: text('teamName'),
    color: hexColor,
    captainId: id,
    memberIds: z.array(id).max(50),
    subIds: z.array(id).max(50),
    // Only newly added numbers must be Indian mobiles (teams.ts decideTeamUpdate): a legacy invite
    // stored before the format rule passes through unchanged and can still be removed (QA retest
    // 217 #3). The bound keeps junk out of the request.
    pendingPhones: z.array(z.string().min(1).max(32)).max(50),
    city: optText('city'),
  })
  .partial();

export const newChallengeSchema = z.object({
  fromTeamId: id,
  fromTeamName: z.string().max(LIMITS.teamName.max).optional(), // must equal the team's name (QA G19)
  fromCaptainId: id,
  toTeamId: id,
  toTeamName: z.string().max(LIMITS.teamName.max).optional(),
  toCaptainId: id,
  when: ms,
  location: placeSchema,
  message: optText('challengeMessage', { multiline: true }),
  rules: ruleSetSchema,
  status: z.string().optional(),
});
export const challengePatchSchema = z
  .object({ status: z.enum(['pending', 'accepted', 'declined', 'cancelled']), matchId: z.string().max(64).nullable() })
  .partial();

export const tournamentTeamSchema = z.object({ id: z.string().min(1).max(64), name: text('sideName'), color: hexColor });
export const fixtureSchema = z.object({
  id: z.string().min(1).max(64),
  round: z.number().int().min(1).max(999),
  index: z.number().int().min(0).max(9999),
  homeId: z.string().max(64).nullable(),
  awayId: z.string().max(64).nullable(),
  homeFrom: z.string().max(64).optional(),
  awayFrom: z.string().max(64).optional(),
  matchId: z.string().max(64).optional(),
});
const tournamentFields = {
  name: text('tournamentName'),
  organizerId: id,
  format: z.enum(['knockout', 'league']),
  rules: ruleSetSchema,
  startDate: ms,
  endDate: ms,
  location: placeSchema,
  teams: z.array(tournamentTeamSchema).max(MAX_TOURNAMENT_TEAMS),
  fixtures: z.array(fixtureSchema).max(2000),
  status: z.enum(['registration', 'running', 'finished']),
};
export const newTournamentSchema = z.object(tournamentFields);
export const tournamentPatchSchema = z.object(tournamentFields).partial();

export const newCourtSchema = z.object({
  name: text('courtName'),
  location: placeSchema,
  surface: z.enum(['indoor', 'beach', 'grass', 'outdoor']),
  addedBy: id,
});
export const courtPatchSchema = newCourtSchema.partial();

export function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  const r = schema.safeParse(body);
  if (!r.success) {
    const first = r.error.issues[0];
    if (first.message === INVALID_PHONE_MESSAGE) throw new HttpError(400, INVALID_PHONE_CODE, `Invalid request: ${first.path.join('.') || 'phone'} – ${first.message}`);
    if (INPUT_CODES.has(first.message)) {
      const params = (first as { params?: { min?: number; max?: number } }).params ?? {};
      throw new HttpError(400, first.message, `Invalid request: ${first.path.join('.') || 'body'} – ${first.message}`, { field: first.path.join('.') || undefined, ...params });
    }
    throw badRequest(`Invalid request: ${first.path.join('.') || 'body'} – ${first.message}`);
  }
  return r.data;
}
