/**
 * 1.4.4 API: V143-6 (the stored email, unchanged, always passes), V143-10 (structure), V143-7 (a live match whose
 * events already have a winner can be finished by the scorer or voided by an admin), V143-8 (rules that would end
 * a live match → 400), V143-9 (crash-safe checksum bootstrap; the allowlist warning once).
 */
import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import { createDb, type Db } from '../src/db/knex';
import { dropAll, migrate, MIGRATIONS_DIR } from '../src/db/migrate';
import { ADMIN, EVERYONE, PEOPLE, createMatch, pt, register, regFor, startHarness, testDbUrl, type Harness } from './helpers';

let h: Harness;
before(async () => (h = await startHarness()));
after(async () => h.close());
beforeEach(async () => {
  await h.reset();
  await register(h, ...EVERYONE);
});

describe('V143-6 / V143-10: email on save', () => {
  const p = PEOPLE.bob;
  const put = (extra: Record<string, unknown>) => h.as('bob').put(`/api/users/${p.uid}`).send({ name: p.name, phone: p.phone, position: 'any', ...regFor(p.name), ...extra });
  it("Tester's probes: a stored out-of-list / old-format address doesn't block a pincode or name save (kept byte for byte)", async () => {
    for (const legacy of ['张伟@example.com', 'a\u200bb@x.in', 'ab@ex..com', 'ab@-x.in']) {
      await h.db('users').where({ id: p.uid }).update({ email: legacy });
      for (const extra of [{ pincode: '400001' }, { pincode: '110001', email: legacy }, { firstName: 'Bobby' }]) {
        const { email: _e, ...rest } = extra as Record<string, unknown>;
        const r = await put('email' in extra ? extra : { ...rest, email: undefined });
        assert.equal(r.status, 200, `${JSON.stringify(legacy)} ${JSON.stringify(extra)}: ${JSON.stringify(r.body)}`);
        assert.equal((await h.db('users').where({ id: p.uid }).first('email')).email, legacy);
      }
      // a different bad address is still refused; removing it works
      assert.equal((await put({ email: `x${legacy}` })).status, 400);
      assert.equal((await put({ email: '' })).status, 200);
    }
  });
  it('V143-10: structure – leading/trailing/double dots, local part > 64, domain labels with a leading or trailing "-" → 400 email_invalid', async () => {
    for (const email of ['.a@x.in', 'a.@x.in', 'a..b@x.in', 'a@x..in', `${'a'.repeat(65)}@x.in`, 'a@-x.in', 'a@x-.in', 'a@x.-in', 'a@x.in-']) {
      const r = await put({ email });
      assert.deepEqual([email, r.status, r.body.error], [email, 400, 'email_invalid']);
    }
    assert.equal((await put({ email: 'a-b@x-y.co.in' })).status, 200);
  });
});

const WIN = [pt('A', 1000, 'bob'), pt('A', 1001, 'bob'), pt('A', 1002, 'bob'), pt('A', 1003, 'cap'), pt('A', 1004)];
/** Tester's seed: a 'live' row whose events already have a winner (an older or hand-edited row). */
async function stuckLive() {
  const id = await createMatch(h, { title: 'Stuck', location: null });
  assert.equal((await h.as('cap').put(`/api/matches/${id}/progress`).send({ events: WIN })).body.status, 'finished');
  await h.db('matches').where({ id }).update({ status: 'live', finished_at: null });
  const m = (await h.as('cap').get(`/api/matches/${id}`)).body;
  assert.equal(m.status, 'live');
  return { id, m };
}

describe('V143-7: a live match whose events already have a winner is no longer stuck', () => {
  it('the scorer\'s finishing write (same events, with or without status) closes it with the server time', async () => {
    for (const send of [{ events: WIN }, { events: WIN, status: 'finished', finishedAt: 1 }]) {
      const { id } = await stuckLive();
      const r = await h.as('cap').put(`/api/matches/${id}/progress`).send(send);
      assert.equal(r.status, 200, JSON.stringify(r.body));
      assert.equal(r.body.status, 'finished');
      assert.ok(r.body.finishedAt > Date.now() - 60_000);
    }
    const { id } = await stuckLive();
    const r = await h.as('cap').patch(`/api/matches/${id}`).send({ status: 'finished' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal((await h.as('cap').get(`/api/matches/${id}`)).body.status, 'finished');
  });
  it('still refused on it: undo of the winning rally, abandon, rules, title (409)', async () => {
    const { id, m } = await stuckLive();
    assert.equal((await h.as('cap').put(`/api/matches/${id}/progress`).send({ events: WIN.slice(0, 4) })).status, 409);
    for (const patch of [{ status: 'abandoned' }, { title: 'X' }, { rules: { ...m.rules, pointsPerSet: 7 } }])
      assert.equal((await h.as('cap').patch(`/api/matches/${id}`).send(patch)).status, 409, JSON.stringify(patch));
  });
  it('an admin can void it: it is closed as finished and voided (never counts); approving still needs a completed match', async () => {
    const { id } = await stuckLive();
    assert.equal((await h.as(ADMIN).post(`/api/admin/matches/${id}/review`).send({ decision: 'approve' })).body.error, 'not_completed');
    const r = await h.as(ADMIN).post(`/api/admin/matches/${id}/review`).send({ decision: 'void' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const m = (await h.as('cap').get(`/api/matches/${id}`)).body;
    assert.deepEqual([m.status, m.verification.status], ['finished', 'voided']);
    // a normal live match (no winner) can't be voided
    const id2 = await createMatch(h, { title: 'Live', location: null });
    assert.equal((await h.as(ADMIN).post(`/api/admin/matches/${id2}/review`).send({ decision: 'void' })).body.error, 'not_completed');
  });
});

describe('V143-8: new rules that would end a live match', () => {
  // 1.4.5 (QA V144-4): every rules change after the first rally is refused first (409 match_setup_locked) – the
  // 1.4.4 400 match_rules_end can no longer be reached from a match with rallies, and the harmless change is refused too
  it('→ refused (1.4.5: 409 match_setup_locked); the match stays live with its rules', async () => {
    const id = await createMatch(h, { title: 'R', location: null });
    await h.as('cap').put(`/api/matches/${id}/progress`).send({ events: WIN.slice(0, 4) });
    const m = (await h.as('cap').get(`/api/matches/${id}`)).body;
    const r = await h.as('cap').patch(`/api/matches/${id}`).send({ rules: { ...m.rules, pointsPerSet: 4, decidingSetPoints: 4, decidingSwitchAt: 2 } });
    assert.deepEqual([r.status, r.body.error], [409, 'match_setup_locked']);
    assert.equal((await h.as('cap').get(`/api/matches/${id}`)).body.status, 'live');
    const r2 = await h.as('cap').patch(`/api/matches/${id}`).send({ rules: { ...m.rules, pointsPerSet: 7, decidingSetPoints: 7, decidingSwitchAt: 2 } });
    assert.deepEqual([r2.status, r2.body.error], [409, 'match_setup_locked']);
    assert.equal((await h.as('cap').get(`/api/matches/${id}`)).body.rules.pointsPerSet, m.rules.pointsPerSet);
  });
});

describe('V143-9: migration checksum bootstrap', () => {
  const url = new URL(testDbUrl());
  const name = url.pathname.replace(/^\//, '').replace(/_test$/, '_c144_test');
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
  /** A database from before 1.4.2 that stopped right after ADD COLUMN (all NULL) or after some updates. */
  async function crashedBootstrap(filled: number) {
    await dropAll(db);
    await migrate(db, MIGRATIONS_DIR, { onWarn: () => undefined });
    await db.raw('DROP TABLE schema_migrations_meta');
    const rows: { version: string }[] = await db('schema_migrations').orderBy('version').select('version');
    await db('schema_migrations').whereNotIn('version', rows.slice(0, filled).map((r) => r.version)).update({ checksum: null });
    return rows.length;
  }
  it('a start interrupted after ADD COLUMN (or part-way) completes the record on the next start, with warnings', async () => {
    for (const filled of [0, 5]) {
      const n = await crashedBootstrap(filled);
      const warnings: string[] = [];
      assert.deepEqual(await migrate(db, MIGRATIONS_DIR, { onWarn: (m) => warnings.push(m) }), []);
      assert.match(warnings.join('\n'), /started but not finished/);
      assert.match(warnings.join('\n'), /trust on first use/);
      assert.equal(await db('schema_migrations').whereNull('checksum').count({ c: '*' }).then((r) => Number(r[0].c)), 0);
      assert.equal(await db('schema_migrations').count({ c: '*' }).then((r) => Number(r[0].c)), n);
      // and from now on a NULL is refused again (the record exists)
      await db('schema_migrations').where({ version: '0003_uncredit_removed_players.sql' }).update({ checksum: null });
      await assert.rejects(migrate(db, MIGRATIONS_DIR, { onWarn: () => undefined }), /no checksum recorded/);
    }
  });
  it('the 0014 "unknown" warning is shown once per database (flag in the meta table)', async () => {
    await dropAll(db);
    await migrate(db, MIGRATIONS_DIR, { onWarn: () => undefined });
    await db('schema_migrations').where({ version: '0014_email_index_repair.sql' }).update({ checksum: 'unknown' });
    const runs: string[][] = [];
    for (let i = 0; i < 3; i++) {
      const w: string[] = [];
      await migrate(db, MIGRATIONS_DIR, { onWarn: (m) => w.push(m) });
      runs.push(w.filter((m) => /unknown earlier version/.test(m)));
    }
    assert.deepEqual(runs.map((r) => r.length), [1, 0, 0]);
  });
});
