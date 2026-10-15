/**
 * 1.4.19 Help Center > Contact us: support tickets (validation shared with the app: src/core/support.ts).
 * A user creates tickets and reads only their own; only app admins (ADMIN_UIDS) read all and change the status.
 */
import type { Services } from '../context';
import { isAdmin } from '../context';
import { forbidden, HttpError, notFound } from '../errors';
import type { Identity } from '../auth/verifier';
import { checkSupportStatus, checkSupportTicket, SUPPORT_IMAGE_MAX_BYTES, SUPPORT_IMAGE_TYPES, type SupportTicket } from '../../../src/core/support';
import { checkImage } from './photos';
import { newId, nowDate, toMs, type Row } from './util';

function asHttp(e: unknown): never {
  const err = e as { code?: string; field?: string; message?: string; max?: number; min?: number };
  if (err?.code) throw new HttpError(400, err.code, `Invalid request: ${err.field ?? ''} – ${err.message}`, { field: err.field, max: err.max, min: err.min });
  throw e;
}
const requireAdmin = (s: Services, id: Identity) => {
  if (!isAdmin(s, id.uid)) throw forbidden('admin_only', 'Admins only');
};
const fromRow = (s: Services, r: Row): SupportTicket => ({
  id: r.id, userId: r.user_id, userName: r.user_name ?? null, topic: r.topic, message: r.message, appVersion: r.app_version ?? null, status: r.status,
  screenshotUrl: r.screenshot_key ? s.storage.url(r.screenshot_key) : null, createdAt: toMs(r.created_at) ?? 0, updatedAt: toMs(r.updated_at) ?? 0,
});

/**
 * 1.4.20 (QA Help Center Lows): `gate` (the rate limit) runs only after the ticket is valid, so a refused attempt
 * never uses up the user's allowance.
 */
export async function createTicket(s: Services, id: Identity, body: Record<string, unknown>, gate?: () => Promise<void>) {
  let c: ReturnType<typeof checkSupportTicket>;
  try { c = checkSupportTicket(body); } catch (e) { asHttp(e); }
  if (gate) await gate();
  const now = nowDate();
  const row = { id: newId(), user_id: id.uid, topic: c.topic, message: c.message, app_version: c.appVersion, status: 'open', screenshot_key: null, created_at: now, updated_at: now };
  await s.db('support_tickets').insert(row);
  return { id: row.id };
}

/** The ticket's owner adds one screenshot (JPEG / PNG / WebP, < 5 MB, magic bytes checked). */
export async function uploadScreenshot(s: Services, id: Identity, ticketId: string, contentType: string | undefined, data: Buffer) {
  const t = await s.db('support_tickets').where({ id: ticketId }).first('user_id', 'screenshot_key');
  if (!t || t.user_id !== id.uid) throw notFound('Ticket not found'); // others can't tell it exists
  if (t.screenshot_key) throw new HttpError(409, 'support_image_exists', 'This ticket already has a screenshot');
  const declared = (contentType || '').split(';')[0].trim().toLowerCase();
  if (!SUPPORT_IMAGE_TYPES[declared]) throw new HttpError(400, 'support_image_type', 'Screenshots must be JPEG, PNG or WebP', { field: 'screenshot' });
  if (data.length >= SUPPORT_IMAGE_MAX_BYTES) throw new HttpError(413, 'support_image_size', 'Screenshots must be smaller than 5 MB', { field: 'screenshot', max: SUPPORT_IMAGE_MAX_BYTES });
  const type = checkImage(contentType, data, 'storage.support.create');
  if (!SUPPORT_IMAGE_TYPES[type]) throw new HttpError(400, 'support_image_type', 'Screenshots must be JPEG, PNG or WebP', { field: 'screenshot' });
  const key = `support/${id.uid}/${ticketId}.${SUPPORT_IMAGE_TYPES[type]}`;
  await s.storage.put(key, data, type);
  await s.db('support_tickets').where({ id: ticketId }).update({ screenshot_key: key, updated_at: nowDate() });
  return { url: s.storage.url(key) };
}

const listQ = (s: Services) => s.db('support_tickets as t').leftJoin('users as u', 'u.id', 't.user_id').select('t.*', 'u.name as user_name');

export async function listMine(s: Services, id: Identity) {
  return (await listQ(s).where('t.user_id', id.uid).orderBy('t.created_at', 'desc').limit(100)).map((r: Row) => fromRow(s, r));
}
export async function listAll(s: Services, id: Identity) {
  requireAdmin(s, id);
  return (await listQ(s).orderBy('t.created_at', 'desc').limit(500)).map((r: Row) => fromRow(s, r));
}
export async function setStatus(s: Services, id: Identity, ticketId: string, body: { status?: unknown }) {
  requireAdmin(s, id);
  let status: string;
  try { status = checkSupportStatus(body.status); } catch (e) { asHttp(e); }
  const n = await s.db('support_tickets').where({ id: ticketId }).update({ status, updated_at: nowDate() });
  if (!n) throw notFound('Ticket not found');
  const [r] = await listQ(s).where('t.id', ticketId);
  return fromRow(s, r);
}
