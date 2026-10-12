/**
 * 1.3.9: tester's 1.3.8 findings on the API server – V138-1 (0013 collation-pinned and re-runnable from a
 * half-applied state), V138-2 (email uniqueness is case-insensitive only, not accent/width-insensitive),
 * V138-6 (the complete-profile gate uses the registration validators), V138-11 (confirming never changes
 * the match's date; lists are ordered by the match date), V138-7 (facts carry createdAt).
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, beforeEach, describe, it } from 'node:test';
import { createDb, type Db } from '../src/db/knex';
import { dropAll, migrate, MIGRATIONS_DIR } from '../src/db/migrate';
import { acceptTermsFor, createMatch, EVERYONE, newMatchBody, pt, register, startHarness, testDbUrl, type Harness } from './helpers';

let h: Harness;
before(async () => (h = await startHarness()));
after(async () => h.close());
beforeEach(async () => {
  await h.reset();
  await register(h, ...EVERYONE);
});

const M13 = '0013_users_email_unique.sql';
const rows = <T>(r: unknown) => (r as [T[]])[0];
async function tableCollation(db: Db, table: string): Promise<string> {
  const r = rows<{ c: string }>(await db.raw('SELECT table_collation AS c FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ?', [table]));
  return r[0]?.c;
}
async function emailIndexExpr(db: Db): Promise<string | null> {
  const r = rows<{ e: string }>(await db.raw("SELECT expression AS e FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'users' AND index_name = 'ux_users_email_norm'"));
  return r[0]?.e ?? null;
}
/** Statements of a .sql file the way the runner splits them. */
const split = (file: string) =>
  fs.readFileSync(file, 'utf8').split(/^-- ;;\s*$/m).map((s) => s.trim()).filter((s) => s.replace(/^--.*$/gm, '').trim());
/** A copy of the migrations folder holding only the files before `upTo` (an older deploy). */
function migrationsBefore(upTo: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vl-mig-'));
  for (const f of fs.readdirSync(MIGRATIONS_DIR)) if (f.endsWith('.sql') && f < upTo) fs.copyFileSync(path.join(MIGRATIONS_DIR, f), path.join(dir, f));
  return dir;
}
/** 1.4.1: the migrations up to 0014 – these tests are about 0013/0014 (0015, daily items, is separate). */
let pre15: string | undefined;
const PRE15 = () => (pre15 ??= migrationsBefore('0015'));

describe('V138-1: 0013 on a database whose default collation is NOT utf8mb4_0900_ai_ci', () => {
  const url = new URL(testDbUrl());
  const name = url.pathname.replace(/^\//, '').replace(/_test$/, '_coll139_test');
  let db: Db;
  before(async () => {
    await h.db.raw('DROP DATABASE IF EXISTS ??', [name]);
    await h.db.raw('CREATE DATABASE ?? CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci', [name]);
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
    id, name: `U ${id}`, phone: `+9170000013${String(n).padStart(2, '0')}`, email, created_at: new Date(t0 - ageSec * 1000), updated_at: new Date(t0),
  });
  const seed = () =>
    db('users').insert([
      user('u1', 'same@x.in', 300, 1), // oldest of the real duplicates: keeps it
      user('u2', 'SAME@x.in ', 200, 2), // real duplicate (case + space): cleared
      user('u3', 'josé@x.in', 100, 3), // accent variant of u4: a DIFFERENT address (V138-2)
      user('u4', 'jose@x.in', 400, 4),
      user('u5', 'straße@x.in', 100, 5), // ß ≠ ss
      user('u6', 'strasse@x.in', 400, 6),
      user('u7', '', 50, 7), // empty / NULL are no email
      user('u8', null, 50, 8),
    ]);
  const emails = async () => Object.fromEntries((await db('users').orderBy('id').select('id', 'email')).map((r: { id: string; email: string | null }) => [r.id, r.email]));
  const EXPECTED = { u1: 'same@x.in', u2: null, u3: 'josé@x.in', u4: 'jose@x.in', u5: 'straße@x.in', u6: 'strasse@x.in', u7: '', u8: null };
  const listed = async () => (await db('email_duplicates_0013').orderBy('user_id').select('user_id', 'email', 'kept_user_id')).map((r: { user_id: string; email: string; kept_user_id: string }) => [r.user_id, r.email, r.kept_user_id]);

  it('a fresh database: every migration applies, the 0013 table is pinned to utf8mb4_0900_ai_ci, a second run applies nothing', async () => {
    await dropAll(db);
    const applied = await migrate(db);
    assert.ok(applied.includes(M13), applied.join());
    assert.equal(await tableCollation(db, 'email_duplicates_0013'), 'utf8mb4_0900_ai_ci');
    assert.match(String(await emailIndexExpr(db)), /utf8mb4_bin/);
    assert.deepEqual(await migrate(db), []);
  });

  it('half-applied by the 1.3.8 version (reproduced: Illegal mix of collations), the fixed 0013 completes; re-running changes nothing', async () => {
    await dropAll(db);
    await migrate(db, migrationsBefore(M13)); // a 1.3.7 server
    await seed();
    // the 1.3.8 file: table + list succeed (DDL auto-commits), the UPDATE fails – exactly the tester's state
    const old = split(path.join(__dirname, 'fixtures/0013_as_shipped_in_1.3.8.sql'));
    await db.raw(old[0]);
    await db.raw(old[1]);
    await assert.rejects(db.raw(old[2]), /Illegal mix of collations/);
    assert.equal(await tableCollation(db, 'email_duplicates_0013'), 'utf8mb4_unicode_ci');
    assert.equal(await emailIndexExpr(db), null);
    assert.ok((await listed()).some(([u]) => u === 'u3'), 'the 1.3.8 list wrongly had josé@ as a duplicate of jose@');
    // the fixed file through the runner (as MIGRATE_ON_START would); 1.4.0's 0014 then finds nothing to repair
    assert.deepEqual(await migrate(db, PRE15()), [M13, '0014_email_index_repair.sql']);
    assert.deepEqual(await emails(), EXPECTED);
    assert.deepEqual(await listed(), [['u2', 'SAME@x.in ', 'u1']]);
    assert.equal(await tableCollation(db, 'email_duplicates_0013'), 'utf8mb4_0900_ai_ci');
    assert.match(String(await emailIndexExpr(db)), /utf8mb4_bin/);
    // the index: case/space duplicates refused, accent variants are different addresses
    await assert.rejects(db('users').where({ id: 'u8' }).update({ email: ' JOSÉ@x.in' }), /ux_users_email_norm|Duplicate/);
    await assert.rejects(db('users').where({ id: 'u8' }).update({ email: 'Same@X.in' }), /ux_users_email_norm|Duplicate/);
    await db('users').where({ id: 'u8' }).update({ email: 'ｊose@x.in' }); // fullwidth ｊ: a different address
    await db('users').where({ id: 'u8' }).update({ email: null });
    // re-run of the whole file (schema_migrations row removed): no error, no change
    for (let run = 0; run < 2; run++) {
      await db('schema_migrations').where({ version: M13 }).del();
      assert.deepEqual(await migrate(db, PRE15()), [M13]);
      assert.deepEqual(await emails(), EXPECTED);
      assert.deepEqual(await listed(), [['u2', 'SAME@x.in ', 'u1']]);
    }
    assert.deepEqual(await migrate(db, PRE15()), []);
  });

  it('an index left with the 1.3.8 (accent-insensitive) definition is replaced by the binary one on a re-run', async () => {
    await dropAll(db);
    await migrate(db);
    await db.raw('DROP INDEX ux_users_email_norm ON users');
    await db.raw("CREATE UNIQUE INDEX ux_users_email_norm ON users ((NULLIF(LOWER(TRIM(email)), '')))");
    await db('schema_migrations').where({ version: M13 }).del();
    assert.deepEqual(await migrate(db, PRE15()), [M13]);
    assert.match(String(await emailIndexExpr(db)), /utf8mb4_bin/);
  });
});

describe('V138-2: email uniqueness is case-insensitive only – accents and widths make a different address', () => {
  const people = ['e1', 'e2', 'e3', 'e4'].map((uid, i) => ({ uid: `v1392${uid}`, phone: `+91600000139${i}` }));
  const body = (u: { phone: string }, email: string) => ({ phone: u.phone, firstName: 'Asha', lastName: 'Rao', dob: '2000-05-20', pincode: '110001', email });
  const put = (u: { uid: string; phone: string }, email: string) => h.as(u).put(`/api/users/${u.uid}`).send(body(u, email));
  it('jose@ / josé@ and strasse@ / straße@ can belong to different accounts; JOSÉ@ (case only) cannot', async () => {
    await acceptTermsFor(h.db, people.map((p) => p.uid));
    const [a, b, c, d] = people;
    assert.equal((await put(a, 'jose@x.in')).status, 200);
    assert.equal((await put(b, 'josé@x.in')).status, 200);
    assert.equal((await put(c, 'strasse@x.in')).status, 200);
    assert.equal((await put(d, 'straße@x.in')).status, 200);
    const taken = await put(d, ' JOSÉ@X.IN ');
    assert.equal(taken.status, 409, JSON.stringify(taken.body));
    assert.equal(taken.body.error, 'email_taken');
    assert.equal((await put(c, 'Strasse@X.in')).status, 200); // your own address again
    const stored = await h.db('users').whereIn('id', people.map((p) => p.uid)).orderBy('id').pluck('email');
    assert.deepEqual(stored, ['jose@x.in', 'josé@x.in', 'strasse@x.in', 'straße@x.in']);
  });
});

const code = (r: { status: number; body: { error?: string } }, status: number, err?: string) => {
  assert.equal(r.status, status, JSON.stringify(r.body));
  if (err) assert.equal(r.body.error, err, JSON.stringify(r.body));
};

describe('V138-6: the create-match gate refuses blank names and invalid pincodes in old rows', () => {
  for (const [label, patch] of [
    ['first name of one space', { first_name: ' ' }],
    ['last name of spaces', { last_name: '   ' }],
    ['pincode 000000', { pincode: '000000' }],
    ['pincode 012345', { pincode: '012345' }],
    ['unallocated pincode prefix 10', { pincode: '100001' }],
  ] as const) {
    it(`${label} → 403 profile_incomplete`, async () => {
      await h.db('users').where({ id: 'cap' }).update(patch);
      code(await h.as('cap').post('/api/matches').send(newMatchBody()), 403, 'profile_incomplete');
    });
  }
  it('a complete, valid profile still creates (201)', async () => {
    code(await h.as('cap').post('/api/matches').send(newMatchBody()), 201);
  });
});

describe('V138-11: confirming never changes the match date or start time', () => {
  const WIN_A = ['bob', 'bob', 'bob', 'cap', 'cap'].map((c, i) => pt('A', 1000 + i, c));
  async function finishedAt(when: number) {
    const id = await createMatch(h);
    code(await h.as('cap').put(`/api/matches/${id}/progress`).send({ events: WIN_A }), 200);
    code(await h.as('cap').put(`/api/matches/${id}/player-of-match`).send({ playerId: 'bob' }), 200);
    await h.db('matches').where({ id }).update({ started_at: new Date(when - 30 * 60_000), started_server_at: new Date(when - 30 * 60_000), finished_at: new Date(when), updated_at: new Date(when) });
    return id;
  }
  it('times are unchanged, confirmedAt is set, and the list order stays by match date', async () => {
    const DAY = 86_400_000;
    const now = Date.now();
    const older = await finishedAt(now - 3 * DAY);
    const newer = await finishedAt(now - DAY);
    const before = (await h.as('aarav').get('/api/matches').query({ participant: 'aarav' })).body as { id: string; startedAt: number; finishedAt: number; confirmedAt?: number | null }[];
    assert.deepEqual(before.filter((m) => [older, newer].includes(m.id)).map((m) => m.id), [newer, older]);
    const row0 = await h.db('matches').where({ id: older }).first('started_at', 'finished_at', 'created_at', 'scheduled_at');
    code(await h.as('aarav').post(`/api/matches/${older}/confirm`), 200);
    const row1 = await h.db('matches').where({ id: older }).first('started_at', 'finished_at', 'created_at', 'scheduled_at');
    assert.deepEqual(row1, row0);
    const after = (await h.as('aarav').get('/api/matches').query({ participant: 'aarav' })).body as typeof before;
    assert.deepEqual(after.filter((m) => [older, newer].includes(m.id)).map((m) => m.id), [newer, older]); // not moved to the top
    const o0 = before.find((m) => m.id === older)!;
    const o1 = after.find((m) => m.id === older)!;
    assert.equal(o1.startedAt, o0.startedAt);
    assert.equal(o1.finishedAt, o0.finishedAt);
    assert.ok(typeof o1.confirmedAt === 'number' && o1.confirmedAt >= now - 60_000, String(o1.confirmedAt));
    assert.equal(after.find((m) => m.id === newer)!.confirmedAt ?? null, null);
  });
  it('a client cannot send confirmedAt', async () => {
    const r = await h.as('cap').post('/api/matches').send(newMatchBody({ confirmedAt: 1 }));
    assert.equal(r.status, 400, JSON.stringify(r.body));
  });
});

describe('V138-7: facts carry createdAt (new ones join the daily rotation the next IST day)', () => {
  it('the API returns createdAt for admin items', async () => {
    const admin = { uid: 'admin1', phone: null };
    const r = await h.as(admin).post('/api/admin/daily-items').send({ type: 'fact', textEn: 'Fact', textHi: 'तथ्य', active: true });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    const list = (await h.as('cap').get('/api/daily-items')).body as { id: string; createdAt: number | null }[];
    const it1 = list.find((x) => x.id === r.body.id)!;
    assert.ok(typeof it1.createdAt === 'number' && Math.abs(it1.createdAt - Date.now()) < 120_000, String(it1.createdAt));
  });
});
