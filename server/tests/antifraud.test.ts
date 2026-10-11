/**
 * 1.3.0 T&C gate + anti-fraud on the API server: every item of the batch and the QA baseline holes
 * (fraud-api-baseline-1.2.0.txt). Points/bonus/wallet are derived (src/core/antifraud.ts).
 */
import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import { ADMIN, EVERYONE, SQUAD_A, SQUAD_B, createMatch, makeTeam, newMatchBody, playersOf, pt, register, startHarness, team, type Harness } from './helpers';
import { TERMS_VERSION } from '../../src/core/terms';
import { ANTI_FRAUD } from '../../src/core/antifraud';
import { RANKING_POINTS_PER_POTM, RANKING_POINTS_PER_WIN } from '../../src/core/ranking';
import { parseAdminUids } from '../src/config';

let h: Harness;
before(async () => (h = await startHarness()));
after(async () => h.close());
beforeEach(async () => {
  await h.reset();
  await register(h, ...EVERYONE, 'zed');
});

type Who = Parameters<Harness['as']>[0];
type Caps = { A: string; B: Exclude<Who, object> };
const progress = (id: string, events: object[], who: Who = 'cap', extra: object = {}) => h.as(who).put(`/api/matches/${id}/progress`).send({ events, ...extra });
const potm = (id: string, playerId: string, who: Who = 'cap') => h.as(who).put(`/api/matches/${id}/player-of-match`).send({ playerId });
const sweep = (credits: (string | undefined)[], side: 'A' | 'B' = 'A') => credits.map((c, i) => pt(side, 1000 + i, c));
const WIN_A = sweep(['bob', 'bob', 'bob', 'cap', 'cap']);
const code = (r: { status: number; body: { error?: string } }, status: number, err?: string) => {
  assert.equal(r.status, status, JSON.stringify(r.body));
  if (err) assert.equal(r.body.error, err, JSON.stringify(r.body));
};
/** Move a match's server times (simulates waiting / another day without sleeping). */
async function setTimes(id: string, startedMs: number, finishedMs: number) {
  await h.db('matches').where({ id }).update({ started_server_at: new Date(startedMs), finished_at: new Date(finishedMs) });
}
/** Live -> finished (team A sweeps) -> POTM bob. */
async function completed(over: Record<string, unknown> = {}) {
  const id = await createMatch(h, over);
  code(await progress(id, WIN_A), 200);
  code(await potm(id, 'bob'), 200);
  return id;
}
const MIN = 60_000;

describe('T&C gate (TC-02, TC-06, TC-08..TC-11, TC-22)', () => {
  const fresh = { uid: 'fresh', phone: '+919555500001' };
  it('before acceptance: GET /me works, every write is 403 terms_not_accepted', async () => {
    const me = await h.as(fresh).get('/api/me');
    code(me, 200);
    assert.equal(me.body.termsAccepted, false);
    assert.equal(me.body.currentTermsVersion, TERMS_VERSION);
    assert.equal(me.body.terms, null);
    code(await h.as(fresh).put('/api/users/fresh').send({ name: 'Fresh', phone: fresh.phone }), 403, 'terms_not_accepted');
    code(await h.as(fresh).post('/api/teams').send({ name: 'Tigers', color: '#E53935', captainId: 'fresh', memberIds: ['fresh'] }), 403, 'terms_not_accepted');
    code(await h.as(fresh).post('/api/matches').send(newMatchBody({ createdBy: 'fresh' })), 403, 'terms_not_accepted');
    code(await h.as(fresh).put('/api/matches/x/progress').send({ events: [] }), 403, 'terms_not_accepted');
    code(await h.as(fresh).post('/api/matches/x/photos').send('x'), 403, 'terms_not_accepted');
    code(await h.as(fresh).post('/api/challenges').send({}), 403, 'terms_not_accepted');
    code(await h.as(fresh).post('/api/matches/x/confirm'), 403, 'terms_not_accepted');
  });
  it('accept: only the exact current version, server time, idempotent; then registration works', async () => {
    // 17 accept calls here (validation + 10 parallel replays); the per-user limit has its own tests
    // (rateLimit.test.ts), so give this one room. helpers.reset() clears the buckets between tests.
    const lim = h.s.rateLimiter!.limits;
    const saved = lim.terms;
    lim.terms = { burst: 100, perMinute: 100 };
    try {
    for (const v of ['2020-01', TERMS_VERSION + ' ', TERMS_VERSION.toUpperCase(), '']) code(await h.as(fresh).post('/api/me/terms/accept').send({ version: v }), 400, 'terms_version_mismatch');
    code(await h.as(fresh).post('/api/me/terms/accept').send({ version: 2 }), 400);
    // client-supplied time is not accepted (strict body)
    code(await h.as(fresh).post('/api/me/terms/accept').send({ version: TERMS_VERSION, acceptedAt: 1 }), 400);
    const t0 = Date.now();
    const r = await h.as(fresh).post('/api/me/terms/accept').send({ version: TERMS_VERSION });
    code(r, 200);
    assert.equal(r.body.version, TERMS_VERSION);
    assert.ok(r.body.acceptedAt >= t0 - 1000 && r.body.acceptedAt <= Date.now() + 1000);
    // 10 parallel replays: one row, first timestamp kept
    const again = await Promise.all(Array.from({ length: 10 }, () => h.as(fresh).post('/api/me/terms/accept').send({ version: TERMS_VERSION })));
    for (const a of again) assert.equal(a.body.acceptedAt, r.body.acceptedAt);
    assert.equal((await h.db('terms_acceptances').where({ user_id: 'fresh' })).length, 1);
    code(await h.as(fresh).put('/api/users/fresh').send({ name: 'Fresh', phone: fresh.phone }), 200);
    assert.equal((await h.as(fresh).get('/api/me')).body.termsAccepted, true);
    } finally {
      lim.terms = saved;
    }
  });
  it('an older stored version is gated again until the new one is accepted (TC-12, TC-21)', async () => {
    await h.db('terms_acceptances').where({ user_id: 'bob' }).update({ version: '2025-old' });
    code(await h.as('bob').put('/api/users/bob').send({ name: 'Bob Builder', phone: '+919000000002' }), 403, 'terms_not_accepted');
    code(await h.as('bob').post('/api/me/terms/accept').send({ version: TERMS_VERSION }), 200);
    code(await h.as('bob').put('/api/users/bob').send({ name: 'Bob Builder', phone: '+919000000002' }), 200);
  });
  it('the T&C version can only be written through the accept action (TC-08, TC-11)', async () => {
    code(await h.as('bob').put('/api/users/bob').send({ name: 'Bob', phone: '+919000000002', termsVersion: TERMS_VERSION, termsAcceptedAt: 1 }), 400, 'server_field');
    // accept always records the caller's own uid; there is no way to name another uid and no delete
    await h.as(fresh).post('/api/me/terms/accept').send({ version: TERMS_VERSION, uid: 'eve' });
    assert.equal((await h.db('terms_acceptances').where({ user_id: 'fresh' })).length, 0); // strict body refused it
    code(await h.as('bob').del('/api/me/terms'), 404);
  });
});

describe('POTM required + terminal statuses + server time (baseline PM-04, PM-10b, PM-11, PM-15b, AF-14, AF-18, RG-01)', () => {
  it('a new match can only be scheduled or live; a finished/abandoned create is refused (AF-18)', async () => {
    code(await h.as('cap').post('/api/matches').send(newMatchBody({ status: 'finished', finishedAt: Date.UTC(2100, 0, 1) })), 400, 'match_bad_status');
    code(await h.as('cap').post('/api/matches').send(newMatchBody({ status: 'abandoned' })), 400, 'match_bad_status');
  });
  it('startedAt comes from the server clock, never the client (AF-14)', async () => {
    const t0 = Date.now();
    const id = await createMatch(h, { startedAt: t0 - 5 * 3600_000 });
    const m = (await h.as('bob').get(`/api/matches/${id}`)).body;
    assert.ok(m.startedAt >= t0 - 1000, String(m.startedAt));
    assert.ok(m.startedServerAt >= t0 - 1000);
    code(await h.as('cap').patch(`/api/matches/${id}`).send({ startedAt: t0 - 3600_000 }), 400, 'server_time'); // N121-3
    assert.equal((await h.as('bob').get(`/api/matches/${id}`)).body.startedAt, m.startedAt);
    code(await progress(id, [pt('A', 1)], 'cap', { startedAt: 0 }), 200);
    assert.equal((await h.as('bob').get(`/api/matches/${id}`)).body.startedAt, m.startedAt);
  });
  it('a scheduled match gets its start when it goes live', async () => {
    const id = await createMatch(h, { status: 'scheduled', scheduledAt: Date.now() + 3600_000, startedAt: 5 });
    assert.equal((await h.as('bob').get(`/api/matches/${id}`)).body.startedAt, null);
    const t0 = Date.now();
    code(await h.as('cap').patch(`/api/matches/${id}`).send({ status: 'live' }), 200);
    assert.ok((await h.as('bob').get(`/api/matches/${id}`)).body.startedServerAt >= t0 - 1000);
  });
  it('finishedAt is never in the future (PM-11) and finished needs a winner (PM-04/RG-01)', async () => {
    const id = await createMatch(h);
    code(await h.as('cap').patch(`/api/matches/${id}`).send({ status: 'finished' }), 400, 'match_no_winner');
    const r = await progress(id, WIN_A, 'cap', { finishedAt: Date.now() + 30 * 86_400_000 });
    assert.ok(r.body.finishedAt <= Date.now() + 1000);
    assert.equal(r.body.status, 'finished');
    assert.equal(r.body.playerOfMatchId, null);
    assert.equal(r.body.verification.status, 'pending');
  });
  it('without a POTM the match is not complete: it can not be confirmed and does not count', async () => {
    const id = await createMatch(h);
    code(await progress(id, WIN_A), 200);
    code(await h.as('aarav').post(`/api/matches/${id}/confirm`), 409, 'not_completed');
    // undo is still possible while awaiting the POTM
    code(await progress(id, WIN_A.slice(0, 4)), 200);
    code(await progress(id, WIN_A), 200);
    code(await potm(id, 'bob'), 200);
  });
  it('completed (finished + POTM) is terminal: no undo, no re-finish with another POTM, no edits (PM-10b)', async () => {
    const id = await completed();
    code(await progress(id, WIN_A.slice(0, 4)), 409, 'match_terminal');
    code(await potm(id, 'cap'), 409, 'potm_already_set');
    code(await h.as('cap').patch(`/api/matches/${id}`).send({ status: 'live' }), 409, 'match_terminal');
    code(await h.as('cap').patch(`/api/matches/${id}`).send({ title: 'Edited' }), 409, 'match_terminal');
    code(await h.as('cap').patch(`/api/matches/${id}`).send({ scorerId: 'bob' }), 409, 'match_terminal');
    code(await h.as('cap').patch(`/api/matches/${id}`).send({ status: 'abandoned' }), 409, 'match_terminal');
  });
  it('abandoned is terminal: never finished or live again (PM-15b)', async () => {
    const id = await createMatch(h);
    code(await progress(id, WIN_A.slice(0, 3)), 200);
    code(await h.as('cap').patch(`/api/matches/${id}`).send({ status: 'abandoned' }), 200);
    code(await h.as('cap').patch(`/api/matches/${id}`).send({ status: 'finished' }), 409, 'match_terminal');
    code(await progress(id, WIN_A), 409, 'match_terminal');
  });
  it('awaiting POTM can not be abandoned or handed over (PM-13)', async () => {
    const id = await createMatch(h);
    code(await progress(id, WIN_A), 200);
    code(await h.as('cap').patch(`/api/matches/${id}`).send({ status: 'abandoned' }), 409, 'match_status_move');
    code(await h.as('cap').patch(`/api/matches/${id}`).send({ scorerId: 'bob' }), 409, 'match_terminal');
  });
  it('clients can not write verification, server times, points, bonus or wallet (AF-46c, AF-51, WL-03)', async () => {
    const id = await createMatch(h);
    for (const f of [{ verification: { status: 'confirmed' } }, { startedServerAt: 1 }, { finishedServerAt: 1 }, { points: 5 }, { bonus: 100 }, { wallet: 1 }, { balance: 9999 }])
      code(await h.as('cap').patch(`/api/matches/${id}`).send(f), 400, 'server_field');
    code(await h.as('cap').post('/api/matches').send(newMatchBody({ verification: { status: 'confirmed' } })), 400, 'server_field');
    code(await h.as('cap').post('/api/matches').send(newMatchBody({ playerOfMatchId: 'bob' })), 400, 'potm_use_endpoint');
    code(await h.as('bob').put('/api/users/bob').send({ name: 'Bob', phone: '+919000000002', balance: 9999 }), 400, 'server_field');
  });
  it('a finished match can only be deleted by an admin (AF-50)', async () => {
    const id = await completed();
    code(await h.as('cap').del(`/api/matches/${id}`), 403);
    const awaiting = await createMatch(h);
    code(await progress(awaiting, WIN_A), 200);
    code(await h.as('cap').del(`/api/matches/${awaiting}`), 403);
    code(await h.as(ADMIN).del(`/api/matches/${id}`), 204);
    // scheduled / abandoned stay deletable by the creator
    const sch = await createMatch(h, { status: 'scheduled', scheduledAt: Date.now() + 3600_000 });
    code(await h.as('cap').del(`/api/matches/${sch}`), 204);
  });
});

describe('QA retest 1.2.1: N121-1..N121-3 and INFO', () => {
  it('N121-1: finished and abandoned never toggle; the finish time is not re-stamped; no POTM on an abandoned match', async () => {
    // awaiting POTM -> abandoned is refused (H2a), so the finished <-> abandoned loop can't start
    const id = await createMatch(h);
    const fin = (await progress(id, WIN_A)).body;
    code(await h.as('cap').patch(`/api/matches/${id}`).send({ status: 'abandoned' }), 409, 'match_status_move');
    assert.equal((await h.as('cap').get(`/api/matches/${id}`)).body.finishedAt, fin.finishedAt);
    // completed -> abandoned (H2a after POTM) is refused too
    code(await potm(id, 'bob'), 200);
    code(await h.as('cap').patch(`/api/matches/${id}`).send({ status: 'abandoned' }), 409, 'match_terminal');
    const after = (await h.as('cap').get(`/api/matches/${id}`)).body;
    assert.equal(after.finishedAt, fin.finishedAt);
    assert.equal(after.status, 'finished');
    // abandoned -> finished (H2b) refused, and an abandoned match can't take a POTM (H-AB3)
    const ab = await createMatch(h);
    code(await progress(ab, WIN_A.slice(0, 3)), 200);
    code(await h.as('cap').patch(`/api/matches/${ab}`).send({ status: 'abandoned' }), 200);
    code(await h.as('cap').patch(`/api/matches/${ab}`).send({ status: 'finished' }), 409, 'match_terminal');
    assert.equal((await potm(ab, 'bob')).status >= 400, true);
    assert.equal((await h.as('cap').get(`/api/matches/${ab}`)).body.playerOfMatchId, null);
  });
  it('N121-2: POST /matches as finished with a full winning log is refused (same as the rules)', async () => {
    code(await h.as('cap').post('/api/matches').send(newMatchBody({ status: 'finished', events: WIN_A })), 400, 'match_bad_status');
    code(await h.as('cap').post('/api/matches').send(newMatchBody({ status: 'abandoned' })), 400, 'match_bad_status');
  });
  it('N121-3: a backdated startedAt is refused or ignored everywhere (create, PATCH, progress); finished delete is admin only', async () => {
    const t0 = Date.now();
    const id = await createMatch(h, { startedAt: t0 - 6 * 3600_000 });
    const start = (await h.as('cap').get(`/api/matches/${id}`)).body.startedAt;
    assert.ok(start >= t0 - 1000);
    code(await h.as('cap').patch(`/api/matches/${id}`).send({ startedAt: t0 - 3600_000 }), 400, 'server_time');
    code(await progress(id, WIN_A, 'cap', { startedAt: 1 }), 200);
    code(await h.as('cap').patch(`/api/matches/${id}`).send({ startedAt: 1 }), 400, 'server_time'); // H3 on a finished match
    assert.equal((await h.as('cap').get(`/api/matches/${id}`)).body.startedAt, start);
    code(await h.as('cap').del(`/api/matches/${id}`), 403); // H4
    code(await h.as(ADMIN).del(`/api/matches/${id}`), 204);
  });
  it('INFO: PATCH with finishedAt is 400, like playerOfMatchId', async () => {
    const id = await createMatch(h);
    code(await h.as('cap').patch(`/api/matches/${id}`).send({ finishedAt: Date.now() }), 400, 'server_time');
    code(await h.as('cap').patch(`/api/matches/${id}`).send({ playerOfMatchId: 'bob' }), 400, 'potm_use_endpoint');
  });
  it('INFO: undo after the POTM is blocked, so a re-opened match never carries a POTM', async () => {
    const id = await completed();
    code(await progress(id, WIN_A.slice(0, 4)), 409, 'match_terminal');
    const m = (await h.as('cap').get(`/api/matches/${id}`)).body;
    assert.equal(m.status, 'finished');
    assert.ok(m.playerOfMatchId);
  });
});

describe('captains and opposing-captain confirmation (AF-36..AF-46)', () => {
  it('a side built by number needs a captain named by the creator, on that side', async () => {
    code(await h.as('cap').post('/api/matches').send(newMatchBody({ captains: null })), 400, 'captains_required');
    code(await h.as('cap').post('/api/matches').send(newMatchBody({ captains: { A: 'cap', B: 'cap' } })), 400, 'captains_same');
    code(await h.as('cap').post('/api/matches').send(newMatchBody({ captains: { A: 'cap', B: 'eve' } })), 400, 'captain_not_on_side');
  });
  it("a registered team's captain is filled in from the team", async () => {
    const tA = await makeTeam(h, 'cap', SQUAD_A);
    const tB = await makeTeam(h, 'aarav', SQUAD_B);
    const r = await h.as('cap').post('/api/matches').send(newMatchBody({ teamA: team('A', playersOf(SQUAD_A), tA), teamB: team('B', playersOf(SQUAD_B), tB), captains: { A: 'bob', B: 'dan' } }));
    code(r, 201);
    assert.deepEqual((await h.as('bob').get(`/api/matches/${r.body.id}`)).body.captains, { A: 'cap', B: 'aarav' });
  });
  it('captains are fixed once scoring started', async () => {
    const id = await createMatch(h);
    code(await progress(id, [pt('A', 1)]), 200);
    code(await h.as('cap').patch(`/api/matches/${id}`).send({ captains: { A: 'bob', B: 'dan' } }), 403);
  });
  it('only the opposing captain confirms; not the scorer, the creator, their side or others', async () => {
    const id = await completed();
    code(await h.as('cap').post(`/api/matches/${id}/confirm`), 403, 'scoring_side');
    code(await h.as('bob').post(`/api/matches/${id}/confirm`), 403, 'not_captain');
    code(await h.as('dan').post(`/api/matches/${id}/confirm`), 403, 'not_captain');
    code(await h.as('eve').post(`/api/matches/${id}/confirm`), 403, 'not_captain');
    const ok = await h.as('aarav').post(`/api/matches/${id}/confirm`);
    code(ok, 200);
    assert.equal(ok.body.verification.status, 'confirmed');
    assert.equal(ok.body.verification.by, 'aarav');
    // replay is idempotent; a different decision afterwards is 409
    code(await h.as('aarav').post(`/api/matches/${id}/confirm`), 200);
    code(await h.as('aarav').post(`/api/matches/${id}/reject`).send({}), 409, 'already_reviewed');
  });
  it('a scorer on the B side makes B a scoring side: B captain can not confirm', async () => {
    const id = await createMatch(h, { scorerId: 'dan' });
    code(await progress(id, WIN_A, 'dan'), 200);
    code(await potm(id, 'bob', 'dan'), 200);
    code(await h.as('aarav').post(`/api/matches/${id}/confirm`), 403, 'scoring_side');
  });
  it('reject: reason max 200 plain text; the match is flagged (disputed) and excluded', async () => {
    const id = await completed();
    code(await h.as('aarav').post(`/api/matches/${id}/reject`).send({ reason: 'x'.repeat(201) }), 400, 'text_too_long');
    code(await h.as('aarav').post(`/api/matches/${id}/reject`).send({ reason: 'bad\u0007score' }), 400);
    const r = await h.as('aarav').post(`/api/matches/${id}/reject`).send({ reason: 'Score is wrong' });
    code(r, 200);
    assert.equal(r.body.verification.status, 'disputed');
    assert.equal(r.body.verification.reason, 'Score is wrong');
    assert.equal((await h.as('eve').get(`/api/matches/${id}`)).body.verification.reason, null); // not shown to outsiders
    code(await h.as('aarav').post(`/api/matches/${id}/confirm`), 409, 'already_reviewed');
    assert.equal((await h.as('bob').get('/api/rankings')).body.me, null);
    // the scorer can't reset it by editing / re-finishing
    code(await progress(id, WIN_A.slice(0, 4)), 409, 'match_terminal');
  });
  it('confirming an unfinished or abandoned match is 409', async () => {
    const live = await createMatch(h);
    code(await h.as('aarav').post(`/api/matches/${live}/confirm`), 409, 'not_completed');
    code(await h.as('cap').patch(`/api/matches/${live}`).send({ status: 'abandoned' }), 200);
    code(await h.as('aarav').post(`/api/matches/${live}/confirm`), 409, 'not_completed');
  });
});

describe('flags, admin review, caps, wallet and bonus', () => {
  const now = Date.now();
  it('a match under MIN_MATCH_MINUTES is flagged until an admin approves it; admins only', async () => {
    const id = await completed();
    code(await h.as('aarav').post(`/api/matches/${id}/confirm`), 200);
    // real elapsed time is seconds: flagged too_short
    assert.equal((await h.as('bob').get('/api/me/wallet')).body.balance, 0);
    assert.equal((await h.as('bob').get('/api/me/wallet')).body.flagged, 1);
    code(await h.as('cap').post(`/api/admin/matches/${id}/review`).send({ decision: 'approve' }), 403);
    code(await h.as('cap').get('/api/admin/matches/flagged'), 403);
    const list = await h.as(ADMIN).get('/api/admin/matches/flagged');
    assert.deepEqual(list.body.map((m: { id: string }) => m.id), [id]);
    code(await h.as(ADMIN).post(`/api/admin/matches/${id}/review`).send({ decision: 'approve' }), 200);
    code(await h.as(ADMIN).post(`/api/admin/matches/${id}/review`).send({ decision: 'void' }), 409, 'already_reviewed');
    const w = (await h.as('bob').get('/api/me/wallet')).body;
    assert.equal(w.balance, 3 + RANKING_POINTS_PER_WIN + RANKING_POINTS_PER_POTM);
    assert.equal(w.flagged, 0);
  });
  it('void never counts', async () => {
    const id = await completed();
    code(await h.as(ADMIN).post(`/api/admin/matches/${id}/review`).send({ decision: 'void' }), 200);
    assert.equal((await h.as('bob').get('/api/me/wallet')).body.balance, 0);
  });
  it('MIN_MATCH_MINUTES boundary: 10 minutes counts, 9:59 does not', async () => {
    const a = await completed();
    code(await h.as('aarav').post(`/api/matches/${a}/confirm`), 200);
    await setTimes(a, now - ANTI_FRAUD.MIN_MATCH_MINUTES * MIN + 1000, now);
    assert.equal((await h.as('bob').get('/api/me/wallet')).body.countedMatches, 0);
    await setTimes(a, now - ANTI_FRAUD.MIN_MATCH_MINUTES * MIN, now);
    assert.equal((await h.as('bob').get('/api/me/wallet')).body.countedMatches, 1);
  });
  it('same pair at most 2 per IST week; a player at most 3 per IST day', async () => {
    const day = Date.UTC(2026, 9, 13, 6, 0); // Tue 11:30 IST
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      const id = await completed();
      code(await h.as('aarav').post(`/api/matches/${id}/confirm`), 200);
      await setTimes(id, day + i * 3600_000 - 20 * MIN, day + i * 3600_000);
      ids.push(id);
    }
    assert.equal((await h.as('bob').get('/api/me/wallet')).body.countedMatches, 2); // pair cap
    // the same players against "different pairs" (different captains) the same day: daily cap 3
    for (const [i, caps] of ([{ A: 'bob', B: 'dan' }, { A: 'a3', B: 'b3' }] as Caps[]).entries()) {
      const id = await completed({ captains: caps });
      code(await h.as(caps.B).post(`/api/matches/${id}/confirm`), 200);
      await setTimes(id, day + (5 + i) * 3600_000 - 20 * MIN, day + (5 + i) * 3600_000);
    }
    assert.equal((await h.as('bob').get('/api/me/wallet')).body.countedMatches, 3);
    // next IST week the pair counts again
    await setTimes(ids[2], day + 7 * 86_400_000 - 20 * MIN, day + 7 * 86_400_000);
    assert.equal((await h.as('bob').get('/api/me/wallet')).body.countedMatches, 4);
  });
  it('+100 per 5 counted wins, derived (wallet = ranking points + bonus); no redeem endpoints', async () => {
    const base = Date.UTC(2026, 6, 6, 6, 0); // a Monday
    for (let i = 0; i < 5; i++) {
      const caps = ([{ A: 'cap', B: 'aarav' }, { A: 'bob', B: 'dan' }] as Caps[])[i % 2];
      const id = await completed({ captains: caps });
      code(await h.as(caps.B).post(`/api/matches/${id}/confirm`), 200);
      const at = base + i * 86_400_000 * (i % 2 ? 1 : 7); // spread over days and weeks
      await setTimes(id, at - 20 * MIN, at);
    }
    const w = (await h.as('bob').get('/api/me/wallet')).body;
    assert.equal(w.wins, 5);
    assert.equal(w.bonus, 100);
    assert.equal(w.balance, w.matchPoints + 100);
    assert.equal(w.matchPoints, 5 * 3 + 5 * RANKING_POINTS_PER_WIN + 5 * RANKING_POINTS_PER_POTM);
    assert.equal(w.winsToNextBonus, 5);
    // 1.3.1 (QA C130-7): the points history, derived from the same counted matches, newest first;
    // its rows add up to the balance (5 match rows + 1 bonus row at the 5th win).
    assert.equal(w.history.length, 6);
    assert.equal(w.history.filter((x: { kind: string }) => x.kind === 'bonus').length, 1);
    assert.equal(w.history.reduce((n: number, x: { points: number }) => n + x.points, 0), w.balance);
    for (let i = 1; i < w.history.length; i++) assert.ok(w.history[i - 1].at >= w.history[i].at);
    const row = w.history.find((x: { kind: string }) => x.kind === 'match');
    assert.equal(row.points, 3 + RANKING_POINTS_PER_WIN + RANKING_POINTS_PER_POTM);
    assert.ok(row.opponent && row.won === true && row.potm === true && row.credited === 3);
    // 1.3.1 (QA C130-8): rankings carry my counted match ids, the same matches as the wallet history
    const r = (await h.as('bob').get('/api/rankings')).body;
    assert.equal(r.myCountedMatchIds.length, r.me.matches);
    assert.deepEqual([...r.myCountedMatchIds].sort(), w.history.filter((x: { kind: string }) => x.kind === 'match').map((x: { matchId: string }) => x.matchId).sort());
    assert.ok(!JSON.stringify(w).match(/redeem|cash|rupee|upi|withdraw/i));
    for (const p of ['/api/wallet/redeem', '/api/me/wallet/redeem', '/api/redemptions', '/api/payouts', '/api/withdraw']) code(await h.as('bob').post(p).send({}), 404);
    code(await h.as('bob').put('/api/me/upi').send({}), 404);
    // nothing about points is stored on the match or the user
    const cols = (await h.db.raw("SELECT COLUMN_NAME c FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name IN ('users','matches')"))[0].map((r: { c: string }) => r.c);
    assert.ok(!cols.some((c: string) => /bonus|wallet|balance|aadhaar|uid_number/i.test(c)), cols.join(','));
  });
  it('location is recorded when it is given', async () => {
    const id = await createMatch(h);
    assert.deepEqual((await h.as('bob').get(`/api/matches/${id}`)).body.location, { name: 'Lodhi Garden', lat: 28.59, lng: 77.22 });
    const none = await createMatch(h, { location: null });
    assert.equal((await h.as('bob').get(`/api/matches/${none}`)).body.location, null);
  });
});

describe('admin allow-list comes from ADMIN_UIDS', () => {
  it('parses ids only and refuses junk', async () => {
    assert.deepEqual(parseAdminUids(' a1, b2 ,a1,'), ['a1', 'b2']);
    assert.deepEqual(parseAdminUids(undefined), []);
    assert.throws(() => parseAdminUids('ok,bad uid'));
  });
});
