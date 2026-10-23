/**
 * 1.5.2 (Tester F151-6): mask PII in ask_history rows written before 1.5.2 (from 1.5.2 on, chat() stores the masked
 * question, and GET /ask/history masks on read, so this is only tidy-up of stored text).
 * 1.5.3 (Tester F152-1 / F152-2): uses the STORED mask (also spaced single digits / digit words) and tidies
 * ask_audit.question too.
 *
 *   DATABASE_URL=mysql://root@127.0.0.1:3306/volleylive_test npx tsx scripts/mask-ask-history.ts            dry run
 *   DATABASE_URL=mysql://root@127.0.0.1:3306/volleylive_test npx tsx scripts/mask-ask-history.ts --apply    write
 *
 * LOCAL ONLY: refused unless the database is on localhost:3306 and its name ends in _test or _audit. It only UPDATEs
 * ask_history.question / ask_audit.question to the masked text (same mask as the audit); no schema change, no row is deleted. Running it on
 * any other database (staging / production) needs separate approval and is not part of this release.
 */
import { createDb } from '../src/db/knex';
import { maskPiiStored } from '../../src/core/pii';

export async function maskAskHistory(db: ReturnType<typeof createDb>, apply: boolean, table: 'ask_history' | 'ask_audit' = 'ask_history'): Promise<{ scanned: number; changed: number }> {
  let scanned = 0;
  let changed = 0;
  let last = 0;
  for (;;) {
    const rows: { id: number; question: string }[] = await db(table).where('id', '>', last).orderBy('id').limit(500).select('id', 'question');
    if (!rows.length) break;
    for (const r of rows) {
      scanned++;
      const m = maskPiiStored(r.question);
      if (m !== r.question) {
        changed++;
        if (apply) await db(table).where({ id: r.id }).update({ question: m });
      }
    }
    last = rows[rows.length - 1].id;
  }
  return { scanned, changed };
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required');
  const u = new URL(url);
  const name = u.pathname.replace(/^\//, '');
  if (!['127.0.0.1', 'localhost'].includes(u.hostname) || (u.port || '3306') !== '3306' || !/_(test|audit)$/.test(name))
    throw new Error('local only: localhost:3306 and a database name ending in _test or _audit');
  const apply = process.argv.includes('--apply');
  const db = createDb(url, { max: 2 });
  try {
    for (const t of ['ask_history', 'ask_audit'] as const) {
      const r = await maskAskHistory(db, apply, t);
      console.log(`${t}: ${r.scanned} rows scanned, ${r.changed} ${apply ? 'masked' : 'would be masked (dry run; --apply to write)'}`);
    }
  } finally {
    await db.destroy();
  }
}
if (require.main === module) main().catch((e) => { console.error(e.message); process.exit(1); });
