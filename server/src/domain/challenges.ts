/** Team challenges. Port of `match /challenges/{challengeId}`. */
import type { Challenge } from '../../../src/core/types';
import { MIN_PLAYERS, TEAM_TOO_SMALL_MESSAGE } from '../../../src/core/roster';
import { notify, type Services } from '../context';
import { badRequest, forbidden, notFound } from '../errors';
import type { Identity } from '../auth/verifier';
import { topics } from '../live/bus';
import { checkChallengeNames, checkNotPast } from '../../../src/core/validate';
import { insertRuleSet, loadRuleSets, newId, nowDate, placeCols, placeFromRow, toDate, toMs, type Row, type Trx } from './util';

export async function loadChallenges(db: Trx, ids: string[]): Promise<Challenge[]> {
  if (!ids.length) return [];
  const rows = await db('challenges').whereIn('id', ids).orderBy('created_at', 'desc');
  const rules = await loadRuleSets(db, rows.map((r: { rule_set_id: number }) => Number(r.rule_set_id)));
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
    const r = await trx('challenges').where({ id }).forUpdate().first();
    if (!r) throw notFound('Challenge not found');
    const nextStatus = patch.status ?? r.status;
    const nextMatch = patch.matchId === undefined ? r.match_id : patch.matchId;
    const statusChanged = nextStatus !== r.status;
    const matchChanged = (nextMatch ?? null) !== (r.match_id ?? null);
    const respond = r.to_captain_id === viewer.uid && r.status === 'pending' && ['accepted', 'declined'].includes(nextStatus);
    const cancel = r.from_captain_id === viewer.uid && r.status === 'pending' && !matchChanged && nextStatus === 'cancelled';
    if (!respond && !cancel) {
      if (!statusChanged && !matchChanged) return { ...r, changedNow: false }; // no-op write (allowed by Firestore too)
      throw forbidden('challenges.update', 'Only the challenged captain can answer, and only the challenger can cancel, a pending challenge');
    }
    if (respond && nextStatus === 'accepted' && statusChanged) await assertTeamsCanPlay(trx, [r.from_team_id, r.to_team_id], 'challenges.accept.teamSize');
    if (nextMatch && !(await trx('matches').where({ id: nextMatch }).first('id'))) throw badRequest('matchId does not exist');
    await trx('challenges').where({ id }).update({ status: nextStatus, match_id: nextMatch ?? null, responded_at: nowDate() });
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
