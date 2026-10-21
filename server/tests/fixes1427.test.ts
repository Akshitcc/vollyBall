/**
 * 1.4.27 fixes from Tester's 1.4.26 E2E rerun (fixes-retest.md 'E2E scenario 1.4.26'):
 * V1426-1 concurrent retries of one Idempotency-Key on a fixture match all get the first 201 body;
 * V1426-2 a scorer handoff to a device whose clock is behind loses no rallies (the sequence restarts per scorer);
 * V1426-4 db-audit does not flag a match abandoned before the first rally;
 * V1426-5 same key + another body = 422 idempotency_mismatch; no-seq save after seq refused; 0025 re-runnable.
 */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { playSets, type ClientFor } from '../scripts/auditSim';
import { migrate, MIGRATIONS_DIR } from '../src/db/migrate';
import { runAudit } from '../src/ops/dbAudit';
import { AUDIT_RULES, clientFor, liftLimits, makeWorld } from './auditHelpers';
import { startHarness, type Harness } from './helpers';

let h: Harness;
let c: ClientFor;
let w: Awaited<ReturnType<typeof makeWorld>>;
before(async () => {
  h = await startHarness();
  liftLimits(h.s.rateLimiter!);
  c = clientFor(h);
  w = await makeWorld(c, 'f27', 9340000000);
});
after(async () => { await h.close(); });
const failing = async () => (await runAudit(h.db)).filter((r) => !r.ok).map((r) => `${r.id}: ${JSON.stringify(r.sample)}`);

describe('V1426-1: Idempotency-Key decided before the fixture lock', () => {
  for (const run of [1, 2, 3, 4]) {
    it(`run ${run}: 8 concurrent retries of one key on a fixture match -> eight 201 with the same id, one match`, async () => {
      const tid = await w.tournament();
      const t = (await w.as(w.org)('GET', `/api/tournaments/${tid}`)).body;
      const f = t.fixtures.find((x: { homeId: string | null; awayId: string | null }) => x.homeId && x.awayId);
      const { doc } = await w.matchDoc(f.homeId, f.awayId, { tournamentId: tid, fixtureId: f.id });
      const key = `fx-retry-${run}-0001`;
      const rs = await Promise.all(Array.from({ length: 8 }, () => w.as(w.org)('POST', '/api/matches', doc, { 'Idempotency-Key': key })));
      assert.deepEqual(rs.map((r) => r.status), Array(8).fill(201), JSON.stringify(rs.map((r) => r.body)));
      assert.equal(new Set(rs.map((r) => r.body.id)).size, 1);
      assert.equal(Number((await h.db('matches').where({ tournament_id: tid, fixture_key: f.id }).count({ n: '*' }))[0].n), 1);
      // a different key for the same fixture is still a second start
      const other = await w.as(w.org)('POST', '/api/matches', doc, { 'Idempotency-Key': `fx-other-${run}-01` });
      assert.deepEqual([other.status, other.body.error], [409, 'fixture_taken']);
    });
  }
});

describe('V1426-5: same key, different body', () => {
  it('422 idempotency_mismatch (with the first match id); the same body still 201', async () => {
    const { doc } = await w.matchDoc(w.teams[0], w.teams[1]);
    const a = await w.as(w.org)('POST', '/api/matches', doc, { 'Idempotency-Key': 'mismatch-0001' });
    const b = await w.as(w.org)('POST', '/api/matches', { ...doc, title: 'Another match' }, { 'Idempotency-Key': 'mismatch-0001' });
    assert.deepEqual([a.status, b.status, b.body.error, b.body.matchId], [201, 422, 'idempotency_mismatch', a.body.id]);
    const par = await Promise.all([doc, { ...doc, title: 'X' }].map((d) => w.as(w.org)('POST', '/api/matches', d, { 'Idempotency-Key': 'mismatch-0002' })));
    assert.deepEqual(par.map((r) => r.status).sort(), [201, 422]);
    assert.equal((await w.as(w.org)('POST', '/api/matches', doc, { 'Idempotency-Key': 'mismatch-0001' })).body.id, a.body.id);
  });
  it('a save without seq on a match never saved with one keeps working (older app)', async () => {
    const { doc, players } = await w.matchDoc(w.teams[0], w.teams[1]);
    const mid = (await w.as(w.org)('POST', '/api/matches', doc)).body.id;
    const ev = playSets(AUDIT_RULES, ['A'], players);
    assert.equal((await w.put(mid, ev.slice(0, 3))).status, 200);
    assert.equal((await w.put(mid, ev.slice(0, 4))).status, 200);
  });
});

describe('V1426-2: scorer handoff with the new device clock behind', () => {
  it('the new scorer\'s smaller seq is accepted after the handoff; every rally is stored', async () => {
    const { doc, players } = await w.matchDoc(w.teams[0], w.teams[1]);
    const A = w.us.slice(0, 6).map((u) => u.uid);
    const capA = doc.captains!.A;
    const [s1, s2] = w.us.filter((u) => A.includes(u.uid) && u.uid !== capA).slice(0, 2);
    const mid = (await w.as(w.org)('POST', '/api/matches', { ...doc, scorerId: s1.uid })).body.id;
    const ev = playSets(AUDIT_RULES, ['A', 'A'], players);
    const put = (u: typeof s1, n: number, seq: number) => w.as(u)('PUT', `/api/matches/${mid}/progress`, { events: ev.slice(0, n), seq });
    const t0 = Date.parse('2026-10-16T10:00:00Z');
    assert.equal((await put(s1, 10, t0)).status, 200); // 1.4.26 apps: seq from the clock
    const ho = await w.as(s1)('PATCH', `/api/matches/${mid}`, { scorerId: s2.uid });
    assert.equal(ho.status, 200, JSON.stringify(ho.body));
    assert.equal((await h.db('matches').where({ id: mid }).first('progress_seq')).progress_seq, null);
    const r1 = await put(s2, 11, t0 - 120_000); // 2 min behind
    const r2 = await put(s2, 12, t0 - 119_000);
    assert.deepEqual([r1.status, r2.status], [200, 200], JSON.stringify([r1.body, r2.body]));
    assert.equal((await h.db('matches').where({ id: mid }).first('event_count')).event_count, 12);
    const late = await put(s2, 11, t0 - 120_000); // stale protection still on for the new scorer
    assert.equal(late.body.error, 'progress_stale');
    assert.deepEqual(await failing(), []);
  });
});

describe('V1426-4: abandoned before the first rally', () => {
  it('db-audit stays clean for a direct abandon; an abandon after a rally without a record is still flagged', async () => {
    const { doc, players } = await w.matchDoc(w.teams[0], w.teams[1]);
    const mid = (await w.as(w.org)('POST', '/api/matches', doc)).body.id;
    assert.equal((await w.as(w.org)('POST', `/api/matches/${mid}/abandon`, {})).status, 200);
    assert.equal((await h.db('matches').where({ id: mid }).first('abandon_info')).abandon_info, null);
    assert.deepEqual(await failing(), []);
    const m2 = (await w.as(w.org)('POST', '/api/matches', doc)).body.id;
    await w.put(m2, playSets(AUDIT_RULES, ['A'], players).slice(0, 3));
    await h.db('matches').where({ id: m2 }).update({ status: 'abandoned', abandon_info: null });
    assert.deepEqual((await failing()).map((x) => x.split(':')[0]), ['abandoned.record']);
    await h.db('matches').where({ id: m2 }).del();
  });
});

describe('migration 0025', () => {
  it('is additive and re-runnable', async () => {
    await h.db('schema_migrations').where({ version: '0025_match_create_claims.sql' }).del();
    assert.deepEqual(await migrate(h.db, MIGRATIONS_DIR, { onWarn: () => undefined }), ['0025_match_create_claims.sql']);
    assert.deepEqual(await migrate(h.db, MIGRATIONS_DIR, { onWarn: () => undefined }), []);
  });
});
