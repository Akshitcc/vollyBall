/**
 * 1.3.2 tap-a-player scoring on the API backend: a chip tap is ONE point event carrying playerId; only
 * the assigned scorer may write it; the credit must belong to the scoring team; undo (dropping the last
 * event) removes the team point and the player credit together; a team-only point stores no player.
 */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { createMatch, pt, register, startHarness, type Harness, EVERYONE } from './helpers';

let h: Harness;
before(async () => {
  h = await startHarness();
  await register(h, ...EVERYONE);
});
after(async () => h.close());

describe('tap a player to score (1.3.2)', () => {
  it('only the scorer can save a tapped point', async () => {
    const id = await createMatch(h);
    for (const who of ['bob', 'aarav', 'eve'] as const) {
      const r = await h.as(who).put(`/api/matches/${id}/progress`).send({ events: [pt('A', 1, 'bob')] });
      assert.equal(r.status, 403, `${who} should be refused`);
    }
    const ok = await h.as('cap').put(`/api/matches/${id}/progress`).send({ events: [pt('A', 1, 'bob')] });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    const doc = (await h.as('eve').get(`/api/matches/${id}`)).body;
    assert.equal(doc.summary.currentA, 1);
    assert.deepEqual(doc.events.map((e: { playerId?: string }) => e.playerId), ['bob']);
  });

  it('rejects a credit to a player of the other team (or nobody on the roster)', async () => {
    const id = await createMatch(h);
    for (const bad of ['aarav', 'eve']) {
      const r = await h.as('cap').put(`/api/matches/${id}/progress`).send({ events: [pt('A', 1, bad)] });
      assert.equal(r.status, 400, `${bad}: ${r.status}`);
    }
  });

  it('team-only point stores no credit; undo removes the team point and the player credit together', async () => {
    const id = await createMatch(h);
    const two = [pt('B', 1, 'aarav'), pt('A', 2)];
    assert.equal((await h.as('cap').put(`/api/matches/${id}/progress`).send({ events: two })).status, 200);
    const rows = await h.db('points').where({ match_id: id }).orderBy('seq');
    assert.equal(rows.length, 2);
    assert.equal(rows[0].player_key, 'aarav');
    assert.equal(rows[1].player_key ?? null, null);
    // undo the team point, then the tapped point
    assert.equal((await h.as('cap').put(`/api/matches/${id}/progress`).send({ events: two.slice(0, 1) })).status, 200);
    assert.equal((await h.as('cap').put(`/api/matches/${id}/progress`).send({ events: [] })).status, 200);
    assert.equal((await h.db('points').where({ match_id: id }).count({ n: '*' }))[0].n, 0);
    const doc = (await h.as('eve').get(`/api/matches/${id}`)).body;
    assert.deepEqual([doc.summary.currentA, doc.summary.currentB], [0, 0]);
  });
});
