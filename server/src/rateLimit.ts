/**
 * QA C130-2 / X-07 (1.3.1): simple per-user rate limiting, in memory (no new dependency).
 *
 * A token bucket per (user, bucket): `burst` requests at once, refilled at `perMinute`. Over the limit
 * the API answers 429 `rate_limited` with `retryAfter` (seconds) and a Retry-After header; the app
 * shows a translated "slow down" message (src/i18n `errors.codes.rate_limited`).
 *
 * In memory means per server process: a restart forgets the counts and several processes each keep
 * their own. That is enough to stop bursts from one account (accept/confirm/reject spam, write floods);
 * a shared store would be needed behind a load balancer.
 */
import type { NextFunction, Request, Response } from 'express';
import { HttpError } from './errors';

export type RateBucket = 'terms' | 'verify' | 'matchWrite';
export interface RateRule {
  /** Requests allowed at once. */
  burst: number;
  /** Refill rate. */
  perMinute: number;
}
export type RateLimits = Record<RateBucket, RateRule>;

/**
 * Defaults. Scoring saves progress after every rally, and an offline queue can flush a backlog at
 * once, so match writes get a large burst; accepting T&C and confirming/rejecting are rare actions.
 */
export const DEFAULT_RATE_LIMITS: RateLimits = Object.freeze({
  terms: { burst: 5, perMinute: 5 },
  verify: { burst: 10, perMinute: 10 },
  matchWrite: { burst: 120, perMinute: 120 },
}) as RateLimits;

export const RATE_LIMITED = 'rate_limited';

export class RateLimiter {
  private buckets = new Map<string, { tokens: number; at: number }>();
  private lastSweep = 0;
  /** A copy per limiter (the defaults stay frozen); tests may lower a rule. */
  readonly limits: RateLimits;
  constructor(
    limits: RateLimits = DEFAULT_RATE_LIMITS,
    private readonly now: () => number = Date.now,
  ) {
    this.limits = { terms: { ...limits.terms }, verify: { ...limits.verify }, matchWrite: { ...limits.matchWrite } };
  }

  /** Forget every count (tests). */
  reset() {
    this.buckets.clear();
  }

  /** Takes one token; returns 0 when allowed, else the seconds until one is available. */
  take(uid: string, bucket: RateBucket): number {
    const rule = this.limits[bucket];
    const t = this.now();
    this.sweep(t);
    const key = `${bucket}\u0000${uid}`;
    const ratePerMs = rule.perMinute / 60_000;
    const b = this.buckets.get(key) ?? { tokens: rule.burst, at: t };
    b.tokens = Math.min(rule.burst, b.tokens + (t - b.at) * ratePerMs);
    b.at = t;
    if (b.tokens >= 1) {
      b.tokens -= 1;
      this.buckets.set(key, b);
      return 0;
    }
    this.buckets.set(key, b);
    return Math.max(1, Math.ceil((1 - b.tokens) / ratePerMs / 1000));
  }

  /** Drops buckets that have refilled completely (keeps memory bounded). */
  private sweep(t: number) {
    if (t - this.lastSweep < 60_000) return;
    this.lastSweep = t;
    for (const [key, b] of this.buckets) {
      const rule = this.limits[key.split('\u0000')[0] as RateBucket];
      if (b.tokens + (t - b.at) * (rule.perMinute / 60_000) >= rule.burst) this.buckets.delete(key);
    }
  }

  get size() {
    return this.buckets.size;
  }

  /** Express middleware for one bucket (after requireAuth, so the user id is known). */
  middleware(bucket: RateBucket) {
    return (req: Request, res: Response, next: NextFunction) => {
      const uid = req.identity?.uid;
      if (!uid) return next();
      const wait = this.take(uid, bucket);
      if (!wait) return next();
      res.setHeader('Retry-After', String(wait));
      next(new HttpError(429, RATE_LIMITED, 'Too many requests. Wait a moment and try again.', { retryAfter: wait }));
    };
  }
}
