/**
 * 1.3.7 in-app review: WHEN the app may ask for a Google Play review (pure, tested).
 *
 * Asked only at a happy moment (the user's side won a finished match, or they are Player of the Match),
 * after at least MIN_COMPLETED completed matches, at most once every COOLDOWN_DAYS per user, and never
 * while live scoring. Reviews are never rewarded (no points, no badges, nothing).
 */
import { stripHidden } from './text';
import { CodedError } from './codedError';

export const REVIEW_RULES = Object.freeze({ MIN_COMPLETED: 3, COOLDOWN_DAYS: 60, RECENT_MINUTES: 10 });
export type ReviewMoment = 'won' | 'potm';

export interface ReviewContext {
  completedMatches: number;
  /** Last time this user was asked (ms), or null. */
  lastAskedAt: number | null;
  now: number;
  /** True on the live scoring screen (never ask there). */
  liveScoring: boolean;
  /** Why we'd ask now; null = not a happy moment. */
  moment: ReviewMoment | null;
}

export function reviewEligible(c: ReviewContext): boolean {
  if (c.liveScoring || !c.moment) return false;
  if (c.completedMatches < REVIEW_RULES.MIN_COMPLETED) return false;
  return c.lastAskedAt == null || c.now - c.lastAskedAt >= REVIEW_RULES.COOLDOWN_DAYS * 86_400_000;
}

/** The happy moment for `uid` in a finished match: POTM first, then a win of their side. */
export function reviewMomentFor(
  m: { status: string; summary?: { winner?: 'A' | 'B' | null } | null; playerOfMatchId?: string | null; teamA: { players: { id: string }[] }; teamB: { players: { id: string }[] } },
  uid: string,
): ReviewMoment | null {
  if (m.status !== 'finished') return null;
  if (m.playerOfMatchId === uid) return 'potm';
  const w = m.summary?.winner;
  if (!w) return null;
  return (w === 'A' ? m.teamA : m.teamB).players.some((p) => p.id === uid) ? 'won' : null;
}

/**
 * 1.3.8 (QA V137-4): WHEN on the match screen the happy moment is "now" – never just because an old won
 * match was opened:
 *  - the user just confirmed the result (opposing captain), or
 *  - the match finished (or got its Player of the Match) while the screen was open, or
 *  - it was opened right after it finished (within RECENT_MINUTES: the scorer lands here after the last
 *    rally / POTM pick).
 * `now` and `finishedAt` should be server times when the backend knows them.
 */
export function reviewTriggered(p: {
  confirmedNow?: boolean;
  /** As first seen on this screen. */
  openedFinished: boolean;
  openedWithPotm: boolean;
  finished: boolean;
  hasPotm: boolean;
  finishedAt: number | null | undefined;
  now: number;
}): boolean {
  if (p.confirmedNow) return true;
  if (!p.finished) return false;
  if (!p.openedFinished || (p.hasPotm && !p.openedWithPotm)) return true;
  const recent = REVIEW_RULES.RECENT_MINUTES * 60_000;
  return p.finishedAt != null && Math.abs(p.now - p.finishedAt) <= recent;
}

/** Play Store listing (the native sheet is used when available; see services/review.ts). */
export const PLAY_PACKAGE = 'com.volleylive.app';
export const PLAY_MARKET_URL = `market://details?id=${PLAY_PACKAGE}`;
export const PLAY_WEB_URL = `https://play.google.com/store/apps/details?id=${PLAY_PACKAGE}`;

/** Feedback (Profile > Send feedback): 1–5 stars, optional text up to FEEDBACK_MAX characters. */
export const FEEDBACK_MAX = 1000;
/**
 * Every backend (API server, demo, Firebase app) stores exactly this. 1.3.9 (V138-4): the text loses
 * every character of the shared hidden set (core/text.ts HIDDEN_CHARS) except newline and tab, so
 * firestore.rules (hiddenML()) never refuses what the app sends; the app version keeps only
 * [0-9A-Za-z.+- ()] (as the API always did) and is null when nothing is left.
 */
export function checkFeedback(f: { stars?: unknown; text?: unknown; appVersion?: unknown }): { stars: number; text: string; appVersion: string | null } {
  const stars = Number(f.stars);
  if (!Number.isInteger(stars) || stars < 1 || stars > 5) throw Object.assign(new CodedError('feedback_stars', 'Choose 1 to 5 stars'), { field: 'stars' });
  const text = stripHidden(String(f.text ?? ''), { multiline: true }).trim();
  if ([...text].length > FEEDBACK_MAX) throw Object.assign(new CodedError('feedback_too_long', 'Feedback is too long'), { field: 'text', max: FEEDBACK_MAX });
  const appVersion = typeof f.appVersion === 'string' ? f.appVersion.replace(/[^0-9A-Za-z.+\- ()]/g, '').trim().slice(0, 40) || null : null;
  return { stars, text, appVersion };
}
