/**
 * Teams, members and invites. Every write goes through `decideTeamUpdate`, a
 * line-by-line port of the `match /teams/{teamId}` block in firestore.rules
 * (plus the PRD limits the rules could not express). See server/RULES.md.
 */
import { MAX_SUBS, TEAM_SIZE, type Team } from '../../../src/core/types';
import { notify, type Services } from '../context';
import { badRequest, conflict, forbidden, HttpError, notFound } from '../errors';
import { INVALID_PHONE_CODE, INVALID_PHONE_MESSAGE, isValidE164 } from '../../../src/core/phone';
import type { Identity } from '../auth/verifier';
import { topics } from '../live/bus';
import { changedKeys, minus, newId, nowDate, setEq, toMs, type Trx } from './util';

export const MAX_MEMBERS = TEAM_SIZE + MAX_SUBS; // 12 (rule: memberIds.size() <= 12)
export const MAX_PENDING = 12; // rule: pendingPhones.size() <= 12

export type TeamDoc = Pick<Team, 'name' | 'color' | 'captainId' | 'memberIds' | 'subIds' | 'pendingPhones' | 'city'>;
const KEYS: (keyof TeamDoc)[] = ['name', 'color', 'captainId', 'memberIds', 'subIds', 'pendingPhones', 'city'];

export type TeamBranch = 'captain' | 'acceptingInvite' | 'decliningInvite' | 'leaving';

/**
 * Returns which rule branch allows `before -> after` for `viewer`, or throws 403.
 * `registered(phone)` answers "is this number a registered user" (rule: invitesOnlyRegistered).
 */
export function decideTeamUpdate(before: TeamDoc, after: TeamDoc, viewer: Identity, registered: Set<string>): TeamBranch {
  const uid = viewer.uid;
  const phone = viewer.phone;
  const changed = changedKeys(before, after, KEYS);
  const only = (allowed: (keyof TeamDoc)[]) => changed.every((k) => allowed.includes(k));

  // isCaptain() && captainId in memberIds && memberIds.size() <= 12 && pendingPhones.size() <= 12 && invitesOnlyRegistered()
  if (before.captainId === uid) {
    const rule = 'teams.update.captain';
    if (!after.memberIds.includes(after.captainId)) throw forbidden(rule, 'The captain must be a team member');
    if (after.memberIds.length > MAX_MEMBERS) throw forbidden(rule, `A team can have at most ${MAX_MEMBERS} players`);
    if (after.pendingPhones.length > MAX_PENDING) throw forbidden(rule, `At most ${MAX_PENDING} pending invites`);
    const added = minus(after.pendingPhones, before.pendingPhones);
    // New invites must be valid Indian mobiles; existing (legacy) entries pass through untouched.
    if (added.some((p) => !isValidE164(p))) {
      throw new HttpError(400, INVALID_PHONE_CODE, `Invalid request: pendingPhones – ${INVALID_PHONE_MESSAGE}`, { field: 'pendingPhones' });
    }
    if (added.some((p) => !registered.has(p))) throw forbidden('teams.update.invitesOnlyRegistered', "This number isn't on VolleyLive yet. Ask them to register first.");
    // PRD limits (not expressible in the rules language):
    if (minus(after.memberIds, before.memberIds).length) throw forbidden(rule, 'Players join by accepting an invite; the captain cannot add them directly');
    if (minus(after.subIds, after.memberIds).length) throw forbidden(rule, 'Subs must be team members');
    if (after.subIds.length > MAX_SUBS) throw forbidden(rule, `At most ${MAX_SUBS} subs`);
    if (after.memberIds.length + after.pendingPhones.length > MAX_MEMBERS) throw forbidden(rule, `Members plus pending invites cannot exceed ${MAX_MEMBERS}`);
    if (new Set(after.pendingPhones).size !== after.pendingPhones.length) throw badRequest('Duplicate invite');
    return 'captain';
  }

  // acceptingInvite(): myPhone() in pendingPhones && only memberIds/pendingPhones/subIds change,
  // memberIds == old ∪ {uid}, pendingPhones == old − {myPhone}, new subs ⊆ {uid}
  if (
    phone &&
    before.pendingPhones.includes(phone) &&
    only(['memberIds', 'pendingPhones', 'subIds']) &&
    setEq(after.memberIds, [...before.memberIds, uid]) &&
    setEq(after.pendingPhones, minus(before.pendingPhones, [phone])) &&
    minus(after.subIds, before.subIds).every((x) => x === uid)
  ) {
    const rule = 'teams.update.acceptingInvite';
    if (!setEq(minus(before.subIds, after.subIds), [])) throw forbidden(rule, "You can't change other players' roles");
    if (after.memberIds.length > MAX_MEMBERS) throw forbidden(rule, 'This team is full');
    const starters = before.memberIds.filter((m) => !before.subIds.includes(m)).length;
    if (starters >= TEAM_SIZE && !after.subIds.includes(uid)) throw forbidden(rule, 'The team already has 6 starters; join as a sub');
    if (after.subIds.length > MAX_SUBS) throw forbidden(rule, 'This team already has 6 subs');
    return 'acceptingInvite';
  }

  // decliningInvite(): myPhone() in pendingPhones && only pendingPhones changes && pendingPhones == old − {myPhone}
  if (phone && before.pendingPhones.includes(phone) && only(['pendingPhones']) && setEq(after.pendingPhones, minus(before.pendingPhones, [phone]))) {
    return 'decliningInvite';
  }

  // leaving(): uid in memberIds && !isCaptain() && only memberIds/subIds change, both minus {uid}
  if (
    before.memberIds.includes(uid) &&
    only(['memberIds', 'subIds']) &&
    setEq(after.memberIds, minus(before.memberIds, [uid])) &&
    setEq(after.subIds, minus(before.subIds, [uid]))
  ) {
    return 'leaving';
  }
  throw forbidden('teams.update', 'Only the captain can edit this team');
}

// ---------------- loading ----------------
interface TeamRow {
  id: string;
  name: string;
  name_lower: string;
  color: string;
  captain_id: string;
  city: string | null;
  created_at: Date;
}

export async function loadTeams(db: Trx, ids: string[]): Promise<Team[]> {
  if (!ids.length) return [];
  const rows: TeamRow[] = await db('teams').whereIn('id', ids);
  const members = await db('team_members').whereIn('team_id', ids).orderBy(['sort_order', 'joined_at']);
  const invites = await db('team_invites').whereIn('team_id', ids).where({ status: 'pending' }).orderBy('id');
  const byId = new Map<string, Team>(
    rows.map((r): [string, Team] => [
      r.id,
      {
        id: r.id,
        name: r.name,
        nameLower: r.name_lower,
        color: r.color,
        captainId: r.captain_id,
        memberIds: [] as string[],
        subIds: [] as string[],
        pendingPhones: [] as string[],
        city: r.city ?? undefined,
        createdAt: toMs(r.created_at)!,
      },
    ]),
  );
  for (const m of members) {
    const t = byId.get(m.team_id);
    if (!t) continue;
    t.memberIds.push(m.user_id);
    if (m.role === 'sub') t.subIds.push(m.user_id);
  }
  for (const i of invites) byId.get(i.team_id)?.pendingPhones.push(i.phone);
  return ids.map((id) => byId.get(id)).filter((t): t is Team => !!t);
}

/** Phone privacy: pending numbers are visible to the captain; others only see their own number. */
export function viewTeam(t: Team, viewer: Identity): Team {
  if (t.captainId === viewer.uid) return t;
  return { ...t, pendingPhones: t.pendingPhones.filter((p) => p === viewer.phone) };
}

const toDoc = (t: Team): TeamDoc => ({
  name: t.name,
  color: t.color,
  captainId: t.captainId,
  memberIds: t.memberIds,
  subIds: t.subIds,
  pendingPhones: t.pendingPhones,
  city: t.city,
});

// ---------------- writes ----------------
/** teams create: captainId == uid() && memberIds == [uid()] && pendingPhones.size() == 0 && name.size() <= 40 */
export async function createTeam(s: Services, viewer: Identity, t: TeamDoc, fixedId?: string): Promise<string> {
  const rule = 'teams.create';
  if (t.captainId !== viewer.uid) throw forbidden(rule, 'You must be the captain of a team you create');
  if (t.memberIds.length !== 1 || t.memberIds[0] !== viewer.uid) throw forbidden(rule, 'A new team starts with only its captain');
  if (t.pendingPhones.length) throw forbidden(rule, 'Invite players after creating the team');
  if (minus(t.subIds, t.memberIds).length) throw forbidden(rule, 'Subs must be team members');
  const id = fixedId ?? newId(); // fixedId: seeds only, never from a request
  const now = nowDate();
  await s.db.transaction(async (trx) => {
    if (!(await trx('users').where({ id: viewer.uid, profile_complete: 1 }).first('id'))) throw badRequest('Create your profile first');
    await trx('teams').insert({ id, name: t.name.trim(), color: t.color, captain_id: viewer.uid, city: t.city ?? null, created_at: now, updated_at: now });
    await trx('team_members').insert({ team_id: id, user_id: viewer.uid, role: t.subIds.includes(viewer.uid) ? 'sub' : 'starter', sort_order: 0, joined_at: now });
  });
  publishTeam(s, id);
  return id;
}

function publishTeam(s: Services, id: string) {
  // Invalidate only (no document): the payload differs per viewer because of phone privacy.
  s.bus.publish({ topic: topics.team(id), type: 'invalidate' });
  s.bus.publish({ topic: topics.teams, type: 'invalidate' });
}

/** Loads the team under a row lock, computes the new state, checks the rules and writes the diff. */
export async function changeTeam(
  s: Services,
  viewer: Identity,
  teamId: string,
  compute: (before: Team) => TeamDoc,
): Promise<{ team: Team; branch: TeamBranch }> {
  const invitedUsers: string[] = [];
  const result = await s.db.transaction(async (trx) => {
    const locked = await trx('teams').where({ id: teamId }).forUpdate().first('id');
    if (!locked) throw notFound('Team not found');
    const [before] = await loadTeams(trx, [teamId]);
    const after = compute(before);
    const added = minus(after.pendingPhones, before.pendingPhones);
    const regRows: { id: string; phone: string }[] = added.length ? await trx('users').whereIn('phone', added).where({ profile_complete: 1 }).select('id', 'phone') : [];
    const registered = new Set(regRows.map((r) => r.phone));
    const branch = decideTeamUpdate(toDoc(before), after, viewer, registered);
    if (added.some((p) => after.memberIds.some((m) => regRows.find((r) => r.phone === p)?.id === m))) throw badRequest('That player is already in the team');

    const now = nowDate();
    await trx('teams')
      .where({ id: teamId })
      .update({ name: after.name.trim(), color: after.color, captain_id: after.captainId, city: after.city ?? null, updated_at: now });

    const removedMembers = minus(before.memberIds, after.memberIds);
    if (removedMembers.length) await trx('team_members').where({ team_id: teamId }).whereIn('user_id', removedMembers).del();
    const newMembers = minus(after.memberIds, before.memberIds);
    if (newMembers.length) {
      const max = (await trx('team_members').where({ team_id: teamId }).max({ m: 'sort_order' }).first())?.m ?? 0;
      await trx('team_members').insert(
        newMembers.map((u, i) => ({ team_id: teamId, user_id: u, role: after.subIds.includes(u) ? 'sub' : 'starter', sort_order: Number(max) + 1 + i, joined_at: now })),
      );
    }
    for (const u of after.memberIds.filter((m) => before.memberIds.includes(m))) {
      const was = before.subIds.includes(u);
      const is = after.subIds.includes(u);
      if (was !== is) await trx('team_members').where({ team_id: teamId, user_id: u }).update({ role: is ? 'sub' : 'starter' });
    }

    const removedPhones = minus(before.pendingPhones, after.pendingPhones);
    if (removedPhones.length) {
      const status = branch === 'acceptingInvite' ? 'accepted' : branch === 'decliningInvite' ? 'declined' : 'revoked';
      await trx('team_invites').where({ team_id: teamId, status: 'pending' }).whereIn('phone', removedPhones).update({ status, responded_at: now });
    }
    for (const p of added) {
      const invited = regRows.find((r) => r.phone === p)?.id ?? null;
      await trx('team_invites').insert({ team_id: teamId, phone: p, invited_user_id: invited, invited_by: viewer.uid, status: 'pending', created_at: now });
      if (invited) invitedUsers.push(invited);
    }
    const [team] = await loadTeams(trx, [teamId]);
    return { team, branch };
  });
  publishTeam(s, teamId);
  if (invitedUsers.length) {
    // was Cloud Function onTeamInvite
    notify(s, invitedUsers, '🏐 Team invite', `You've been invited to join ${result.team.name}.`, { type: 'teamInvite', teamId });
  }
  return result;
}

export function acceptInvite(s: Services, viewer: Identity, teamId: string) {
  return changeTeam(s, viewer, teamId, (t) => {
    if (!viewer.phone || !t.pendingPhones.includes(viewer.phone)) throw forbidden('teams.update.acceptingInvite', 'No pending invite for your number');
    const starters = t.memberIds.filter((m) => !t.subIds.includes(m)).length;
    return {
      ...toDoc(t),
      memberIds: [...t.memberIds, viewer.uid],
      subIds: starters >= TEAM_SIZE ? [...t.subIds, viewer.uid] : t.subIds, // 6 starters already: join as a sub
      pendingPhones: t.pendingPhones.filter((p) => p !== viewer.phone),
    };
  });
}

export function declineInvite(s: Services, viewer: Identity, teamId: string) {
  return changeTeam(s, viewer, teamId, (t) => ({ ...toDoc(t), pendingPhones: t.pendingPhones.filter((p) => p !== viewer.phone) }));
}

export function leaveTeam(s: Services, viewer: Identity, teamId: string) {
  return changeTeam(s, viewer, teamId, (t) => ({
    ...toDoc(t),
    memberIds: t.memberIds.filter((m) => m !== viewer.uid),
    subIds: t.subIds.filter((m) => m !== viewer.uid),
  }));
}

export function patchTeam(s: Services, viewer: Identity, teamId: string, patch: Partial<TeamDoc>) {
  return changeTeam(s, viewer, teamId, (t) => ({ ...toDoc(t), ...patch }));
}

/** teams delete: isCaptain() */
export async function deleteTeam(s: Services, viewer: Identity, teamId: string) {
  const t = await s.db('teams').where({ id: teamId }).first('captain_id');
  if (!t) throw notFound('Team not found');
  if (t.captain_id !== viewer.uid) throw forbidden('teams.delete', 'Only the captain can delete the team');
  // tournament_teams.team_id is NOT NULL (0002): a team that is in a tournament stays.
  if (await s.db('tournament_teams').where({ team_id: teamId }).first('tournament_id')) throw conflict('This team is in a tournament and cannot be deleted');
  await s.db('teams').where({ id: teamId }).del();
  s.bus.publish({ topic: topics.team(teamId), type: 'deleted' });
  s.bus.publish({ topic: topics.teams, type: 'invalidate' });
}

export async function teamsForMember(db: Trx, uid: string) {
  const ids = (await db('team_members').where({ user_id: uid }).select('team_id')).map((r: { team_id: string }) => r.team_id);
  return loadTeams(db, ids);
}

export async function teamsInvitingPhone(db: Trx, phone: string) {
  const ids = (await db('team_invites').where({ phone, status: 'pending' }).select('team_id')).map((r: { team_id: string }) => r.team_id);
  return loadTeams(db, ids);
}

export async function searchTeams(db: Trx, prefix: string) {
  const p = prefix.trim().toLowerCase();
  const q = db('teams').select('id').limit(20);
  if (p) q.where('name_lower', 'like', `${p.replace(/[\\%_]/g, (c) => `\\${c}`)}%`).orderBy('name_lower');
  else q.orderBy('created_at', 'desc');
  const ids = (await q).map((r: { id: string }) => r.id);
  return loadTeams(db, ids);
}
