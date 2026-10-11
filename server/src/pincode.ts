/**
 * 1.3.6 pincode lookup (India Post data via api.postalpincode.in): short timeout, in-memory cache,
 * feature flag. Only a definite "No records found" rejects a pincode; a timeout or any other failure
 * means "unknown" and the format check alone decides (core/registration.ts).
 */
import { isApsPincode, parsePincodeResponse, pincodePrefixOk, PINCODE_RE, type PincodeInfo } from '../../src/core/registration';
import { log } from './ops/logger';

type FetchFn = (url: string, init: { signal: AbortSignal }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

/**
 * 1.3.7 (R136-6): bounded and abuse-resistant. "ok" and "invalid" are cached for `ttlMs`, "unknown"
 * (upstream down or odd answer) for `unknownTtlMs` so repeats don't call out again; the cache holds at
 * most `maxEntries` pins (oldest dropped first); concurrent lookups of one pin share one request.
 * The route is signed-in only and rate limited per user and per IP (routes/api.ts).
 */
export class PincodeLookup {
  private cache = new Map<string, { at: number; ttl: number; info: PincodeInfo }>();
  private inflight = new Map<string, Promise<PincodeInfo>>();
  /** Outbound requests made (tests / ops). */
  calls = 0;
  constructor(
    readonly enabled = true,
    private fetchFn: FetchFn = fetch as unknown as FetchFn,
    readonly timeoutMs = 3000,
    private ttlMs = 24 * 3600_000,
    private now: () => number = Date.now,
    private baseUrl = 'https://api.postalpincode.in/pincode/',
    private unknownTtlMs = 10 * 60_000,
    readonly maxEntries = 5000,
  ) {}

  get size() {
    return this.cache.size;
  }

  async lookup(pin: string): Promise<PincodeInfo> {
    if (!PINCODE_RE.test(pin)) return { status: 'invalid' };
    // 1.3.7 (R136-16): an unallocated prefix (10, 29, 35, 54, 55, 86–89) is invalid without a lookup,
    // same as the demo; 9x (Army Postal Service) is still looked up.
    if (!pincodePrefixOk(pin) && !isApsPincode(pin)) return { status: 'invalid' };
    if (!this.enabled) return { status: 'unknown' };
    const hit = this.cache.get(pin);
    if (hit && this.now() - hit.at < hit.ttl) return hit.info;
    const pending = this.inflight.get(pin);
    if (pending) return pending;
    const p = this.fetchOne(pin).finally(() => this.inflight.delete(pin));
    this.inflight.set(pin, p);
    return p;
  }

  private async fetchOne(pin: string): Promise<PincodeInfo> {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), this.timeoutMs);
    let info: PincodeInfo = { status: 'unknown' };
    this.calls++;
    try {
      const res = await this.fetchFn(this.baseUrl + pin, { signal: ctl.signal });
      if (res.ok) info = parsePincodeResponse(await res.json());
    } catch (e) {
      log.warn('pincode lookup failed; accepting on format', { error: (e as Error)?.name ?? 'error' });
    } finally {
      clearTimeout(timer);
    }
    this.cache.delete(pin); // re-insert at the end (Map keeps insertion order: oldest first)
    while (this.cache.size >= this.maxEntries) this.cache.delete(this.cache.keys().next().value as string);
    this.cache.set(pin, { at: this.now(), ttl: info.status === 'unknown' ? this.unknownTtlMs : this.ttlMs, info });
    return info;
  }
}
