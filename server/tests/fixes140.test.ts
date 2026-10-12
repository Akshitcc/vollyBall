/**
 * 1.4.0: V139-1 (0014 repairs a database that applied the 1.3.8 0013, and changes nothing on a correct
 * one), V139-2 (emails NFC-normalised), PUT /progress refuses server-only fields.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, beforeEach, describe, it } from 'node:test';
import { createDb, type Db } from '../src/db/knex';
import { dropAll, migrate, MIGRATIONS_DIR } from '../src/db/migrate';
import { acceptTermsFor, createMatch, EVERYONE, pt, register, startHarness, testDbUrl, type Harness } from './helpers';

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

describe('V139-1: 0014 repairs a database that applied the 1.3.8 0013', () => {
  const url = new URL(testDbUrl());
  const name = url.pathname.replace(/^\//, '').replace(/_test$/, '_m140_test');
  let db: Db;
  before(async () => {
    await h.db.raw('DROP DATABASE IF EXISTS ??', [name]);
    await h.db.raw('CREATE DATABASE ?? CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci', [name]);
    const u = new URL(url.toString());
    u.pathname = `/${name}`;
    db = createDb(u.toString(), { max: 3 });
  });
  after(async () => {
    await db?.destroy();
    await h.db.raw('DROP DATABASE IF EXISTS ??', [name]);
  });
  const t0 = Date.parse('2026-01-01T00:00:00Z');
  const user = (id: string, email: string | null, ageSec: number, n: number) => ({
    id, name: `U ${id}`, phone: `+9170000014${String(n).padStart(2, '0')}`, email, created_at: new Date(t0 - ageSec * 1000), updated_at: new Date(t0),
  });
  const seed = () =>
    db('users').insert([
      user('a1', 'jose@x.in', 900, 1), // keeps it
      user('a2', 'josé@x.in', 800, 2), // 1.3.8 cleared it (accent variant): given back
      user('b1', 'strasse@x.in', 900, 3),
      user('b2', 'straße@x.in', 800, 4), // ß: given back
      user('c1', 'dup@x.in', 900, 5),
      user('c2', 'DUP@X.IN ', 800, 6), // a real (case/space) duplicate: stays cleared
      user('d1', 'manana@x.in', 900, 7),
      user('d2', 'mañana@x.in', 800, 8), // given back (oldest of the two that clash with each other)
      user('d3', 'MAÑANA@x.in', 700, 9), // case-only clash with d2: stays cleared
      user('e1', 'ｒace@x.in', 800, 10), // fullwidth ｒ: 1.3.8 thought it equal to race@
      user('e2', 'race@x.in', 900, 11),
      user('f1', 'cafe@x.in', 900, 12),
      user('f2', 'café@x.in', 800, 13), // cleared, then f2 set another address: left alone
      user('g1', null, 100, 14),
    ]);
  const emails = async () => Object.fromEntries((await db('users').orderBy('id').select('id', 'email')).map((r: { id: string; email: string | null }) => [r.id, r.email]));
  const indexExpr = async () => rows<{ e: string }>(await db.raw("SELECT expression AS e FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'users' AND index_name = 'ux_users_email_norm'"))[0]?.e ?? null;
  const tableExists = async (t: string) => rows<{ n: number }>(await db.raw('SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ?', [t]))[0].n > 0;
  const listed = async () => (await db('email_duplicates_0013').orderBy('user_id').pluck('user_id')) as string[];
  /** A server that ran 1.3.8: 0001–0012, then the 1.3.8 0013 (which succeeds on a 0900_ai_ci database) recorded as applied. */
  async function as138() {
    await dropAll(db);
    await migrate(db, migrationsBefore(M13));
    await seed();
    for (const q of split(path.join(__dirname, 'fixtures/0013_as_shipped_in_1.3.8.sql'))) await db.raw(q);
    await db('schema_migrations').insert({ version: M13, applied_at: new Date() });
    // 1.4.3 (V142-4): a 1.3.8 database has no checksum column and no record (a NULL record now fails)
    await db.raw('ALTER TABLE schema_migrations DROP COLUMN checksum');
    await db.raw('DROP TABLE schema_migrations_meta');
    await db('users').where({ id: 'f2' }).update({ email: 'other@x.in' }); // a later change on a cleared account
  }
  const REPAIRED = {
    a1: 'jose@x.in', a2: 'josé@x.in', b1: 'strasse@x.in', b2: 'straße@x.in', c1: 'dup@x.in', c2: null,
    d1: 'manana@x.in', d2: 'mañana@x.in', d3: null, e1: 'ｒace@x.in', e2: 'race@x.in', f1: 'cafe@x.in', f2: 'other@x.in', g1: null,
  };

  it('the 1.3.8 state is reproduced: accent-insensitive index, accent variants cleared', async () => {
    await as138();
    assert.doesNotMatch(String(await indexExpr()), /utf8mb4_bin/);
    const e = await emails();
    assert.equal(e.a2, null);
    assert.equal(e.b2, null);
    await assert.rejects(db('users').where({ id: 'g1' }).update({ email: 'JOSÉ@x.in' }), /Duplicate|ux_users_email_norm/);
  });

  it('0014 drops the old index, gives back the safe addresses, keeps real duplicates cleared, creates the binary index', async () => {
    await as138();
    assert.deepEqual(await migrate(db, PRE15()), [M14]);
    assert.deepEqual(await emails(), REPAIRED);
    assert.match(String(await indexExpr()), /utf8mb4_bin/);
    const restored = (await db('email_restored_0014').orderBy('user_id').select('user_id', 'email')).map((r: { user_id: string; email: string }) => [r.user_id, r.email]);
    assert.deepEqual(restored, [['a2', 'josé@x.in'], ['b2', 'straße@x.in'], ['d2', 'mañana@x.in'], ['e1', 'ｒace@x.in']]);
    assert.deepEqual(await listed(), ['c2', 'd3', 'f2']); // still cleared (f2 kept its newer address)
    // the new index: accents/widths differ, case/spaces don't
    await db('users').where({ id: 'g1' }).update({ email: 'josé2@x.in' });
    await db('users').where({ id: 'g1' }).update({ email: null });
    await assert.rejects(db('users').where({ id: 'g1' }).update({ email: ' JOSÉ@X.IN' }), /Duplicate|ux_users_email_norm/);
    // forcing another run changes nothing
    const snap = JSON.stringify([await emails(), await listed(), await db('email_restored_0014').orderBy('user_id').select('user_id', 'email'), await indexExpr()]);
    await db('schema_migrations').where({ version: M14 }).del();
    assert.deepEqual(await migrate(db, PRE15()), [M14]);
    assert.equal(JSON.stringify([await emails(), await listed(), await db('email_restored_0014').orderBy('user_id').select('user_id', 'email'), await indexExpr()]), snap);
  });

  it('an interrupted repair (old index already dropped) is finished by the next run', async () => {
    await as138();
    await db.raw('DROP INDEX ux_users_email_norm ON users'); // stopped right after step 1
    assert.deepEqual(await migrate(db, PRE15()), [M14]);
    assert.deepEqual(await emails(), REPAIRED);
    assert.match(String(await indexExpr()), /utf8mb4_bin/);
  });

  it('on a correct database (1.3.9+ 0013) 0014 changes nothing – no table, no row, same index', async () => {
    await dropAll(db);
    await migrate(db, migrationsBefore(M14));
    await db('users').insert([user('a1', 'jose@x.in', 900, 1), user('a2', 'josé@x.in', 800, 2), user('c1', 'dup@x.in', 900, 5), user('c2', null, 800, 6)]);
    await db('email_duplicates_0013').insert({ user_id: 'c2', email: 'DUP@X.IN ', kept_user_id: 'c1', noted_at: new Date(t0) });
    await db('users').where({ id: 'c1' }).update({ email: 'changed@x.in' }); // even a "now safe" listed address is not touched
    const tables = async () => (rows<{ t: string }>(await db.raw('SELECT table_name AS t FROM information_schema.tables WHERE table_schema = DATABASE() ORDER BY table_name'))).map((r) => r.t);
    const before = JSON.stringify([await emails(), await listed(), await indexExpr(), await tables()]);
    assert.deepEqual(await migrate(db, PRE15()), [M14]);
    assert.equal(await tableExists('email_restored_0014'), false);
    assert.equal(JSON.stringify([await emails(), await listed(), await indexExpr(), await tables()]), before);
    await db('schema_migrations').where({ version: M14 }).del();
    assert.deepEqual(await migrate(db, PRE15()), [M14]);
    assert.equal(JSON.stringify([await emails(), await listed(), await indexExpr(), await tables()]), before);
  });
});

describe('V139-2: emails are NFC-normalised before validating and comparing', () => {
  const people = ['n1', 'n2'].map((uid, i) => ({ uid: `v1402${uid}`, phone: `+91600000140${i}` }));
  const body = (u: { phone: string }, email: string, firstName = 'Asha') => ({ phone: u.phone, firstName, lastName: 'Rao', dob: '2000-05-20', pincode: '110001', email });
  it('josé@ typed decomposed (e + U+0301) is the same address as the composed one: 409, and stored composed', async () => {
    await acceptTermsFor(h.db, people.map((p) => p.uid));
    const [a, b] = people;
    const nfd = 'jose\u0301@x.in';
    const r1 = await h.as(a).put(`/api/users/${a.uid}`).send(body(a, nfd, 'Jose\u0301'));
    assert.equal(r1.status, 200, JSON.stringify(r1.body));
    const row = await h.db('users').where({ id: a.uid }).first('email', 'first_name');
    assert.equal(row.email, 'josé@x.in'); // NFC
    assert.equal(row.first_name, 'José');
    const r2 = await h.as(b).put(`/api/users/${b.uid}`).send(body(b, 'JOSÉ@x.in'));
    assert.equal(r2.status, 409, JSON.stringify(r2.body));
    const r3 = await h.as(b).put(`/api/users/${b.uid}`).send(body(b, ' jose\u0301@X.in '));
    assert.equal(r3.status, 409, JSON.stringify(r3.body));
  });
});

describe('PUT /progress refuses server-only fields (400 instead of dropping them)', () => {
  for (const field of ['confirmedAt', 'verification', 'points', 'isAdmin', 'startedServerAt']) {
    it(`${field} → 400 server_field`, async () => {
      const id = await createMatch(h);
      const r = await h.as('cap').put(`/api/matches/${id}/progress`).send({ events: [pt('A', 1000, 'bob')], [field]: field === 'verification' ? { status: 'confirmed' } : 1 });
      assert.equal(r.status, 400, JSON.stringify(r.body));
      assert.equal(r.body.error, 'server_field');
    });
  }
  it('a normal progress update still works', async () => {
    const id = await createMatch(h);
    assert.equal((await h.as('cap').put(`/api/matches/${id}/progress`).send({ events: [pt('A', 1000, 'bob')] })).status, 200);
  });
});
