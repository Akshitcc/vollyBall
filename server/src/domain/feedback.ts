/**
 * 1.3.7 Profile > Send feedback (stars + text) and the admin list; "Fact of the day" items
 * (public read, admin-only add / edit / delete). Validation is shared with the app (src/core).
 */
import type { Services } from '../context';
import { isAdmin } from '../context';
import { forbidden, HttpError, notFound } from '../errors';
import type { Identity } from '../auth/verifier';
import { checkFeedback } from '../../../src/core/reviewPrompt';
import { checkDailyItem, type DailyItem } from '../../../src/core/dailyItems';
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
});

/** Public: active items only (admins also get inactive ones, for the manage screen). */
export async function listDailyItems(s: Services, uid: string | null) {
  const q = s.db('daily_items').orderBy('created_at', 'asc').limit(1000);
  if (!uid || !isAdmin(s, uid)) q.where({ active: 1 });
  return (await q.select('*')).map(itemFrom);
}

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
  const row = { id: newId(), type: c.type, text_en: c.textEn, text_hi: c.textHi, attribution: c.attribution ?? null, source_url: c.sourceUrl ?? null, active: c.active ? 1 : 0, created_by: id.uid, created_at: now, updated_at: now };
  await s.db('daily_items').insert(row);
  return itemFrom(row);
}

export async function updateDailyItem(s: Services, id: Identity, itemId: string, body: Partial<DailyItem>) {
  requireAdmin(s, id);
  const old = await s.db('daily_items').where({ id: itemId }).first();
  if (!old) throw notFound('Item not found');
  const c = checked({ ...itemFrom(old), ...body });
  await s.db('daily_items').where({ id: itemId }).update({ type: c.type, text_en: c.textEn, text_hi: c.textHi, attribution: c.attribution ?? null, source_url: c.sourceUrl ?? null, active: c.active ? 1 : 0, updated_at: nowDate() });
  return itemFrom(await s.db('daily_items').where({ id: itemId }).first());
}

export async function deleteDailyItem(s: Services, id: Identity, itemId: string) {
  requireAdmin(s, id);
  const n = await s.db('daily_items').where({ id: itemId }).delete();
  if (!n) throw notFound('Item not found');
}
