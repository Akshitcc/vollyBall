/** Match photos and avatars on local disk (PhotoStorage). Port of storage.rules + the photos subcollection rules. */
import type { MatchPhoto } from '../../../src/core/types';
import type { Services } from '../context';
import { badRequest, forbidden, HttpError, invalidInput, notFound } from '../errors';
import { imageTruncated, PHOTO_ERROR_CODES, sniffImageType } from '../../../src/core/photos';
import { PHOTO_NOT_ALLOWED, PHOTO_NOT_ALLOWED_MESSAGE } from '../../../src/core/codedError';
import type { Identity } from '../auth/verifier';
import { topics } from '../live/bus';
import { IMAGE_TYPES, MAX_IMAGE_BYTES } from '../storage/photoStorage';
import { newId, nowDate, toMs } from './util';

/**
 * storage.rules isImage() plus QA G11: the type comes from the file's magic bytes, not the declared
 * Content-Type, so an HTML or SVG file labelled image/png is refused. The declared type must also
 * be an allowed image type, and the stored/served type is the sniffed one.
 */
export function checkImage(contentType: string | undefined, data: Buffer, rule: string): string {
  const declared = (contentType || '').split(';')[0].trim().toLowerCase();
  if (!IMAGE_TYPES[declared]) throw forbidden(rule, 'Only images (JPEG, PNG, WebP, HEIC, GIF) can be uploaded');
  if (!data.length) throw invalidInput(PHOTO_ERROR_CODES.empty, 'Empty upload');
  if (data.length >= MAX_IMAGE_BYTES) throw new HttpError(413, PHOTO_ERROR_CODES.tooLarge, 'Images must be smaller than 10 MB', { max: MAX_IMAGE_BYTES });
  const sniffed = sniffImageType(data);
  if (!sniffed) throw invalidInput(PHOTO_ERROR_CODES.badType, 'The file is not a JPEG, PNG, WebP, HEIC or GIF image');
  if (imageTruncated(sniffed, data)) throw invalidInput(PHOTO_ERROR_CODES.truncated, 'The image is incomplete (too small or cut off)');
  return sniffed;
}

interface PhotoRow {
  id: string;
  match_id: string;
  uploaded_by: string;
  storage_key: string;
  created_at: Date;
}
const photoFromRow = (s: Services, r: PhotoRow): MatchPhoto => ({
  id: r.id,
  matchId: r.match_id,
  url: s.storage.url(r.storage_key),
  storagePath: r.storage_key,
  uploadedBy: r.uploaded_by,
  createdAt: toMs(r.created_at)!,
});

export async function listPhotos(s: Services, matchId: string): Promise<MatchPhoto[]> {
  const rows: PhotoRow[] = await s.db('match_photos').where({ match_id: matchId }).orderBy('created_at', 'desc');
  return rows.map((r) => photoFromRow(s, r));
}

/**
 * photos create / storage matches/{matchId}/{userId}/{file}: only a player of this match (team A or
 * B) or its scorer – src/core/photos.ts canAddMatchPhoto(). The creator alone (not playing, not
 * scoring) and followers can't add photos.
 */
export async function canUpload(s: Services, matchId: string, uid: string): Promise<boolean> {
  const m = await s.db('matches').where({ id: matchId }).first('scorer_id');
  if (!m) throw notFound('Match not found');
  if (m.scorer_id === uid) return true;
  return !!(await s.db('match_players').where({ match_id: matchId, user_id: uid }).first('player_key'));
}

/** Idempotency-Key of a queued photo (src/core/uploadQueue.ts photoIdempotencyKey). */
export const IDEMPOTENCY_KEY_RE = /^[A-Za-z0-9_-]{8,64}$/;

export async function uploadPhoto(s: Services, viewer: Identity, matchId: string, contentType: string | undefined, data: Buffer, idempotencyKey?: string) {
  const rule = 'photos.create';
  // 403 with a code the app translates (src/core/codedError.ts PHOTO_NOT_ALLOWED); rule id kept in the message.
  if (!(await canUpload(s, matchId, viewer.uid))) throw new HttpError(403, PHOTO_NOT_ALLOWED, `${PHOTO_NOT_ALLOWED_MESSAGE} [${rule}]`);
  if (idempotencyKey != null && !IDEMPOTENCY_KEY_RE.test(idempotencyKey)) throw badRequest('Idempotency-Key must be 8-64 letters, digits, _ or -');
  // QA NB-P2: a retry of an upload that already succeeded (lost response, app killed before the
  // queue was saved) returns the stored photo instead of adding a duplicate.
  const existing = async () => {
    if (!idempotencyKey) return null;
    const r = await s.db('match_photos').where({ uploaded_by: viewer.uid, idempotency_key: idempotencyKey }).first();
    if (r && r.match_id !== matchId) throw new HttpError(409, 'idempotency_conflict', 'This Idempotency-Key was already used for another match');
    return r ? photoFromRow(s, r) : null;
  };
  const prior = await existing();
  if (prior) return prior;
  const type = checkImage(contentType, data, 'storage.matches.create');
  const id = newId();
  const key = `matches/${matchId}/${viewer.uid}/${id}.${IMAGE_TYPES[type]}`;
  await s.storage.put(key, data, type);
  try {
    await s.db('match_photos').insert({ id, match_id: matchId, uploaded_by: viewer.uid, storage_key: key, content_type: type, size_bytes: data.length, idempotency_key: idempotencyKey ?? null, created_at: nowDate() });
  } catch (e) {
    await s.storage.delete(key);
    // Two concurrent retries with the same key: the loser returns the winner's photo.
    const raced = (e as { code?: string }).code === 'ER_DUP_ENTRY' ? await existing() : null;
    if (raced) return raced;
    throw e;
  }
  s.bus.publish({ topic: topics.photos(matchId), type: 'invalidate' });
  const row = await s.db('match_photos').where({ id }).first();
  return photoFromRow(s, row);
}

/** photos delete / storage delete: uploadedBy == uid() */
export async function deletePhoto(s: Services, viewer: Identity, matchId: string, photoId: string) {
  const r = await s.db('match_photos').where({ id: photoId, match_id: matchId }).first();
  if (!r) throw notFound('Photo not found');
  if (r.uploaded_by !== viewer.uid) throw forbidden('photos.delete', 'Only the uploader can delete a photo');
  await s.db('match_photos').where({ id: photoId }).del();
  await s.storage.delete(r.storage_key);
  s.bus.publish({ topic: topics.photos(matchId), type: 'invalidate' });
}

/** storage avatars/{userId}/{file}: request.auth.uid == userId && isImage() */
export async function uploadAvatar(s: Services, viewer: Identity, uid: string, contentType: string | undefined, data: Buffer) {
  if (viewer.uid !== uid) throw forbidden('storage.avatars.write', 'You can only change your own photo');
  const type = checkImage(contentType, data, 'storage.avatars.write');
  const key = `avatars/${uid}/${newId()}.${IMAGE_TYPES[type]}`;
  await s.storage.put(key, data, type);
  return s.storage.url(key);
}

/**
 * "Memories" on a profile: photos from the matches this user played in (team A or B), newest first.
 * Reads mirror `allow read: if signedIn()` on the photos.
 */
export async function listMemories(s: Services, userId: string, limit = 60): Promise<MatchPhoto[]> {
  const rows: PhotoRow[] = await s
    .db('match_photos as ph')
    .whereIn('ph.match_id', s.db('match_players').where({ user_id: userId }).select('match_id'))
    .orderBy('ph.created_at', 'desc')
    .limit(Math.max(1, Math.min(limit, 200)))
    .select('ph.*');
  return rows.map((r) => photoFromRow(s, r));
}
