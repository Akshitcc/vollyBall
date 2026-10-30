/**
 * 1.5.9 (Tester F158-3): limits on looking people up by mobile number.
 *
 * - PHONE_LOOKUP_RATE: the API server's per-user / per-IP token buckets (server/src/routes/api.ts uses this object;
 *   since 1.5.9 a team invite takes from the same buckets, F158-2).
 * - PHONE_LOOKUP_RULES: what firestore.rules can enforce on the Firebase backend – a fixed window per account
 *   (phoneLookups/{uid}: at most `limit` different numbers per `windowS` seconds). Firestore has no per-IP view.
 *   rules-tests compare these numbers with phoneLookupLimit() / phoneLookupWindowS().
 * - The app also throttles itself with the API's per-user bucket (phoneLookupWait), so a burst is refused on the phone
 *   before it reaches either backend.
 */
import { supportRateWait } from './support';

export const PHONE_LOOKUP_RATE = Object.freeze({ user: Object.freeze({ burst: 30, perMinute: 10 }), ip: Object.freeze({ burst: 100, perMinute: 40 }) });
export const PHONE_LOOKUP_RULES = Object.freeze({ limit: 60, windowS: 3600 });

const recent = new Map<string, number[]>();
/** Seconds until this account may look up another number on this phone (0 = now); records the lookup when 0. */
export function phoneLookupWait(uid: string, now: number = Date.now()): number {
  const mine = (recent.get(uid) ?? []).filter((x) => now - x < 3_600_000);
  const wait = supportRateWait(mine, now, PHONE_LOOKUP_RATE.user);
  if (!wait) mine.push(now);
  recent.set(uid, mine);
  return wait;
}
/** Tests. */
export const resetPhoneLookupWait = () => recent.clear();
