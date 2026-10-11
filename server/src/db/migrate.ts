/**
 * Minimal SQL migration runner: applies server/migrations/*.sql in name order
 * and records each one in `schema_migrations`. Statements inside a file are
 * separated by a line containing only `-- ;;`.
 * Note: MySQL DDL auto-commits, so a failed file must be fixed and re-run by hand.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { Db } from './knex';

// src/db (tsx) or dist/server/src/db (compiled): find server/migrations either way.
export const MIGRATIONS_DIR =
  [path.resolve(__dirname, '../../migrations'), path.resolve(__dirname, '../../../../migrations')].find((d) => fs.existsSync(d)) ??
  path.resolve(__dirname, '../../migrations');

export async function migrate(db: Db, dir = MIGRATIONS_DIR): Promise<string[]> {
  await db.raw(
    'CREATE TABLE IF NOT EXISTS schema_migrations (version VARCHAR(255) NOT NULL PRIMARY KEY, applied_at DATETIME(3) NOT NULL) ENGINE=InnoDB',
  );
  const done = new Set((await db('schema_migrations').select('version')).map((r: { version: string }) => r.version));
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  const applied: string[] = [];
  for (const file of files) {
    if (done.has(file)) continue;
    const sql = fs.readFileSync(path.join(dir, file), 'utf8');
    const statements = sql
      .split(/^-- ;;\s*$/m)
      .map((s) => s.trim())
      .filter((s) => s.replace(/^--.*$/gm, '').trim().length > 0);
    for (const st of statements) await db.raw(st);
    await db('schema_migrations').insert({ version: file, applied_at: new Date() });
    applied.push(file);
  }
  return applied;
}

/**
 * Launch prep: migrations run on deploy (start step) and several instances may start at once, so the
 * runner takes a MySQL named lock first (GET_LOCK, held on one connection); the others wait, then find
 * nothing left to apply. Migrations stay additive (new tables/columns only), so an older instance
 * still serving traffic during a rolling deploy keeps working.
 */
export async function migrateLocked(db: Db, dir = MIGRATIONS_DIR, timeoutSeconds = 120): Promise<string[]> {
  const client = db.client as { acquireConnection(): Promise<unknown>; releaseConnection(c: unknown): Promise<void> };
  const conn = await client.acquireConnection();
  try {
    const [rows] = await db.raw('SELECT GET_LOCK(?, ?) AS l', ['volleylive_migrate', timeoutSeconds]).connection(conn as never);
    if (Number((rows as { l: number | null }[])[0]?.l) !== 1) throw new Error('Could not get the migration lock (another instance is migrating?)');
    try {
      return await migrate(db, dir);
    } finally {
      await db.raw('SELECT RELEASE_LOCK(?)', ['volleylive_migrate']).connection(conn as never);
    }
  } finally {
    await client.releaseConnection(conn);
  }
}

/** Drops every table (tests and `npm run db:reset` only). */
export async function dropAll(db: Db): Promise<void> {
  // One connection (a transaction) so the session-level FOREIGN_KEY_CHECKS switch applies to every DROP.
  await db.transaction(async (trx) => {
    const [rows] = await trx.raw('SELECT table_name AS t, table_type AS k FROM information_schema.tables WHERE table_schema = DATABASE()');
    await trx.raw('SET FOREIGN_KEY_CHECKS = 0');
    try {
      // Views first (0004 player_finished_matches): DROP TABLE refuses a view.
      for (const r of rows as { t: string; k: string }[]) if (r.k === 'VIEW') await trx.raw('DROP VIEW IF EXISTS ??', [r.t]);
      for (const r of rows as { t: string; k: string }[]) if (r.k !== 'VIEW') await trx.raw('DROP TABLE IF EXISTS ??', [r.t]);
    } finally {
      await trx.raw('SET FOREIGN_KEY_CHECKS = 1');
    }
  });
}
