/**
 * 1.5.3 (Tester F152-2): rows written before 1.5.3 carry an UNSALTED SHA-256 of the raw question in
 * ask_audit.question_sha (a short phone-only question could be brute-forced from it). From 1.5.3 on the server stores an
 * HMAC keyed with ASK_AUDIT_HMAC_KEY, or NULL without a key. This script sets the old values to NULL.
 *
 *   DATABASE_URL=mysql://root@127.0.0.1:3306/volleylive_test npx tsx scripts/null-ask-audit-sha.ts            dry run
 *   DATABASE_URL=mysql://root@127.0.0.1:3306/volleylive_test npx tsx scripts/null-ask-audit-sha.ts --apply    write
 *
 * Which rows: everything created before --before=<ISO time> (default: now), i.e. run it right after the 1.5.3 server
 * (and migration 0028, which makes the column NULLable) is live. Old unsalted hashes can't be told apart from HMACs by
 * looking at them, so the cut-off is by time. It only UPDATEs question_sha to NULL; no row is deleted, nothing else
 * changes, no schema change.
 *
 * LOCAL ONLY: refused unless the database is on localhost:3306 and its name ends in _test or _audit. Running it on any
 * other database (staging / production) needs separate approval and is not part of this release.
 */
import { createDb } from '../src/db/knex';

export async function nullAskAuditSha(db: ReturnType<typeof createDb>, before: Date, apply: boolean): Promise<{ matched: number; changed: number }> {
  const q = () => db('ask_audit').whereNotNull('question_sha').where('created_at', '<', before);
  const [{ n }] = await q().count({ n: '*' });
  const matched = Number(n);
  const changed = apply ? await q().update({ question_sha: null }) : 0;
  return { matched, changed };
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required');
  const u = new URL(url);
  const name = u.pathname.replace(/^\//, '');
  if (!['127.0.0.1', 'localhost'].includes(u.hostname) || (u.port || '3306') !== '3306' || !/_(test|audit)$/.test(name))
    throw new Error('local only: localhost:3306 and a database name ending in _test or _audit');
  const apply = process.argv.includes('--apply');
  const b = process.argv.find((a) => a.startsWith('--before='));
  const before = b ? new Date(b.slice(9)) : new Date();
  if (Number.isNaN(before.getTime())) throw new Error('--before must be an ISO date/time');
  const db = createDb(url, { max: 2 });
  try {
    const r = await nullAskAuditSha(db, before, apply);
    console.log(`ask_audit: ${r.matched} rows with a question hash before ${before.toISOString()}; ${apply ? `${r.changed} set to NULL` : 'dry run (--apply to set them to NULL)'}`);
  } finally {
    await db.destroy();
  }
}
if (require.main === module) main().catch((e) => { console.error(e.message); process.exit(1); });
