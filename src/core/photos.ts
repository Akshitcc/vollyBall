/**
 * Photo checks shared by the app, the API server and (mirrored) storage.rules / firestore.rules.
 * Allowed types are decided by the file's magic bytes, never the declared content type alone.
 */
import { MAX_IMAGE_BYTES, MAX_URL_LENGTH, MIN_IMAGE_BYTES } from './limits';

/** Same list as storage.rules imageType() and the server (no SVG: it can carry script). */
export const IMAGE_TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'image/gif': 'gif',
};
export const IMAGE_TYPE_RE = /^image\/(jpeg|png|webp|heic|gif)$/;

const startsWith = (b: Uint8Array, sig: number[], at = 0) => b.length >= at + sig.length && sig.every((x, i) => b[at + i] === x);
const ascii = (b: Uint8Array, from: number, to: number) => String.fromCharCode(...Array.from(b.subarray(from, to)));

/** Content type from the first bytes, or null when it is not an allowed image. */
export function sniffImageType(b: Uint8Array): string | null {
  if (startsWith(b, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (b.length >= 6 && (ascii(b, 0, 6) === 'GIF87a' || ascii(b, 0, 6) === 'GIF89a')) return 'image/gif';
  if (b.length >= 12 && ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 12) === 'WEBP') return 'image/webp';
  if (b.length >= 12 && ascii(b, 4, 8) === 'ftyp' && /^(heic|heix|hevc|hevx|heim|heis|mif1|msf1)$/.test(ascii(b, 8, 12))) return 'image/heic';
  return null;
}

export type PhotoSizeProblem = 'empty' | 'tooLarge';
export function photoSizeProblem(bytes: number | null | undefined): PhotoSizeProblem | null {
  if (bytes == null) return null; // unknown size: the server / storage.rules still check it
  if (bytes < MIN_IMAGE_BYTES) return 'empty';
  if (bytes >= MAX_IMAGE_BYTES) return 'tooLarge';
  return null;
}

/**
 * Stored photo URLs: https on the project's Firebase Storage host
 * (https://firebasestorage.googleapis.com/v0/b/<bucket>/o/...), or the API server's own
 * signed /files/(avatars|matches)/... path in API mode. Anything else (javascript:, data:, http:,
 * other hosts) is rejected. firestore.rules use the same pattern (photoUrlOk).
 */
export function firebasePhotoUrlRe(bucket: string) {
  const b = bucket.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^https://firebasestorage\\.googleapis\\.com/v0/b/${b}/o/(avatars|matches)%2F[^\\s]+$`);
}
export const API_FILE_PATH_RE = /^\/files\/(avatars|matches)\/[A-Za-z0-9_:.\/-]+\.(jpg|png|webp|heic|gif)(\?[^\s]*)?$/;

export function isAllowedPhotoUrl(url: unknown, opts: { bucket?: string | null; apiBase?: string | null }): boolean {
  if (typeof url !== 'string' || url.length > MAX_URL_LENGTH) return false;
  if (opts.bucket && firebasePhotoUrlRe(opts.bucket).test(url)) return true;
  if (opts.apiBase) {
    const base = opts.apiBase.replace(/\/+$/, '');
    if (url.startsWith(base + '/') && /^https?:\/\//.test(base) && API_FILE_PATH_RE.test(url.slice(base.length))) return true;
  }
  return false;
}

export const PHOTO_ERROR_CODES = { badType: 'photo_type', empty: 'photo_empty', tooLarge: 'photo_too_large', badUrl: 'photo_url', truncated: 'photo_truncated', unreadable: 'photo_unreadable', duplicate: 'photo_duplicate', limit: 'photo_limit' } as const;

/**
 * Smallest file that can still be a whole image of each type (QA retest 217 #9): a bare GIF header
 * (6-13 bytes) passes the magic-byte check but has no image in it. The numbers are the smallest
 * valid 1x1 files of each format, rounded down (GIF 26, PNG 67, WebP 26, JPEG ~107-125, HEIC a few
 * hundred bytes).
 */
export const MIN_IMAGE_BYTES_BY_TYPE: Record<string, number> = {
  'image/gif': 26,
  'image/png': 67,
  'image/webp': 26,
  'image/jpeg': 100,
  'image/heic': 100,
};
/**
 * True when a file of the sniffed type is too short to hold an image, or (GIF) doesn't end with
 * the trailer byte 0x3B, i.e. it is only a header or was cut off.
 */
export function imageTruncated(type: string, b: Uint8Array): boolean {
  if (b.length < (MIN_IMAGE_BYTES_BY_TYPE[type] ?? 26)) return true;
  if (type === 'image/gif' && b[b.length - 1] !== 0x3b) return true;
  return false;
}

/**
 * Who may add photos to a match: the players of team A or B and the scorer (not the creator just for
 * creating it, not followers). Same check on the API server (domain/photos.ts), in firestore.rules
 * (photos create) and storage.rules (matches/{matchId}/{uid}/…).
 */
export function canAddMatchPhoto(
  m: { teamA: { players: readonly { id: string }[] }; teamB: { players: readonly { id: string }[] }; scorerId: string },
  uid: string | null | undefined,
): boolean {
  if (!uid) return false;
  return uid === m.scorerId || m.teamA.players.some((p) => p.id === uid) || m.teamB.players.some((p) => p.id === uid);
}

/** What the client knows about a picked file before uploading it (see services/photoFile.ts). */
export interface PhotoProbe {
  /** Declared type (blob.type / picker mimeType); '' when unknown. */
  declaredType: string;
  size: number;
  /** The first bytes (at least 16 when the file is that long). */
  head: Uint8Array;
  /** The last byte, or -1 for an empty file. */
  last: number;
}

/**
 * Client-side photo check, the same on every backend (QA NB-P3, 1.1.0 browser pass): the declared
 * type, if any, must be on the allow-list (an SVG or text file is refused, never relabelled as
 * JPEG); the magic bytes must be an allowed image; the size is between the per-type minimum and
 * MAX_IMAGE_BYTES; a GIF must end with its trailer. Returns the sniffed type, or an error code.
 */
export function checkPhotoProbe(p: PhotoProbe): { type: string; ext: string } | { error: string } {
  if (p.size <= 0) return { error: PHOTO_ERROR_CODES.empty };
  if (photoSizeProblem(p.size) === 'tooLarge') return { error: PHOTO_ERROR_CODES.tooLarge };
  const declared = (p.declaredType || '').toLowerCase().split(';')[0].trim();
  if (declared && declared !== 'application/octet-stream' && !IMAGE_TYPE_RE.test(declared === 'image/jpg' ? 'image/jpeg' : declared))
    return { error: PHOTO_ERROR_CODES.badType };
  const type = sniffImageType(p.head);
  if (!type) return { error: PHOTO_ERROR_CODES.badType };
  if (p.size < (MIN_IMAGE_BYTES_BY_TYPE[type] ?? 26) || (type === 'image/gif' && p.last !== 0x3b)) return { error: PHOTO_ERROR_CODES.truncated };
  return { type, ext: IMAGE_TYPES[type] };
}

/** File input accept list for the web picker (no stray comma, no image/*). */
export const PHOTO_ACCEPT = Object.keys(IMAGE_TYPES).join(',');
