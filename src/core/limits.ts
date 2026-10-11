/**
 * One table of text limits shared by the app (maxLength + form checks), the API server (zod) and
 * firestore.rules (nameOk / textOk: the numbers are repeated there, and rules-tests check they match).
 * Lengths are counted in Unicode code points after cleanText() (NFC, zero-width removed, trimmed).
 * Validation is on write only: stored documents are never rewritten.
 */
export interface TextLimit {
  /** Minimum length after cleaning. 0 = optional (empty is stored as no value). */
  min: number;
  max: number;
}

export const LIMITS = {
  profileName: { min: 2, max: 60 },
  city: { min: 0, max: 80 },
  teamName: { min: 2, max: 40 },
  /** A match side's display name (team name or "Team A" for a side built by number). */
  sideName: { min: 1, max: 40 },
  playerName: { min: 1, max: 60 },
  matchTitle: { min: 0, max: 120 },
  tournamentName: { min: 3, max: 80 },
  courtName: { min: 2, max: 80 },
  placeName: { min: 1, max: 160 },
  challengeMessage: { min: 0, max: 500 },
  teamSearch: { min: 0, max: 40 },
  /** Reason when the opposing captain rejects a result (1.3.0, core/antifraud.ts REJECT_REASON_MAX). */
  rejectReason: { min: 0, max: 200 },
} as const satisfies Record<string, TextLimit>;

export type LimitKey = keyof typeof LIMITS;

/** Match event log cap (a 5-set match is a few hundred events). */
export const MAX_EVENTS = 2000;
/** Upper bound on any stored set score (rule set fields are 1..99, deuce can run past them). */
export const MAX_SCORE = 199;
/** Photo uploads: more than 0 bytes and strictly below 10 MB (server, storage.rules and the app). */
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const MIN_IMAGE_BYTES = 1;
/**
 * 1.3.4 (QA D133-2): photos per match. Neither the PRD nor this file had a number, so 50 was chosen.
 * Enforced by the app (picker shows the slots left), the demo backend and the API server. The
 * Firestore/Storage rules can't count documents, so on Firebase the app enforces it (documented limit).
 */
export const MAX_PHOTOS_PER_MATCH = 50;
/** Photos picked at once from the gallery (services/camera MAX_GALLERY_PICK). */
export const MAX_PHOTOS_PER_BATCH = 10;
/**
 * Max teams in a tournament (QA G8, retest 217): the Firestore rules can read 10 documents per
 * request, so they check registration (1 read per team) and duplicates for every team only up to
 * 10. The app, the API server (schemas.ts tournamentSchema) and the rules all use this cap.
 */
export const MAX_TOURNAMENT_TEAMS = 10;
/**
 * Team / side colours: exactly #RRGGBB (QA retest 217 #5). The same pattern in the app
 * (validate.ts), the API (schemas.ts hexColor) and firestore.rules (colorOk, sideOk).
 */
export const HEX_COLOR_RE = /^#[0-9A-Fa-f]{6}$/;
/** URLs we store (photos). */
export const MAX_URL_LENGTH = 2048;

/** 1.3.4: photos used / left in a match (uploaded + still queued), against MAX_PHOTOS_PER_MATCH. */
export function photoSlots(uploaded: number, queued: number) {
  const used = Math.max(0, uploaded) + Math.max(0, queued);
  return { used, left: Math.max(0, MAX_PHOTOS_PER_MATCH - used) };
}
