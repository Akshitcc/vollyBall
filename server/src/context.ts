/** Everything a request handler needs, injected once at startup (tests pass fakes). */
import type { Db } from './db/knex';
import type { LiveBus } from './live/bus';
import type { PushSender } from './push/pushSender';
import type { PhotoStorage } from './storage/photoStorage';
import type { TokenVerifier } from './auth/verifier';
import type { RateLimiter } from './rateLimit';

export interface Services {
  db: Db;
  verifier: TokenVerifier;
  storage: PhotoStorage;
  push: PushSender;
  bus: LiveBus;
  publicBaseUrl: string;
  corsOrigins: string[];
  /** 1.3.0: admin allow-list (config ADMIN_UIDS). Missing/empty = nobody is an admin. */
  adminUids?: ReadonlySet<string>;
  /** 1.3.1 (QA C130-2): per-user limits; default DEFAULT_RATE_LIMITS when not given. */
  rateLimiter?: RateLimiter;
  /** Pushes are fire-and-forget; tests can await them through this hook. */
  pending?: Set<Promise<unknown>>;
}

export const isAdmin = (s: Services, uid: string): boolean => !!s.adminUids?.has(uid);

const STORED_PREFIX = 'storage:';

/** Photo URLs are stored as `storage:<key>` and signed on the way out (links expire). */
export function publicFileUrl(s: Services, stored: string | null | undefined): string | null {
  if (!stored) return stored ?? null;
  return stored.startsWith(STORED_PREFIX) ? s.storage.url(stored.slice(STORED_PREFIX.length)) : stored;
}

/** Turns one of our signed URLs back into `storage:<key>`; other URLs are kept as given. */
export function storedFileUrl(s: Services, url: string | null | undefined): string | null {
  if (!url) return null;
  const prefix = `${s.publicBaseUrl}/files/`;
  if (url.startsWith(prefix)) return STORED_PREFIX + decodeURIComponent(url.slice(prefix.length).split('?')[0]);
  if (url.startsWith(STORED_PREFIX)) return url;
  return url;
}

/** Sends a push to every device of the given users (after the DB commit). */
export function notify(s: Services, uids: string[], title: string, body: string, data: Record<string, string>) {
  const job = (async () => {
    const ids = [...new Set(uids)].filter(Boolean);
    if (!ids.length) return;
    const rows: { token: string }[] = await s.db('device_tokens').whereIn('user_id', ids).select('token');
    if (!rows.length) return;
    const res = await s.push.send(rows.map((r) => ({ to: r.token, title, body, data })));
    if (res.invalidTokens.length) await s.db('device_tokens').whereIn('token', res.invalidTokens).del();
  })().catch((e) => console.warn('[push] failed:', e instanceof Error ? e.message : e));
  s.pending?.add(job);
  job.finally(() => s.pending?.delete(job));
}
