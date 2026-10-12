/**
 * 1.4.9 server: V148-2 (the confirmer repair is refused – scorer-only, like core, the demo and the rules) and the
 * 0019 type check of matches.verdict_repair (QA H10: a pre-existing TEXT column is no longer accepted silently).
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, beforeEach, describe, it } from 'node:test';
import { createDb, type Db } from '../src/db/knex';
import { dropAll, migrate, MIGRATIONS_DIR } from '../src/db/migrate';
import { ADMIN, EVERYONE, createMatch, pt, register, startHarness, testDbUrl, type Harness } from './helpers';

let h: Harness;
before(async () => (h = await startHarness()));
after(async () => h.close());
beforeEach(async () => {
  await h.reset();
  await register(h, ...EVERYONE);
});

function migrationsBefore(upTo: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vl-mig149-'));
  for (const f of fs.readdirSync(MIGRATIONS_DIR)) if (f.endsWith('.sql') && f < upTo) fs.copyFileSync(path.join(MIGRATIONS_DIR, f), path.join(dir, f));
  return dir;
}
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

describe('V148-2 (API): verdict repair is scorer-only', () => {
  it('a captain (confirmer) fix is refused on either side, a scorer fix works', async () => {
    const id = await createMatch(h, { title: 'V148', location: null });
    assert.equal((await h.as('cap').put(`/api/matches/${id}/progress`).send({ events: Array.from({ length: 5 }, (_, i) => pt('A', 1000 + i)) })).status, 200);
    await h.db('matches').where({ id }).update({ status: 'finished', player_of_match_id: 'bob', was_won: 1, finished_at: new Date(), scorer_id: 'dan' });
    const url = `/api/admin/matches/${id}/repair-verdict`;
    for (const captain of [{ side: 'A', id: 'bob' }, { side: 'B', id: 'b3' }, { side: 'B', id: 'cap' }]) {
      const r = await h.as(ADMIN).post(url).send({ captain });
      assert.deepEqual([r.status, r.body.error], [400, 'repair_invalid'], JSON.stringify(captain));
    }
    assert.equal((await h.db('matches').where({ id }).first('verdict_repair')).verdict_repair, null);
    assert.equal((await h.as(ADMIN).post(url).send({ scorerId: 'cap' })).status, 200);
  });
});

describe('H10: 0019 checks the type of matches.verdict_repair', () => {
  const ctx = scratchDb('m149');
  const db = () => ctx.db;
  it('a clean install: JSON, and 0019 passes', async () => {
    await dropAll(db());
    const applied = await migrate(db(), migrationsBefore('9999'));
    assert.ok(applied.includes('0019_verdict_repair_type.sql'));
    const [[col]] = await db().raw("SELECT LOWER(DATA_TYPE) t FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'matches' AND column_name = 'verdict_repair'");
    assert.equal(col.t, 'json');
    assert.deepEqual(await migrate(db(), migrationsBefore('9999')), []); // re-runnable
  });
  it('a pre-existing TEXT column: 0018 skips it, 0019 stops with a clear error (nothing is changed)', async () => {
    await dropAll(db());
    await migrate(db(), migrationsBefore('0018'));
    await db().raw('ALTER TABLE matches ADD COLUMN verdict_repair TEXT NULL');
    await assert.rejects(migrate(db(), migrationsBefore('9999')), /verdict_repair must be JSON, found text/);
    const [[col]] = await db().raw("SELECT LOWER(DATA_TYPE) t FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'matches' AND column_name = 'verdict_repair'");
    assert.equal(col.t, 'text');
    const done = (await db()('schema_migrations').select('version')).map((r: { version: string }) => r.version);
    assert.ok(done.includes('0018_verdict_repair.sql') && !done.includes('0019_verdict_repair_type.sql'));
  });
});
