/** Community courts. Port of `match /courts/{courtId}`. */
import type { Court } from '../../../src/core/types';
import type { Services } from '../context';
import { forbidden, notFound } from '../errors';
import type { Identity } from '../auth/verifier';
import { topics } from '../live/bus';
import { newId, nowDate, placeCols, placeFromRow, toMs, type Row } from './util';

const courtFromRow = (r: Row): Court => ({
  id: r.id,
  name: r.name,
  location: placeFromRow(r)!,
  surface: r.surface,
  addedBy: r.added_by,
  createdAt: toMs(r.created_at)!,
});

export async function listCourts(s: Services): Promise<Court[]> {
  return (await s.db('courts').orderBy('created_at', 'desc').limit(300)).map(courtFromRow);
}

/** courts create: addedBy == uid() */
export async function addCourt(s: Services, viewer: Identity, c: Omit<Court, 'id' | 'createdAt'>, fixedId?: string) {
  if (c.addedBy !== viewer.uid) throw forbidden('courts.create', 'addedBy must be you');
  const id = fixedId ?? newId(); // fixedId: seeds only
  await s.db('courts').insert({ id, name: c.name.trim(), ...placeCols(c.location), surface: c.surface, added_by: viewer.uid, created_at: nowDate() });
  s.bus.publish({ topic: topics.courts, type: 'invalidate' });
  return id;
}

/** courts update/delete: resource.addedBy == uid() (and addedBy cannot be reassigned) */
export async function patchCourt(s: Services, viewer: Identity, id: string, patch: Partial<Omit<Court, 'id' | 'createdAt'>>) {
  const r = await s.db('courts').where({ id }).first();
  if (!r) throw notFound('Court not found');
  if (r.added_by !== viewer.uid || (patch.addedBy && patch.addedBy !== viewer.uid)) throw forbidden('courts.update', 'Only the person who added this court can edit it');
  await s.db('courts')
    .where({ id })
    .update({ ...(patch.name ? { name: patch.name.trim() } : {}), ...(patch.location ? placeCols(patch.location) : {}), ...(patch.surface ? { surface: patch.surface } : {}) });
  s.bus.publish({ topic: topics.courts, type: 'invalidate' });
  return courtFromRow(await s.db('courts').where({ id }).first());
}

export async function deleteCourt(s: Services, viewer: Identity, id: string) {
  const r = await s.db('courts').where({ id }).first('added_by');
  if (!r) throw notFound('Court not found');
  if (r.added_by !== viewer.uid) throw forbidden('courts.delete', 'Only the person who added this court can delete it');
  await s.db('courts').where({ id }).del();
  s.bus.publish({ topic: topics.courts, type: 'invalidate' });
}
