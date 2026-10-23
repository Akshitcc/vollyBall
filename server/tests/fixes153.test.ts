/**
 * 1.5.3 Tester "1.5.2 retest": F152-4 (a former captain / member / the wrong side declining or cancelling a pending
 * challenge gets 403 challenge_not_captain, same as accept) and F152-3 (the Ask index re-syncs the corrected
 * "Flagged for review" / "disputed" FAQ EN + HI). LOCAL test database only.
 */
import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import { EVERYONE, SQUAD_A, SQUAD_B, makeTeam, register, startHarness, type Harness } from './helpers';
import { syncAskIndex } from '../src/domain/ask';

let h: Harness;
before(async () => (h = await startHarness()));
after(async () => h.close());
beforeEach(async () => { await h.reset(); await register(h, ...EVERYONE); });

const place = { name: 'Siri Fort', lat: 28.55, lng: 77.22 };
const rules = { preset: 'indoor', bestOf: 3, pointsPerSet: 25, decidingSetPoints: 15, winBy: 2, pointCap: null, timeoutsPerSet: 2, sideSwitchEvery: null, decidingSideSwitchEvery: 8, decidingSwitchAt: null };
async function challenge() {
  const a = await makeTeam(h, 'cap', SQUAD_A, 'QA Spikers');
  const b = await makeTeam(h, 'dan', SQUAD_B, 'Delhi Smashers');
  const r = await h.as('cap').post('/api/challenges').send({ fromTeamId: a, fromCaptainId: 'cap', toTeamId: b, toCaptainId: 'dan', when: Date.now() + 3_600_000, location: place, rules });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return { a, b, id: r.body.id as string };
}
const transfer = async (teamId: string, from: Parameters<Harness['as']>[0], to: string) => {
  const r = await h.as(from).patch(`/api/teams/${teamId}`).send({ captainId: to });
  assert.equal(r.status, 200, JSON.stringify(r.body));
};
const status = async (id: string) => (await h.db('challenges').where({ id }).first()).status;

describe('F152-4: decline / cancel by anyone but the current captain → challenge_not_captain', () => {
  it('former challenged captain declines → 403 challenge_not_captain, still pending; new captain 200', async () => {
    const { b, id } = await challenge();
    await transfer(b, 'dan', 'b4');
    const old = await h.as('dan').patch(`/api/challenges/${id}`).send({ status: 'declined' });
    assert.equal(old.status, 403);
    assert.equal(old.body.error, 'challenge_not_captain', JSON.stringify(old.body));
    assert.equal(await status(id), 'pending');
    assert.equal((await h.as('b4').patch(`/api/challenges/${id}`).send({ status: 'declined' })).status, 200);
  });
  it('former challenger captain cancels → 403 challenge_not_captain, still pending; new challenger captain 200', async () => {
    const { a, id } = await challenge();
    await transfer(a, 'cap', SQUAD_A[1]);
    const old = await h.as('cap').patch(`/api/challenges/${id}`).send({ status: 'cancelled' });
    assert.equal(old.status, 403);
    assert.equal(old.body.error, 'challenge_not_captain', JSON.stringify(old.body));
    assert.equal(await status(id), 'pending');
    assert.equal((await h.as(SQUAD_A[1]).patch(`/api/challenges/${id}`).send({ status: 'cancelled' })).status, 200);
  });
  it('a member, the challenger declining, the challenged side cancelling: all challenge_not_captain', async () => {
    const { id } = await challenge();
    for (const [who, st] of [[SQUAD_B[2], 'declined'], [SQUAD_A[2], 'cancelled'], ['cap', 'declined'], ['dan', 'cancelled'], ['cap', 'accepted']] as const) {
      const r = await h.as(who).patch(`/api/challenges/${id}`).send({ status: st });
      assert.equal(r.status, 403, `${who} ${st}`);
      assert.equal(r.body.error, 'challenge_not_captain', `${who} ${st} ${JSON.stringify(r.body)}`);
    }
    assert.equal(await status(id), 'pending');
  });
  it('a closed challenge keeps its own errors (no change for non-pending rows)', async () => {
    const { id } = await challenge();
    assert.equal((await h.as('dan').patch(`/api/challenges/${id}`).send({ status: 'declined' })).status, 200);
    const r = await h.as('cap').patch(`/api/challenges/${id}`).send({ status: 'cancelled' });
    assert.equal(r.status, 403);
    assert.notEqual(r.body.error, 'challenge_not_captain');
  });
});

describe('F152-3: the Ask index picks up the corrected disputed copy (EN + HI)', () => {
  it('a stale 1.5.2 "flagged" row is re-embedded with the new text, and the new "disputed" FAQ is indexed', async () => {
    await syncAskIndex(h.s);
    await h.db('ask_chunks').where('id', 'like', 'faq:flagged:%').update({ body: 'OLD: or disputed … the admin can approve it', content_sha: 'stale' });
    const ix = await syncAskIndex(h.s);
    for (const lang of ['en', 'hi'] as const) {
      const flagged = ix.chunks.find((c) => c.id.startsWith(`faq:flagged:${lang}`));
      const disputed = ix.chunks.find((c) => c.id.startsWith(`faq:disputed:${lang}`));
      assert.ok(flagged && disputed, lang);
      assert.doesNotMatch(flagged.text, /^OLD/);
      assert.match(disputed.text, lang === 'en' ? /doesn’t count – not even if an admin approves/ : /नहीं गिना जाता – एडमिन के फ़्लैग मंज़ूर करने पर भी नहीं/);
      assert.match(disputed.text, lang === 'en' ? /An admin can void it/ : /एडमिन उसे रद्द कर सकता है/);
    }
  });
});
