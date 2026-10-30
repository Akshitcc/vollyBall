/**
 * 1.5.9 (Tester F158-3): the Firebase profile is two documents (firestore.rules users/{uid}):
 *   users/{uid}                  PUBLIC – any signed-in user reads it: PUBLIC_PROFILE_KEYS only
 *   users/{uid}/private/profile  owner only: mobile number, playing position, city
 *   users/{uid}/private/registration (1.3.7) owner only: dob, email, pincode
 * Docs written by 1.5.8 and earlier ("legacy") still hold phone / position / city (and maybe pushToken) on the public
 * doc. Reading: the owner falls back to those fields until the private doc exists; nobody else ever gets them from
 * this app. Writing: the owner's next save moves them (same transaction, deleteField on the public doc);
 * scripts/migrate-private-profiles.js moves everyone's (local / approved runs only).
 */
import type { UserProfile } from '../../core/types';

export const PUBLIC_PROFILE_KEYS = ['id', 'name', 'photoURL', 'createdAt', 'updatedAt', 'firstName', 'lastName'] as const;
export const PRIVATE_PROFILE_KEYS = ['phone', 'position', 'city'] as const;
/** Fields a legacy public doc may still carry that must leave it. */
export const LEGACY_PUBLIC_KEYS = ['phone', 'position', 'city', 'pushToken'] as const;

type Doc = Record<string, unknown>;
export type PrivateProfile = { phone: string; position: UserProfile['position'] | null; city: string | null };

/** The legacy private fields still present on a public doc. */
export function legacyKeys(d: Doc | null | undefined): string[] {
  return d ? LEGACY_PUBLIC_KEYS.filter((k) => k in d) : [];
}

/** Another user's profile: the public fields only (phone '' like the API; no position or city, even on a legacy doc). */
export function publicView(id: string, d: Doc): UserProfile {
  const out: Doc = { id };
  for (const k of PUBLIC_PROFILE_KEYS) if (k !== 'id' && d[k] !== undefined) out[k] = d[k];
  return { ...out, phone: '' } as unknown as UserProfile;
}

/** The private fields of the owner: the private doc, else (legacy, not moved yet) the public doc's copies. */
export function privateOf(pub: Doc | null, priv: Doc | null): Partial<PrivateProfile> {
  const src = priv ?? pub ?? {};
  const out: Partial<PrivateProfile> = {};
  if (typeof src.phone === 'string') out.phone = src.phone;
  if (src.position != null) out.position = src.position as UserProfile['position'];
  if (typeof src.city === 'string') out.city = src.city;
  return out;
}

/** Your own profile = public doc + private profile (legacy fallback); no legacy pushToken. */
export function ownView(id: string, pub: Doc, priv: Doc | null): UserProfile {
  const base = publicView(id, pub) as unknown as Doc;
  const p = privateOf(pub, priv);
  return { ...base, phone: p.phone ?? '', ...(p.position != null ? { position: p.position } : {}), ...(p.city != null ? { city: p.city } : {}) } as unknown as UserProfile;
}

/** Split a profile the app saves into the public doc and the private profile doc. */
export function splitProfile(p: UserProfile): { pub: Doc; priv: PrivateProfile } {
  const pub: Doc = {};
  for (const k of PUBLIC_PROFILE_KEYS) {
    const v = (p as unknown as Doc)[k];
    if (v !== undefined) pub[k] = v;
  }
  return { pub, priv: { phone: p.phone, position: p.position ?? null, city: p.city ?? null } };
}
