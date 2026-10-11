import type { UserProfile } from '../../../src/core/types';
import { publicFileUrl, storedFileUrl, type Services } from '../context';
import { conflict, forbidden, HttpError, invalidInput, notFound } from '../errors';
import { INVALID_PHONE_CODE, INVALID_PHONE_MESSAGE, isValidE164 } from '../../../src/core/phone';
import { PHOTO_ERROR_CODES } from '../../../src/core/photos';
import type { Identity } from '../auth/verifier';
import { topics } from '../live/bus';
import { nowDate, toMs, type Trx } from './util';

interface UserRow {
  id: string;
  name: string;
  phone: string;
  photo_url: string | null;
  position: UserProfile['position'];
  city: string | null;
  /** 1.3.4: 0 = sign-up row created by GET /me, profile not saved yet. */
  profile_complete: number;
  created_at: Date;
}

/**
 * Phone privacy (tightened vs Firestore): a profile only includes the phone
 * number for its owner, or for a caller who already looked the user up by that number.
 */
export function profileFromRow(s: Services, r: UserRow, viewer: Identity, revealPhone = false): UserProfile {
  return {
    id: r.id,
    name: r.name,
    phone: viewer.uid === r.id || revealPhone ? r.phone : '',
    photoURL: publicFileUrl(s, r.photo_url),
    position: r.position,
    city: r.city ?? undefined,
    createdAt: toMs(r.created_at)!,
  };
}

/** Placeholder name of a sign-up row (users.name is NOT NULL, 1–60 characters); never shown. */
export const SIGNUP_ROW_NAME = 'New player';

/**
 * 1.3.4 hardening (c): the first authenticated GET /api/me creates a minimal users row – id and the
 * verified E.164 phone – so a sign-up appears in `users` before the profile is saved. Idempotent
 * (INSERT IGNORE: an existing row, or the number already belonging to another account, is left
 * alone). The row has profile_complete = 0, so until PUT /api/users/:id saves a profile it isn't a
 * profile: getProfile/getProfiles/findByPhone ignore it and the app still opens "Set up profile".
 */
export async function ensureSignupRow(s: Services, viewer: Identity): Promise<boolean> {
  if (!viewer.phone || !isValidE164(viewer.phone)) return false;
  if (await s.db('users').where({ id: viewer.uid }).first('id')) return false;
  const now = nowDate();
  const r = await s.db('users')
    .insert({ id: viewer.uid, name: SIGNUP_ROW_NAME, phone: viewer.phone, position: 'any', profile_complete: 0, created_at: now, updated_at: now })
    .onConflict()
    .ignore();
  return !!(Array.isArray(r) ? r[0] : r);
}

export async function getProfile(s: Services, viewer: Identity, uid: string): Promise<UserProfile | null> {
  const r = await s.db<UserRow>('users').where({ id: uid, profile_complete: 1 }).first();
  return r ? profileFromRow(s, r, viewer) : null;
}

export async function getProfiles(s: Services, viewer: Identity, uids: string[]): Promise<UserProfile[]> {
  const ids = uids.filter(Boolean);
  if (!ids.length) return [];
  const rows = await s.db<UserRow>('users').whereIn('id', ids).where({ profile_complete: 1 });
  return rows.map((r) => profileFromRow(s, r, viewer));
}

/** phoneIndex/{phone}: `allow get` (exact lookup) – there is deliberately no list/search by phone. */
export async function findByPhone(s: Services, viewer: Identity, phone: string): Promise<UserProfile | null> {
  const r = await s.db<UserRow>('users').where({ phone, profile_complete: 1 }).first();
  return r ? profileFromRow(s, r, viewer, true) : null;
}

export async function uidForPhone(db: Trx, phone: string): Promise<string | null> {
  const r = await db('users').where({ phone }).first('id');
  return r?.id ?? null;
}

/**
 * users/{userId} create/update: uid() == userId && phone == token phone && 1 <= name.size() <= 60.
 * phoneIndex/{phone} create/update: phone == myPhone() && uid == uid() – implied by the unique users.phone column.
 */
export async function saveProfile(
  s: Services,
  viewer: Identity,
  p: { id: string; name: string; phone: string; photoURL?: string | null; position: UserProfile['position']; city?: string | null },
) {
  if (viewer.uid !== p.id) throw forbidden('users.write', 'You can only edit your own profile');
  if (!viewer.phone || viewer.phone !== p.phone) throw forbidden('users.write', 'Profile phone must match your verified number');
  const existing = await s.db<UserRow>('users').where({ id: p.id }).first('phone', 'photo_url');
  // Indian mobile format when the number is being set or changed. A profile saved before build 216
  // with another format keeps working while the number stays the same (no data is rewritten; N4).
  if ((!existing || existing.phone !== p.phone) && !isValidE164(p.phone))
    throw new HttpError(400, INVALID_PHONE_CODE, `Invalid request: phone – ${INVALID_PHONE_MESSAGE}`, { field: 'phone' });
  // QA G3: a new photo must be one of our own uploads for this user (null clears it).
  const photo = storedFileUrl(s, p.photoURL);
  if (photo && photo !== (existing?.photo_url ?? null) && !photo.startsWith(`storage:avatars/${p.id}/`))
    throw invalidInput(PHOTO_ERROR_CODES.badUrl, 'Invalid request: photoURL – must be a photo uploaded to VolleyLive', { field: 'photoURL' });
  const taken = await s.db('users').where({ phone: p.phone }).whereNot({ id: p.id }).first('id');
  if (taken) throw conflict('This number already belongs to another account');
  const now = nowDate();
  await s.db('users')
    .insert({
      id: p.id,
      name: p.name,
      phone: p.phone,
      photo_url: photo,
      position: p.position,
      city: p.city ?? null,
      profile_complete: 1,
      created_at: now,
      updated_at: now,
    })
    .onConflict('id')
    .merge(['name', 'phone', 'photo_url', 'position', 'city', 'profile_complete', 'updated_at']);
  s.bus.publish({ topic: topics.profile(p.id), type: 'invalidate' });
  const r = await s.db<UserRow>('users').where({ id: p.id }).first();
  return profileFromRow(s, r!, viewer);
}

/** pushTokens/{userId}: read, write if uid() == userId. A token that moved to another account is re-assigned. */
export async function savePushToken(s: Services, viewer: Identity, token: string, platform?: string) {
  const user = await s.db('users').where({ id: viewer.uid }).first('id');
  if (!user) throw notFound('Create your profile first');
  const now = nowDate();
  await s.db('device_tokens')
    .insert({ user_id: viewer.uid, token, platform: platform ?? null, created_at: now, updated_at: now })
    .onConflict('token')
    .merge(['user_id', 'platform', 'updated_at']);
}

export async function deletePushToken(s: Services, viewer: Identity, token: string) {
  await s.db('device_tokens').where({ token, user_id: viewer.uid }).del();
}
