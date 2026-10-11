/**
 * 1.3.2: queue several picked photos (gallery multi-select). Every file goes through the same checks
 * as a single photo – size, then type allow-list + magic bytes (services/photoFile.ts readPhoto) – and
 * then the offline upload queue (services/photoQueue). Who may add photos is unchanged: the screens
 * only offer the buttons when canAddMatchPhoto allows it, and every backend checks it again on upload.
 * One bad file never blocks the others; failures are reported with their translated reason.
 */
import { photoSizeProblem } from '../core/photos';
import type { PickedPhoto } from './camera';
import { MAX_GALLERY_PICK } from './camera';
import { photoError, readPhoto } from './photoFile';
import { photoQueue } from './photoQueue';

export interface QueueResult {
  queued: number;
  /** Files beyond the limit (not looked at). */
  dropped: number;
  failed: { index: number; error: unknown }[];
}

export async function queuePickedPhotos(
  picked: readonly PickedPhoto[],
  matchId: string,
  uid: string,
  deps: { read?: (uri: string, type?: string | null) => Promise<unknown>; add?: (matchId: string, uid: string, uri: string) => Promise<unknown>; limit?: number } = {},
): Promise<QueueResult> {
  const read = deps.read ?? readPhoto;
  const add = deps.add ?? ((m: string, u: string, uri: string) => photoQueue.add(m, u, uri));
  const limit = deps.limit ?? MAX_GALLERY_PICK;
  const list = picked.slice(0, limit);
  const out: QueueResult = { queued: 0, dropped: Math.max(0, picked.length - limit), failed: [] };
  for (let i = 0; i < list.length; i++) {
    const p = list[i];
    try {
      const size = photoSizeProblem(p.fileSize);
      if (size) throw photoError(size === 'empty' ? 'photo_empty' : 'photo_too_large');
      await read(p.uri, p.mimeType ?? null);
      await add(matchId, uid, p.uri);
      out.queued++;
    } catch (e) {
      out.failed.push({ index: i, error: e });
    }
  }
  return out;
}
