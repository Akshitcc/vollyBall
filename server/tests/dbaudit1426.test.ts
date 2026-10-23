/**
 * 1.4.26 DB integrity audit (docs/qa/DB-AUDIT-1.4.26.md). The API simulation (scripts/auditSim.ts) leaves a database
 * that passes every check in src/ops/dbAudit.ts; then users, cascade / restrict, finished-match persistence, and the
 * idempotency / concurrency / resume / migration re-run scenarios, with the bugs found (DB-1..DB-6) as regressions.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { buildMatch } from '../../src/core/buildMatch';
import { INDOOR_RULES, type RuleSet } from '../../src/core/rules';
import { generateKnockout } from '../../src/core/tournament';
import { migrate, MIGRATIONS_DIR } from '../src/db/migrate';
import { AUDIT_CHECKS, auditSql, runAudit } from '../src/ops/dbAudit';
import { makeTeam, makeUsers, playSets, registerUser, simulate, type ClientFor, type SimReport, type SimUser } from '../scripts/auditSim';
import { AUDIT_RULES, clientFor, liftLimits, makeWorld } from './auditHelpers';
import { startHarness, type Harness } from './helpers';

let h: Harness;
let c: ClientFor;
before(async () => {
  h = await startHarness();
  liftLimits(h.s.rateLimiter!);
  c = clientFor(h);
});
after(async () => { await h.close(); });

const failing = async () => (await runAudit(h.db)).filter((r) => !r.ok).map((r) => `${r.id}: ${JSON.stringify(r.sample)}`);
const count = async (t: string, where: Record<string, unknown> = {}) => Number((await h.db(t).where(where).count({ n: '*' }))[0].n);
const RULES = AUDIT_RULES;
const world = (prefix: string, phoneBase: number) => makeWorld(c, prefix, phoneBase);

describe('1. API simulation: 2-team match, full knockout and league', () => {
  let rep: SimReport;
  it('simulates everything through the API', async () => {
    rep = await simulate(c);
    assert.equal(rep.oversizeStatus, 400); // 1.4.27: MAX_TOURNAMENT_TEAMS = 32 – a 33-team tournament is refused, nothing written
    assert.equal(rep.tournament.played, 9); // 10 teams in a 16 bracket: 6 byes, 9 matches
    assert.equal(rep.tournament.byes, 6);
    assert.ok(rep.tournament.champion);
    assert.equal(rep.league.played, 45);
    assert.deepEqual(rep.support, { tickets: 4, feedback: 4 });
    assert.equal(await count('support_tickets'), 4);
    // 1.5.1 (F150-1): accepted challenge has its match; declined / cancelled have none; the challenger's early create was refused
    assert.equal(rep.challenges.earlyCreateStatus, 409);
    assert.equal((await h.db('challenges').where({ id: rep.challenges.accepted }).first()).match_id, rep.challenges.acceptedMatchId);
    for (const id of [rep.challenges.declined, rep.challenges.cancelled]) assert.equal(await count('matches', { challenge_id: id }), 0);
  });
  it('every audit check passes on the simulated data', async () => {
    assert.deepEqual(await failing(), []);
    assert.equal(AUDIT_CHECKS.length, 32);
  });
  it('users: all registered with required fields, unique mobile, DOB and pincode', async () => {
    const rows = await h.db('users').whereIn('id', rep.users.map((u) => u.uid));
    assert.equal(rows.length, rep.users.length);
    for (const r of rows) {
      assert.equal(r.profile_complete, 1);
      assert.ok(r.first_name && r.last_name && r.dob && /^[1-9]\d{5}$/.test(r.pincode));
    }
    assert.equal(new Set(rows.map((r) => r.phone)).size, rows.length);
  });
  it('the friendly is stored completely: score, sets, every rally, timeouts, stats, winner, POTM, verdict, wallet', async () => {
    const id = rep.friendly.matchId;
    const m = await h.db('matches').where({ id }).first();
    const sum = JSON.parse(typeof m.summary === 'string' ? m.summary : JSON.stringify(m.summary));
    assert.equal(m.status, 'finished');
    assert.equal(sum.winner, 'A');
    assert.deepEqual([sum.setsA, sum.setsB], [2, 1]);
    assert.equal(await count('sets', { match_id: id }), 3);
    assert.equal(await count('points', { match_id: id }), rep.friendly.rallies); // the 3 undone rallies were replaced
    assert.equal(await count('timeouts', { match_id: id }), rep.friendly.timeouts);
    assert.equal(m.event_count, rep.friendly.rallies + rep.friendly.timeouts);
    assert.ok(m.player_of_match_id);
    assert.equal(m.verification_status, 'confirmed');
    const stats = await h.db('player_finished_matches').where({ match_id: id });
    assert.equal(stats.length, 12);
    assert.equal(stats.reduce((n, r) => n + Number(r.credited_points), 0), rep.friendly.rallies);
    assert.equal(stats.filter((r) => Number(r.potm)).length, 1);
    // points awarded: the simulation plays in seconds, so the anti-fraud minimum length (10 min, server time) keeps it
    // out of the wallet; once the match is an hour long it counts, with exactly the stored rallies, the win and the POTM
    const capA = rep.users[0];
    assert.equal((await c(capA.uid, capA.phone)('GET', '/api/me/wallet')).body.countedMatches, 0);
    await h.db('matches').where({ id }).update({ started_server_at: h.db.raw('finished_at - INTERVAL 1 HOUR') });
    const w = (await c(capA.uid, capA.phone)('GET', '/api/me/wallet')).body;
    const mine = stats.find((r) => r.user_id === capA.uid)!;
    assert.deepEqual([w.countedMatches, w.points, w.wins, w.potm], [1, Number(mine.credited_points), 1, Number(mine.potm)]);
    assert.ok(w.history.some((l: { matchId?: string }) => l.matchId === id));
  });
  it('the abandoned match keeps its record, has no winner and earns nothing', async () => {
    const m = await h.db('matches').where({ id: rep.abandonedId }).first();
    assert.equal(m.status, 'abandoned');
    assert.ok(m.abandon_info);
    assert.equal(await count('player_finished_matches', { match_id: rep.abandonedId }), 0);
    assert.equal(await count('points', { match_id: rep.abandonedId }) + await count('timeouts', { match_id: rep.abandonedId }), 9);
  });
  it('tournaments: every played fixture claims its finished match with a POTM; league table adds up', async () => {
    for (const tid of [rep.tournament.id, rep.league.id]) {
      const fx = await h.db('fixtures').where({ tournament_id: tid }).whereNotNull('match_id');
      for (const f of fx) {
        const m = await h.db('matches').where({ id: f.match_id }).first('status', 'tournament_id', 'fixture_key', 'player_of_match_id');
        assert.deepEqual([m.status, m.tournament_id, m.fixture_key, !!m.player_of_match_id], ['finished', tid, f.fixture_key, true]);
      }
    }
    assert.equal((await h.db('fixtures').where({ tournament_id: rep.league.id }).whereNotNull('match_id')).length, 45);
    assert.equal(rep.league.table.reduce((n, r) => n + r.played, 0), 90);
    assert.equal(rep.league.table.reduce((n, r) => n + r.won, 0), 45);
    assert.equal((await h.db('tournaments').where({ id: rep.tournament.id }).first('status')).status, 'finished');
  });
  it('db-audit.sql is generated from the same checks', () => {
    const file = fs.readFileSync(path.join(__dirname, '../scripts/db-audit.sql'), 'utf8');
    assert.equal(file, auditSql());
  });
});

describe('2. users', () => {
  it('a mobile belongs to one account; bad pincode / DOB are refused; the DB checks hold too', async () => {
    const [u1, u2] = makeUsers('uq', 2, 9300000000);
    await registerUser(c, u1, 1);
    await registerUser(c, u2, 2);
    const steal = await c(u2.uid, u2.phone)('PUT', `/api/users/${u2.uid}`, { name: u2.name, phone: u1.phone, position: 'any', firstName: 'A', lastName: 'B', dob: '1990-01-01', pincode: '110001' });
    assert.notEqual(steal.status, 200);
    for (const [k, v] of [['pincode', '011000'], ['pincode', '12345'], ['dob', '2099-01-01'], ['dob', new Date(Date.now() - 5 * 365 * 864e5).toISOString().slice(0, 10)]]) {
      const r = await c(u1.uid, u1.phone)('PUT', `/api/users/${u1.uid}`, { name: u1.name, phone: u1.phone, position: 'any', firstName: 'A', lastName: 'B', dob: '1990-01-01', pincode: '110001', [k]: v });
      assert.equal(r.status, 400, `${k}=${v}`);
    }
    await assert.rejects(h.db('users').insert({ id: 'x1', name: 'X', phone: u1.phone, created_at: new Date(), updated_at: new Date() }), /Duplicate|uq_users_phone/);
    await assert.rejects(h.db('users').insert({ id: 'x2', name: 'X', phone: '98765', created_at: new Date(), updated_at: new Date() }), /chk_users_phone/);
    assert.deepEqual(await failing(), []);
  });
});

describe('3. relations: cascade and restrict', () => {
  it('team delete cascades members and unlinks match sides; a tournament team and a user with matches are restricted', async () => {
    const w = await world('rel', 9310000000);
    const { doc } = await w.matchDoc(w.teams[0], w.teams[1]);
    const mid = (await w.as(w.org)('POST', '/api/matches', doc)).body.id;
    const tid = await w.tournament();
    assert.equal((await w.as(w.us[0])('DELETE', `/api/teams/${w.teams[0]}`)).status, 409); // in a tournament
    await w.as(w.org)('DELETE', `/api/tournaments/${tid}`);
    assert.equal((await w.as(w.us[0])('DELETE', `/api/teams/${w.teams[0]}`)).status, 204);
    assert.equal(await count('team_members', { team_id: w.teams[0] }), 0);
    assert.equal((await h.db('match_sides').where({ match_id: mid, side: 'A' }).first('team_id')).team_id, null);
    assert.equal(await count('matches', { id: mid }), 1); // the match (history) stays
    await assert.rejects(h.db('users').where({ id: w.org.uid }).del(), /foreign key|ER_ROW_IS_REFERENCED/i);
    assert.deepEqual(await failing(), []);
  });
  it('deleting a match removes its sets, rallies, timeouts, players, sides and keys, and unclaims its fixture', async () => {
    const w = await world('cas', 9320000000);
    const tid = await w.tournament();
    const t = (await w.as(w.org)('GET', `/api/tournaments/${tid}`)).body;
    const f = t.fixtures.find((x: { homeId: string | null; awayId: string | null }) => x.homeId && x.awayId);
    const { doc, players } = await w.matchDoc(f.homeId, f.awayId, { tournamentId: tid, fixtureId: f.id });
    const mid = (await w.as(w.org)('POST', '/api/matches', doc, { 'Idempotency-Key': 'cascade-key-1' })).body.id;
    assert.equal((await w.put(mid, playSets(RULES, ['A'], players))).status, 200);
    // admin / DB clean-up path (the app can't delete a scored match); rule_sets is the parent side, so it goes with it
    const rs = (await h.db('matches').where({ id: mid }).first('rule_set_id')).rule_set_id;
    await h.db('matches').where({ id: mid }).del();
    assert.ok((await failing()).some((f) => f.startsWith('matches.rule_set')));
    await h.db('rule_sets').where({ id: rs }).del();
    for (const tb of ['sets', 'points', 'timeouts', 'match_players', 'match_sides', 'match_participants', 'match_create_keys']) assert.equal(await count(tb, { match_id: mid }), 0, tb);
    assert.equal((await h.db('fixtures').where({ tournament_id: tid, fixture_key: f.id }).first('match_id')).match_id, null);
    assert.deepEqual(await failing(), []);
  });
});

describe('4. scenarios', () => {
  let w: Awaited<ReturnType<typeof world>>;
  before(async () => { w = await world('sc', 9330000000); });

  it('DB-1: a duplicate create with the same Idempotency-Key returns the first match (also at the same time)', async () => {
    const { doc } = await w.matchDoc(w.teams[0], w.teams[1]);
    const n0 = await count('matches');
    const a = await w.as(w.org)('POST', '/api/matches', doc, { 'Idempotency-Key': 'dup-key-0001' });
    const b = await w.as(w.org)('POST', '/api/matches', doc, { 'Idempotency-Key': 'dup-key-0001' });
    assert.deepEqual([a.status, b.status, b.body.id], [201, 201, a.body.id]);
    const par = await Promise.all([1, 2, 3].map(() => w.as(w.org)('POST', '/api/matches', doc, { 'Idempotency-Key': 'dup-key-0002' })));
    assert.equal(new Set(par.map((r) => r.body.id)).size, 1);
    assert.equal(await count('matches'), n0 + 2);
    assert.equal((await w.as(w.org)('POST', '/api/matches', doc, { 'Idempotency-Key': 'bad key!' })).status, 400);
    const other = await w.as(w.us[0])('POST', '/api/matches', { ...doc, createdBy: w.us[0].uid, scorerId: w.us[0].uid }, { 'Idempotency-Key': 'dup-key-0001' });
    assert.notEqual(other.body.id, a.body.id); // keys are per user
  });
  it('DB-2: a fixture is started once (double tap / two devices), must exist, and can be replayed after an abandon', async () => {
    const tid = await w.tournament();
    const t = (await w.as(w.org)('GET', `/api/tournaments/${tid}`)).body;
    const f = t.fixtures.find((x: { homeId: string | null; awayId: string | null }) => x.homeId && x.awayId);
    const { doc, players } = await w.matchDoc(f.homeId, f.awayId, { tournamentId: tid, fixtureId: f.id });
    const rs = await Promise.all([w.as(w.org)('POST', '/api/matches', doc), w.as(w.org)('POST', '/api/matches', doc)]);
    assert.deepEqual(rs.map((r) => r.status).sort(), [201, 409]);
    assert.equal(rs.find((r) => r.status === 409)!.body.error, 'fixture_taken');
    const first = rs.find((r) => r.status === 201)!.body.id;
    assert.equal((await h.db('fixtures').where({ tournament_id: tid, fixture_key: f.id }).first('match_id')).match_id, first); // claimed at create
    assert.equal((await w.as(w.org)('POST', '/api/matches', { ...doc, fixtureId: 'R9-M9' })).body.error, 'fixture_unknown');
    await w.put(first, playSets(RULES, ['A'], players).slice(0, 5));
    assert.equal((await w.as(w.org)('POST', `/api/matches/${first}/abandon`, {})).status, 200);
    const again = await w.as(w.org)('POST', '/api/matches', doc);
    assert.equal(again.status, 201);
    assert.equal((await h.db('fixtures').where({ tournament_id: tid, fixture_key: f.id }).first('match_id')).match_id, again.body.id);
    assert.deepEqual(await failing(), []);
  });
  it('DB-3 / DB-6: a fixture claims only its own match; an older copy of the fixtures never drops a claim', async () => {
    const tid = await w.tournament();
    const t0 = (await w.as(w.org)('GET', `/api/tournaments/${tid}`)).body;
    const f = t0.fixtures.find((x: { homeId: string | null; awayId: string | null }) => x.homeId && x.awayId);
    const { doc: friendly } = await w.matchDoc(w.teams[0], w.teams[1]);
    const fid = (await w.as(w.org)('POST', '/api/matches', friendly)).body.id;
    const steal = await w.as(w.org)('PATCH', `/api/tournaments/${tid}`, { fixtures: t0.fixtures.map((x: { id: string }) => (x.id === f.id ? { ...x, matchId: fid } : x)) });
    assert.deepEqual([steal.status, steal.body.error], [400, 'fixture_match_mismatch']);
    const { doc } = await w.matchDoc(f.homeId, f.awayId, { tournamentId: tid, fixtureId: f.id });
    const mid = (await w.as(w.org)('POST', '/api/matches', doc)).body.id;
    assert.equal((await w.as(w.org)('PATCH', `/api/tournaments/${tid}`, { fixtures: t0.fixtures })).status, 200); // the copy from before the start
    assert.equal((await h.db('fixtures').where({ tournament_id: tid, fixture_key: f.id }).first('match_id')).match_id, mid);
    assert.deepEqual(await failing(), []);
  });
  it('DB-5: deleting a tournament leaves its matches without a dangling fixture tag', async () => {
    const tid = await w.tournament();
    const t = (await w.as(w.org)('GET', `/api/tournaments/${tid}`)).body;
    const f = t.fixtures.find((x: { homeId: string | null; awayId: string | null }) => x.homeId && x.awayId);
    const { doc } = await w.matchDoc(f.homeId, f.awayId, { tournamentId: tid, fixtureId: f.id });
    const mid = (await w.as(w.org)('POST', '/api/matches', doc)).body.id;
    assert.equal((await w.as(w.org)('DELETE', `/api/tournaments/${tid}`)).status, 204);
    const m = await h.db('matches').where({ id: mid }).first('tournament_id', 'fixture_key');
    assert.deepEqual([m.tournament_id, m.fixture_key], [null, null]);
    assert.deepEqual(await failing(), []);
  });
  it('DB-4: an older save delivered late is refused (409 progress_stale) and loses nothing; 1.4.27: no seq after a seq is refused', async () => {
    const { doc, players } = await w.matchDoc(w.teams[0], w.teams[1]);
    const mid = (await w.as(w.org)('POST', '/api/matches', doc)).body.id;
    const ev = playSets(RULES, ['A', 'A'], players);
    assert.equal((await w.put(mid, ev.slice(0, 11), 1001)).status, 200);
    const late = await w.put(mid, ev.slice(0, 10), 1000);
    assert.deepEqual([late.status, late.body.error], [409, 'progress_stale']);
    assert.equal((await h.db('matches').where({ id: mid }).first('event_count')).event_count, 11);
    assert.equal((await w.put(mid, ev.slice(0, 11), 1001)).status, 200); // the same save retried: fine
    assert.equal((await w.put(mid, ev.slice(0, 9), 1002)).status, 200); // a real Undo (newer seq) still works
    // 1.4.27 (V1426-5): once sequenced saves exist, a save without seq is refused (it could overwrite newer rallies)
    const noSeq = await w.put(mid, ev.slice(0, 12));
    assert.deepEqual([noSeq.status, noSeq.body.error], [409, 'progress_seq_required']);
    assert.equal(await count('points', { match_id: mid }) + await count('timeouts', { match_id: mid }), 9);
    assert.deepEqual(await failing(), []);
  });
  it('concurrent scorers: 8 identical saves at once and a non-scorer save leave one consistent log', async () => {
    const { doc, players } = await w.matchDoc(w.teams[0], w.teams[1]);
    const mid = (await w.as(w.org)('POST', '/api/matches', doc)).body.id;
    const ev = playSets(RULES, ['A', 'B'], players);
    const rs = await Promise.all(Array.from({ length: 8 }, () => w.put(mid, ev.slice(0, 40))));
    assert.ok(rs.every((r) => r.status === 200));
    assert.equal((await w.as(w.us[1])('PUT', `/api/matches/${mid}/progress`, { events: ev })).status, 403);
    assert.equal(await count('points', { match_id: mid }) + await count('timeouts', { match_id: mid }), 40);
    assert.deepEqual(await failing(), []);
  });
  it('app killed mid-match and resumed: the reloaded log continues; offline rallies after it are all stored; undo across a set', async () => {
    const { doc, players } = await w.matchDoc(w.teams[0], w.teams[1]);
    const mid = (await w.as(w.org)('POST', '/api/matches', doc)).body.id;
    const ev = playSets(RULES, ['A', 'B', 'A'], players);
    await w.put(mid, ev.slice(0, 30));
    const resumed = (await w.as(w.org)('GET', `/api/matches/${mid}`)).body; // the app restarts from the server copy
    assert.equal(resumed.events.length, 30);
    assert.equal((await w.put(mid, [...resumed.events, ...ev.slice(30, 75)])).status, 200); // 45 rallies scored offline
    const firstSetEnd = (await h.db('points').where({ match_id: mid, set_number: 2 }).min({ s: 'seq' }))[0].s as number;
    assert.equal((await w.put(mid, ev.slice(0, firstSetEnd - 2))).status, 200); // undo back into set 1
    const sets = await h.db('sets').where({ match_id: mid }).select('set_number', 'winner');
    assert.deepEqual(sets.map((x) => [x.set_number, x.winner]), [[1, null]]);
    const fin = await w.put(mid, ev);
    assert.equal(fin.body.status, 'finished');
    assert.deepEqual(await failing(), []);
  });
});

describe('5. migrations: re-run and rollback', () => {
  it('migrate again applies nothing and changes no column', async () => {
    const shape = async () => JSON.stringify((await h.db.raw("SELECT table_name, column_name, column_type, is_nullable FROM information_schema.columns WHERE table_schema = DATABASE() ORDER BY 1, 2"))[0]);
    const before = await shape();
    assert.deepEqual(await migrate(h.db), []);
    assert.equal(await shape(), before);
  });
  it('every file from 0012 on (incl. 0023) re-runs cleanly on a migrated database (an interrupted deploy can simply run again)', async () => {
    const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql') && f >= '0012').sort();
    assert.ok(files.includes('0023_match_create_keys_progress_seq.sql'));
    for (const f of files) {
      const sts = fs.readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8').split(/^-- ;;\s*$/m).map((s) => s.trim()).filter((s) => s.replace(/^--.*$/gm, '').trim());
      await h.db.transaction(async (trx) => { for (const s of sts) await trx.raw(s); });
    }
    assert.deepEqual(await failing(), []);
  });
  it('0023 is additive: dropping only what it added returns the 0022 schema (the rollback for 1.4.26)', async () => {
    await h.db.raw('DROP TABLE match_create_keys');
    await h.db.raw('ALTER TABLE matches DROP COLUMN progress_seq');
    await h.db('schema_migrations').where({ version: '0023_match_create_keys_progress_seq.sql' }).del();
    assert.deepEqual(await migrate(h.db), ['0023_match_create_keys_progress_seq.sql']); // roll forward again
    assert.equal(await count('match_create_keys') >= 0, true);
  });
});
