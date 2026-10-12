/**
 * 1.4.1: V140-1 (0014 resumable: a rerun re-checks, never restores into a duplicate), V140-2 (latin1 default
 * database), V140-3 (an NFD legacy address: 0014 doesn't restore its NFC twin, and an unchanged address never
 * 409s), V140-4 (final sigma case-folded), V140-7 (daily items: deactivate/delete keep a server-timed tombstone).
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, beforeEach, describe, it } from 'node:test';
import { createDb, type Db } from '../src/db/knex';
import { dropAll, migrate, MIGRATIONS_DIR } from '../src/db/migrate';
import { acceptTermsFor, ADMIN, EVERYONE, register, startHarness, testDbUrl, type Harness } from './helpers';

let h: Harness;
before(async () => (h = await startHarness()));
after(async () => h.close());
beforeEach(async () => {
  await h.reset();
  await register(h, ...EVERYONE);
});

const M13 = '0013_users_email_unique.sql';
const M14 = '0014_email_index_repair.sql';
const rows = <T>(r: unknown) => (r as [T[]])[0];
const split = (file: string) =>
  fs.readFileSync(file, 'utf8').split(/^-- ;;\s*$/m).map((s) => s.trim()).filter((s) => s.replace(/^--.*$/gm, '').trim());
function migrationsBefore(upTo: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vl-mig-'));
  for (const f of fs.readdirSync(MIGRATIONS_DIR)) if (f.endsWith('.sql') && f < upTo) fs.copyFileSync(path.join(MIGRATIONS_DIR, f), path.join(dir, f));
  return dir;
}
/** 1.4.1: the migrations up to 0014 – these tests are about 0013/0014 (0015, daily items, is separate). */
let pre15: string | undefined;
const PRE15 = () => (pre15 ??= migrationsBefore('0015'));
/** The 1.4.0 0014 (as shipped), statement by statement – to stop it part-way like an interrupted deploy. */
const OLD14 = split(path.join(__dirname, 'fixtures/0014_as_shipped_in_1.4.0.sql'));

function scratchDb(suffix: string, charset: string, collation: string) {
  const url = new URL(testDbUrl());
  const name = url.pathname.replace(/^\//, '').replace(/_test$/, `_${suffix}_test`);
  const ctx: { db: Db } = { db: undefined as unknown as Db };
  before(async () => {
    await h.db.raw('DROP DATABASE IF EXISTS ??', [name]);
    await h.db.raw(`CREATE DATABASE ?? CHARACTER SET ${charset} COLLATE ${collation}`, [name]);
    const u = new URL(url.toString());
    u.pathname = `/${name}`;
    ctx.db = createDb(u.toString(), { max: 3 });
  });
  after(async () => {
    await ctx.db?.destroy();
    await h.db.raw('DROP DATABASE IF EXISTS ??', [name]);
  });
  return ctx;
}

const t0 = Date.parse('2026-01-01T00:00:00Z');
const user = (id: string, email: string | null, ageSec: number, n: number) => ({
  id, name: `U ${id}`, phone: `+9170000141${String(n).padStart(2, '0')}`, email, created_at: new Date(t0 - ageSec * 1000), updated_at: new Date(t0),
});
const SEED = () => [
  user('a1', 'jose@x.in', 900, 1),
  user('a2', 'josé@x.in', 800, 2), // 1.3.8 cleared it: safe to give back
  user('b1', 'strasse@x.in', 900, 3),
  user('b2', 'straße@x.in', 800, 4), // given back unless someone takes it first
  user('c1', 'dup@x.in', 900, 5),
  user('c2', 'DUP@X.IN ', 800, 6), // real duplicate: stays cleared
  user('e1', 'ｒace@x.in', 800, 10), // fullwidth: not Latin-1
  user('e2', 'race@x.in', 900, 11),
  user('k1', 'cafe@x.in', 900, 12),
  user('k2', 'café@x.in', 800, 13), // NFC café, cleared by 1.3.8
  user('g1', null, 100, 14),
  user('g2', null, 90, 15),
];

function helpersFor(ctx: { db: Db }) {
  const db = () => ctx.db;
  return {
    emails: async () => Object.fromEntries((await db()('users').orderBy('id').select('id', 'email')).map((r: { id: string; email: string | null }) => [r.id, r.email])),
    indexes: async () => rows<{ n: string; e: string }>(await db().raw("SELECT index_name AS n, expression AS e FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'users' AND index_name LIKE 'ux_users_email%' ORDER BY index_name")),
    listed: async () => (await db()('email_duplicates_0013').orderBy('user_id').pluck('user_id')) as string[],
    restored: async () => (await db()('email_restored_0014').orderBy('user_id').select('user_id', 'email')).map((r: { user_id: string; email: string }) => [r.user_id, r.email]),
    /** A server that ran 1.3.8: 0001–0012, then the 1.3.8 0013 recorded as applied. */
    as138: async (extra?: () => Promise<void>) => {
      await dropAll(db());
      await migrate(db(), migrationsBefore(M13));
      await db()('users').insert(SEED());
      await extra?.();
      for (const q of split(path.join(__dirname, 'fixtures/0013_as_shipped_in_1.3.8.sql'))) await db().raw(q);
      await db()('schema_migrations').insert({ version: M13, applied_at: new Date() });
    // 1.4.3 (V142-4): a 1.3.8 database has no checksum column and no record (a NULL record now fails)
    await db().raw('ALTER TABLE schema_migrations DROP COLUMN checksum');
    await db().raw('DROP TABLE schema_migrations_meta');
    },
    /** Runs the first `n` statements of the 1.4.0 0014 on one connection (session variables), then "crashes". */
    old14Until: async (stop: (sql: string) => boolean) => {
      const conn = await (db().client as { acquireConnection(): Promise<unknown> }).acquireConnection();
      try {
        for (const q of OLD14) {
          await db().raw(q).connection(conn as never);
          if (stop(q)) break;
        }
      } finally {
        await (db().client as { releaseConnection(c: unknown): Promise<void> }).releaseConnection(conn);
      }
    },
  };
}

const REPAIRED = {
  a1: 'jose@x.in', a2: 'josé@x.in', b1: 'strasse@x.in', b2: 'straße@x.in', c1: 'dup@x.in', c2: null,
  e1: 'ｒace@x.in', e2: 'race@x.in', k1: 'cafe@x.in', k2: 'café@x.in', g1: null, g2: null,
};
const isBinary = (ix: { n: string; e: string }[]) => ix.length === 1 && ix[0].n === 'ux_users_email_norm' && /utf8mb4_bin/.test(ix[0].e);

describe('V140-1: 0014 can be resumed after any interruption, and a rerun re-checks every restore', () => {
  const ctx = scratchDb('m141', 'utf8mb4', 'utf8mb4_0900_ai_ci');
  const H = helpersFor(ctx);

  it('normal path: same result as 1.4.0 (restores logged, binary index, real duplicate stays cleared)', async () => {
    await H.as138();
    assert.deepEqual(await migrate(ctx.db, PRE15()), [M14]);
    assert.deepEqual(await H.emails(), REPAIRED);
    assert.ok(isBinary(await H.indexes()), JSON.stringify(await H.indexes()));
    assert.deepEqual(await H.restored(), [['a2', 'josé@x.in'], ['b2', 'straße@x.in'], ['e1', 'ｒace@x.in'], ['k2', 'café@x.in']]);
    assert.deepEqual(await H.listed(), ['c2']);
    const snap = JSON.stringify([await H.emails(), await H.listed(), await H.restored(), await H.indexes()]);
    await ctx.db('schema_migrations').where({ version: M14 }).del();
    assert.deepEqual(await migrate(ctx.db, PRE15()), [M14]);
    assert.equal(JSON.stringify([await H.emails(), await H.listed(), await H.restored(), await H.indexes()]), snap);
  });

  it('1.4.0 version stopped after logging the restores, someone saves straße@ before the rerun: rerun skips b2, index created', async () => {
    await H.as138();
    let seenInsert = false;
    await H.old14Until((q) => {
      if (/INSERT IGNORE INTO email_restored_0014/.test(q)) seenInsert = true;
      return seenInsert && /^EXECUTE/.test(q);
    });
    assert.deepEqual((await H.restored()).map((r) => r[0]), ['a2', 'b2', 'e1', 'k2']);
    assert.equal((await H.indexes()).length, 0); // 1.4.0 had already dropped the index
    await ctx.db('users').where({ id: 'g1' }).update({ email: 'straße@x.in' }); // no index in this window
    assert.deepEqual(await migrate(ctx.db, PRE15()), [M14]);
    const e = await H.emails();
    assert.equal(e.g1, 'straße@x.in');
    assert.equal(e.b2, null); // not restored into a duplicate
    assert.ok(isBinary(await H.indexes()));
    assert.deepEqual((await H.restored()).map((r) => r[0]), ['a2', 'e1', 'k2']); // the stale log row is gone
    assert.ok((await H.listed()).includes('b2')); // still listed for support
  });

  it('a database stuck by the 1.4.0 version (duplicate restored, CREATE UNIQUE INDEX failing) is repaired', async () => {
    await H.as138();
    // 1.4.0: stopped after the restore-log INSERT; straße@ taken; the rerun then restored b2 anyway and failed
    let seenInsert = false;
    await H.old14Until((q) => {
      if (/INSERT IGNORE INTO email_restored_0014/.test(q)) seenInsert = true;
      return seenInsert && /^EXECUTE/.test(q);
    });
    await ctx.db('users').where({ id: 'g1' }).update({ email: 'straße@x.in' });
    await assert.rejects(H.old14Until(() => false), /Duplicate entry/);
    assert.equal((await H.emails()).b2, 'straße@x.in'); // the duplicate 1.4.0 made
    assert.equal((await H.indexes()).length, 0);
    assert.deepEqual(await migrate(ctx.db, PRE15()), [M14]);
    const e = await H.emails();
    assert.equal(e.g1, 'straße@x.in'); // the account that saved it keeps it
    assert.equal(e.b2, null); // cleared again …
    assert.ok((await H.listed()).includes('b2')); // … and listed again
    assert.equal(e.a2, 'josé@x.in');
    assert.ok(isBinary(await H.indexes()));
    assert.ok(!(await H.restored()).some((r) => r[0] === 'b2'));
  });

  it('1.4.1 version stopped after any statement: the next run finishes with the same result, and the index never disappears', async () => {
    const stmts = split(path.join(MIGRATIONS_DIR, M14));
    let reference: string | null = null;
    for (let stopAt = 0; stopAt < stmts.length; stopAt += 3) {
      await dropAll(ctx.db);
      await H.as138();
      const conn = await (ctx.db.client as { acquireConnection(): Promise<unknown> }).acquireConnection();
      try {
        for (let i = 0; i <= stopAt; i++) {
          await ctx.db.raw(stmts[i]).connection(conn as never);
          assert.ok((await H.indexes()).length >= 1, `no unique email index after statement ${i}`);
        }
        // 1.4.2: an interrupted run's connection is gone – MySQL rolls back its open transaction (steps 4–6)
        await ctx.db.raw('ROLLBACK').connection(conn as never);
      } finally {
        await (ctx.db.client as { releaseConnection(c: unknown): Promise<void> }).releaseConnection(conn);
      }
      assert.deepEqual(await migrate(ctx.db, PRE15()), [M14]);
      const snap = JSON.stringify([await H.emails(), await H.listed(), await H.restored(), await H.indexes()]);
      reference ??= snap;
      assert.equal(snap, reference, `stopped after statement ${stopAt}`);
    }
  });

  it('1.4.1 version stopped after logging, someone saves straße@: the index is in place, the rerun re-checks and skips b2', async () => {
    await H.as138();
    const stmts = split(path.join(MIGRATIONS_DIR, M14));
    const insertAt = stmts.findIndex((q) => /INSERT IGNORE INTO email_restored_0014/.test(q));
    const conn = await (ctx.db.client as { acquireConnection(): Promise<unknown> }).acquireConnection();
    try {
      for (let i = 0; i <= insertAt + 2; i++) await ctx.db.raw(stmts[i]).connection(conn as never); // SET, PREPARE, EXECUTE
      // 1.4.2 (V141-1): the log rows are written inside the restore transaction – the stopped run's connection
      // is gone, so they are rolled back with it: nothing half-done is left
      await ctx.db.raw('ROLLBACK').connection(conn as never);
    } finally {
      await (ctx.db.client as { releaseConnection(c: unknown): Promise<void> }).releaseConnection(conn);
    }
    assert.ok(!(await H.restored()).some((r) => r[0] === 'b2'));
    assert.ok(isBinary(await H.indexes()));
    await ctx.db('users').where({ id: 'g1' }).update({ email: 'straße@x.in' });
    assert.deepEqual(await migrate(ctx.db, PRE15()), [M14]);
    assert.equal((await H.emails()).b2, null);
    assert.ok(!(await H.restored()).some((r) => r[0] === 'b2'));
    assert.ok((await H.listed()).includes('b2'));
  });

  it('V140-3: an address held in decomposed form (NFD) by another account is not given back in composed form', async () => {
    await H.as138(async () => {
      await ctx.db('users').insert(user('t3', null, 50, 16));
    });
    // after 1.3.8: k1 moves off cafe@, then t3 saves café in NFD (a pre-1.4.0 app)
    await ctx.db('users').where({ id: 'k1' }).update({ email: 'k1new@x.in' });
    await ctx.db('users').where({ id: 't3' }).update({ email: 'cafe\u0301@x.in' });
    assert.deepEqual(await migrate(ctx.db, PRE15()), [M14]);
    const e = await H.emails();
    assert.equal(e.k2, null);
    assert.equal(e.t3, 'cafe\u0301@x.in');
    assert.ok((await H.listed()).includes('k2'));
  });

  it('V140-9: values given back are trimmed and lower-cased; a case-only duplicate is given back once its holder removed the address', async () => {
    await H.as138();
    await ctx.db('users').where({ id: 'c1' }).update({ email: null }); // the holder of dup@ removed it
    assert.deepEqual(await migrate(ctx.db, PRE15()), [M14]);
    assert.equal((await H.emails()).c2, 'dup@x.in'); // 'DUP@X.IN ' given back as dup@x.in
  });

  it('on a correct database (1.3.9+ 0013) 0014 changes nothing', async () => {
    await dropAll(ctx.db);
    await migrate(ctx.db, migrationsBefore(M14));
    await ctx.db('users').insert(SEED().filter((u) => !['a2', 'b2', 'c2', 'k2'].includes(u.id)));
    const tables = async () => rows<{ t: string }>(await ctx.db.raw('SELECT table_name AS t FROM information_schema.tables WHERE table_schema = DATABASE() ORDER BY table_name')).map((r) => r.t);
    const snap = JSON.stringify([await H.emails(), await H.indexes(), await tables()]);
    assert.deepEqual(await migrate(ctx.db, PRE15()), [M14]);
    assert.equal(JSON.stringify([await H.emails(), await H.indexes(), await tables()]), snap);
  });
});

describe('V140-2: a database whose default charset is latin1', () => {
  const ctx = scratchDb('l141', 'latin1', 'latin1_swedish_ci');
  const H = helpersFor(ctx);

  it('the 1.3.8 0013 logged ｒace@ as ?ace@ (latin1 log table); 0014 completes, keeps the index, never "restores" the mangled address', async () => {
    await H.as138();
    const cs = rows<{ c: string }>(await ctx.db.raw("SELECT character_set_name AS c FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'email_duplicates_0013' AND column_name = 'email'"))[0].c;
    assert.equal(cs, 'latin1');
    const logged = Object.fromEntries((await ctx.db('email_duplicates_0013').select('user_id', 'email')).map((r: { user_id: string; email: string }) => [r.user_id, r.email]));
    assert.equal(logged.e1, '?ace@x.in');
    assert.deepEqual(await migrate(ctx.db, PRE15()), [M14]);
    const e = await H.emails();
    assert.equal(e.e1, null); // mangled in the log: stays cleared (listed for support)
    assert.equal(e.a2, 'josé@x.in'); // Latin-1 characters survive: given back
    assert.equal(e.b2, 'straße@x.in');
    assert.equal(e.k2, 'café@x.in');
    assert.equal(e.c2, null);
    assert.ok(isBinary(await H.indexes()), JSON.stringify(await H.indexes()));
    assert.deepEqual((await H.listed()).sort(), ['c2', 'e1']);
    await ctx.db('schema_migrations').where({ version: M14 }).del();
    assert.deepEqual(await migrate(ctx.db, PRE15()), [M14]); // re-runnable
    assert.equal((await H.emails()).e1, null);
  });

  it('a fresh latin1 database: every migration applies, binary index', async () => {
    await dropAll(ctx.db);
    await migrate(ctx.db);
    assert.ok(isBinary(await H.indexes()));
  });
});

describe('V140-3 / V140-4 on the API', () => {
  const people = ['p1', 'p2'].map((uid, i) => ({ uid: `v1413${uid}`, phone: `+91600000141${i}` }));
  const body = (u: { phone: string }, extra: Record<string, unknown> = {}) => ({ phone: u.phone, firstName: 'Asha', lastName: 'Rao', dob: '2000-05-20', pincode: '110001', ...extra });
  it('a legacy NFD address keeps saving (with or without an email field) after another account saved the NFC form', async () => {
    await acceptTermsFor(h.db, people.map((p) => p.uid));
    const [a, b] = people;
    assert.equal((await h.as(a).put(`/api/users/${a.uid}`).send(body(a, { email: 'other@x.in' }))).status, 200);
    await h.db('users').where({ id: a.uid }).update({ email: 'cafe\u0301@x.in' }); // stored by a pre-1.4.0 server
    assert.equal((await h.as(b).put(`/api/users/${b.uid}`).send(body(b, { email: 'café@x.in' }))).status, 200);
    const r1 = await h.as(a).put(`/api/users/${a.uid}`).send(body(a, { firstName: 'Ashaa' }));
    assert.equal(r1.status, 200, JSON.stringify(r1.body));
    const r2 = await h.as(a).put(`/api/users/${a.uid}`).send(body(a, { email: 'café@x.in', firstName: 'Ashab' })); // the app sends it normalised
    assert.equal(r2.status, 200, JSON.stringify(r2.body));
    assert.equal((await h.db('users').where({ id: a.uid }).first('email')).email, 'cafe\u0301@x.in'); // kept as stored
    // a different address is still refused
    assert.equal((await h.as(a).put(`/api/users/${a.uid}`).send(body(a, { email: 'CAFÉ@x.in ' }))).status, 200); // its own
    const [, bb] = people;
    assert.equal((await h.as(bb).put(`/api/users/${bb.uid}`).send(body(bb, { email: 'other2@x.in' }))).status, 200);
  });
  it('without a clash, an unchanged legacy NFD address is stored normalised on the next save', async () => {
    await acceptTermsFor(h.db, [people[0].uid]);
    const [a] = people;
    assert.equal((await h.as(a).put(`/api/users/${a.uid}`).send(body(a))).status, 200);
    await h.db('users').where({ id: a.uid }).update({ email: 'cafe\u0301@x.in' });
    assert.equal((await h.as(a).put(`/api/users/${a.uid}`).send(body(a, { firstName: 'Ashaa' }))).status, 200);
    assert.equal((await h.db('users').where({ id: a.uid }).first('email')).email, 'café@x.in');
  });
  it('V140-4: ΟΔΟΣ@ and οδοσ@ are the same address (final sigma folded)', async () => {
    await acceptTermsFor(h.db, people.map((p) => p.uid));
    const [a, b] = people;
    const r1 = await h.as(a).put(`/api/users/${a.uid}`).send(body(a, { email: 'ΟΔΟΣ@x.in' }));
    assert.equal(r1.status, 200, JSON.stringify(r1.body));
    assert.equal((await h.db('users').where({ id: a.uid }).first('email')).email, 'οδοσ@x.in');
    assert.equal((await h.as(b).put(`/api/users/${b.uid}`).send(body(b, { email: 'οδοσ@x.in' }))).status, 409);
    assert.equal((await h.as(b).put(`/api/users/${b.uid}`).send(body(b, { email: 'οδος@x.in' }))).status, 409);
  });
});

describe('V140-7: daily items keep server-timed tombstones (API)', () => {
  const fact = { type: 'fact', textEn: 'Court 18 x 9 m', textHi: 'कोर्ट 18 x 9 मी', attribution: null, sourceUrl: null, active: true };
  type Item = { id: string; active: boolean; createdAt: number; removedAt: number | null; deleted?: boolean; textEn: string };
  it('turning off stamps removedAt once; back on = a copy (new id, new createdAt), the old row a deleted tombstone', async () => {
    const a = (await h.as(ADMIN).post('/api/admin/daily-items').send(fact)).body as Item;
    assert.equal(a.removedAt, null);
    const off = (await h.as(ADMIN).patch(`/api/admin/daily-items/${a.id}`).send({ active: false })).body as Item;
    assert.equal(typeof off.removedAt, 'number');
    assert.ok(Math.abs(off.removedAt! - Date.now()) < 60_000);
    const edited = (await h.as(ADMIN).patch(`/api/admin/daily-items/${a.id}`).send({ textEn: 'Edited while off' })).body as Item;
    assert.equal(edited.removedAt, off.removedAt); // set once
    // a client-sent removedAt / createdAt is ignored
    const forged = (await h.as(ADMIN).patch(`/api/admin/daily-items/${a.id}`).send({ removedAt: 1, createdAt: 1 })).body as Item;
    assert.equal(forged.removedAt, off.removedAt);
    assert.equal(forged.createdAt, a.createdAt);
    const on = await h.as(ADMIN).patch(`/api/admin/daily-items/${a.id}`).send({ active: true });
    assert.equal(on.status, 200);
    assert.notEqual(on.body.id, a.id);
    assert.equal(on.body.active, true);
    assert.equal(on.body.textEn, 'Edited while off');
    const row = await h.db('daily_items').where({ id: a.id }).first();
    assert.equal(row.deleted, 1);
    assert.equal((await h.as(ADMIN).patch(`/api/admin/daily-items/${a.id}`).send({ textEn: 'x' })).status, 404); // tombstone
    const admin = (await h.as(ADMIN).get('/api/admin/daily-items')).body as Item[];
    assert.deepEqual(admin.map((x) => x.id), [on.body.id]);
    const pub = (await h.api.get('/api/daily-items')).body as Item[];
    assert.deepEqual(pub.map((x) => [x.id, x.active]).sort(), [[a.id, false], [on.body.id, true]].sort());
    assert.equal(pub.find((x) => x.id === a.id)!.textEn, '');
  });
  it('deleting an item that is on stamps removedAt; deleting one that is off keeps its removedAt', async () => {
    const a = (await h.as(ADMIN).post('/api/admin/daily-items').send(fact)).body as Item;
    assert.equal((await h.as(ADMIN).del(`/api/admin/daily-items/${a.id}`)).status, 204);
    const ra = await h.db('daily_items').where({ id: a.id }).first();
    assert.equal(ra.deleted, 1);
    assert.equal(ra.active, 0);
    assert.ok(ra.removed_at instanceof Date);
    const b = (await h.as(ADMIN).post('/api/admin/daily-items').send({ ...fact, active: false })).body as Item;
    assert.equal(typeof b.removedAt, 'number');
    await h.db('daily_items').where({ id: b.id }).update({ removed_at: new Date('2026-03-01T00:00:00Z') });
    assert.equal((await h.as(ADMIN).del(`/api/admin/daily-items/${b.id}`)).status, 204);
    assert.equal((await h.db('daily_items').where({ id: b.id }).first()).removed_at.toISOString(), '2026-03-01T00:00:00.000Z');
  });
  it('an item turned off before 1.4.1 (no removed_at) stays out of every cycle: edit, delete and reactivate never stamp it', async () => {
    const mk = async () => {
      const a = (await h.as(ADMIN).post('/api/admin/daily-items').send({ ...fact, active: false })).body as Item;
      await h.db('daily_items').where({ id: a.id }).update({ removed_at: null }); // as 0015 leaves a pre-1.4.1 "off" row
      return a;
    };
    const a = await mk();
    await h.as(ADMIN).patch(`/api/admin/daily-items/${a.id}`).send({ textEn: 'Edited while off' });
    assert.equal((await h.db('daily_items').where({ id: a.id }).first()).removed_at, null);
    assert.equal((await h.as(ADMIN).del(`/api/admin/daily-items/${a.id}`)).status, 204);
    const ra = await h.db('daily_items').where({ id: a.id }).first();
    assert.equal(ra.deleted, 1);
    assert.equal(ra.removed_at, null);
    const b = await mk();
    const on = (await h.as(ADMIN).patch(`/api/admin/daily-items/${b.id}`).send({ active: true })).body as Item;
    assert.notEqual(on.id, b.id);
    assert.equal((await h.db('daily_items').where({ id: b.id }).first()).removed_at, null);
    const pub = (await h.api.get('/api/daily-items')).body as Item[];
    assert.ok(!pub.some((x) => x.id === a.id || x.id === b.id)); // never listed: in no cycle
  });
  it('0015 is re-runnable', async () => {
    await h.db('schema_migrations').where({ version: '0015_daily_items_tombstones.sql' }).del();
    assert.deepEqual(await migrate(h.db), ['0015_daily_items_tombstones.sql']);
  });
});
