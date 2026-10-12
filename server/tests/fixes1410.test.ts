/**
 * 1.4.10 server: V149-2 (the API's verdict check counts the stored scorerReassign.from, like core), V149-3 (the captain
 * repair for an older match whose team-B captain is a team-A player – only there) and the schema checks after 0019
 * (0018 recorded but the column gone / retyped later; readable errors).
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, beforeEach, describe, it } from 'node:test';
import { createDb, type Db } from '../src/db/knex';
import { checkSchema, dropAll, migrate, MIGRATIONS_DIR, readableMigrationError, SchemaCheckError } from '../src/db/migrate';
import { ADMIN, EVERYONE, createMatch, playersOf, pt, register, startHarness, team, testDbUrl, type Harness } from './helpers';

let h: Harness;
before(async () => (h = await startHarness()));
after(async () => h.close());
beforeEach(async () => {
  await h.reset();
  await register(h, ...EVERYONE);
});
const SQUAD_A = ['cap', 'bob', 'a3', 'a4', 'a5', 'a6'];
const SQUAD_B = ['aarav', 'dan', 'b3', 'b4', 'b5', 'b6'];

describe('V149-2 (API): the verdict check counts scorerReassign.from', () => {
  const swap = async (id: string) => {
    const a = SQUAD_A.filter((x) => x !== 'a6').concat('b6');
    const b = SQUAD_B.filter((x) => x !== 'b6').concat('a6');
    return h.as('cap').patch(`/api/matches/${id}`).send({ teamA: team('QA Spikers', playersOf(a)), teamB: team('Delhi Smashers', playersOf(b)), participantIds: [...a, ...b] });
  };
  const sched = { status: 'scheduled', startedAt: null, scheduledAt: Date.now() + 86_400_000 };
  it('an older match handed over from team B (creator on A): a roster swap is refused (400 match_no_verdict), like core', async () => {
    const id = await createMatch(h, sched);
    await h.db('matches').where({ id }).update({ scorer_reassign: JSON.stringify({ from: 'dan', by: 'admin', at: 1 }) });
    const r = await swap(id);
    assert.deepEqual([r.status, r.body.error], [400, 'match_no_verdict']);
  });
  it('the same swap without the record (or with the reference on A) is accepted', async () => {
    const id = await createMatch(h, sched);
    assert.equal((await swap(id)).status, 200);
    const id2 = await createMatch(h, sched);
    await h.db('matches').where({ id: id2 }).update({ scorer_reassign: JSON.stringify({ from: 'bob', by: 'admin', at: 1 }) });
    assert.equal((await swap(id2)).status, 200);
  });
});

describe('V149-3 (API): captain repair for an older match whose team-B captain is a team-A player', () => {
  async function rp9() {
    const id = await createMatch(h, { title: 'V149', location: null });
    assert.equal((await h.as('cap').put(`/api/matches/${id}/progress`).send({ events: Array.from({ length: 5 }, (_, i) => pt('A', 1000 + i)) })).status, 200);
    await h.db('matches').where({ id }).update({ status: 'finished', player_of_match_id: 'bob', was_won: 1, finished_at: new Date(), captain_b: 'bob' }); // older data
    return id;
  }
  it('no scorer fixes it; a team-B player as captain B does (audited); an A player or side A is refused; then the new captain confirms', async () => {
    const id = await rp9();
    const url = `/api/admin/matches/${id}/repair-verdict`;
    for (const s of ['cap', 'aarav', 'dan']) assert.deepEqual([(await h.as(ADMIN).post(url).send({ scorerId: s })).body.error], ['repair_invalid'], s);
    for (const captain of [{ side: 'B', id: 'a3' }, { side: 'A', id: 'a3' }]) {
      const r = await h.as(ADMIN).post(url).send({ captain });
      assert.deepEqual([r.status, r.body.error], [400, 'repair_invalid'], JSON.stringify(captain));
    }
    assert.equal((await h.as('aarav').post(url).send({ captain: { side: 'B', id: 'dan' } })).status, 403);
    const r = await h.as(ADMIN).post(url).send({ captain: { side: 'B', id: 'dan' } });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const row = await h.db('matches').where({ id }).first('verdict_repair', 'captain_a', 'captain_b');
    const rec = typeof row.verdict_repair === 'string' ? JSON.parse(row.verdict_repair) : row.verdict_repair;
    assert.deepEqual([row.captain_a, row.captain_b], ['cap', 'dan']);
    assert.deepEqual({ kind: rec.kind, side: rec.side, to: rec.to, prevCaptainB: rec.prevCaptainB }, { kind: 'confirmer', side: 'B', to: 'dan', prevCaptainB: 'bob' });
    assert.equal((await h.as('dan').post(`/api/matches/${id}/confirm`).send({})).status, 200);
  });
});

function migrationsBefore(upTo: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vl-mig1410-'));
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

describe('0019 notes: schema checks on every migrate and at start', () => {
  const ctx = scratchDb('m1410');
  const db = () => ctx.db;
  const ALL = migrationsBefore('9999');
  it('a clean install passes; checkSchema passes', async () => {
    await dropAll(db());
    await migrate(db(), ALL);
    await checkSchema(db());
  });
  it('0018 recorded but the column dropped by hand: a clear error (migrate and checkSchema)', async () => {
    await dropAll(db());
    await migrate(db(), ALL);
    await db().raw('ALTER TABLE matches DROP COLUMN verdict_repair');
    await assert.rejects(migrate(db(), ALL), (e: unknown) => e instanceof SchemaCheckError && /0018_verdict_repair\.sql is recorded but matches\.verdict_repair is missing/.test(e.message));
    await assert.rejects(checkSchema(db()), SchemaCheckError);
  });
  it('retyped after 0019 ran: caught later (no new migration needed)', async () => {
    await dropAll(db());
    await migrate(db(), ALL);
    await db().raw('ALTER TABLE matches MODIFY verdict_repair TEXT NULL');
    await assert.rejects(checkSchema(db()), /matches\.verdict_repair must be JSON, found text/);
    await db().raw('ALTER TABLE matches MODIFY verdict_repair JSON NULL');
    await checkSchema(db());
  });
  it('the 0019 refusal reads as a plain message, not "Unknown column"', async () => {
    await dropAll(db());
    await migrate(db(), migrationsBefore('0018'));
    await db().raw('ALTER TABLE matches ADD COLUMN verdict_repair TEXT NULL');
    await assert.rejects(migrate(db(), ALL), (e: unknown) => e instanceof SchemaCheckError && !/Unknown column/.test(e.message) && /^Migration 0019_verdict_repair_type\.sql stopped: matches\.verdict_repair must be JSON, found text/.test(e.message));
    const other = new Error('boom');
    assert.equal(readableMigrationError('x.sql', other), other);
  });
});
