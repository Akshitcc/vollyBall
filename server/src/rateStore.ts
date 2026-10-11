/**
 * Launch prep: where rate-limit counts live.
 *  - memory (default): per process, exact token buckets (RateLimiter's own). Correct for ONE instance;
 *    with several instances each keeps its own counts, so the effective limit is N times higher.
 *  - redis (REDIS_URL set): shared by every instance. Fixed windows sized so the average rate is the same
 *    as the token bucket's: `burst` requests per (burst / perMinute) minutes.
 */
import type { RedisClient } from './ops/redis';
import type { RateRule } from './rateLimit';

export interface RateStore {
  readonly kind: string;
  /** Takes one request from `key` under `rule`: 0 = allowed, else seconds to wait. */
  take(key: string, rule: RateRule): Promise<number>;
}

export class RedisRateStore implements RateStore {
  readonly kind = 'redis';
  constructor(
    private readonly redis: Pick<RedisClient, 'command'>,
    private readonly prefix = 'vl:rl:',
    private readonly now: () => number = Date.now,
  ) {}
  async take(key: string, rule: RateRule): Promise<number> {
    const windowMs = Math.max(1000, Math.round((rule.burst / rule.perMinute) * 60_000));
    const t = this.now();
    const start = Math.floor(t / windowMs) * windowMs;
    const k = `${this.prefix}${key}:${start}`;
    const n = Number(await this.redis.command(['INCR', k]));
    if (n === 1) await this.redis.command(['PEXPIRE', k, windowMs + 1000]);
    if (n <= rule.burst) return 0;
    return Math.max(1, Math.ceil((start + windowMs - t) / 1000));
  }
}
