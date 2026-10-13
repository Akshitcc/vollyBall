/**
 * 1.4.11 server: V1410-2 (a rename on an already-broken older match passes; a roster edit there is still checked) and
 * the readable 0019 refusal with the ALTER hint. (Header from 1.4.10 server: V149-2 (the API's verdict check counts the stored scorerReassign.from, like core), V149-3 (the captain
 * repair for an older match whose team-B captain is a team-A player – only there) and the schema checks after 0019
 * (0018 recorded but the column gone / retyped later; readable errors).
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, beforeEach, describe, it } from 'node:test';
import { createDb, type Db } from '../src/db/knex';
import { dropAll, migrate, MIGRATIONS_DIR, readableMigrationError, SchemaCheckError } from '../src/db/migrate';
import { EVERYONE, createMatch, playersOf, register, startHarness, team, testDbUrl, type Harness } from './helpers';

let h: Harness;
before(async () => (h = await startHarness()));
after(async () => h.close());
beforeEach(async () => {
  await h.reset();
  await register(h, ...EVERYONE);
});
const SQUAD_A = ['cap', 'bob', 'a3', 'a4', 'a5', 'a6'];
const SQUAD_B = ['aarav', 'dan', 'b3', 'b4', 'b5', 'b6'];

describe('V1410-2 (API): a rename on an already-broken older match', () => {
  const sched = { status: 'scheduled', startedAt: null, scheduledAt: Date.now() + 86_400_000 };
  it('GU11 (handoff from B, creator on A): rename 200; a roster swap still 400 match_no_verdict', async () => {
    const id = await createMatch(h, sched);
    await h.db('matches').where({ id }).update({ scorer_reassign: JSON.stringify({ from: 'dan', by: 'admin', at: 1 }) });
    const r = await h.as('cap').patch(`/api/matches/${id}`).send({ teamA: team('Renamed Spikers', playersOf(SQUAD_A)) });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.teamA.name, 'Renamed Spikers');
    const a = SQUAD_A.filter((x) => x !== 'a6').concat('b6');
    const b = SQUAD_B.filter((x) => x !== 'b6').concat('a6');
    const s2 = await h.as('cap').patch(`/api/matches/${id}`).send({ teamA: team('Renamed Spikers', playersOf(a)), teamB: team('Delhi Smashers', playersOf(b)), participantIds: [...a, ...b] });
    assert.deepEqual([s2.status, s2.body.error], [400, 'match_no_verdict']);
  });
});

function migrationsBefore(upTo: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vl-mig1411-'));
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

describe('0019 refusal: the ALTER hint (runner mapping, 0019 unchanged)', () => {
  const ctx = scratchDb('m1411');
  it('a pre-existing TEXT column: "… found text – fix the column by hand (ALTER TABLE matches MODIFY verdict_repair JSON NULL) …"', async () => {
    await dropAll(ctx.db);
    await migrate(ctx.db, migrationsBefore('0018'));
    await ctx.db.raw('ALTER TABLE matches ADD COLUMN verdict_repair TEXT NULL');
    await assert.rejects(migrate(ctx.db, migrationsBefore('9999')), (e: unknown) => e instanceof SchemaCheckError && /found text/.test(e.message) && /ALTER TABLE matches MODIFY verdict_repair JSON NULL/.test(e.message));
  });
  it('the mapping alone', () => {
    const e = readableMigrationError('0019_verdict_repair_type.sql', new Error("Unknown column '0019: matches.verdict_repair must be JSON, found longtext - fix the column by hand' in 'field list'"));
    assert.ok(e instanceof SchemaCheckError);
    assert.match((e as Error).message, /found longtext – fix the column by hand \(ALTER TABLE matches MODIFY verdict_repair JSON NULL\) and run the migrations again/);
  });
});
