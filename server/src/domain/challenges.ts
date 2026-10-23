/** Team challenges. Port of `match /challenges/{challengeId}`. */
import type { Challenge } from '../../../src/core/types';
import { MIN_PLAYERS, TEAM_TOO_SMALL_MESSAGE } from '../../../src/core/roster';
import { notify, type Services } from '../context';
import { badRequest, forbidden, HttpError, notFound } from '../errors';
import { CHALLENGE_LINK_MESSAGES, CHALLENGE_LINK_STATUS, CHALLENGE_NOT_CAPTAIN, challengeAcceptProblem, challengeRespondLinkProblem } from '../../../src/core/challengeLink';
import { createMatch } from './matches';
import { currentCaptains, withCurrentCaptains } from './challengeCaptains';
import type { Identity } from '../auth/verifier';
import { topics } from '../live/bus';
import { checkChallengeNames, checkNotPast } from '../../../src/core/validate';
import { insertRuleSet, loadRuleSets, newId, nowDate, placeCols, placeFromRow, toDate, toMs, type Row, type Trx } from './util';

export async function loadChallenges(db: Trx, ids: string[]): Promise<Challenge[]> {
  if (!ids.length) return [];
  const rows0 = await db('challenges').whereIn('id', ids).orderBy('created_at', 'desc');
  // 1.5.2 (F151-1): the teams' current captains (who can answer / cancel now), not the ones at send time
  const cap = await currentCaptains(db, rows0.flatMap((r: Row) => [r.from_team_id, r.to_team_id]));
  const rows: Row[] = rows0.map((r: Row) => ({ ...r, from_captain_id: cap.get(r.from_team_id) ?? r.from_captain_id, to_captain_id: cap.get(r.to_team_id) ?? r.to_captain_id }));
  const rules = await loadRuleSets(db, rows.map((r: Row) => Number(r.rule_set_id)));
  return rows.map((r: Row) => ({
    id: r.id,
    fromTeamId: r.from_team_id,
    fromTeamName: r.from_team_name,
    fromCaptainId: r.from_captain_id,
    toTeamId: r.to_team_id,
    toTeamName: r.to_team_name,
    toCaptainId: r.to_captain_id,
    when: toMs(r.scheduled_for)!,
    location: placeFromRow(r)!,
    ...(r.message ? { message: r.message } : {}),
    rules: rules.get(Number(r.rule_set_id))!,
    status: r.status,
    matchId: r.match_id,
    createdAt: toMs(r.created_at)!,
  }));
}

export async function challengesForTeams(db: Trx, teamIds: string[]) {
  if (!teamIds.length) return [];
  const ids = (await db('challenges').whereIn('from_team_id', teamIds).orWhereIn('to_team_id', teamIds).select('id')).map((r: { id: string }) => r.id);
  return loadChallenges(db, ids);
}

/**
 * challenges create: fromCaptainId == uid() && status == 'pending'
 *   && teams[fromTeamId].captainId == uid() && teams[toTeamId].captainId == toCaptainId
 */
/** Both teams need MIN_PLAYERS members to challenge / accept (a captain alone can't play). */
async function assertTeamsCanPlay(trx: Trx, teamIds: string[], rule: string) {
  for (const t of teamIds) {
    const [{ n }] = await trx('team_members').where({ team_id: t }).count({ n: '*' });
    if (Number(n) < MIN_PLAYERS) throw forbidden(rule, TEAM_TOO_SMALL_MESSAGE);
  }
}

export async function createChallenge(
  s: Services,
  viewer: Identity,
  c: Omit<Challenge, 'id' | 'createdAt' | 'status' | 'matchId' | 'fromTeamName' | 'toTeamName'> & { status?: string; fromTeamName?: string; toTeamName?: string },
) {
  const rule = 'challenges.create';
  if (c.fromCaptainId !== viewer.uid) throw forbidden(rule, 'You can only challenge as yourself');
  if (c.status !== undefined && c.status !== 'pending') throw forbidden(rule, 'A new challenge must be pending');
  if (c.fromTeamId === c.toTeamId) throw badRequest('A team cannot challenge itself');
  checkNotPast('when', c.when); // QA G9
  const id = newId();
  await s.db.transaction(async (trx) => {
    const from = await trx('teams').where({ id: c.fromTeamId }).first('captain_id', 'name');
    const to = await trx('teams').where({ id: c.toTeamId }).first('captain_id', 'name');
    if (!from || !to) throw notFound('Team not found');
    if (from.captain_id !== viewer.uid) throw forbidden(rule, 'Only the captain can challenge for this team');
    if (to.captain_id !== c.toCaptainId) throw forbidden(rule, 'toCaptainId must be the captain of the challenged team');
    // QA G19: stored names always come from the teams table; a different name sent by the client is rejected.
    checkChallengeNames(c as { fromTeamName?: string; toTeamName?: string }, from, to);
    await assertTeamsCanPlay(trx, [c.fromTeamId, c.toTeamId], 'challenges.create.teamSize');
    const ruleSetId = await insertRuleSet(trx, c.rules);
    await trx('challenges').insert({
      id,
      from_team_id: c.fromTeamId,
      to_team_id: c.toTeamId,
      from_captain_id: viewer.uid,
      to_captain_id: c.toCaptainId,
      from_team_name: from.name, // names come from the teams table, not the client
      to_team_name: to.name,
      scheduled_for: toDate(c.when),
      ...placeCols(c.location),
      message: c.message ?? null,
      rule_set_id: ruleSetId,
      status: 'pending',
      created_at: nowDate(),
    });
  });
  s.bus.publish({ topic: topics.challenges, type: 'invalidate' });
  const [created] = await loadChallenges(s.db, [id]);
  // was Cloud Function onChallengeCreated
  notify(s, [created.toCaptainId], '⚡ New challenge!', `${created.fromTeamName} challenged ${created.toTeamName}. Tap to accept or decline.`, { type: 'challenge', challengeId: id });
  return id;
}

/**
 * challenges update:
 *   (toCaptainId == uid() && status == 'pending' && only status/matchId change && status in [accepted, declined])
 *   || (fromCaptainId == uid() && status == 'pending' && only status changes && status == 'cancelled')
 * challenges delete: false (no route).
 */
export async function respondChallenge(s: Services, viewer: Identity, id: string, patch: { status?: Challenge['status']; matchId?: string | null }) {
  const updated = await s.db.transaction(async (trx) => {
    const r = await withCurrentCaptains(trx, await trx('challenges').where({ id }).forUpdate().first(), true); // 1.5.2 (F151-1)
    if (!r) throw notFound('Challenge not found');
    const nextStatus = patch.status ?? r.status;
    const nextMatch = patch.matchId === undefined ? r.match_id : patch.matchId;
    const statusChanged = nextStatus !== r.status;
    const matchChanged = (nextMatch ?? null) !== (r.match_id ?? null);
    const respond = r.to_captain_id === viewer.uid && r.status === 'pending' && ['accepted', 'declined'].includes(nextStatus);
    const cancel = r.from_captain_id === viewer.uid && r.status === 'pending' && !matchChanged && nextStatus === 'cancelled';
    if (!respond && !cancel) {
      if (!statusChanged && !matchChanged) return { ...r, changedNow: false }; // no-op write (allowed by Firestore too)
      // 1.5.3 (Tester F152-4): answering / cancelling a PENDING challenge as anyone but the current captain of that side
      // (a former captain, a member, the other side) is the same error as accept: challenge_not_captain (403)
      if (r.status === 'pending' && statusChanged && !matchChanged && ['accepted', 'declined', 'cancelled'].includes(nextStatus)) throw new HttpError(CHALLENGE_LINK_STATUS[CHALLENGE_NOT_CAPTAIN], CHALLENGE_NOT_CAPTAIN, CHALLENGE_LINK_MESSAGES[CHALLENGE_NOT_CAPTAIN]);
      throw forbidden('challenges.update', 'Only the challenged captain can answer, and only the challenger can cancel, a pending challenge');
    }
    if (respond && nextStatus === 'accepted' && statusChanged) await assertTeamsCanPlay(trx, [r.from_team_id, r.to_team_id], 'challenges.accept.teamSize');
    // 1.5.1 (F150-1): an answer never links a match, and an accept comes with its match (POST /challenges/:id/accept)
    const c = { id: r.id, fromTeamId: r.from_team_id, toTeamId: r.to_team_id, fromCaptainId: r.from_captain_id, toCaptainId: r.to_captain_id, status: r.status, matchId: r.match_id };
    const p = challengeRespondLinkProblem(c, nextStatus, patch.matchId);
    if (p) throw new HttpError(CHALLENGE_LINK_STATUS[p], p, CHALLENGE_LINK_MESSAGES[p]);
    // the row records who answered for each team now (the current captains)
    await trx('challenges').where({ id }).update({ status: nextStatus, match_id: nextMatch ?? null, responded_at: nowDate(), from_captain_id: r.from_captain_id, to_captain_id: r.to_captain_id });
    return { ...r, status: nextStatus, match_id: nextMatch, changedNow: statusChanged };
  });
  s.bus.publish({ topic: topics.challenges, type: 'invalidate' });
  if (updated.changedNow && (updated.status === 'accepted' || updated.status === 'declined')) {
    // was Cloud Function onChallengeUpdated
    notify(
      s,
      [updated.from_captain_id],
      updated.status === 'accepted' ? '✅ Challenge accepted' : 'Challenge declined',
      `${updated.to_team_name} ${updated.status} your challenge.`,
      { type: 'challenge', challengeId: id, matchId: String(updated.match_id ?? '') },
    );
  }
  const [c] = await loadChallenges(s.db, [id]);
  return c;
}

/**
 * 1.5.1 (Tester F150-1): the challenged captain accepts AND creates the challenge match in one transaction – the only way
 * a match gets a challengeId. The challenge row is locked, must still be pending, the match is the challenge's two teams,
 * created by the accepting captain; then the challenge becomes accepted with this match. A retried accept with the same
 * Idempotency-Key returns the first match.
 */
export async function acceptChallenge(s: Services, viewer: Identity, id: string, input: Parameters<typeof createMatch>[2], idempotencyKey?: string): Promise<{ matchId: string }> {
  if (input.challengeId != null && input.challengeId !== id) throw new HttpError(400, 'challenge_match_invalid', CHALLENGE_LINK_MESSAGES.challenge_match_invalid);
  let accepted = false;
  let capNow: { from: string; to: string } | null = null;
  const matchId = await createMatch(s, viewer, { ...input, challengeId: id }, undefined, idempotencyKey, {
    claim: async (trx, doc) => {
      const r = await withCurrentCaptains(trx, await trx('challenges').where({ id }).forUpdate().first(), true); // 1.5.2 (F151-1)
      capNow = r ? { from: r.from_captain_id, to: r.to_captain_id } : null;
      const c = r ? { id: r.id, fromTeamId: r.from_team_id, toTeamId: r.to_team_id, fromCaptainId: r.from_captain_id, toCaptainId: r.to_captain_id, status: r.status, matchId: r.match_id } : null;
      const p = challengeAcceptProblem(c, doc, viewer.uid);
      if (p) throw new HttpError(CHALLENGE_LINK_STATUS[p], p, CHALLENGE_LINK_MESSAGES[p]);
      await assertTeamsCanPlay(trx, [r.from_team_id, r.to_team_id], 'challenges.accept.teamSize');
    },
    link: async (trx, mid) => {
      await trx('challenges').where({ id }).update({ status: 'accepted', match_id: mid, responded_at: nowDate(), ...(capNow ? { from_captain_id: capNow.from, to_captain_id: capNow.to } : {}) });
      accepted = true;
    },
  });
  s.bus.publish({ topic: topics.challenges, type: 'invalidate' });
  if (accepted) {
    const [c] = await loadChallenges(s.db, [id]);
    if (c) notify(s, [c.fromCaptainId], '✅ Challenge accepted', `${c.toTeamName} accepted your challenge.`, { type: 'challenge', challengeId: id, matchId });
  }
  return { matchId };
}
