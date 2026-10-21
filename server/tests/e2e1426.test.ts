/** 1.4.26: Tester's E2E on 1.4.25 – E2E-2 (played fixtures are locked) and E2E-3 (fixture readiness / teams). */
import assert from 'node:assert/strict';
import { after, before, it } from 'node:test';
import { playSets, type ClientFor } from '../scripts/auditSim';
import { AUDIT_RULES, clientFor, liftLimits, makeWorld } from './auditHelpers';
import { startHarness, type Harness } from './helpers';

let h: Harness;
let c: ClientFor;
before(async () => { h = await startHarness(); liftLimits(h.s.rateLimiter!); c = clientFor(h); });
after(async () => { await h.close(); });

type Fx = { id: string; homeId: string | null; awayId: string | null; homeFrom?: string; matchId?: string };

it('E2E-2: once its match has a result a fixture keeps its teams and match (409 fixture_locked); others stay editable', async () => {
  const w = await makeWorld(c, 'lk', 9400000000, 'league');
  const tid = await w.tournament();
  const t = (await w.as(w.org)('GET', `/api/tournaments/${tid}`)).body;
  const f: Fx = t.fixtures[0];
  const { doc, players } = await w.matchDoc(f.homeId!, f.awayId!, { tournamentId: tid, fixtureId: f.id });
  const mid = (await w.as(w.org)('POST', '/api/matches', doc)).body.id;
  assert.equal((await w.put(mid, playSets(AUDIT_RULES, ['A', 'A'], players))).body.status, 'finished');
  const cur: Fx[] = (await w.as(w.org)('GET', `/api/tournaments/${tid}`)).body.fixtures;
  const other = w.teams.find((x) => x !== f.homeId && x !== f.awayId)!;
  const swap = await w.as(w.org)('PATCH', `/api/tournaments/${tid}`, { fixtures: cur.map((x) => (x.id === f.id ? { ...x, homeId: other } : x)) });
  assert.deepEqual([swap.status, swap.body.error], [409, 'fixture_locked']);
  const drop = await w.as(w.org)('PATCH', `/api/tournaments/${tid}`, { fixtures: cur.filter((x) => x.id !== f.id) });
  assert.equal(drop.status, 409);
  // an unplayed fixture can still be rearranged
  const g = cur.find((x) => x.id !== f.id)!;
  const ok = await w.as(w.org)('PATCH', `/api/tournaments/${tid}`, { fixtures: cur.map((x) => (x.id === g.id ? { ...x, homeId: x.awayId, awayId: x.homeId } : x)) });
  assert.equal(ok.status, 200);
});

it('E2E-3: a knockout fixture can start only when both feeders are decided, with exactly its two teams', async () => {
  const w = await makeWorld(c, 'rd', 9410000000, 'knockout'); // 3 teams: R1 = one match + a bye, R2 = final
  const tid = await w.tournament();
  const t = (await w.as(w.org)('GET', `/api/tournaments/${tid}`)).body;
  const final: Fx = t.fixtures.find((x: Fx) => x.homeFrom);
  const semi: Fx = t.fixtures.find((x: Fx) => x.homeId && x.awayId);
  const { doc: early } = await w.matchDoc(w.teams[0], w.teams[1], { tournamentId: tid, fixtureId: final.id });
  assert.deepEqual([(await w.as(w.org)('POST', '/api/matches', early)).body.error], ['fixture_not_ready']);
  const { doc: wrong } = await w.matchDoc(semi.awayId!, semi.homeId!, { tournamentId: tid, fixtureId: semi.id }); // sides swapped
  assert.equal((await w.as(w.org)('POST', '/api/matches', wrong)).body.error, 'fixture_teams');
  const { doc, players } = await w.matchDoc(semi.homeId!, semi.awayId!, { tournamentId: tid, fixtureId: semi.id });
  const mid = (await w.as(w.org)('POST', '/api/matches', doc)).body.id;
  assert.equal((await w.put(mid, playSets(AUDIT_RULES, ['A', 'A'], players))).body.status, 'finished');
  const bye: Fx = t.fixtures.find((x: Fx) => !x.homeFrom && (!x.homeId || !x.awayId));
  const byeTeam = bye.homeId ?? bye.awayId;
  const [home, away] = final.homeFrom === semi.id ? [semi.homeId!, byeTeam!] : [byeTeam!, semi.homeId!];
  const { doc: fin } = await w.matchDoc(home, away, { tournamentId: tid, fixtureId: final.id });
  const r = await w.as(w.org)('POST', '/api/matches', fin);
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal((await w.as(w.org)('POST', '/api/matches', fin)).body.error, 'fixture_taken'); // one match per fixture
});
