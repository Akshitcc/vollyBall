/**
 * 1.4.6 (QA V145 general): the API walks the one lifecycle (core/lifecycle.ts) – every action in LC_WALK, in every
 * state of LC_STATES, as every walker, succeeds exactly when the table allows it. Each cell gets a fresh match; the
 * state is built by the API's own scoring (events) plus the lifecycle columns written as fixtures. Runs under the
 * current ABANDON_POLICY (scripts/run-policy-suites.sh runs all three).
 */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { walkRepairFix } from '../../src/core/verdictRepair';
import { LC_NOT_ON, LC_STATES, LC_WALK, LC_WALKERS, walkExpect, walkFields, walkSkip, type LcAction, type LcStateSpec } from '../../src/core/lifecycle';
import { ABANDON_POLICY } from '../../src/core/abandonPolicy';
import { sideOfPlayer, verdictCaptains } from '../../src/core/antifraud';
import type { Match } from '../../src/core/types';
import type { Identity } from '../src/auth/verifier';
import * as matches from '../src/domain/matches';
import { ADMIN, EVERYONE, newMatchBody, register, startHarness, type Harness } from './helpers';

let h: Harness;
before(async () => {
  h = await startHarness();
  await h.reset();
  await register(h, ...EVERYONE);
});
after(async () => h.close());

const CAST = { scorer: 'cap', oppCaptain: 'aarav', bPlayer: 'dan', pastAdmin: 'adm2', teammate: 'bob' };
const WHO: Record<(typeof LC_WALKERS)[number], Identity> = {
  scorer: { uid: 'cap', phone: null },
  oppCaptain: { uid: 'aarav', phone: null },
  teammate: { uid: 'bob', phone: null },
  admin: ADMIN,
  stranger: { uid: 'eve', phone: null },
};
const INTERNAL: Identity = { uid: '\u0000internal', phone: null };

async function build(spec: LcStateSpec): Promise<string> {
  const t0 = Date.now() - 600_000;
  const f = walkFields(spec, CAST, t0);
  const scheduled = spec.status === 'scheduled';
  const id = await matches.createMatch(h.s, WHO.scorer, newMatchBody(scheduled ? { status: 'scheduled', startedAt: null, scheduledAt: Date.now() + 86_400_000 } : { startedAt: t0 - 1000 }) as never);
  if (f.events!.length) await matches.saveProgress(h.s, WHO.scorer, id, { events: f.events! });
  const ended = spec.status === 'finished' || spec.status === 'abandoned';
  const row: Record<string, unknown> = {
    status: spec.status,
    max_events: spec.maxEvents,
    was_won: f.wasWon ? 1 : 0,
    player_of_match_id: f.playerOfMatchId ?? null,
    finished_at: ended ? new Date(t0 + 60_000) : null,
    abandon_info: f.abandon ? JSON.stringify(f.abandon) : null,
  };
  if (f.scorerId) row.scorer_id = f.scorerId; // 1.4.8 (V147-2): older data nobody can confirm
  if (f.captains) Object.assign(row, { captain_a: f.captains.A, captain_b: f.captains.B }); // 1.4.13 (V1412-1): captain mix
  if (f.verification) Object.assign(row, { verification_status: 'confirmed', captain_verdict: 'confirmed', verified_by: CAST.oppCaptain, verified_at: new Date(t0 + 60_000) });
  await h.db('matches').where({ id }).update(row);
  return id;
}

function act(a: LcAction, v: Identity, id: string, m?: never): Promise<unknown> {
  switch (a) {
    case 'delete': return matches.deleteMatch(h.s, v, id);
    case 'unschedule': return matches.patchMatch(h.s, v, id, { status: 'scheduled' });
    case 'editSetup': return matches.patchMatch(h.s, v, id, { firstServe: 'B' });
    case 'abandon': return matches.abandonMatch(h.s, v, id);
    case 'report': return matches.reportAbandonedMatch(h.s, v, id);
    case 'confirmAbandon': return matches.resolveMatch(h.s, v, id, 'confirm_abandon');
    case 'reinstate': return matches.resolveMatch(h.s, v, id, 'reinstate');
    case 'reopen': return matches.resolveMatch(h.s, v, id, 'reopen');
    case 'adminAbandon': return matches.resolveMatch(h.s, v, id, 'abandon');
    case 'void': return matches.reviewMatch(h.s, v, id, 'void');
    case 'verdict': return matches.verifyResult(h.s, v, id, 'confirmed');
    case 'repairVerdict': return matches.repairVerdict(h.s, v, id, m ? walkRepairFix(m, CAST.scorer) : { scorerId: CAST.scorer }); // 1.4.13: a captain fix on capMix
    default: throw new Error(a);
  }
}

describe('1.4.6 API lifecycle walk', () => {
  it('the API accepts each walk cell exactly when the lifecycle table allows it (and the fixtures are what the table means)', async () => {
    const bad: string[] = [];
    let n = 0;
    for (const spec of LC_STATES) {
      // the built state reads back as the spec (the API's own facts, not the fixture's)
      const probe = (await matches.getMatch(h.s, await build(spec), INTERNAL)) as never as { status: string; maxEvents: number; wasWon: boolean };
      assert.deepEqual([probe.status, probe.maxEvents, probe.wasWon], [spec.status, spec.maxEvents, !!spec.wasWon], spec.name);
      for (const a of LC_WALK) {
        if (LC_NOT_ON.api.includes(a) || walkSkip(spec, a)) continue;
        for (const w of LC_WALKERS) {
          const id = await build(spec);
          const m = (await matches.getMatch(h.s, id, INTERNAL)) as never;
          const v = WHO[w];
          const why = walkExpect(a, m, v.uid, w === 'admin', ABANDON_POLICY);
          let err: unknown = null;
          const got = await act(a, v, id, m).then(() => true, (e) => ((err = e), false));
          n++;
          // QA AF-45: the same captain replaying the same verdict is an idempotent no-op (nothing is written)
          const replay = a === 'verdict' && why === 'already_reviewed' && (m as { verification?: { by?: string } }).verification?.by === v.uid;
          if (replay && got) {
            assert.equal((await matches.getMatch(h.s, id, INTERNAL))!.updatedAt, (m as { updatedAt: number }).updatedAt, `${spec.name}: replay wrote`);
            continue;
          }
          if (got !== (why === null)) bad.push(`${spec.name} ${a} as ${w}: API ${got ? 'allows' : `refuses (${(err as { code?: string })?.code ?? err})`}, lifecycle ${why === null ? 'allows' : why}`);
        }
      }
    }
    assert.deepEqual(bad, []);
    assert.equal(n, (LC_STATES.length * (LC_WALK.length - LC_NOT_ON.api.length) - LC_STATES.filter((x) => walkSkip(x, 'unschedule')).length) * LC_WALKERS.length);
  });
});

describe('1.4.7 (QA V146-2/3): the verdict invariant on the API', () => {
  const broken = (m: Match): string | null => {
    const caps = verdictCaptains(m);
    if (!caps.length) return 'no verdict captain';
    const ss = sideOfPlayer(m, m.scorerId);
    return caps.includes(m.scorerId) || caps.some((c) => ss !== null && sideOfPlayer(m, c) === ss) ? `scorer ${m.scorerId} on the verdict side` : null;
  };
  it('every walk state has a verdict captain, and every scorer change the API accepts keeps one (off the scorer\'s side)', async () => {
    const bad: string[] = [];
    let changes = 0;
    const targets = ['cap', 'bob', 'a3', 'aarav', 'dan', 'b3', 'eve', ADMIN.uid];
    for (const spec of LC_STATES.filter((x) => !x.noConfirmer && !x.captainMix)) { // (1.4.8: noConfirm* = older data, repaired by an admin)
      const m0 = (await matches.getMatch(h.s, await build(spec), INTERNAL)) as never as Match;
      const p0 = broken(m0);
      if (p0) bad.push(`${spec.name}: ${p0}`);
      for (const to of targets) {
        for (const how of ['handover', 'reassign'] as const) {
          const id = await build(spec);
          const ok = await (how === 'handover' ? matches.patchMatch(h.s, WHO.scorer, id, { scorerId: to } as never) : matches.reassignScorer(h.s, ADMIN, id, to)).then(() => true, () => false);
          if (!ok) continue;
          changes++;
          const m = (await matches.getMatch(h.s, id, INTERNAL)) as never as Match;
          const p = broken(m);
          if (p) bad.push(`${spec.name} ${how}→${to}: ${p}`);
        }
      }
    }
    assert.deepEqual(bad, []);
    assert.ok(changes > 10, String(changes));
  });
});

describe('1.4.6 (V145-17): GET /matches/:id/handoff-admins', () => {
  it('the creator / scorer gets the admins who may take over (not the scorer, not a verdict captain); others 403', async () => {
    const id = await build(LC_STATES.find((x) => x.name === 'live3')!);
    await h.db('users').insert({ id: ADMIN.uid, name: 'Admin Person', phone: '+919000000099', created_at: new Date(), updated_at: new Date() }).onConflict('id').merge();
    const r = await h.as('cap').get(`/api/matches/${id}/handoff-admins`);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.deepEqual(r.body, [{ id: ADMIN.uid, name: 'Admin Person' }]);
    assert.equal((await h.as('bob').get(`/api/matches/${id}/handoff-admins`)).status, 403);
    assert.equal((await h.as('eve').get(`/api/matches/${id}/handoff-admins`)).status, 403);
    // and the handoff itself goes through after the first rally
    const ho = await h.as('cap').patch(`/api/matches/${id}`).send({ scorerId: ADMIN.uid });
    assert.equal(ho.status, 200, JSON.stringify(ho.body));
  });
});
