/**
 * 1.4.28 (QA V1427-3 Info): the manual down step for migration 0024_tournament_groups.sql (the runner is forward-only;
 * migrations stay additive). It never deletes data:
 *  - while any tournament uses format 'groups' (or any group / seed column holds a value) it REFUSES with a clear
 *    message – the ENUM can't lose 'groups' then, and dropping the columns would lose the group tables. Roll back the
 *    server only (a 1.4.27+ schema is fine for older servers: the columns are nullable) or delete those tournaments first.
 *  - otherwise it reverts the ENUM to ('knockout','league'), drops the five nullable 0024 columns and removes the
 *    0024 record so the runner re-applies it later. Every step is guarded (re-runnable after a partial run).
 * CLI: DATABASE_URL=… npx tsx src/db/rollback/rollback0024.ts   (see docs/DEPLOY.md "Rolling back 0024")
 */
import type { Knex } from 'knex';
import { createDb, sslFromEnv } from '../knex';

export const ROLLBACK_0024_REFUSED = 'rollback_0024_refused';
const COLS: [string, string][] = [['tournaments', 'advance'], ['tournament_teams', 'group_key'], ['fixtures', 'group_key'], ['fixtures', 'home_seed'], ['fixtures', 'away_seed']];

async function hasCol(db: Knex, table: string, col: string) {
  const [rows] = await db.raw('SELECT COUNT(*) AS n FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?', [table, col]);
  return Number(rows[0].n) > 0;
}

/** Rows that still need 0024 (empty = safe to roll back). */
export async function groupsDataInUse(db: Knex): Promise<string[]> {
  const out: string[] = [];
  const n = Number((await db('tournaments').where({ format: 'groups' }).count({ n: '*' }))[0].n);
  if (n) out.push(`${n} tournament(s) with format 'groups'`);
  for (const [t, c] of COLS) {
    if (!(await hasCol(db, t, c))) continue;
    const k = Number((await db(t).whereNotNull(c).count({ n: '*' }))[0].n);
    if (k) out.push(`${k} row(s) in ${t}.${c}`);
  }
  return out;
}

export async function rollback0024(db: Knex): Promise<{ ok: true; dropped: string[] }> {
  const inUse = await groupsDataInUse(db);
  if (inUse.length) {
    const e = new Error(`Refusing to roll back 0024_tournament_groups: groups data exists (${inUse.join('; ')}). Nothing was changed. ` +
      'Roll back the server only (the 0024 columns are nullable and harmless), or delete those tournaments first. See docs/DEPLOY.md.');
    (e as Error & { code?: string }).code = ROLLBACK_0024_REFUSED;
    throw e;
  }
  const dropped: string[] = [];
  for (const [t, c] of COLS) if (await hasCol(db, t, c)) { await db.raw(`ALTER TABLE \`${t}\` DROP COLUMN \`${c}\``); dropped.push(`${t}.${c}`); }
  await db.raw("ALTER TABLE tournaments MODIFY format ENUM('knockout','league') NOT NULL");
  await db('schema_migrations').where({ version: '0024_tournament_groups.sql' }).del();
  return { ok: true, dropped };
}

if (require.main === module) {
  (async () => {
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
    const db = createDb(process.env.DATABASE_URL, {}, sslFromEnv(process.env, process.env.DATABASE_URL));
    try {
      console.log(JSON.stringify(await rollback0024(db)));
    } catch (e) {
      console.error((e as Error).message);
      process.exitCode = 1;
    } finally {
      await db.destroy();
    }
  })();
}
