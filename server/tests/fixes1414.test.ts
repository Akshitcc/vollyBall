/**
 * 1.4.14 server: V1413-4 – a player on both rosters can't give the verdict. The API stores one row per (match, player)
 * (match_players unique key), so a player can't be on both sides here at all; the confirm itself uses core confirmProblem
 * (core tests cover the both-rosters case).
 */
import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import { EVERYONE, createMatch, register, startHarness, type Harness } from './helpers';

let h: Harness;
before(async () => (h = await startHarness()));
after(async () => h.close());
beforeEach(async () => {
  await h.reset();
  await register(h, ...EVERYONE);
});

describe('V1413-4 (API): no player on both rosters', () => {
  it('a second row for the same player on the other side is refused by the schema', async () => {
    const id = await createMatch(h, { title: 'V1413-4', location: null });
    const row = await h.db('match_players').where({ match_id: id, side: 'B' }).first();
    assert.ok(row);
    await assert.rejects(h.db('match_players').insert({ ...row, side: 'A', sort_order: 99 }));
    const n = await h.db('match_players').where({ match_id: id, player_key: row.player_key }).count({ c: '*' }).first();
    assert.equal(Number(n!.c), 1);
  });
});

describe('V1415-1 (API, 1.4.16): 13 on a side is refused with the size message', () => {
  it('PATCH with 13 players on team A → 400 "at most 12", nothing stored', async () => {
    const id = await createMatch(h, { title: 'V1415-1', location: null });
    const m = (await h.as('cap').get(`/api/matches/${id}`)).body;
    const players = [...m.teamA.players, ...Array.from({ length: 13 - m.teamA.players.length }, (_, i) => ({ id: `x${i}`, name: `X${i}` }))];
    const r = await h.as('cap').patch(`/api/matches/${id}`).send({ teamA: { ...m.teamA, players } });
    assert.equal(r.status, 400, JSON.stringify(r.body));
    assert.match(JSON.stringify(r.body), /at most 12/);
    const n = await h.db('match_players').where({ match_id: id, side: 'A' }).count({ c: '*' }).first();
    assert.equal(Number(n!.c), m.teamA.players.length);
  });
});
