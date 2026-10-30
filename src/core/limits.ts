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

/** Match event log cap. */
// 1.4.4 (QA info): 3000 (was 2000, which a legal long uncapped deuce match can reach – Tester's 667:667). About 2.5x
// the longest realistic match (4 sets of 120-118 + 100-98 ≈ 1150 rallies plus timeouts). Not higher: on Firebase a
// re-credit of a 4000-event log with real 28-character uids hit the rules' 5 MiB variable-memory limit (measured,
// rules-tests "worst case"). firestore.rules eventsStepOk uses the same number (rules-tests check it).
export const MAX_EVENTS = 3000;
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
 * Max teams in a tournament. 1.4.27 (Akshit, E2E-4): raised from 10 to 32 in the app, the API server
 * (schemas.ts tournamentSchema), the demo and the Firestore rules. The rules can read only 10 documents per request,
 * so they check registration (1 read per team) for the first 10 teams; every team id is format-checked and
 * duplicates are refused for all 32, and every fixture match is created through the match rules, which check its
 * team and members. The API server checks every team.
 */
export const MAX_TOURNAMENT_TEAMS = 32;
/** 1.5.8 (QA V1426-3): the most fixtures the app generates – a 32-team league (32*31/2); firestore.rules uses 496 too. */
export const MAX_TOURNAMENT_FIXTURES = (MAX_TOURNAMENT_TEAMS * (MAX_TOURNAMENT_TEAMS - 1)) / 2;
/** 1.4.27: the Firestore rules read (get) the team documents of this many tournament teams. */
export const RULES_TEAM_READS = 10;
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
