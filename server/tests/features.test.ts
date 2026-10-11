/**
 * Build 27 features on the API server: match photos (players + scorer only, memories),
 * Player of the Match (PUT /matches/:id/player-of-match) and rankings (GET /rankings, the 0004 view
 * + the shared src/core/ranking.ts).
 */
import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import { type Who, EVERYONE, SQUAD_A, SQUAD_B, createMatch, newMatchBody, pt, register, startHarness, type Harness } from './helpers';
import { rankPlayers, MIN_RANKED_MATCHES } from '../../src/core/ranking';
import { countedTotals } from '../../src/core/antifraud';
import { pickPlayerOfMatch } from '../../src/core/potm';

let h: Harness;
before(async () => (h = await startHarness()));
after(async () => h.close());
beforeEach(async () => {
  await h.reset();
  await register(h, ...EVERYONE, 'zed');
});

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a6d10000000049454e44ae426082', 'hex');
const up = (who: Parameters<Harness['as']>[0], id: string) => h.as(who).post(`/api/matches/${id}/photos`).set('Content-Type', 'image/png').send(PNG);
const progress = (id: string, events: object[], who: Parameters<Harness['as']>[0] = 'cap') => h.as(who).put(`/api/matches/${id}/progress`).send({ events });
const potm = (id: string, playerId: string, who: Parameters<Harness['as']>[0] = 'cap') => h.as(who).put(`/api/matches/${id}/player-of-match`).send({ playerId });
/** Team A wins 5-0 (best of 1, to 5, win by 1); credits in order. */
const sweep = (credits: (string | undefined)[], side: 'A' | 'B' = 'A') => credits.map((c, i) => pt(side, 1000 + i, c));

describe('match photos: players of the match + the scorer only', () => {
  it('the creator who neither plays nor scores, and outsiders, are refused; players and the scorer upload', async () => {
    const r = await h.as('eve').post('/api/matches').send(newMatchBody({ createdBy: 'eve', scorerId: 'zed', participantIds: [...SQUAD_A, ...SQUAD_B, 'eve', 'zed'] }));
    assert.equal(r.status, 201, JSON.stringify(r.body));
    const id = r.body.id;
    const no = await up('eve', id);
    assert.equal(no.status, 403);
    assert.match(no.body.message, /players and the scorer/);
    assert.equal((await up('zed', id)).status, 201); // scorer
    assert.equal((await up('bob', id)).status, 201); // team A
    assert.equal((await up('dan', id)).status, 201); // team B
    assert.equal((await up('nophone', id)).status, 403);
    assert.equal((await up('bob', 'nope')).status, 404);
    assert.equal((await h.as('eve').get(`/api/matches/${id}/photos`)).body.length, 3); // anyone signed in can look
  });

  it('memories: photos from the matches a user played in, newest first', async () => {
    const id = await createMatch(h);
    await up('cap', id);
    await up('dan', id);
    const bob = await h.as('eve').get('/api/users/bob/photos');
    assert.equal(bob.status, 200);
    assert.equal(bob.body.length, 2);
    assert.ok(bob.body[0].createdAt >= bob.body[1].createdAt);
    assert.equal((await h.as('cap').get('/api/users/eve/photos')).body.length, 0);
    assert.equal((await h.api.get('/api/users/bob/photos')).status, 401);
  });
});

describe('Player of the Match', () => {
  it('only the scorer, only once the match is finished, only a player of the match, only once', async () => {
    const id = await createMatch(h);
    const ev = sweep(['bob', 'bob', 'cap', 'bob', 'cap']);
    assert.equal((await progress(id, ev.slice(0, 4))).status, 200);
    let r = await potm(id, 'bob');
    assert.equal(r.status, 400);
    assert.equal(r.body.error, 'potm_not_finished');
    const fin = await progress(id, ev);
    assert.equal(fin.body.status, 'finished');
    assert.equal(fin.body.playerOfMatchId, null);
    assert.equal(pickPlayerOfMatch(fin.body), 'bob'); // the app's auto pick
    r = await potm(id, 'bob', 'bob');
    assert.equal(r.status, 403); // a player, not the scorer
    r = await potm(id, 'eve');
    assert.equal(r.status, 400);
    assert.equal(r.body.error, 'potm_not_player');
    assert.equal((await h.as('cap').put(`/api/matches/${id}/player-of-match`).send({ playerId: 'x y' })).status, 400);
    assert.equal((await h.as('cap').put(`/api/matches/${id}/player-of-match`).send({ playerId: 'dan', extra: 1 })).status, 400);
    // INFO (retest 1.1.0): a player with 0 credited points can't be chosen while others scored
    r = await potm(id, 'dan');
    assert.equal(r.status, 400);
    assert.equal(r.body.error, 'potm_no_points');
    r = await potm(id, 'cap'); // the scorer overrides the auto pick (bob) with another scorer of points
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.playerOfMatchId, 'cap');
    r = await potm(id, 'bob');
    assert.equal(r.status, 409);
    assert.equal(r.body.error, 'potm_already_set');
    assert.equal((await h.as('eve').get(`/api/matches/${id}`)).body.playerOfMatchId, 'cap');
    // INFO (retest 1.1.0): PATCH with playerOfMatchId is a 400, not silently ignored
    const p = await h.as('cap').patch(`/api/matches/${id}`).send({ playerOfMatchId: 'bob' });
    assert.equal(p.status, 400);
    assert.equal(p.body.error, 'potm_use_endpoint');
    assert.equal((await h.as('eve').get(`/api/matches/${id}`)).body.playerOfMatchId, 'cap');
  });

  it('NB-R3 / 1.3.0: once the POTM is confirmed the match is closed: no undo, no re-pick', async () => {
    const id = await createMatch(h);
    const ev = sweep(['bob', 'bob', 'bob', 'cap', 'cap']);
    await progress(id, ev);
    assert.equal((await potm(id, 'bob')).status, 200);
    const back = await progress(id, ev.slice(0, 4));
    assert.equal(back.status, 409);
    assert.equal(back.body.error, 'match_terminal');
    const again = await potm(id, 'cap');
    assert.equal(again.status, 409);
    assert.equal(again.body.error, 'potm_already_set');
    assert.equal((await h.as('eve').get(`/api/matches/${id}`)).body.playerOfMatchId, 'bob');
  });

  it('NB-R3: the server sets finishedAt itself and ignores the client value', async () => {
    const id = await createMatch(h);
    const before = Date.now();
    const r = await h.as('cap').put(`/api/matches/${id}/progress`).send({ events: sweep(['bob', 'bob', 'bob', 'cap', 'cap']), status: 'finished', finishedAt: Date.now() + 20 * 3600_000 });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.ok(r.body.finishedAt >= before - 1000 && r.body.finishedAt <= Date.now() + 1000, String(r.body.finishedAt));
    // 1.3.0 (INFO retest 1.2.1): a PATCH with finishedAt is refused like playerOfMatchId
    const p = await h.as('cap').patch(`/api/matches/${id}`).send({ title: 'Renamed', finishedAt: Date.now() + 20 * 3600_000 });
    assert.equal(p.status, 400);
    assert.equal(p.body.error, 'server_time');
    assert.equal((await h.as('cap').get(`/api/matches/${id}`)).body.finishedAt, r.body.finishedAt);
  });

  it('NB-R2: "finished" without a winner is refused (create, PATCH, progress)', async () => {
    const id = await createMatch(h);
    const p = await h.as('cap').patch(`/api/matches/${id}`).send({ status: 'finished' });
    assert.equal(p.status, 400);
    assert.equal(p.body.error, 'match_no_winner');
    const q = await h.as('cap').put(`/api/matches/${id}/progress`).send({ events: sweep(['bob', 'bob']), status: 'finished' });
    // progress derives the status from the event log: a client "finished" can't stick
    assert.equal(q.status, 200);
    assert.equal(q.body.status, 'live');
    const c = await h.as('cap').post('/api/matches').send(newMatchBody({ status: 'finished' }));
    assert.equal(c.status, 400);
    assert.equal(c.body.error, 'match_bad_status'); // 1.3.0: can't be created finished at all
  });
});

describe('migration 0005: the ranking view needs a winner (NB-R2)', () => {
  it('a legacy "finished" row without a winner is not in player_finished_matches; a real finish is', async () => {
    const ok = await createMatch(h);
    await progress(ok, sweep(['bob', 'bob', 'bob', 'cap', 'cap']));
    const bad = await createMatch(h);
    await h.db('matches').where({ id: bad }).update({ status: 'finished' }); // legacy data, summary.winner null
    const rows = await h.db('player_finished_matches').select('match_id').distinct();
    const ids = rows.map((r: { match_id: string }) => r.match_id);
    assert.ok(ids.includes(ok));
    assert.ok(!ids.includes(bad));
  });
});

describe('photo idempotency (retest 1.1.0 NB-P2)', () => {
  it('the same Idempotency-Key returns the same photo; another match with that key is a 409', async () => {
    const id = await createMatch(h);
    const send = (mid: string, key: string) => h.as('bob').post(`/api/matches/${mid}/photos`).set('Content-Type', 'image/png').set('Idempotency-Key', key).send(PNG);
    const a = await send(id, 'q_abc123_xyz');
    assert.equal(a.status, 201, JSON.stringify(a.body));
    const b = await send(id, 'q_abc123_xyz');
    assert.ok(b.status === 200 || b.status === 201);
    assert.equal(b.body.id, a.body.id);
    assert.equal((await h.as('bob').get(`/api/matches/${id}/photos`)).body.length, 1);
    const other = await createMatch(h);
    const c = await send(other, 'q_abc123_xyz');
    assert.equal(c.status, 409);
    assert.equal(c.body.error, 'idempotency_conflict');
    assert.equal((await send(id, 'bad key!')).status, 400);
    // another uploader may use the same key (keys are per uploader)
    const d = await h.as('cap').post(`/api/matches/${id}/photos`).set('Content-Type', 'image/png').set('Idempotency-Key', 'q_abc123_xyz').send(PNG);
    assert.equal(d.status, 201);
    assert.notEqual(d.body.id, a.body.id);
  });

  it('only within 24 h of the finish', async () => {
    const id = await createMatch(h);
    await progress(id, sweep(['bob', 'bob', 'bob', 'cap', 'cap']));
    await h.db('matches').where({ id }).update({ finished_at: new Date(Date.now() - 25 * 3600 * 1000) });
    const r = await potm(id, 'bob');
    assert.equal(r.status, 400);
    assert.equal(r.body.error, 'potm_window');
  });
});

describe('rankings (GET /api/rankings)', () => {
  /**
   * 1.3.0: a match counts once it is completed (POTM), confirmed by the opposing captain and at least
   * MIN_MATCH_MINUTES long by the server's clock (the start is moved back in the DB to simulate the
   * wait). Each match uses different captains so the same-pair weekly cap doesn't apply.
   */
  async function finished(credits: (string | undefined)[], side: 'A' | 'B', pick: string, captains: { A: string; B: Who }) {
    const id = await createMatch(h, { captains });
    const r = await progress(id, sweep(credits, side));
    assert.equal(r.body.status, 'finished');
    assert.equal((await potm(id, pick)).status, 200);
    await h.db('matches').where({ id }).update({ started_server_at: h.db.raw('DATE_SUB(started_server_at, INTERVAL 20 MINUTE)') });
    const c = await h.as(captains.B).post(`/api/matches/${id}/confirm`);
    assert.equal(c.status, 200, JSON.stringify(c.body));
    return id;
  }

  it('needs 3 finished matches; same totals and order as the shared core ranking; own row highlighted data', async () => {
    const ids = [await finished(['bob', 'bob', 'cap', undefined, 'bob'], 'A', 'bob', { A: 'cap', B: 'aarav' }), await finished(['dan', 'dan', 'dan', 'aarav', undefined], 'B', 'dan', { A: 'bob', B: 'dan' })];
    // a live match and an abandoned one never count
    const live = await createMatch(h);
    await progress(live, sweep(['bob', 'bob']));
    let r = await h.as('bob').get('/api/rankings');
    assert.equal(r.status, 200);
    assert.equal(r.body.total, 0);
    assert.equal(r.body.minMatches, MIN_RANKED_MATCHES);
    assert.deepEqual({ ...r.body.me, photoURL: undefined }, { playerId: 'bob', name: 'Bob Builder', photoURL: undefined, matches: 2, wins: 1, points: 3, potm: 1, rankingPoints: 3 + 10 + 25, winPct: 50, rank: null });
    ids.push(await finished(['cap', 'cap', 'a3', 'a3', 'a3'], 'A', 'cap', { A: 'a3', B: 'b3' }));
    r = await h.as('bob').get('/api/rankings');
    assert.equal(r.body.total, 12);
    const all = await Promise.all(ids.map(async (id) => (await h.as('bob').get(`/api/matches/${id}`)).body));
    const core = rankPlayers(countedTotals(all));
    assert.deepEqual(
      r.body.ranked.map((x: { playerId: string; rankingPoints: number; rank: number }) => [x.playerId, x.rankingPoints, x.rank]),
      core.ranked.map((x) => [x.playerId, x.rankingPoints, x.rank]),
    );
    // bob: 3 pts + 2 wins + 1 POTM = 3 + 20 + 25 = 48 → first
    assert.deepEqual(r.body.ranked[0], { ...r.body.ranked[0], playerId: 'bob', rankingPoints: 48, rank: 1, matches: 3, wins: 2, potm: 1, winPct: 67 });
    assert.equal(r.body.me.rank, 1);
    assert.equal((await h.as('eve').get('/api/rankings')).body.me, null);
    assert.equal((await h.as('bob').get('/api/rankings?limit=2')).body.ranked.length, 2);
    assert.equal((await h.as('bob').get('/api/rankings?limit=0')).status, 400);
    assert.equal((await h.as('bob').get('/api/rankings?limit=abc')).status, 400);
    assert.equal((await h.api.get('/api/rankings')).status, 401);
    // abandoning a finished match isn't possible through progress, but a status change off 'finished' drops it
    await h.db('matches').where({ id: ids[2] }).update({ status: 'abandoned' });
    assert.equal((await h.as('bob').get('/api/rankings')).body.total, 0);
  });
});
