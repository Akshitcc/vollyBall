import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import { careerStats, playerStats } from '../../src/core/stats';
import { migrate } from '../src/db/migrate';
import { EVERYONE, PEOPLE, SQUAD_A, SQUAD_B, createMatch, makeTeam, newMatchBody, playersOf, pt, register, startHarness, team, type Harness } from './helpers';

let h: Harness;
before(async () => (h = await startHarness()));
after(async () => h.close());
beforeEach(async () => {
  await h.reset();
  await register(h, ...EVERYONE);
});

const save = (id: string, events: object[], who: 'cap' | 'bob' = 'cap') => h.as(who).put(`/api/matches/${id}/progress`).send({ events });

describe('matches create (rule: createdBy == uid && uid in participantIds)', () => {
  it('enforces creator and participant; rejects unknown users', async () => {
    assert.equal((await h.as('bob').post('/api/matches').send(newMatchBody())).status, 403);
    assert.equal((await h.as('cap').post('/api/matches').send(newMatchBody({ participantIds: ['bob'] }))).status, 403);
    assert.equal((await h.as('cap').post('/api/matches').send(newMatchBody({ scorerId: 'ghost' }))).status, 400);
    const id = await createMatch(h);
    const m = (await h.as('eve').get(`/api/matches/${id}`)).body;
    assert.equal(m.status, 'live');
    assert.deepEqual(m.teamB.players.map((p: { id: string }) => p.id), [...SQUAD_B]);
    assert.deepEqual(m.summary, { setsA: 0, setsB: 0, currentA: 0, currentB: 0, setScores: [], winner: null, serving: 'A' });
    assert.equal(m.rotation.server, 'cap');
  });

  it('a match created live notifies the players except the scorer', async () => {
    await h.as('bob').put('/api/me/push-tokens').send({ token: 'ExponentPushToken[bob]' });
    await h.as('cap').put('/api/me/push-tokens').send({ token: 'ExponentPushToken[cap]' });
    await createMatch(h);
    await h.flushPush();
    assert.deepEqual(h.push.sent.map((m) => m.to), ['ExponentPushToken[bob]']); // only bob has a device
  });
});

describe('scoring (rule: only the assigned scorer changes the score)', () => {
  it('scorer saves the log; the server derives summary, sets and status', async () => {
    const id = await createMatch(h);
    assert.equal((await save(id, [pt('A', 1)], 'bob')).status, 403);
    const events = [pt('A', 1), pt('B', 2), pt('A', 3), pt('A', 4), pt('A', 5), pt('A', 6)];
    const r = await save(id, events);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.status, 'finished');
    assert.equal(r.body.summary.winner, 'A');
    assert.ok(r.body.finishedAt);
    const sets = await h.db('sets').where({ match_id: id });
    assert.deepEqual(sets.map((x: { score_a: number; score_b: number; winner: string }) => [x.score_a, x.score_b, x.winner]), [[5, 1, 'A']]);
    // nothing may come after the end of the match
    assert.equal((await save(id, [...events, pt('B', 7)])).status, 400);
  });

  it('rejects timeouts over the limit', async () => {
    const id = await createMatch(h);
    const to = (at: number) => ({ type: 'timeout', side: 'A', at });
    assert.equal((await save(id, [to(1), to(2)])).status, 200);
    assert.equal((await save(id, [to(1), to(2), to(3)])).status, 400);
  });

  it('handover: creator or scorer may change scorerId only; then old scorer loses access', async () => {
    const id = await createMatch(h);
    assert.equal((await h.as('eve').patch(`/api/matches/${id}`).send({ scorerId: 'eve' })).status, 403);
    assert.equal((await h.as('cap').patch(`/api/matches/${id}`).send({ scorerId: 'bob' })).status, 200);
    assert.equal((await save(id, [pt('A', 1)])).status, 403);
    assert.equal((await save(id, [pt('A', 1)], 'bob')).status, 200);
    // creator (no longer scorer) still may hand over, but may not change anything else
    assert.equal((await h.as('cap').patch(`/api/matches/${id}`).send({ scorerId: 'cap', title: 'x' })).status, 403);
  });

  it('"I want to play": anyone toggles only themselves', async () => {
    const id = await createMatch(h, { status: 'scheduled' });
    assert.equal((await h.as('eve').patch(`/api/matches/${id}`).send({ interestedIds: ['eve'] })).status, 200);
    assert.equal((await h.as('eve').patch(`/api/matches/${id}`).send({ interestedIds: ['eve', 'bob'] })).status, 403);
    assert.equal((await h.as('eve').patch(`/api/matches/${id}`).send({ status: 'abandoned' })).status, 403);
    assert.deepEqual((await h.as('cap').get(`/api/matches/${id}`)).body.interestedIds, ['eve']);
    assert.equal((await h.as('eve').patch(`/api/matches/${id}`).send({ interestedIds: [] })).status, 200);
  });

  it('delete: creator only, never while live', async () => {
    const id = await createMatch(h);
    assert.equal((await h.as('cap').del(`/api/matches/${id}`)).status, 403);
    await h.as('cap').patch(`/api/matches/${id}`).send({ status: 'abandoned' });
    assert.equal((await h.as('bob').del(`/api/matches/${id}`)).status, 403);
    assert.equal((await h.as('cap').del(`/api/matches/${id}`)).status, 204);
  });

  it('going live notifies players; lists by status, participant and public', async () => {
    await h.as('dan').put('/api/me/push-tokens').send({ token: 'ExponentPushToken[dan]' });
    const id = await createMatch(h, { status: 'scheduled', startedAt: null });
    await h.flushPush();
    assert.equal(h.push.sent.length, 0);
    await save(id, [pt('A', 1)]);
    await h.flushPush();
    assert.deepEqual(h.push.sent.map((m) => m.data.type), ['match']);
    assert.equal((await h.as('eve').get('/api/matches')).body.length, 1);
    assert.equal((await h.as('eve').get('/api/matches?participant=dan')).body.length, 1);
    assert.equal((await h.as('eve').get('/api/matches?participant=eve')).body.length, 0);
    assert.equal((await h.as('eve').get('/api/matches?public=1')).body.length, 1);
  });
});

describe('lineups & rotation (scorer-only, derived from the event log)', () => {
  const lineup = { '1': { A: ['bob', 'cap', 'a3', 'a4', 'a5', 'a6'], B: ['dan', 'aarav', 'b3', 'b4', 'b5', 'b6'] } };

  it('only the scorer sets lineups; they are validated', async () => {
    const id = await createMatch(h);
    assert.equal((await h.as('bob').patch(`/api/matches/${id}`).send({ lineups: lineup })).status, 403);
    assert.equal((await h.as('cap').patch(`/api/matches/${id}`).send({ lineups: { '1': { A: ['aarav', null, null, null, null, null], B: Array(6).fill(null) } } })).status, 400);
    assert.equal((await h.as('cap').patch(`/api/matches/${id}`).send({ lineups: { '1': { A: ['cap', 'cap', null, null, null, null], B: Array(6).fill(null) } } })).status, 400);
    assert.equal((await h.as('cap').patch(`/api/matches/${id}`).send({ lineups: { '3': lineup['1'] } })).status, 400); // best of 1
    const ok = await h.as('cap').patch(`/api/matches/${id}`).send({ lineups: lineup });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.deepEqual(ok.body.lineups, lineup);
    assert.equal(ok.body.rotation.server, 'bob');
    assert.equal((await h.db('set_lineups').where({ match_id: id })).length, 12);
  });

  it('side-out rotates the receiving team, stores the server of each rally, and undo reverses it', async () => {
    const id = await createMatch(h);
    await h.as('cap').patch(`/api/matches/${id}`).send({ lineups: lineup });
    const r1 = await save(id, [pt('B', 1)]); // side-out to B: B rotates, aarav (pos 2) moves to pos 1 and serves
    assert.deepEqual(r1.body.rotation.positions.B.slice(0, 2), ['aarav', 'b3']);
    assert.equal(r1.body.rotation.server, 'aarav');
    const r2 = await save(id, [pt('B', 1), pt('B', 2)]); // serving team scores: no rotation
    assert.equal(r2.body.rotation.server, 'aarav');
    const rows = await h.db('points').where({ match_id: id }).orderBy('seq');
    assert.deepEqual(rows.map((x: { serving_side: string; server_key: string }) => [x.serving_side, x.server_key]), [['A', 'bob'], ['B', 'aarav']]);
    assert.deepEqual((await h.db('sets').where({ match_id: id }).first()).rotations_b, 1);
    const undone = await save(id, []);
    assert.deepEqual(undone.body.rotation.positions, { A: lineup['1'].A, B: lineup['1'].B });
    assert.equal((await h.db('points').where({ match_id: id })).length, 0);
  });

  it('changing the lineup re-derives who served earlier rallies', async () => {
    const id = await createMatch(h);
    await save(id, [pt('A', 1)]);
    assert.equal((await h.db('points').where({ match_id: id }).first()).server_key, 'cap');
    await h.as('cap').patch(`/api/matches/${id}`).send({ lineups: lineup });
    assert.equal((await h.db('points').where({ match_id: id }).first()).server_key, 'bob');
  });
});

// QA bug A: a player credit must never be lost (or land on the other team).
describe('player credit persistence (QA bug A)', () => {
  const statsOf = async (id: string) => {
    const m = (await h.as('eve').get(`/api/matches/${id}`)).body;
    return m.events.filter((e: { playerId?: string }) => e.playerId).map((e: { side: string; playerId: string; kind: string }) => `${e.side}:${e.playerId}:${e.kind}`);
  };

  it('credit added after the tap (second save of the same rally) is stored', async () => {
    const id = await createMatch(h);
    await save(id, [pt('B', 1)]); // tap
    await save(id, [pt('B', 1, 'aarav', 'kill')]); // credit = rewrite of the last event
    assert.deepEqual(await statsOf(id), ['B:aarav:kill']);
    assert.equal((await h.db('points').where({ match_id: id }).first()).player_key, 'aarav');
  });

  it('credit survives a timeout in between, the end of the match, and undo of later rallies', async () => {
    const id = await createMatch(h);
    const to = { type: 'timeout', side: 'A', at: 2 };
    await save(id, [pt('B', 1), to]);
    await save(id, [pt('B', 1, 'aarav', 'kill'), to]);
    const win = [pt('B', 1, 'aarav', 'kill'), to, pt('B', 3), pt('B', 4), pt('B', 5), pt('B', 6, 'aarav', 'ace')];
    const fin = await save(id, win);
    assert.equal(fin.body.status, 'finished');
    assert.deepEqual(await statsOf(id), ['B:aarav:kill', 'B:aarav:ace']);
    await save(id, win.slice(0, -1)); // undo the winning rally
    assert.deepEqual(await statsOf(id), ['B:aarav:kill']);
  });

  // Fix re-test 212 #2: a credit with no shot type stays untyped end to end (no default to spike).
  it('a credit without a shot type is stored and returned without one; stats agree', async () => {
    const id = await createMatch(h);
    await save(id, [pt('B', 1, 'aarav'), pt('B', 2, 'aarav', 'kill')]);
    assert.deepEqual(await statsOf(id), ['B:aarav:undefined', 'B:aarav:kill']);
    const rows = await h.db('points').where({ match_id: id }).orderBy('seq');
    assert.deepEqual(rows.map((r: { kind: string | null }) => r.kind), [null, 'kill']);
    const m = (await h.as('eve').get(`/api/matches/${id}`)).body;
    assert.equal('kind' in m.events[0], false);
    const line = playerStats(m.rules, m.events, m.firstServe).aarav;
    assert.equal(line.points, 2);
    assert.equal(line.kill, 1); // one spike, matching the one 💥 in the timeline
  });

  it('a point cannot be credited to a player of the other team (the old stale-selection bug)', async () => {
    const id = await createMatch(h);
    const r = await save(id, [pt('A', 1, 'aarav', 'kill')]); // QA Spikers won the rally, Aarav plays for Delhi
    assert.equal(r.status, 400);
    assert.match(r.body.message, /not a player of team A/);
    assert.equal((await save(id, [pt('A', 1, 'ghost', 'kill')])).status, 400);
  });
});

// QA bug E: career stats from the API data must ignore unfinished matches.
describe('career stats from API data (QA bug E)', () => {
  it('counts only finished matches', async () => {
    const done = await createMatch(h);
    await save(done, [pt('A', 1, 'cap', 'kill'), pt('A', 2), pt('A', 3), pt('A', 4), pt('A', 5)]);
    const live = await createMatch(h);
    await save(live, [pt('A', 1, 'cap', 'ace')]);
    await createMatch(h, { status: 'scheduled' }); // unscored fixture
    const mine = (await h.as('cap').get('/api/matches?participant=cap')).body;
    assert.equal(mine.length, 3);
    const c = careerStats('cap', mine);
    assert.deepEqual([c.matches, c.wins, c.losses, c.points, c.kill, c.ace, c.winRate], [1, 1, 0, 1, 1, 0, 1]);
  });
});

// Registered players only (core/roster.ts): every player is a user, 12 max per team, nobody
// twice, MIN_PLAYERS (6) per team before scoring, and rosters lock at the first rally.
describe('registered players only', () => {
  const body = (a: readonly string[], b: readonly string[], over: Record<string, unknown> = {}) =>
    newMatchBody({ teamA: team('A side', playersOf(a)), teamB: team('B side', playersOf(b)), participantIds: [...new Set([...a, ...b, 'cap'])], ...over });
  const post = (b: object) => h.as('cap').post('/api/matches').send(b);

  it('rejects an unregistered player id', async () => {
    const r = await post(body([...SQUAD_A.slice(0, 5), 'ghost'], SQUAD_B, { status: 'scheduled' }));
    assert.equal(r.status, 400);
    assert.match(r.body.message, /Every player must be a registered VolleyLive user/);
  });

  it('rejects free-typed names and old guest ids', async () => {
    const typed = newMatchBody({ teamA: team('A side', [...playersOf(SQUAD_A.slice(0, 5)), { id: 'Rahul K', name: 'Rahul K' }]) });
    assert.equal((await post(typed)).status, 400);
    const guest = newMatchBody({ teamA: team('A side', [...playersOf(SQUAD_A.slice(0, 5)), { id: 'guest:1', name: 'Rahul' }]) });
    assert.equal((await post(guest)).status, 400);
  });

  it('player names and photos come from the users table, not the client', async () => {
    const forged = newMatchBody({ teamA: team('A side', SQUAD_A.map((id) => ({ id, name: 'Forged' }))) });
    const r = await post(forged);
    assert.equal(r.status, 201, JSON.stringify(r.body));
    const m = (await h.as('eve').get(`/api/matches/${r.body.id}`)).body;
    assert.deepEqual(m.teamA.players.map((p: { name: string }) => p.name), SQUAD_A.map((id) => PEOPLE[id].name));
    const rows = await h.db('match_players').where({ match_id: r.body.id });
    assert.ok(rows.every((x: { user_id: string; player_key: string }) => x.user_id === x.player_key));
  });

  it('rejects more than 12 players on a team', async () => {
    const thirteen = [...SQUAD_A, ...SQUAD_B, 'eve'];
    const r = await post(body(thirteen, [], { status: 'scheduled' }));
    assert.equal(r.status, 400);
  });

  it('rejects a player twice or on both teams', async () => {
    assert.equal((await post(body([...SQUAD_A.slice(0, 5), 'cap'], SQUAD_B))).status, 400);
    assert.equal((await post(body(SQUAD_A, [...SQUAD_B.slice(0, 5), 'cap']))).status, 400);
  });

  it('fewer than 6 players: can be scheduled, but scoring is blocked until the team has 6', async () => {
    const five = SQUAD_B.slice(0, 5);
    const live = await post(body(SQUAD_A, five));
    assert.equal(live.status, 403);
    assert.match(live.body.message, /Each team needs at least 6 players before scoring can start \[matches\.roster\.minPlayers\]/);
    const id = (await post(body(SQUAD_A, five, { status: 'scheduled', startedAt: null }))).body.id;
    assert.ok(id);
    assert.equal((await save(id, [pt('A', 1)])).status, 403);
    assert.equal((await h.as('cap').patch(`/api/matches/${id}`).send({ status: 'live' })).status, 403);
    // add the sixth player (before the first rally), then scoring works
    const fixed = await h.as('cap').patch(`/api/matches/${id}`).send({ teamB: team('B side', playersOf(SQUAD_B)), participantIds: [...SQUAD_A, ...SQUAD_B] });
    assert.equal(fixed.status, 200, JSON.stringify(fixed.body));
    assert.equal((await save(id, [pt('A', 1)])).status, 200);
  });

  it('rosters lock at the first rally (the scorer cannot rewrite players mid-match)', async () => {
    const id = await createMatch(h);
    await save(id, [pt('A', 1)]);
    const swap = [...SQUAD_A.slice(0, 5), 'eve'];
    const r = await h.as('cap').patch(`/api/matches/${id}`).send({ teamA: team('QA Spikers', playersOf(swap)), participantIds: [...swap, ...SQUAD_B, 'cap'] });
    assert.equal(r.status, 403);
    assert.match(r.body.message, /Players can only be changed before the first rally/);
  });

  it('a registered team side may only list members of that team', async () => {
    const t = await makeTeam(h, 'cap', SQUAD_A, 'QA Spikers');
    assert.equal((await post(newMatchBody({ teamA: team('QA Spikers', playersOf(SQUAD_A), t) }))).status, 201);
    const outsider = [...SQUAD_A.slice(0, 5), 'eve'];
    const r = await post(body(outsider, SQUAD_B, { teamA: team('QA Spikers', playersOf(outsider), t) }));
    assert.equal(r.status, 400);
    assert.match(r.body.message, /Not a member of team/);
    assert.equal((await post(newMatchBody({ teamA: team('QA Spikers', playersOf(SQUAD_A), 'no-such-team') }))).status, 400);
  });

  it('participantIds must be exactly both rosters plus the creator/scorer (QA retest #1)', async () => {
    // missing players (only the creator listed)
    const missing = await post(newMatchBody({ participantIds: ['cap'] }));
    assert.equal(missing.status, 400);
    assert.match(missing.body.message, /Participants must be the players of both teams/);
    // an outsider who isn't playing, scoring or creating
    assert.equal((await post(newMatchBody({ participantIds: [...SQUAD_A, ...SQUAD_B, 'eve'] }))).status, 400);
    // someone listed twice
    assert.equal((await post(newMatchBody({ participantIds: [...SQUAD_A, ...SQUAD_B, 'cap'] }))).status, 400);
    // the creator/scorer may be listed without playing
    const r = await h.as('eve').post('/api/matches').send(newMatchBody({ createdBy: 'eve', scorerId: 'eve', participantIds: [...SQUAD_A, ...SQUAD_B, 'eve'] }));
    assert.equal(r.status, 201, JSON.stringify(r.body));
    // a roster edit must bring participantIds along
    const id = (await post(newMatchBody({ status: 'scheduled', startedAt: null }))).body.id;
    const swap = [...SQUAD_B.slice(0, 5), 'eve'];
    assert.equal((await h.as('cap').patch(`/api/matches/${id}`).send({ teamB: team('B', playersOf(swap)) })).status, 400);
    assert.equal((await h.as('cap').patch(`/api/matches/${id}`).send({ teamB: team('B', playersOf(swap)), participantIds: [...SQUAD_A, ...swap] })).status, 200);
    // participantIds alone can't add an outsider either
    assert.equal((await h.as('cap').patch(`/api/matches/${id}`).send({ participantIds: [...SQUAD_A, ...swap, 'zed'] })).status, 400);
  });

  it('stores participantIds in the order the Firestore rules require, whatever order is sent (fix-retest #5)', async () => {
    // B's players first, then A's: accepted (same set) but stored and returned as A, B, creator.
    const r = await h.as('eve').post('/api/matches').send(newMatchBody({ createdBy: 'eve', scorerId: 'eve', participantIds: ['eve', ...[...SQUAD_B].reverse(), ...SQUAD_A] }));
    assert.equal(r.status, 201, JSON.stringify(r.body));
    const got = (await h.as('eve').get(`/api/matches/${r.body.id}`)).body;
    assert.deepEqual(got.participantIds, [...SQUAD_A, ...SQUAD_B, 'eve']);
    // a PATCH with a shuffled list is normalised too
    const p = await h.as('eve').patch(`/api/matches/${r.body.id}`).send({ participantIds: [...SQUAD_B, 'eve', ...SQUAD_A] });
    assert.equal(p.status, 200, JSON.stringify(p.body));
    assert.deepEqual((await h.as('eve').get(`/api/matches/${r.body.id}`)).body.participantIds, [...SQUAD_A, ...SQUAD_B, 'eve']);
  });
});

describe('legacy matches left short of players by migration 0002 (QA retest #2)', () => {
  /** A live match with a rally, then (as 0002 did) players removed straight from the database. */
  async function stuckMatch(events = [pt('A', 1)]) {
    const id = await createMatch(h);
    if (events.length) assert.equal((await save(id, events)).status, 200);
    await h.db('match_players').where({ match_id: id }).whereIn('player_key', ['b5', 'b6']).del();
    await h.db('match_participants').where({ match_id: id }).whereIn('user_id', ['b5', 'b6']).del();
    return id;
  }

  it('cannot be scored, but the scorer can abandon it', async () => {
    const id = await stuckMatch();
    assert.equal((await save(id, [pt('A', 1), pt('B', 2)])).status, 403);
    const r = await h.as('cap').patch(`/api/matches/${id}`).send({ status: 'abandoned' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.status, 'abandoned');
    // still no scoring after that (1.3.0: abandoned is terminal -> 409 match_terminal)
    const again = await save(id, [pt('A', 1), pt('B', 2)]);
    assert.equal(again.status, 409);
    assert.equal(again.body.error, 'match_terminal');
  });

  it('abandoning is the only relaxation: not by others, not together with other changes', async () => {
    const id = await stuckMatch();
    assert.equal((await h.as('bob').patch(`/api/matches/${id}`).send({ status: 'abandoned' })).status, 403);
    assert.equal((await h.as('cap').patch(`/api/matches/${id}`).send({ status: 'abandoned', title: 'x' })).status, 403);
    assert.equal((await h.as('cap').patch(`/api/matches/${id}`).send({ status: 'finished' })).status, 403);
  });

  it('handover and "I want to play" still work on it (as in the rules)', async () => {
    const id = await stuckMatch();
    assert.equal((await h.as('eve').patch(`/api/matches/${id}`).send({ interestedIds: ['eve'] })).status, 200);
    assert.equal((await h.as('cap').patch(`/api/matches/${id}`).send({ scorerId: 'bob' })).status, 200);
  });

  it('before the first rally the scorer can put it back to scheduled, or complete the players', async () => {
    const a = await stuckMatch([]);
    assert.equal((await h.as('cap').patch(`/api/matches/${a}`).send({ status: 'scheduled' })).status, 200);
    const b = await stuckMatch([]);
    const r = await h.as('cap').patch(`/api/matches/${b}`).send({ teamB: team('Delhi Smashers', playersOf(SQUAD_B)), participantIds: [...SQUAD_A, ...SQUAD_B] });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal((await save(b, [pt('A', 1)])).status, 200);
  });
});

describe('migration 0003 (QA retest #3)', () => {
  it('clears credits to ids that are no longer players of the match and is idempotent', async () => {
    const id = await createMatch(h);
    assert.equal((await save(id, [pt('A', 1, 'cap', 'ace'), pt('B', 2, 'dan', 'kill'), pt('A', 3)])).status, 200);
    // what 0002 left behind: a guest credit and a guest server on old rallies
    await h.db('points').where({ match_id: id, seq: 0 }).update({ player_key: 'guest:a0', server_key: 'guest:a0' });
    const rerun = async () => {
      await h.db('schema_migrations').where({ version: '0003_uncredit_removed_players.sql' }).del();
      assert.deepEqual(await migrate(h.db), ['0003_uncredit_removed_players.sql']);
    };
    await rerun();
    const rows = await h.db('points').where({ match_id: id }).orderBy('seq');
    assert.equal(rows[0].player_key, null);
    assert.equal(rows[0].server_key, null);
    assert.equal(rows[0].kind, 'ace'); // the rally and its shot type stay
    assert.equal(rows[1].player_key, 'dan'); // valid credits untouched
    assert.equal(rows.length, 3); // no rally deleted
    const m = (await h.as('eve').get(`/api/matches/${id}`)).body;
    assert.equal(m.events[0].playerId, undefined);
    assert.deepEqual([m.summary.currentA, m.summary.currentB], [2, 1]);
    await rerun(); // running it again changes nothing
    assert.deepEqual(await h.db('points').where({ match_id: id }).orderBy('seq'), rows);
  });
});

