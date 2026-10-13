/**
 * Minimal SQL migration runner: applies server/migrations/*.sql in name order
 * and records each one in `schema_migrations`. Statements inside a file are
 * separated by a line containing only `-- ;;`.
 * Note: MySQL DDL auto-commits, so a file that fails half-way leaves its earlier statements applied.
 * Files are therefore written to be re-runnable (IF NOT EXISTS, guarded steps): fix the cause, run again.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { Db } from './knex';

// src/db (tsx) or dist/server/src/db (compiled): find server/migrations either way.
export const MIGRATIONS_DIR =
  [path.resolve(__dirname, '../../migrations'), path.resolve(__dirname, '../../../../migrations')].find((d) => fs.existsSync(d)) ??
  path.resolve(__dirname, '../../migrations');

type RawOn = (sql: string) => Promise<unknown>;
async function onOneConnection(db: Db, fn: (q: RawOn) => Promise<void>): Promise<void> {
  const client = db.client as { acquireConnection(): Promise<unknown>; releaseConnection(c: unknown): Promise<void> };
  const conn = await client.acquireConnection();
  try {
    await fn((sql) => db.raw(sql).connection(conn as never));
  } catch (e) {
    // 1.4.2: a file may open a transaction (0014 steps 4–6); never hand a connection back to the pool with
    // half of it open – roll it back (a no-op when none is open)
    await db.raw('ROLLBACK').connection(conn as never).catch(() => undefined);
    throw e;
  } finally {
    await client.releaseConnection(conn);
  }
}

/** sha256 of a migration file (line endings normalised, so a checkout with CRLF is the same file). */
export const migrationChecksum = (sql: string) => crypto.createHash('sha256').update(sql.replace(/\r\n/g, '\n'), 'utf8').digest('hex');

/**
 * 1.4.2 (QA V141-1) / 1.4.3 (QA V142-4): files that were knowingly edited after release. An entry is allowed only
 * when BOTH hold: the file on disk is exactly the accepted version (`current`), and the database recorded one of
 * its earlier versions (`earlier`) or `unknown` (applied before checksums existed, see below). Then it is a
 * warning; any other change to an applied file stops the runner. (1.4.2 matched the recorded checksum only, so
 * any later edit of 0014 passed on a database that had recorded an earlier version.) Keep this list short and
 * explained (docs/DEPLOY.md "Migration checksums").
 */
export const CHECKSUM_ALLOWLIST: Readonly<Record<string, { current: string; earlier: readonly string[]; why: string }>> = Object.freeze({
  '0014_email_index_repair.sql': {
    current: 'fac47cb32057e1986a4db820f193694ed4a034293c3d56606213e8159996186f', // 1.4.2 (unchanged in 1.4.3)
    earlier: [
      'c27520af3fc55a82aac0be65d1980153c13cd50038345014116dc51ee5bbaaf4', // 1.4.0 (as shipped, tests/fixtures/0014_as_shipped_in_1.4.0.sql)
      '9cdb1e87859f3bfd03c2bdd0e456fc6695c8436561f808bed237f974fc0c9993', // 1.4.1
    ],
    why: 'fixed in place in 1.4.1 (V140-1..3) and 1.4.2 (V141-1); never deployed to any server',
  },
});

/** Recorded for a file applied before checksums existed whose applied version can't be told (1.4.3). */
export const CHECKSUM_UNKNOWN = 'unknown';

export class MigrationChecksumError extends Error {
  constructor(readonly files: string[], readonly reasons: Record<string, string> = {}) {
    super(`Applied migration file(s) changed since they were applied, or their checksum record is missing: ${files.map((f) => (reasons[f] ? `${f} (${reasons[f]})` : f)).join(', ')}. ` +
      'Migrations are append-only – put the change in a new file (or, for a file that was never deployed, add it to CHECKSUM_ALLOWLIST in src/db/migrate.ts). ' +
      'See docs/DEPLOY.md "Migration checksums" for a record that went missing.');
    this.name = 'MigrationChecksumError';
  }
}

export interface MigrateOptions {
  /**
   * Told about allowlisted changes, files applied before checksums existed (recorded on the first run under
   * 1.4.2+ – trust on first use – or as `unknown`), and the checksum record being started. Default: console.warn.
   */
  onWarn?: (message: string) => void;
}

const META = 'schema_migrations_meta';

export async function migrate(db: Db, dir = MIGRATIONS_DIR, opts: MigrateOptions = {}): Promise<string[]> {
  const warn = opts.onWarn ?? ((m: string) => console.warn(`[migrate] ${m}`));
  await db.raw(
    'CREATE TABLE IF NOT EXISTS schema_migrations (version VARCHAR(255) NOT NULL PRIMARY KEY, applied_at DATETIME(3) NOT NULL) ENGINE=InnoDB',
  );
  // 1.4.3 (QA V142-4, additive): when the checksum record started. Without it a dropped `checksum` column looked
  // exactly like a database from before 1.4.2 and was silently re-recorded from whatever files are on disk.
  await db.raw(`CREATE TABLE IF NOT EXISTS ${META} (k VARCHAR(64) NOT NULL PRIMARY KEY, v VARCHAR(255) NOT NULL, at DATETIME(3) NOT NULL) ENGINE=InnoDB`);
  const since = await db(META).where({ k: 'checksums_since' }).first('v');
  // 1.4.2 (QA V141-1, additive): each applied file's sha256.
  const [cols] = (await db.raw(
    "SELECT COUNT(*) AS n FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'schema_migrations' AND column_name = 'checksum'",
  )) as unknown as [{ n: number }[]];
  const hadColumn = Number(cols[0]?.n) > 0;
  if (!hadColumn && since) {
    // the record was started on this database and the column is gone: never re-baseline silently
    throw new MigrationChecksumError(['schema_migrations.checksum'], { 'schema_migrations.checksum': `column missing; checksums recorded since ${since.v}` });
  }
  if (!hadColumn) await db.raw("ALTER TABLE schema_migrations ADD COLUMN checksum CHAR(64) NULL COMMENT 'sha256 of the file when applied (1.4.2); unknown = applied before checksums'");
  const rows: { version: string; checksum: string | null }[] = await db('schema_migrations').select('version', 'checksum');
  const done = new Map(rows.map((r) => [r.version, r.checksum == null ? null : r.checksum.trim().toLowerCase()]));
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  const sqlOf = new Map(files.map((f) => [f, fs.readFileSync(path.join(dir, f), 'utf8')]));
  // A database from before 1.4.2 (no column, no record): its applied files get a checksum now. For a file that
  // was edited in place (allowlisted) the version that ran can't be told from the database (its end state is the
  // same), so it is recorded as `unknown`; every other file as it is on disk (trust on first use). Both warned.
  // A 1.4.2 database (column, no record) has its checksums already: the record just starts.
  // 1.4.4 (QA V143-9): the bootstrap is crash-safe. It ends with the meta insert, so a start that stopped after
  // ADD COLUMN (or after some of the updates below) still has no meta row: the next start is still the bootstrap
  // and records the checksums that are still NULL, with the same warnings, instead of refusing every file. A
  // 1.4.2 database (column filled by 1.4.2, no record) has no NULLs, so only the record starts. Once the meta row
  // exists a NULL is never re-recorded (below). Deleting the meta row AND the column is therefore an intentional
  // reset to "before 1.4.2" (it needs DB write access; docs/DEPLOY.md "Migration checksums").
  if (!since) {
    const missing = files.filter((f) => done.has(f) && done.get(f) == null);
    if (hadColumn && missing.length) warn(`the checksum record was started but not finished (an interrupted first start under 1.4.2+?) – completing it for: ${missing.join(', ')}`);
    {
      const firstUse: string[] = [];
      for (const file of files) {
        if (!done.has(file) || done.get(file) != null) continue;
        const allowed = CHECKSUM_ALLOWLIST[file];
        const sum = allowed ? CHECKSUM_UNKNOWN : migrationChecksum(sqlOf.get(file)!);
        await db('schema_migrations').where({ version: file }).update({ checksum: sum });
        done.set(file, sum);
        if (allowed) warn(`${file} was applied before checksums were recorded; the version that ran can't be told (${allowed.why}) – recorded as "${CHECKSUM_UNKNOWN}"`);
        else firstUse.push(file);
      }
      if (firstUse.length) warn(`checksums recorded for the first time (trust on first use – the files on disk are taken as the ones that ran): ${firstUse.join(', ')}`);
    }
    await db(META).insert({ k: 'checksums_since', v: new Date().toISOString(), at: new Date() }).onConflict('k').ignore();
  }
  // Applied files first: all are checked before anything new is applied.
  const changed: string[] = [];
  const reasons: Record<string, string> = {};
  for (const file of files) {
    if (!done.has(file)) continue;
    const sum = migrationChecksum(sqlOf.get(file)!);
    const recorded = done.get(file);
    if (recorded === sum) continue;
    if (recorded == null) {
      // 1.4.3 (QA V142-4): a missing record is not re-recorded silently
      changed.push(file);
      reasons[file] = 'no checksum recorded';
      continue;
    }
    const allowed = CHECKSUM_ALLOWLIST[file];
    if (allowed && sum === allowed.current && (recorded === CHECKSUM_UNKNOWN || allowed.earlier.includes(recorded))) {
      // 1.4.4 (QA V143-9): told once per database (flag in the meta table), not on every start
      const k = `warned:${file}:${recorded.slice(0, 12)}`.slice(0, 64);
      if (!(await db(META).where({ k }).first('k'))) {
        warn(`${file} was applied as ${recorded === CHECKSUM_UNKNOWN ? 'an unknown earlier version' : `an earlier version (${recorded.slice(0, 12)}…)`}; allowlisted: ${allowed.why} (shown once)`);
        await db(META).insert({ k, v: sum, at: new Date() }).onConflict('k').ignore();
      }
    } else {
      changed.push(file);
      if (allowed && sum !== allowed.current) reasons[file] = 'the file differs from its accepted version';
    }
  }
  if (changed.length) throw new MigrationChecksumError(changed, reasons);
  const applied: string[] = [];
  for (const file of files) {
    if (done.has(file)) continue;
    const sql = sqlOf.get(file)!;
    const statements = sql
      .split(/^-- ;;\s*$/m)
      .map((s) => s.trim())
      .filter((s) => s.replace(/^--.*$/gm, '').trim().length > 0);
    // 1.3.9 (V138-1): every statement of a file runs on ONE connection, so a file can use session
    // variables (e.g. a guarded `SET @x = IF(…); PREPARE …; EXECUTE …` for steps MySQL has no IF NOT EXISTS for).
    await onOneConnection(db, async (q) => {
      for (const st of statements) await q(st);
    }).catch((e: unknown) => {
      throw readableMigrationError(file, e);
    });
    await db('schema_migrations').insert({ version: file, applied_at: new Date(), checksum: migrationChecksum(sql) });
    applied.push(file);
  }
  // 1.4.10 (QA 0019 notes): the schema checks run on EVERY migrate (deploy / MIGRATE_ON_START / migrate-cli), not only
  // once when 0019 is applied: a column dropped or retyped by hand later is caught too.
  await checkSchema(db);
  return applied;
}

/** 1.4.10: a schema check that failed – readable, names the file / column and what to do. */
export class SchemaCheckError extends Error {
  constructor(message: string, readonly check: string) {
    super(message);
    this.name = 'SchemaCheckError';
  }
}
/**
 * 1.4.10: a guarded check inside a migration stops by selecting a column named after its message ("Unknown column
 * '0019: …'"); turn that MySQL error into the plain message. Other errors pass through unchanged.
 */
export function readableMigrationError(file: string, e: unknown): unknown {
  const m = /Unknown column '(\d{4}: [^']+)'/.exec(String((e as { message?: string })?.message ?? e));
  if (!m) return e;
  // 1.4.11: 0019's own text ("… found text - fix the column by hand") gets the same ALTER hint as checkSchema
  const msg = m[1].slice(6).replace(/ - fix the column by hand$/, ' – fix the column by hand (ALTER TABLE matches MODIFY verdict_repair JSON NULL) and run the migrations again');
  return new SchemaCheckError(`Migration ${file} stopped: ${msg}`, file);
}
/**
 * 1.4.10 (QA 0019 notes): what the recorded migrations promise must still be there. Today: 0018 recorded ⇒
 * matches.verdict_repair exists and is JSON. Read-only (information_schema); never changes anything.
 */
export async function checkSchema(db: Db): Promise<void> {
  const [mig] = (await db.raw("SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = 'schema_migrations'")) as unknown as [{ n: number }[]];
  if (!Number(mig[0]?.n)) return;
  const has18 = await db('schema_migrations').where({ version: '0018_verdict_repair.sql' }).first('version');
  if (!has18) return;
  const [cols] = (await db.raw("SELECT LOWER(DATA_TYPE) AS t FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'matches' AND column_name = 'verdict_repair'")) as unknown as [{ t: string }[]];
  const t = cols[0]?.t;
  if (!t)
    throw new SchemaCheckError('0018_verdict_repair.sql is recorded but matches.verdict_repair is missing – add it by hand (ALTER TABLE matches ADD COLUMN verdict_repair JSON NULL) and run the migrations again', '0018');
  if (t !== 'json')
    throw new SchemaCheckError(`matches.verdict_repair must be JSON, found ${t} – fix the column by hand (ALTER TABLE matches MODIFY verdict_repair JSON NULL) and run the migrations again`, '0018');
}

/**
 * Launch prep: migrations run on deploy (start step) and several instances may start at once, so the
 * runner takes a MySQL named lock first (GET_LOCK, held on one connection); the others wait, then find
 * nothing left to apply. Migrations stay additive (new tables/columns only), so an older instance
 * still serving traffic during a rolling deploy keeps working.
 */
export async function migrateLocked(db: Db, dir = MIGRATIONS_DIR, timeoutSeconds = 120, opts: MigrateOptions = {}): Promise<string[]> {
  const client = db.client as { acquireConnection(): Promise<unknown>; releaseConnection(c: unknown): Promise<void> };
  const conn = await client.acquireConnection();
  try {
    const [rows] = await db.raw('SELECT GET_LOCK(?, ?) AS l', ['volleylive_migrate', timeoutSeconds]).connection(conn as never);
    if (Number((rows as { l: number | null }[])[0]?.l) !== 1) throw new Error('Could not get the migration lock (another instance is migrating?)');
    try {
      return await migrate(db, dir, opts);
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
