/**
 * 1.4.19 Help Center > Contact us: support tickets. One validation for the app, the demo backend, the API server and
 * (mirrored) the Firestore / storage rules. A signed-in user creates tickets and reads only their own; only app
 * admins read every ticket and set its status (open → replied → closed, any order).
 */
import { CodedError } from './codedError';
import { stripHiddenKeepJoiners, visibleLength } from './text';

export const SUPPORT_TOPICS = ['account', 'teams', 'match', 'scoring', 'wallet', 'tournament', 'bug', 'other'] as const;
export type SupportTopic = (typeof SUPPORT_TOPICS)[number];
export const SUPPORT_STATUSES = ['open', 'replied', 'closed'] as const;
export type SupportStatus = (typeof SUPPORT_STATUSES)[number];
export const SUPPORT_MESSAGE_MIN = 10;
export const SUPPORT_MESSAGE_MAX = 2000; // 1.4.21 (QA V1420-4): VISIBLE characters (graphemes) – counter, cut and check agree
export const SUPPORT_MESSAGE_MAX_CODE_POINTS = 8000; // storage backstop (migration 0022 column width)
/** Screenshot: from the gallery, JPEG / PNG / WebP only, above 0 and below 5 MB (storage.rules supportImage()). */
export const SUPPORT_IMAGE_TYPES: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
export const SUPPORT_IMAGE_MAX_BYTES = 5 * 1024 * 1024;

export interface SupportTicket {
  id: string;
  userId: string;
  userName?: string | null;
  topic: SupportTopic;
  message: string;
  appVersion: string | null;
  status: SupportStatus;
  /** Download / signed URL for the owner and admins (null = none). */
  screenshotUrl: string | null;
  createdAt: number;
  updatedAt: number;
}
export interface NewSupportTicket {
  topic: string;
  message: string;
  appVersion?: string | null;
  /** Local uri (from the gallery) – uploaded by the backend. */
  screenshot?: { uri: string; type?: string | null; size?: number | null } | null;
}

const bad = (code: string, message: string, field: string, extra: object = {}) => Object.assign(new CodedError(code, message), { field, ...extra });

export function checkSupportTicket(t: { topic?: unknown; message?: unknown; appVersion?: unknown }): { topic: SupportTopic; message: string; appVersion: string | null } {
  // 1.4.20 (QA Help Center Lows): a number / array / object is refused, never turned into text
  if (typeof t.topic !== 'string') throw bad('support_topic', 'Choose a topic', 'topic');
  if (typeof t.message !== 'string') throw bad('support_message_type', 'The message must be text', 'message');
  const topic = t.topic as SupportTopic;
  if (!SUPPORT_TOPICS.includes(topic)) throw bad('support_topic', 'Choose a topic', 'topic');
  const message = stripHiddenKeepJoiners(String(t.message ?? ''), { multiline: true }).trim(); // 1.4.22 (V1421-2): emoji ZWJ kept
  const n = visibleLength(message);
  if (n < SUPPORT_MESSAGE_MIN) throw bad('support_message_short', 'Please describe the problem', 'message', { min: SUPPORT_MESSAGE_MIN });
  if (n > SUPPORT_MESSAGE_MAX || [...message].length > SUPPORT_MESSAGE_MAX_CODE_POINTS) throw bad('support_message_long', 'The message is too long', 'message', { max: SUPPORT_MESSAGE_MAX });
  const appVersion = typeof t.appVersion === 'string' ? t.appVersion.replace(/[^0-9A-Za-z.+\- ()]/g, '').trim().slice(0, 40) || null : null;
  return { topic, message, appVersion };
}

/** null = ok, else an error code (support_image_type / support_image_size). Size unknown (web blobs) → checked on upload. */
export function supportImageProblem(type: string | null | undefined, size: number | null | undefined): string | null {
  if (!type || !SUPPORT_IMAGE_TYPES[type.toLowerCase()]) return 'support_image_type';
  if (size != null && (size <= 0 || size >= SUPPORT_IMAGE_MAX_BYTES)) return 'support_image_size';
  return null;
}
export function assertSupportImage(type: string | null | undefined, size: number | null | undefined) {
  const p = supportImageProblem(type, size);
  if (p) throw bad(p, p === 'support_image_type' ? 'Screenshots must be JPEG, PNG or WebP' : 'Screenshots must be smaller than 5 MB', 'screenshot', { max: SUPPORT_IMAGE_MAX_BYTES });
}

/**
 * 1.4.20 (QA V1419-6 / Help Center Lows): ONE rate rule for tickets on the API and the demo – 5 at once, then 1 more
 * every 12 minutes (a token bucket). Only tickets that were accepted count.
 */
export const SUPPORT_RATE = Object.freeze({ burst: 5, perMinute: 1 / 12 });
/** Seconds until another ticket is allowed, from the times of the accepted ones (0 = now). Same maths as the API. */
export function supportRateWait(times: number[], now: number, rule: { burst: number; perMinute: number } = SUPPORT_RATE): number {
  const perMs = rule.perMinute / 60_000;
  let tokens = rule.burst;
  let at: number | null = null;
  for (const x of [...times].sort((a, b) => a - b)) {
    if (at != null) tokens = Math.min(rule.burst, tokens + (x - at) * perMs);
    tokens -= 1;
    at = x;
  }
  if (at != null) tokens = Math.min(rule.burst, tokens + (now - at) * perMs);
  return tokens >= 1 - 1e-9 ? 0 : Math.max(1, Math.ceil((1 - tokens) / perMs / 1000 - 1e-6));
}

export const NOT_SUPPORT_ADMIN = 'admin_only';
export function checkSupportStatus(status: unknown): SupportStatus {
  if (!SUPPORT_STATUSES.includes(status as SupportStatus)) throw bad('support_status', 'Unknown status', 'status');
  return status as SupportStatus;
}
/** Owner or admin may read a ticket. */
export const canReadTicket = (t: { userId: string }, uid: string | null | undefined, admin: boolean) => admin || (!!uid && t.userId === uid);
