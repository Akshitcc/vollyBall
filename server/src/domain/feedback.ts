/**
 * 1.3.7 Profile > Send feedback (stars + text) and the admin list; "Fact of the day" items
 * (public read, admin-only add / edit / delete). Validation is shared with the app (src/core).
 */
import type { Services } from '../context';
import { isAdmin } from '../context';
import { forbidden, HttpError, notFound } from '../errors';
import type { Identity } from '../auth/verifier';
import { checkFeedback } from '../../../src/core/reviewPrompt';
import { checkDailyItem, dailyTombstone, type DailyItem } from '../../../src/core/dailyItems';
import { newId, nowDate, toMs, type Row } from './util';

function asHttp(e: unknown): never {
  const err = e as { code?: string; field?: string; message?: string; max?: number };
  if (err?.code) throw new HttpError(400, err.code, `Invalid request: ${err.field ?? ''} – ${err.message}`, { field: err.field, max: err.max });
  throw e;
}
const requireAdmin = (s: Services, id: Identity) => {
  if (!isAdmin(s, id.uid)) throw forbidden('admin_only', 'Admins only');
};

export async function sendFeedback(s: Services, id: Identity, body: { stars?: unknown; text?: unknown; appVersion?: unknown }) {
  let f: ReturnType<typeof checkFeedback>;
  try {
    f = checkFeedback(body);
  } catch (e) {
    asHttp(e);
  }
  const row = { id: newId(), user_id: id.uid, stars: f.stars, text: f.text, app_version: f.appVersion, created_at: nowDate() };
  await s.db('feedback').insert(row);
  return { id: row.id };
}

export async function listFeedback(s: Services, id: Identity) {
  requireAdmin(s, id);
  const rows: Row[] = await s.db('feedback as f').leftJoin('users as u', 'u.id', 'f.user_id').orderBy('f.created_at', 'desc').limit(200)
    .select('f.id', 'f.user_id', 'u.name as user_name', 'f.stars', 'f.text', 'f.app_version', 'f.created_at');
  return rows.map((r) => ({ id: r.id, userId: r.user_id, userName: r.user_name ?? null, stars: Number(r.stars), text: r.text, appVersion: r.app_version ?? null, createdAt: toMs(r.created_at) ?? 0 }));
}

const itemFrom = (r: Row): DailyItem => ({
  id: r.id, type: r.type, textEn: r.text_en, textHi: r.text_hi, attribution: r.attribution ?? null, sourceUrl: r.source_url ?? null, active: !!r.active,
  createdAt: toMs(r.created_at) ?? null, // 1.3.9 (V138-7): new items join the daily rotation the next IST day
  removedAt: toMs(r.removed_at) ?? null, // 1.4.1 (V140-7): server time it was turned off / deleted (set once)
  ...(r.deleted ? { deleted: true } : {}),
});

/**
 * Public: active items, plus tombstones (id + timestamps only) of items turned off or deleted – they keep their
 * slots in rotation cycles that had already started (1.4.1, V140-7). Admins: everything except deleted items.
 */
export async function listDailyItems(s: Services, uid: string | null) {
  const admin = !!uid && isAdmin(s, uid);
  if (admin) return (await s.db('daily_items').where({ deleted: 0 }).orderBy('created_at', 'asc').limit(DAILY_LIST_MAX).select('*')).map(itemFrom);
  // 1.4.2 (QA V141-2): every active item first, then the NEWEST tombstones in the room left (they are the ones
  // that can still hold a slot in a running cycle). Before, the oldest 5000 rows of either kind were taken, so
  // old tombstones could push active items out of the list.
  const active = (await s.db('daily_items').where({ active: 1 }).orderBy('created_at', 'asc').limit(DAILY_LIST_MAX).select('*')).map(itemFrom);
  const room = DAILY_LIST_MAX - active.length;
  const gone = room > 0
    ? (await s.db('daily_items').where({ active: 0 }).whereNotNull('removed_at').orderBy([{ column: 'removed_at', order: 'desc' }, { column: 'id', order: 'desc' }]).limit(room).select('*')).map(itemFrom)
    : [];
  return [...active, ...gone.map(dailyTombstone)].sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
/** At most this many rows in a daily-items list (public: active items + newest tombstones; admin: not deleted). */
export const DAILY_LIST_MAX = 5000;

function checked(body: Partial<DailyItem>) {
  try {
    return checkDailyItem(body);
  } catch (e) {
    asHttp(e);
  }
}

export async function createDailyItem(s: Services, id: Identity, body: Partial<DailyItem>) {
  requireAdmin(s, id);
  const c = checked(body);
  const now = nowDate();
  const row = { id: newId(), type: c.type, text_en: c.textEn, text_hi: c.textHi, attribution: c.attribution ?? null, source_url: c.sourceUrl ?? null, active: c.active ? 1 : 0, created_by: id.uid, created_at: now, updated_at: now, removed_at: c.active ? null : now, deleted: 0 };
  await s.db('daily_items').insert(row);
  return itemFrom(row);
}

/**
 * 1.4.1 (V140-7): turning an item off stamps removed_at (server time) once; turning one that is off back on
 * creates a NEW item (copy, new created_at – it joins the next rotation cycle) and marks the old row deleted,
 * in one transaction. The response is the item as it now is (the copy's new id when it was turned back on).
 */
export async function updateDailyItem(s: Services, id: Identity, itemId: string, body: Partial<DailyItem>) {
  requireAdmin(s, id);
  return s.db.transaction(async (trx) => {
    const old = await trx('daily_items').where({ id: itemId, deleted: 0 }).forUpdate().first();
    if (!old) throw notFound('Item not found');
    const c = checked({ ...itemFrom(old), ...body });
    const now = nowDate();
    const fields = { type: c.type, text_en: c.textEn, text_hi: c.textHi, attribution: c.attribution ?? null, source_url: c.sourceUrl ?? null };
    if (!old.active && c.active) {
      await trx('daily_items').where({ id: itemId }).update({ deleted: 1, removed_at: old.active ? now : old.removed_at ?? null, updated_at: now, ...BLANK });
      const row = { id: newId(), ...fields, active: 1, created_by: id.uid, created_at: now, updated_at: now, removed_at: null, deleted: 0 };
      await trx('daily_items').insert(row);
      return itemFrom(row);
    }
    // an item turned off before 1.4.1 (no removed_at) stays out of every cycle: stamping it now would make it a
    // member of the cycle that is running and shift today's fact
    const removedAt = old.active ? (c.active ? null : now) : old.removed_at ?? null;
    await trx('daily_items').where({ id: itemId }).update({ ...fields, active: c.active ? 1 : 0, removed_at: removedAt, updated_at: now });
    return itemFrom(await trx('daily_items').where({ id: itemId }).first());
  });
}

/** 1.4.2 (QA V141-6, parity with Firebase): a deleted row keeps no text (it was never listed, now not even stored). */
const BLANK = { text_en: '', text_hi: '', attribution: null, source_url: null };

/** 1.4.1 (V140-7): a tombstone (off, deleted, removed_at stamped once) – the row stays for the rotation. */
export async function deleteDailyItem(s: Services, id: Identity, itemId: string) {
  requireAdmin(s, id);
  const now = nowDate();
  const n = await s.db('daily_items').where({ id: itemId, deleted: 0 })
    // (removed_at first: MySQL evaluates SET left to right, so it must still see the old `active`)
    .update({ removed_at: s.db.raw('CASE WHEN active = 1 THEN ? ELSE removed_at END', [now]), deleted: 1, active: 0, updated_at: now, ...BLANK });
  if (!n) throw notFound('Item not found');
}
