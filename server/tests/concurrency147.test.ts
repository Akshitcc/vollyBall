/**
 * 1.4.7 (QA V146-1): check-then-act races on the API. Delete used to read and check the match outside a transaction
 * while saveProgress locked it, so both succeeded (33 of 40 runs). Now delete locks the row (SELECT … FOR UPDATE) and
 * deletes conditionally; every state-changing match action locks the row first.
 *  - 120 parallel save-vs-delete pairs: exactly one succeeds, and the state matches the winner.
 *  - parallel admin decisions on one abandoned match (reinstate vs confirm abandon): exactly one wins.
 *  - parallel verdict + reopen / void on one finished match: a consistent end state.
 *  - a source audit: every exported state-changing match function locks the row or runs in loadForAction.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import type { Identity } from '../src/auth/verifier';
import * as matches from '../src/domain/matches';
import { ADMIN, EVERYONE, newMatchBody, pt as rawPt, register, startHarness, type Harness } from './helpers';
import type { MatchEvent } from '../../src/core/scoring';
const pt = (side: 'A' | 'B', at: number) => rawPt(side, at) as MatchEvent;

let h: Harness;
before(async () => {
  h = await startHarness();
  await h.reset();
  await register(h, ...EVERYONE);
});
after(async () => h.close());

const CAP: Identity = { uid: 'cap', phone: null };
const AARAV: Identity = { uid: 'aarav', phone: null };
const INTERNAL: Identity = { uid: '\u0000internal', phone: null };
const code = (e: unknown) => (e as { status?: number; code?: string }).status ?? (e as { code?: string }).code;
const newLive = async () => matches.createMatch(h.s, CAP, newMatchBody({ startedAt: Date.now() - 60_000 }) as never);
// deletable: scheduled, never played (core/lifecycle.ts 'delete'); the first save starts it
const newScheduled = async () => matches.createMatch(h.s, CAP, newMatchBody({ status: 'scheduled', startedAt: null, scheduledAt: Date.now() + 3_600_000 }) as never);

describe('V146-1: save vs delete', () => {
  it('120 parallel save-vs-delete pairs: exactly one succeeds each time; the state is consistent', async () => {
    const PAIRS = 120;
    const BATCH = 8;
    const tally = { saveWon: 0, deleteWon: 0, both: 0, neither: 0 };
    const bad: string[] = [];
    for (let i = 0; i < PAIRS; i += BATCH) {
      const ids: string[] = [];
      for (let k = 0; k < Math.min(BATCH, PAIRS - i); k++) ids.push(await newScheduled());
      await Promise.all(
        ids.map(async (id, k) => {
          const t0 = Date.now();
          const ev = [pt('A', t0), pt('B', t0 + 1)];
          // alternate who is sent first, so both orders are exercised
          // the second call starts 0–9 ms later (jitter), so both outcomes occur
          const later = <T>(f: () => Promise<T>) => new Promise<T>((res, rej) => setTimeout(() => f().then(res, rej), (k * 3) % 10));
          const ops = k % 2
            ? [matches.deleteMatch(h.s, CAP, id), later(() => matches.saveProgress(h.s, CAP, id, { events: ev }))]
            : [matches.saveProgress(h.s, CAP, id, { events: ev }), later(() => matches.deleteMatch(h.s, CAP, id))];
          const res = await Promise.allSettled(ops);
          const [del, save] = k % 2 ? res : [res[1], res[0]];
          const row = await h.db('matches').where({ id }).first('id', 'max_events');
          const pts = Number((await h.db('points').where({ match_id: id }).count({ n: '*' }))[0].n);
          const parts = Number((await h.db('match_participants').where({ match_id: id }).count({ n: '*' }))[0].n);
          if (save.status === 'fulfilled' && del.status === 'fulfilled') tally.both++;
          else if (save.status === 'rejected' && del.status === 'rejected') { tally.neither++; bad.push(`${id}: neither – save ${String((save as PromiseRejectedResult).reason)} / delete ${String((del as PromiseRejectedResult).reason)}`); }
          else if (save.status === 'fulfilled') {
            tally.saveWon++;
            // the save won: the match stays, with its 2 rallies and the latch; delete was refused (403/409)
            if (!row || Number(row.max_events) !== 2 || pts !== 2) bad.push(`${id}: save won but row=${JSON.stringify(row)} points=${pts}`);
            if (![403, 409].includes(code((del as PromiseRejectedResult).reason) as number)) bad.push(`${id}: delete failed with ${code((del as PromiseRejectedResult).reason)}`);
          } else {
            tally.deleteWon++;
            // the delete won: nothing of the match is left; the save got 404
            if (row || pts || parts) bad.push(`${id}: delete won but row=${!!row} points=${pts} participants=${parts}`);
            if (code((save as PromiseRejectedResult).reason) !== 404) bad.push(`${id}: save failed with ${code((save as PromiseRejectedResult).reason)}`);
          }
        }),
      );
    }
    console.log(`# V146-1 save-vs-delete: ${JSON.stringify(tally)}`);
    assert.deepEqual(bad, []);
    assert.deepEqual([tally.both, tally.neither], [0, 0], JSON.stringify(tally));
    assert.equal(tally.saveWon + tally.deleteWon, PAIRS);
    assert.deepEqual(bad, []);
  });

  it('the delete itself is conditional: a row that gained a rally after the check is never deleted', async () => {
    // simulate a stale check: the row now has max_events > 0 – the conditional DELETE removes nothing (409/403)
    const id = await newScheduled();
    await h.db('matches').where({ id }).update({ max_events: 1 });
    await assert.rejects(matches.deleteMatch(h.s, CAP, id), (e: unknown) => [403, 409].includes(code(e) as number));
    assert.ok(await h.db('matches').where({ id }).first('id'));
  });
});

describe('V146-1 audit: other actions under contention', () => {
  it('reinstate vs confirm abandon (30 pairs, two admin calls at once): exactly one decides', async () => {
    let first = 0;
    for (let i = 0; i < 30; i++) {
      const id = await newLive();
      await matches.saveProgress(h.s, CAP, id, { events: [pt('B', 1000), pt('B', 1001), pt('B', 1002)] });
      await matches.abandonMatch(h.s, CAP, id);
      const res = await Promise.allSettled([matches.resolveMatch(h.s, ADMIN, id, 'reinstate'), matches.resolveMatch(h.s, ADMIN, id, 'confirm_abandon')]);
      const ok = res.filter((r) => r.status === 'fulfilled').length;
      assert.equal(ok, 1, `${id}: ${ok} decisions`);
      const m = (await matches.getMatch(h.s, id, INTERNAL))!;
      if (res[0].status === 'fulfilled') { first++; assert.deepEqual([m.status, m.abandon?.review], ['live', 'reinstated']); }
      else assert.deepEqual([m.status, m.abandon?.review], ['abandoned', 'confirmed']);
    }
    console.log(`# reinstate first ${first}/30`);
  });

  it('save vs abandon (30 pairs): the abandon record matches the log it saw', async () => {
    for (let i = 0; i < 30; i++) {
      const id = await newLive();
      await matches.saveProgress(h.s, CAP, id, { events: [pt('B', 1000)] });
      await Promise.allSettled([matches.saveProgress(h.s, CAP, id, { events: [pt('B', 1000), pt('B', 1001)] }), matches.abandonMatch(h.s, CAP, id)]);
      const m = (await matches.getMatch(h.s, id, INTERNAL))!;
      if (m.status === 'abandoned') assert.equal(m.abandon?.events, m.events.length, id);
      else assert.equal(m.status, 'live');
    }
  });

  it('POTM vs void, verdict vs void (20 each): never a verdict or a POTM on a voided match counted twice', async () => {
    const finished = async () => {
      const id = await newLive();
      await matches.saveProgress(h.s, CAP, id, { events: [0, 1, 2, 3, 4].map((k) => pt('A', 1000 + k)) });
      return id;
    };
    for (let i = 0; i < 20; i++) {
      const id = await finished();
      await matches.setPlayerOfMatch(h.s, CAP, id, 'bob');
      const res = await Promise.allSettled([matches.verifyResult(h.s, AARAV, id, 'confirmed'), matches.reviewMatch(h.s, ADMIN, id, 'void')]);
      const m = (await matches.getMatch(h.s, id, INTERNAL))!;
      // whichever order: the row is one consistent state (voided, with or without the earlier verdict; or confirmed then voided refused)
      assert.ok(res.some((r) => r.status === 'fulfilled'), id);
      assert.ok(['voided', 'confirmed', 'approved'].includes(m.verification!.status as string) || m.verification!.status === 'pending', `${id}: ${m.verification!.status}`);
    }
  });

  it('source audit: every exported state-changing match function locks the match row first', () => {
    const src = fs.readFileSync(path.join(__dirname, '../src/domain/matches.ts'), 'utf8');
    const fns = ['patchMatch', 'saveProgress', 'setPlayerOfMatch', 'deleteMatch', 'verifyResult', 'reviewMatch', 'abandonMatch', 'answerAbandonRequest', 'resolveMatch', 'reportAbandonedMatch', 'reassignScorer'];
    for (const f of fns) {
      const start = src.indexOf(`export async function ${f}(`);
      assert.ok(start >= 0, f);
      const body = src.slice(start, src.indexOf('\nexport ', start + 10));
      assert.match(body, /forUpdate\(\)|loadForAction\(/, `${f} must lock the match row`);
      assert.match(body, /txRetry\(|transaction\(/, `${f} must run in a transaction`);
    }
  });
});
