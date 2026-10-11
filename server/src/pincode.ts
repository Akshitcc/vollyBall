/**
 * 1.3.6 pincode lookup (India Post data via api.postalpincode.in): short timeout, in-memory cache,
 * feature flag. Only a definite "No records found" rejects a pincode; a timeout or any other failure
 * means "unknown" and the format check alone decides (core/registration.ts).
 */
import { parsePincodeResponse, PINCODE_RE, type PincodeInfo } from '../../src/core/registration';
import { log } from './ops/logger';

type FetchFn = (url: string, init: { signal: AbortSignal }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export class PincodeLookup {
  private cache = new Map<string, { at: number; info: PincodeInfo }>();
  constructor(
    readonly enabled = true,
    private fetchFn: FetchFn = fetch as unknown as FetchFn,
    readonly timeoutMs = 3000,
    private ttlMs = 24 * 3600_000,
    private now: () => number = Date.now,
    private baseUrl = 'https://api.postalpincode.in/pincode/',
  ) {}

  async lookup(pin: string): Promise<PincodeInfo> {
    if (!PINCODE_RE.test(pin)) return { status: 'invalid' };
    if (!this.enabled) return { status: 'unknown' };
    const hit = this.cache.get(pin);
    if (hit && this.now() - hit.at < this.ttlMs) return hit.info;
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), this.timeoutMs);
    let info: PincodeInfo = { status: 'unknown' };
    try {
      const res = await this.fetchFn(this.baseUrl + pin, { signal: ctl.signal });
      if (res.ok) info = parsePincodeResponse(await res.json());
    } catch (e) {
      log.warn('pincode lookup failed; accepting on format', { error: (e as Error)?.name ?? 'error' });
    } finally {
      clearTimeout(timer);
    }
    // don't cache "unknown" (the service may be back in a minute)
    if (info.status !== 'unknown') {
      if (this.cache.size > 20_000) this.cache.clear();
      this.cache.set(pin, { at: this.now(), info });
    }
    return info;
  }
}
