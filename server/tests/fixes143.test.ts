/**
 * 1.4.3 API: V142-1 (a finished match is final – every PATCHable field), V142-7 (no abandon after the winning
 * rally), V142-4 (migration checksums: NULL record, dropped column, allowlist = current file), V142-5/6 (email
 * allow list).
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, beforeEach, describe, it } from 'node:test';
import { createDb, type Db } from '../src/db/knex';
import { CHECKSUM_ALLOWLIST, dropAll, migrate, migrationChecksum, MigrationChecksumError, MIGRATIONS_DIR } from '../src/db/migrate';
import { EVERYONE, PEOPLE, createMatch, pt, register, regFor, startHarness, testDbUrl, type Harness } from './helpers';

let h: Harness;
before(async () => (h = await startHarness()));
after(async () => h.close());
beforeEach(async () => {
  await h.reset();
  await register(h, ...EVERYONE);
});

const M14 = '0014_email_index_repair.sql';
function migrationsCopy(edit?: (f: string, sql: string) => string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vl-mig143-'));
  for (const f of fs.readdirSync(MIGRATIONS_DIR)) {
    if (!f.endsWith('.sql')) continue;
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8');
    fs.writeFileSync(path.join(dir, f), edit ? edit(f, sql) : sql);
  }
  return dir;
}
const ALL = migrationsCopy();

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

const WIN = [pt('A', 1000, 'bob'), pt('A', 1001, 'bob'), pt('A', 1002, 'bob'), pt('A', 1003, 'cap'), pt('A', 1004)];
async function finished() {
  const id = await createMatch(h, { title: 'Final', location: null });
  const r = await h.as('cap').put(`/api/matches/${id}/progress`).send({ events: WIN });
  assert.equal(r.body.status, 'finished', JSON.stringify(r.body));
  return { id, m: (await h.as('cap').get(`/api/matches/${id}`)).body };
}

describe('V142-1: a finished match (no POTM yet) – every result-affecting PATCH is 409 match_finished', () => {
  it('rules (points, deciding set, best of, win by, cap), summary, status, first serve, teams, title, place, time, stream, size mode, scorer, interest…', async () => {
    const { id, m } = await finished();
    assert.equal(m.playerOfMatchId ?? null, null);
    const R = m.rules;
    const patches: Record<string, unknown>[] = [
      { rules: { ...R, pointsPerSet: R.pointsPerSet + 2 } },
      { rules: { ...R, decidingSetPoints: (R.decidingSetPoints ?? 15) + 2 } },
      { rules: { ...R, bestOf: R.bestOf === 5 ? 3 : 5 } },
      { rules: { ...R, winBy: R.winBy === 1 ? 2 : 1 } },
      { rules: { ...R, pointCap: (R.pointCap ?? 30) + 1 } },
      { status: 'abandoned' }, { status: 'live' }, { status: 'scheduled' },
      { firstServe: m.firstServe === 'A' ? 'B' : 'A' },
      { teamA: { ...m.teamA, name: 'Renamed' } },
      { title: 'Changed' },
      { location: { name: 'Elsewhere', lat: 28.6, lng: 77.2 } },
      { scheduledAt: Date.now() + 86_400_000 },
      { stream: { url: 'https://youtu.be/dQw4w9WgXcQ' } },
      { teamSizeMode: m.teamSizeMode === 'custom' ? 'exact' : 'custom' },
      { scorerId: 'bob' },
      { interestedIds: ['bob'] },
      { lineups: { A: [], B: [] } },
      { participantIds: [...m.participantIds, 'eve'] },
      { tournamentId: 't9' },
      { summary: { ...m.summary, winner: 'B' } },
    ];
    const got: unknown[] = [];
    for (const p of patches) {
      const r = await h.as('cap').patch(`/api/matches/${id}`).send(p);
      // 400 = the request schema refuses the field outright (summary is not PATCHable at all)
      // summary: not a PATCH field – the schema drops it (200, nothing stored; checked below)
      const k = Object.keys(p)[0];
      got.push([k, r.status === 409 ? r.body.error : r.status === 400 ? 'refused_400' : k === 'summary' && r.status === 200 ? 'ignored' : r.status]);
    }
    for (const g of got as [string, string][]) assert.ok(['match_finished', 'match_terminal', 'refused_400', 'ignored'].includes(g[1]), JSON.stringify(g)); // scorerId: the earlier handover check (match_terminal, also 409)
    for (const g of got as [string, string][]) if (['rules', 'status', 'firstServe', 'title', 'scheduledAt', 'teamA'].includes(g[0])) assert.equal(g[1], 'match_finished', JSON.stringify(g));
    const after = (await h.as('cap').get(`/api/matches/${id}`)).body;
    for (const k of ['rules', 'summary', 'status', 'firstServe', 'teamA', 'title', 'location', 'scheduledAt', 'stream', 'scorerId', 'interestedIds', 'participantIds', 'events'])
      assert.deepEqual([k, after[k]], [k, m[k]]);
  });

  it('what stays allowed: crediting one of the last 3 rallies, the POTM', async () => {
    const { id } = await finished();
    const credited = await h.as('cap').put(`/api/matches/${id}/progress`).send({ events: [...WIN.slice(0, -1), pt('A', 1004, 'cap', 'kill')] });
    assert.equal(credited.status, 200, JSON.stringify(credited.body));
    const potm = await h.as('cap').put(`/api/matches/${id}/player-of-match`).send({ playerId: 'bob' });
    assert.ok([200, 204].includes(potm.status), JSON.stringify(potm.body));
    const after = await h.as('cap').patch(`/api/matches/${id}`).send({ status: 'abandoned' });
    assert.equal(after.status, 409);
  });
});

describe('V142-7: abandon after the winning rally (API)', () => {
  it('PATCH status abandoned on a finished match → 409 match_finished; the result stays', async () => {
    const { id } = await finished();
    const r = await h.as('cap').patch(`/api/matches/${id}`).send({ status: 'abandoned' });
    assert.deepEqual([r.status, r.body.error], [409, 'match_finished']);
    const m = (await h.as('bob').get(`/api/matches/${id}`)).body;
    assert.equal(m.status, 'finished');
    assert.equal(m.summary.winner, 'A');
  });
  it('a live match that is not won yet can still be abandoned', async () => {
    const id = await createMatch(h);
    await h.as('cap').put(`/api/matches/${id}/progress`).send({ events: WIN.slice(0, 2) });
    const r = await h.as('cap').patch(`/api/matches/${id}`).send({ status: 'abandoned' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
  });
});

describe('V142-5 / V142-6: email allow list (API, same core check)', () => {
  const put = (email: string) => {
    const p = PEOPLE.bob;
    return h.as('bob').put(`/api/users/${p.uid}`).send({ name: p.name, phone: p.phone, position: 'any', ...regFor(p.name), email });
  };
  it("Tester's format characters (U+FFF9–FFFB, U+0600–0605, U+13430), other scripts and symbols → 400 email_chars", async () => {
    for (const c of ['\uFFF9', '\uFFFB', '\u0600', '\u0605', '\u{13430}', '\uE000', '\u0378', '例', '😀']) {
      for (const email of [`bo${c}b@x.in`, `bob@x${c}y.in`]) {
        const r = await put(email);
        assert.deepEqual([JSON.stringify(email), r.status, r.body.error], [JSON.stringify(email), 400, 'email_chars']);
      }
    }
  });
  it('accepted: ASCII signs, Latin/Greek/Cyrillic (folded), Indian scripts', async () => {
    for (const email of ["o'brien+x@x.in", 'José@x.in', 'राम@उदाहरण.भारत', 'иван@почта.рф']) {
      const r = await put(email);
      assert.equal(r.status, 200, `${email}: ${JSON.stringify(r.body)}`);
    }
  });
});

describe('V142-4: migration checksums', () => {
  const ctx = scratchDb('c143');
  const db = () => ctx.db;
  const reasonsOf = async (dir = ALL) => {
    try {
      await migrate(db(), dir, { onWarn: () => undefined });
      return null;
    } catch (e) {
      assert.ok(e instanceof MigrationChecksumError, String(e));
      return e.reasons;
    }
  };

  it('a NULL checksum fails (it is no longer re-recorded silently)', async () => {
    await dropAll(db());
    await migrate(db(), ALL);
    await db()('schema_migrations').where({ version: '0003_uncredit_removed_players.sql' }).update({ checksum: null });
    assert.deepEqual(await reasonsOf(), { '0003_uncredit_removed_players.sql': 'no checksum recorded' });
  });

  it('a dropped checksum column on a database that had the record fails', async () => {
    await dropAll(db());
    await migrate(db(), ALL);
    await db().raw('ALTER TABLE schema_migrations DROP COLUMN checksum');
    const r = await reasonsOf();
    assert.match(String(r?.['schema_migrations.checksum']), /column missing/);
    // nothing was re-added behind the error
    const [cols] = (await db().raw("SELECT COUNT(*) AS n FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'schema_migrations' AND column_name = 'checksum'")) as unknown as [{ n: number }[]];
    assert.equal(Number(cols[0].n), 0);
  });

  it('0014 allowlist: the file on disk must be the accepted current version AND the record a known one', async () => {
    const cur = migrationChecksum(fs.readFileSync(path.join(ALL, M14), 'utf8'));
    assert.equal(cur, CHECKSUM_ALLOWLIST[M14].current);
    await dropAll(db());
    await migrate(db(), ALL);
    // recorded 1.4.1, file now edited → fails even though the record is allowlisted
    await db()('schema_migrations').where({ version: M14 }).update({ checksum: CHECKSUM_ALLOWLIST[M14].earlier[1] });
    const edited = migrationsCopy((f, sql) => (f === M14 ? `${sql}\n-- edited again\n` : sql));
    assert.deepEqual(await reasonsOf(edited), { [M14]: 'the file differs from its accepted version' });
    // recorded 'unknown' (pre-1.4.2 database), file current → a warning only
    await db()('schema_migrations').where({ version: M14 }).update({ checksum: 'unknown' });
    const warnings: string[] = [];
    assert.deepEqual(await migrate(db(), ALL, { onWarn: (m) => warnings.push(m) }), []);
    assert.match(warnings.join('\n'), /applied as an unknown earlier version/);
    // recorded 'unknown' but the file was edited → fails
    assert.deepEqual(await reasonsOf(edited), { [M14]: 'the file differs from its accepted version' });
    // an upper-case / padded record of the current hash is the same hash
    await db()('schema_migrations').where({ version: M14 }).update({ checksum: cur.toUpperCase() });
    assert.equal(await reasonsOf(), null);
  });
});
