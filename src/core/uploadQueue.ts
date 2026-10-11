/**
 * Offline queue for live match photos – the pure part (state changes, retry timing, which errors
 * are worth retrying). src/services/photoQueue.ts stores the queue in AsyncStorage and runs it.
 */

export interface QueuedPhoto {
  id: string;
  matchId: string;
  uid: string;
  /** Local file URI from the camera / gallery. */
  uri: string;
  addedAt: number;
  /** Failed attempts so far. */
  tries: number;
  /** Not before this time (ms). */
  nextAt: number;
}

/** Retry delay after `tries` failed attempts: 5 s, 15 s, 30 s, 1 min, 2 min, then every 5 min. */
export const MAX_RETRY_DELAY = 300_000;
export function retryDelay(tries: number): number {
  const steps = [5_000, 15_000, 30_000, 60_000, 120_000];
  if (tries <= 0) return 0;
  return tries <= steps.length ? steps[tries - 1] : MAX_RETRY_DELAY;
}

/** Drop a queued photo after this long (a week) – the local file is probably gone by then. */
export const QUEUE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * An upload error that retrying won't fix: refused (not a player/scorer, not signed in), the file
 * itself is bad (type/size/empty), or the match is gone. Anything else (network down, timeouts,
 * 5xx) is retried later.
 */
export function isPermanentUploadError(e: unknown): boolean {
  const err = (e ?? {}) as { code?: unknown; status?: unknown; message?: unknown };
  const code = typeof err.code === 'string' ? err.code : '';
  const status = typeof err.status === 'number' ? err.status : 0;
  const msg = typeof err.message === 'string' ? err.message : String(e);
  if (/^photo_(type|empty|too_large|url|not_allowed|truncated|unreadable|wrong_account|duplicate|limit)$/.test(code)) return true;
  if (/permission|unauthorized|unauthenticated|not-found/i.test(code)) return true;
  if (status >= 400 && status < 500 && status !== 408 && status !== 429) return true;
  if (/Match not found|insufficient permissions|permission[-_ ]denied/i.test(msg)) return true;
  return false;
}

export function enqueue(q: readonly QueuedPhoto[], item: Omit<QueuedPhoto, 'tries' | 'nextAt'>): QueuedPhoto[] {
  return [...q, { ...item, tries: 0, nextAt: item.addedAt }];
}
export const removeItem = (q: readonly QueuedPhoto[], id: string) => q.filter((x) => x.id !== id);
export function markFailed(q: readonly QueuedPhoto[], id: string, now: number): QueuedPhoto[] {
  return q.map((x) => (x.id === id ? { ...x, tries: x.tries + 1, nextAt: now + retryDelay(x.tries + 1) } : x));
}
/** Items due now (oldest first), skipping expired ones. */
export const dueItems = (q: readonly QueuedPhoto[], now: number) =>
  q.filter((x) => x.nextAt <= now && now - x.addedAt < QUEUE_MAX_AGE_MS).sort((a, b) => a.addedAt - b.addedAt);
export const dropExpired = (q: readonly QueuedPhoto[], now: number) => q.filter((x) => now - x.addedAt < QUEUE_MAX_AGE_MS);
/** When to look again (ms from now), or null with nothing waiting. */
export function nextWake(q: readonly QueuedPhoto[], now: number): number | null {
  if (!q.length) return null;
  return Math.max(0, Math.min(...q.map((x) => x.nextAt)) - now);
}
/** Parse a stored queue defensively (bad JSON or bad items are dropped). */
export function parseQueue(raw: string | null): QueuedPhoto[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    if (!Array.isArray(v)) return [];
    return v.filter(
      (x) => x && typeof x.id === 'string' && typeof x.matchId === 'string' && typeof x.uid === 'string' && typeof x.uri === 'string' && Number.isFinite(x.addedAt),
    ).map((x) => ({ ...x, tries: Number(x.tries) || 0, nextAt: Number(x.nextAt) || 0 }));
  } catch {
    return [];
  }
}
