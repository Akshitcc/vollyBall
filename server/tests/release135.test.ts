/**
 * 1.3.5 on the API server (QA E134-2): an admin (ADMIN_UIDS) can never approve or void a match they
 * played in, scored or created; another admin still can. The flagged list still shows the match.
 */
import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import { ADMIN, EVERYONE, createMatch, pt, register, startHarness, type Harness } from './helpers';

let h: Harness;
before(async () => (h = await startHarness()));
after(async () => h.close());
beforeEach(async () => {
  await h.reset();
  await register(h, ...EVERYONE, 'zed');
});

type Who = Parameters<Harness['as']>[0];
const code = (r: { status: number; body: { error?: string } }, status: number, err?: string) => {
  assert.equal(r.status, status, JSON.stringify(r.body));
  if (err) assert.equal(r.body.error, err, JSON.stringify(r.body));
};
const WIN_A = ['bob', 'bob', 'bob', 'cap', 'cap'].map((c, i) => pt('A', 1000 + i, c));
/** The harness's ADMIN_UIDS set (a plain Set at runtime). */
const admins = () => h.s.adminUids as Set<string>;
async function completed() {
  const id = await createMatch(h);
  code(await h.as('cap').put(`/api/matches/${id}/progress`).send({ events: WIN_A }), 200);
  code(await h.as('cap').put(`/api/matches/${id}/player-of-match`).send({ playerId: 'bob' }), 200);
  return id;
}

describe('E134-2: no self-approval', () => {
  it('creator/scorer, a player of either side, and a captain are refused (403 own_match), even as admins', async () => {
    const id = await completed(); // created + scored by cap (team A); 'aarav' and 'dan' play for B
    const insiders: Who[] = ['cap', 'bob', 'aarav', 'dan'];
    for (const who of insiders) admins().add(typeof who === 'string' ? who : who.uid);
    try {
      // they are admins now: the list works for them …
      code(await h.as('bob').get('/api/admin/matches/flagged'), 200);
      // … but none of them may decide their own match
      for (const who of insiders) {
        code(await h.as(who).post(`/api/admin/matches/${id}/review`).send({ decision: 'approve' }), 403, 'own_match');
        code(await h.as(who).post(`/api/admin/matches/${id}/review`).send({ decision: 'void' }), 403, 'own_match');
      }
      const row = await h.db('matches').where({ id }).first('verification_status', 'reviewed_by');
      assert.notEqual(row.verification_status, 'approved');
      assert.equal(row.reviewed_by, null);
      // an admin who isn't in the match still can
      code(await h.as(ADMIN).post(`/api/admin/matches/${id}/review`).send({ decision: 'approve' }), 200);
    } finally {
      for (const who of insiders) admins().delete(typeof who === 'string' ? who : who.uid);
    }
  });
  it('an outsider admin (not in the match) can void', async () => {
    const id = await completed();
    code(await h.as(ADMIN).post(`/api/admin/matches/${id}/review`).send({ decision: 'void' }), 200);
  });
});
