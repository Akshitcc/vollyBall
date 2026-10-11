/**
 * Reads a picked photo (file://, content://, blob: or data: URI) and checks it on the client, the
 * same way on every backend (demo, API, Firebase): allow-listed type, magic bytes, per-type
 * minimum and 10 MB maximum (core/photos.ts checkPhotoProbe). Only the first bytes and the last
 * byte are read (Blob.slice + FileReader works on web and React Native alike).
 *
 * A URI that can no longer be read (a web blob: URL after a reload, a deleted cache file) is a
 * permanent `photo_unreadable` error, so the offline queue drops it at once (QA NB-P4).
 */
import { sha256Hex } from '../core/sha256';
import { CodedError } from '../core/codedError';
import { checkPhotoProbe, PHOTO_ERROR_CODES } from '../core/photos';

export interface ReadPhoto {
  blob: Blob;
  type: string;
  ext: string;
  size: number;
}

const MESSAGES: Record<string, string> = {
  photo_type: 'Only JPEG, PNG, WebP, HEIC or GIF photos can be added',
  photo_empty: 'That file is empty',
  photo_too_large: 'Photos must be smaller than 10 MB',
  photo_truncated: 'That photo is incomplete or damaged',
  photo_unreadable: 'That photo is no longer available on this device',
  photo_duplicate: 'This photo is already in this match',
  photo_limit: 'This match already has the maximum number of photos',
};
export const photoError = (code: string) => new CodedError(code, MESSAGES[code] ?? code);

async function readBytes(b: Blob): Promise<Uint8Array> {
  const ab = (b as Blob & { arrayBuffer?: () => Promise<ArrayBuffer> }).arrayBuffer;
  if (typeof ab === 'function') {
    try {
      return new Uint8Array(await ab.call(b));
    } catch {
      // React Native blobs may not implement arrayBuffer(): fall back to FileReader below
    }
  }
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onerror = () => reject(r.error ?? new Error('read failed'));
    r.onload = () => {
      const url = String(r.result ?? '');
      const b64 = url.slice(url.indexOf(',') + 1);
      const bin = globalThis.atob ? globalThis.atob(b64) : '';
      const out = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
      resolve(out);
    };
    r.readAsDataURL(b);
  });
}

async function fetchBlob(uri: string): Promise<Blob> {
  try {
    const res = await fetch(uri);
    if (!res.ok && res.status !== 0) throw new Error(`HTTP ${res.status}`);
    return await res.blob();
  } catch {
    throw photoError(PHOTO_ERROR_CODES.unreadable);
  }
}

/** 1.3.4 (QA D133-3): sha256 (hex) of the whole image, for per-match de-duplication. */
export async function blobSha256(b: Blob): Promise<string> {
  return sha256Hex(await readBytes(b));
}

/** Reads and checks a photo; throws a CodedError (photo_type / photo_empty / …) when it is refused. */
export async function readPhoto(uri: string, declaredType?: string | null): Promise<ReadPhoto> {
  const blob = await fetchBlob(uri);
  const size = blob.size;
  let head: Uint8Array = new Uint8Array(0);
  let last = -1;
  if (size > 0) {
    try {
      head = await readBytes(blob.slice(0, Math.min(size, 32)));
      last = size > 32 ? (await readBytes(blob.slice(size - 1, size)))[0] ?? -1 : head[head.length - 1] ?? -1;
    } catch {
      throw photoError(PHOTO_ERROR_CODES.unreadable);
    }
  }
  const r = checkPhotoProbe({ declaredType: declaredType ?? blob.type ?? '', size, head, last });
  if ('error' in r) throw photoError(r.error);
  return { blob, type: r.type, ext: r.ext, size };
}
