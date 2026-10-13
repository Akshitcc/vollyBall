/**
 * 1.4.12 server: V1411-2 – a rename or a display-name change on an older captain-mix match (team B's captain is a
 * team-A player) is allowed (the captain check runs only when the captains or the player ids change); a roster or
 * captain change there is still checked.
 */
import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import { EVERYONE, createMatch, playersOf, register, startHarness, team, type Harness } from './helpers';

let h: Harness;
before(async () => (h = await startHarness()));
after(async () => h.close());
beforeEach(async () => {
  await h.reset();
  await register(h, ...EVERYONE);
});
const SQUAD_A = ['cap', 'bob', 'a3', 'a4', 'a5', 'a6'];
const SQUAD_B = ['aarav', 'dan', 'b3', 'b4', 'b5', 'b6'];
const sched = { status: 'scheduled', startedAt: null, scheduledAt: Date.now() + 86_400_000 };

describe('V1411-2 (API): captain-mix match (captain B on team A)', () => {
  async function capmix() {
    const id = await createMatch(h, sched);
    await h.db('matches').where({ id }).update({ captain_b: 'bob' });
    return id;
  }
  it('a rename passes (200), the stored captains are kept', async () => {
    const id = await capmix();
    const r = await h.as('cap').patch(`/api/matches/${id}`).send({ teamA: team('Renamed Spikers', playersOf(SQUAD_A)) });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.teamA.name, 'Renamed Spikers');
    assert.deepEqual(r.body.captains, { A: 'cap', B: 'bob' });
  });
  it('a player display-name change passes (same ids)', async () => {
    const id = await capmix();
    const ps = playersOf(SQUAD_B).map((p, i) => (i === 2 ? { ...p, name: 'Renamed Player' } : p));
    const r = await h.as('cap').patch(`/api/matches/${id}`).send({ teamB: team('Delhi Smashers', ps) });
    assert.equal(r.status, 200, JSON.stringify(r.body));
  });
  it('a rename that resends the same captains (any key order) and participants passes', async () => {
    const id = await capmix();
    for (const captains of [{ A: 'cap', B: 'bob' }, { B: 'bob', A: 'cap' }]) {
      const r = await h.as('cap').patch(`/api/matches/${id}`).send({ title: 'x', teamA: team('Renamed Spikers', playersOf(SQUAD_A)), teamB: team('Delhi Smashers', playersOf(SQUAD_B)), captains, participantIds: [...SQUAD_A, ...SQUAD_B] });
      assert.equal(r.status, 200, JSON.stringify(r.body));
    }
  });
  it('a roster reorder or a captain change is still checked', async () => {
    const id = await capmix();
    const b = [...SQUAD_B].reverse();
    const r = await h.as('cap').patch(`/api/matches/${id}`).send({ teamB: team('Delhi Smashers', playersOf(b)), participantIds: [...SQUAD_A, ...b] });
    assert.deepEqual([r.status, r.body.error], [400, 'captain_not_on_side']);
    const c = await h.as('cap').patch(`/api/matches/${id}`).send({ captains: { A: 'cap', B: 'a3' } });
    assert.equal(c.status, 400);
  });
});
