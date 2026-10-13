/**
 * 1.4.2: V141-1 (0014's restore step is one transaction with an `applied` mark; the runner records and checks
 * migration checksums), V141-2 (the public daily list keeps every active item), V141-5 (invisible characters in
 * an email), V141-6 (a deleted daily item keeps no text), V141-7 (sane scheduledAt), V141-8 (a finished match's
 * score is final), info (daily `active` must be a boolean).
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, beforeEach, describe, it } from 'node:test';
import { createDb, type Db } from '../src/db/knex';
import { CHECKSUM_ALLOWLIST, dropAll, migrate, migrationChecksum, MigrationChecksumError, MIGRATIONS_DIR } from '../src/db/migrate';
import { ADMIN, EVERYONE, PEOPLE, createMatch, pt, register, regFor, startHarness, testDbUrl, type Harness } from './helpers';

let h: Harness;
before(async () => (h = await startHarness()));
after(async () => h.close());
beforeEach(async () => {
  await h.reset();
  await register(h, ...EVERYONE);
});

const M13 = '0013_users_email_unique.sql';
const M14 = '0014_email_index_repair.sql';
const split = (file: string) =>
  fs.readFileSync(file, 'utf8').split(/^-- ;;\s*$/m).map((s) => s.trim()).filter((s) => s.replace(/^--.*$/gm, '').trim());
function migrationsBefore(upTo: string, edit?: (f: string, sql: string) => string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vl-mig142-'));
  for (const f of fs.readdirSync(MIGRATIONS_DIR)) {
    if (!f.endsWith('.sql') || f >= upTo) continue;
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8');
    fs.writeFileSync(path.join(dir, f), edit ? edit(f, sql) : sql);
  }
  return dir;
}
const PRE15 = migrationsBefore('0015');
const ALL = migrationsBefore('9999');
const fixtureBody = (name: string) => fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8').split('\n').slice(2).join('\n');

function scratchDb(suffix: string) {
  const url = new URL(testDbUrl());
  const name = url.pathname.replace(/^\//, '').replace(/_test$/, `_${suffix}_test`);
  const ctx: { db: Db } = { db: undefined as unknown as Db };
  before(async () => {
    await h.db.raw('DROP DATABASE IF EXISTS ??', [name]);
    await h.db.raw('CREATE DATABASE ?? CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci', [name]);
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
  id, name: `U ${id}`, phone: `+9170000142${String(n).padStart(2, '0')}`, email, created_at: new Date(t0 - ageSec * 1000), updated_at: new Date(t0),
});
const SEED = () => [
  user('a1', 'jose@x.in', 900, 1), user('a2', 'josé@x.in', 800, 2),
  user('b1', 'strasse@x.in', 900, 3), user('b2', 'straße@x.in', 800, 4),
  user('c1', 'dup@x.in', 900, 5), user('c2', 'DUP@X.IN ', 800, 6),
  user('k1', 'cafe@x.in', 900, 12), user('k2', 'café@x.in', 800, 13),
];

describe('V141-1: 0014 – restore, mark and clean-up are one transaction; a removed address is never given back', () => {
  const ctx = scratchDb('m142');
  const db = () => ctx.db;
  const emails = async () => Object.fromEntries((await db()('users').orderBy('id').select('id', 'email')).map((r: { id: string; email: string | null }) => [r.id, r.email]));
  const listed = async () => (await db()('email_duplicates_0013').orderBy('user_id').pluck('user_id')) as string[];
  const restored = async () => (await db()('email_restored_0014').orderBy('user_id').select('user_id', 'email', 'applied')).map((r: { user_id: string; email: string; applied: number }) => [r.user_id, r.email, Number(r.applied)]);
  const as138 = async () => {
    await dropAll(db());
    await migrate(db(), migrationsBefore(M13));
    await db()('users').insert(SEED());
    for (const q of split(path.join(__dirname, 'fixtures/0013_as_shipped_in_1.3.8.sql'))) await db().raw(q);
    await db()('schema_migrations').insert({ version: M13, applied_at: new Date() });
    // 1.4.3 (V142-4): a 1.3.8 database has no checksum column and no record (a NULL record now fails)
    await db().raw('ALTER TABLE schema_migrations DROP COLUMN checksum');
    await db().raw('DROP TABLE schema_migrations_meta');
  };
  /** Runs statements on one connection until `stop` says so; `rollback` = the connection drops (crash). */
  const runUntil = async (stmts: string[], stop: (sql: string, i: number) => boolean, rollback: boolean) => {
    const conn = await (db().client as { acquireConnection(): Promise<unknown> }).acquireConnection();
    try {
      for (let i = 0; i < stmts.length; i++) {
        await db().raw(stmts[i]).connection(conn as never);
        if (stop(stmts[i], i)) break;
      }
      if (rollback) await db().raw('ROLLBACK').connection(conn as never);
    } finally {
      await (db().client as { releaseConnection(c: unknown): Promise<void> }).releaseConnection(conn);
    }
  };
  const afterRestore = () => {
    let seen = false;
    return (q: string) => {
      if (/UPDATE IGNORE users u/.test(q)) seen = true;
      return seen && /^EXECUTE/.test(q);
    };
  };

  it('normal path: every restore is logged applied = 1 and leaves email_duplicates_0013', async () => {
    await as138();
    assert.deepEqual(await migrate(db(), PRE15), [M14]);
    assert.deepEqual(await restored(), [['a2', 'josé@x.in', 1], ['b2', 'straße@x.in', 1], ['k2', 'café@x.in', 1]]);
    assert.deepEqual(await listed(), ['c2']);
  });

  it('1.4.2 version stopped right after the restoring UPDATE (connection lost): nothing is half-done; the user changes the address; the rerun respects it', async () => {
    await as138();
    await runUntil(split(path.join(MIGRATIONS_DIR, M14)), afterRestore(), true);
    // rolled back with the connection: no address given back, no log row, nothing removed from the list
    assert.equal((await emails()).a2, null);
    assert.deepEqual(await restored(), []);
    assert.deepEqual(await listed(), ['a2', 'b2', 'c2', 'k2']);
    await db()('users').where({ id: 'a2' }).update({ email: 'new@x.in', updated_at: new Date() });
    assert.deepEqual(await migrate(db(), PRE15), [M14]);
    const e = await emails();
    assert.equal(e.a2, 'new@x.in');
    assert.equal(e.b2, 'straße@x.in');
    assert.ok(!(await restored()).some((r) => r[0] === 'a2'), 'no restore logged for a2');
    assert.deepEqual(await listed(), ['a2', 'c2']); // a2 stays listed (its old address was never given back)
  });

  it('1.4.1 version stopped between its UPDATE and its final DELETE, then a2 removes and k2 changes the address: neither is given back or logged as restored, rows stay listed', async () => {
    await as138();
    await runUntil(split(path.join(__dirname, 'fixtures/0014_as_shipped_in_1.4.1.sql')), afterRestore(), false);
    let e = await emails();
    assert.deepEqual([e.a2, e.b2, e.k2], ['josé@x.in', 'straße@x.in', 'café@x.in']); // restored, log not cleaned up
    assert.deepEqual(await listed(), ['a2', 'b2', 'c2', 'k2']);
    const later = new Date(Date.now() + 5000);
    await db()('users').where({ id: 'a2' }).update({ email: null, updated_at: later }); // removed
    await db()('users').where({ id: 'k2' }).update({ email: 'k2new@x.in', updated_at: later }); // changed
    assert.deepEqual(await migrate(db(), PRE15), [M14]);
    e = await emails();
    assert.equal(e.a2, null, 'a removed address is never given back');
    assert.equal(e.k2, 'k2new@x.in');
    assert.equal(e.b2, 'straße@x.in');
    assert.deepEqual(await restored(), [['a2', 'josé@x.in', 2], ['b2', 'straße@x.in', 1], ['k2', 'café@x.in', 2]]);
    assert.deepEqual(await listed(), ['a2', 'c2', 'k2']);
    // and a further rerun changes nothing
    const snap = JSON.stringify([await emails(), await listed(), await restored()]);
    await db()('schema_migrations').where({ version: M14 }).del();
    assert.deepEqual(await migrate(db(), PRE15), [M14]);
    assert.equal(JSON.stringify([await emails(), await listed(), await restored()]), snap);
  });

  it('1.4.2 version stopped after ANY statement (connection lost), then rerun: always the normal result', async () => {
    const stmts = split(path.join(MIGRATIONS_DIR, M14));
    let reference: string | null = null;
    for (let stopAt = 0; stopAt < stmts.length; stopAt += 4) {
      await as138();
      await runUntil(stmts, (_q, i) => i >= stopAt, true);
      assert.deepEqual(await migrate(db(), PRE15), [M14]);
      const snap = JSON.stringify([await emails(), await listed(), await restored()]);
      reference ??= snap;
      assert.equal(snap, reference, `stopped after statement ${stopAt}`);
    }
  });
});

describe('V141-1: migration checksums', () => {
  const ctx = scratchDb('c142');
  const db = () => ctx.db;
  const sums = async () => Object.fromEntries((await db()('schema_migrations').select('version', 'checksum')).map((r: { version: string; checksum: string | null }) => [r.version, r.checksum]));

  it('records each file\'s sha256 on apply', async () => {
    await dropAll(db());
    await migrate(db(), ALL);
    const s = await sums();
    for (const f of fs.readdirSync(ALL)) assert.equal(s[f], migrationChecksum(fs.readFileSync(path.join(ALL, f), 'utf8')), f);
  });

  it('a changed applied file stops the runner before anything new is applied', async () => {
    await dropAll(db());
    await migrate(db(), PRE15);
    const edited = migrationsBefore('9999', (f, sql) => (f.startsWith('0003') ? `${sql}\n-- edited\n` : sql));
    await assert.rejects(migrate(db(), edited), (e: unknown) => e instanceof MigrationChecksumError && e.files.join() === '0003_uncredit_removed_players.sql');
    assert.equal((await sums())['0015_daily_items_tombstones.sql'], undefined); // 0015 not applied
    assert.equal((await sums())['0016_match_abandon.sql'], undefined); // nor 0016
    assert.equal((await sums())['0017_match_lifecycle.sql'], undefined); // nor 0017
    assert.equal((await sums())['0018_verdict_repair.sql'], undefined); // nor 0018 (1.4.8)
    assert.equal((await sums())['0019_verdict_repair_type.sql'], undefined); // nor 0019 (1.4.9)
    assert.equal((await sums())['0020_support_tickets.sql'], undefined); // nor 0020 (1.4.19)
    // CRLF line endings are the same file
    const crlf = migrationsBefore('9999', (_f, sql) => sql.replace(/\n/g, '\r\n'));
    // (1.4.5: 0016 is new too)
    // (1.4.6: and 0017)
    assert.deepEqual(await migrate(db(), crlf), ['0015_daily_items_tombstones.sql', '0016_match_abandon.sql', '0017_match_lifecycle.sql', '0018_verdict_repair.sql', '0019_verdict_repair_type.sql', '0020_support_tickets.sql']);
  });

  it('0014 recorded as its 1.4.0 / 1.4.1 version: allowlisted (a warning, no failure); any other checksum fails', async () => {
    const [v140, v141] = CHECKSUM_ALLOWLIST[M14].earlier;
    assert.equal(migrationChecksum(fixtureBody('0014_as_shipped_in_1.4.0.sql')), v140);
    assert.equal(migrationChecksum(fixtureBody('0014_as_shipped_in_1.4.1.sql')), v141);
    await dropAll(db());
    await migrate(db(), ALL);
    for (const old of [v140, v141]) {
      await db()('schema_migrations').where({ version: M14 }).update({ checksum: old });
      const warnings: string[] = [];
      assert.deepEqual(await migrate(db(), ALL, { onWarn: (m) => warnings.push(m) }), []);
      assert.equal(warnings.length, 1);
      assert.match(warnings[0], /0014_email_index_repair\.sql was applied as an earlier version/);
    }
    await db()('schema_migrations').where({ version: M14 }).update({ checksum: 'f'.repeat(64) });
    await assert.rejects(migrate(db(), ALL, { onWarn: () => undefined }), MigrationChecksumError);
  });

  it('a database from before 1.4.2 (no checksum column) gets the column and the current checksums, additively', async () => {
    await dropAll(db());
    await migrate(db(), ALL);
    await db().raw('ALTER TABLE schema_migrations DROP COLUMN checksum');
    await db().raw('DROP TABLE schema_migrations_meta'); // 1.4.3: a real pre-1.4.2 database has no record either
    const warnings: string[] = [];
    assert.deepEqual(await migrate(db(), ALL, { onWarn: (m) => warnings.push(m) }), []);
    const s = await sums();
    assert.equal(Object.values(s).filter((v) => v == null).length, 0);
    // 1.4.3 (QA V142-4): the edited-in-place 0014 can't be told apart → 'unknown' + a warning; the rest first use
    assert.equal(s[M14], 'unknown');
    assert.equal(s[M13], migrationChecksum(fs.readFileSync(path.join(ALL, M13), 'utf8')));
    assert.ok(warnings.some((w) => /0014_email_index_repair\.sql was applied before checksums were recorded/.test(w)));
    assert.ok(warnings.some((w) => /trust on first use/.test(w)));
  });
});

describe('V141-2: the public daily list keeps every active item (5,035 rows)', () => {
  it('35 active items among 5,000 older tombstones: all 35 are listed, plus the newest tombstones', async () => {
    const base = Date.parse('2025-01-01T00:00:00Z');
    const mk = (i: number, active: boolean, createdMs: number, removedMs: number | null) => ({
      id: `d${String(i).padStart(5, '0')}`, type: 'fact', text_en: `Fact ${i}`, text_hi: `तथ्य ${i}`, attribution: null, source_url: null,
      active: active ? 1 : 0, created_by: ADMIN.uid, created_at: new Date(createdMs), updated_at: new Date(createdMs),
      removed_at: removedMs == null ? null : new Date(removedMs), deleted: active ? 0 : i % 2,
    });
    const all = [];
    for (let i = 0; i < 5000; i++) all.push(mk(i, false, base + i * 1000, base + 86_400_000 + i * 1000));
    for (let i = 5000; i < 5035; i++) all.push(mk(i, true, base + (i - 5000) * 7_000_000, null)); // interleaved with / after the tombstones
    for (let i = 0; i < all.length; i += 500) await h.db('daily_items').insert(all.slice(i, i + 500));
    const pub = (await h.api.get('/api/daily-items')).body as { id: string; active: boolean; textEn: string; createdAt: number | null }[];
    assert.equal(pub.length, 5000);
    const active = pub.filter((x) => x.active);
    assert.equal(active.length, 35);
    assert.ok(active.every((x) => x.textEn.startsWith('Fact ')));
    const tomb = pub.filter((x) => !x.active);
    assert.equal(tomb.length, 4965);
    assert.ok(tomb.every((x) => x.textEn === ''));
    // the 35 dropped tombstones are the oldest-removed ones
    assert.ok(!tomb.some((x) => Number(x.id.slice(1)) < 35));
    // still ordered by created_at
    const c = pub.map((x) => x.createdAt ?? 0);
    assert.deepEqual(c, [...c].sort((a, b) => a - b));
  });
});

describe('V141-6 / info: daily items (API)', () => {
  const fact = { type: 'fact', textEn: 'Court 18 x 9 m', textHi: 'कोर्ट 18 x 9 मी', attribution: null, sourceUrl: null, active: true };
  it('a deleted item keeps no text in the database', async () => {
    const a = (await h.as(ADMIN).post('/api/admin/daily-items').send({ ...fact, type: 'quote', attribution: 'A', sourceUrl: 'https://e.org/q' })).body as { id: string };
    assert.equal((await h.as(ADMIN).del(`/api/admin/daily-items/${a.id}`)).status, 204);
    const r = await h.db('daily_items').where({ id: a.id }).first();
    assert.deepEqual([r.text_en, r.text_hi, r.attribution, r.source_url, r.deleted], ['', '', null, null, 1]);
    // turned back on = a copy; the old row keeps no text either
    const b = (await h.as(ADMIN).post('/api/admin/daily-items').send({ ...fact, active: false })).body as { id: string };
    assert.equal((await h.as(ADMIN).patch(`/api/admin/daily-items/${b.id}`).send({ active: true })).status, 200);
    const rb = await h.db('daily_items').where({ id: b.id }).first();
    assert.deepEqual([rb.text_en, rb.deleted], ['', 1]);
  });
  it('active must be a boolean: "false", 0, 1, "true", null are refused (no longer taken as on)', async () => {
    const a = (await h.as(ADMIN).post('/api/admin/daily-items').send(fact)).body as { id: string };
    for (const v of ['false', 0, 1, 'true', null]) {
      const r = await h.as(ADMIN).patch(`/api/admin/daily-items/${a.id}`).send({ active: v });
      assert.deepEqual([v, r.status, r.body.error], [v, 400, 'daily_invalid']);
      const c = await h.as(ADMIN).post('/api/admin/daily-items').send({ ...fact, active: v });
      assert.deepEqual([v, c.status], [v, 400]);
    }
    assert.equal((await h.db('daily_items').where({ id: a.id }).first()).active, 1);
    assert.equal((await h.as(ADMIN).patch(`/api/admin/daily-items/${a.id}`).send({ active: false })).status, 200);
  });
});

describe('V141-5: invisible characters in an email are refused (API)', () => {
  it('Hangul fillers, CGJ, Braille blank, zero-width, bidi, variation selectors, tags', async () => {
    const p = PEOPLE.bob;
    const put = (email: string) => h.as('bob').put(`/api/users/${p.uid}`).send({ name: p.name, phone: p.phone, position: 'any', ...regFor(p.name), email });
    for (const c of ['\u3164', '\u115F', '\u1160', '\uFFA0', '\u034F', '\u2800', '\u200B', '\u2060', '\u202E', '\uFE0F', '\u{E0041}', '\u180B']) {
      for (const email of [`bo${c}b@x.in`, `bob@x${c}.in`]) {
        const r = await put(email);
        assert.deepEqual([JSON.stringify(email), r.status, r.body.error], [JSON.stringify(email), 400, 'email_invalid']);
      }
    }
    assert.equal((await put('bob@x.in')).status, 200);
    // ypogegrammeni is case-folded to ι (the same account address)
    assert.equal((await put('a\u0345b@x.in')).body.email ?? (await h.db('users').where({ id: p.uid }).first()).email, 'aιb@x.in');
  });
});

describe('V141-7: scheduledAt is a sane epoch-ms value (API)', () => {
  it('2^53, 1e300 and more than 2 years ahead are time_invalid (before time_in_past)', async () => {
    const id = await createMatch(h, { status: 'scheduled', scheduledAt: Date.now() + 3_600_000 });
    for (const bad of [2 ** 53, 1e300, Date.now() + 3 * 365 * 86_400_000]) {
      const r = await h.as('cap').patch(`/api/matches/${id}`).send({ scheduledAt: bad });
      assert.deepEqual([bad, r.status, r.body.error], [bad, 400, 'time_invalid']);
    }
    assert.equal((await h.as('cap').patch(`/api/matches/${id}`).send({ scheduledAt: Date.now() + 365 * 86_400_000 })).status, 200);
    const past = await h.as('cap').patch(`/api/matches/${id}`).send({ scheduledAt: Date.now() - 86_400_000 });
    assert.equal(past.body.error, 'time_in_past');
  });
});

describe('V141-8: a finished match\'s score is final (API)', () => {
  const save = (id: string, events: object[]) => h.as('cap').put(`/api/matches/${id}/progress`).send({ events });
  const WIN = [pt('A', 1000, 'bob'), pt('A', 1001, 'bob'), pt('A', 1002, 'bob'), pt('A', 1003, 'cap'), pt('A', 1004)];
  it('no undo, no extra rally, no back to live – before the POTM too; crediting the winning rally still works', async () => {
    const id = await createMatch(h);
    assert.equal((await save(id, WIN)).body.status, 'finished');
    for (const ev of [WIN.slice(0, -1), [...WIN, pt('B', 1005)], [pt('B', 999), ...WIN.slice(1)]]) {
      const r = await save(id, ev);
      assert.deepEqual([r.status, r.body.error], [409, 'match_finished']);
    }
    const live = await h.as('cap').patch(`/api/matches/${id}`).send({ status: 'live' });
    assert.equal(live.status, 409);
    const credited = await save(id, [...WIN.slice(0, -1), pt('A', 1004, 'cap', 'kill')]);
    assert.equal(credited.status, 200, JSON.stringify(credited.body));
    const m = (await h.as('bob').get(`/api/matches/${id}`)).body;
    assert.equal(m.status, 'finished');
    assert.equal(m.events.length, 5);
  });
});

