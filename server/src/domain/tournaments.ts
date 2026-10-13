/** Tournaments, their teams and fixtures. Port of `match /tournaments/{id}`. */
import type { Fixture } from '../../../src/core/tournament';
import type { Tournament, TournamentTeam } from '../../../src/core/types';
import { MIN_PLAYERS, TEAM_TOO_SMALL_MESSAGE, TOURNAMENT_TEAMS_MESSAGE } from '../../../src/core/roster';
import type { Services } from '../context';
import { badRequest, forbidden, HttpError, notFound } from '../errors';
import { guardTournamentEdit, isTournamentAdmin, NOT_TOURNAMENT_ADMIN, NOT_TOURNAMENT_ADMIN_MESSAGE } from '../../../src/core/tournamentAdmin';

const notAdmin = () => new HttpError(403, NOT_TOURNAMENT_ADMIN, NOT_TOURNAMENT_ADMIN_MESSAGE);
import type { Identity } from '../auth/verifier';
import { topics } from '../live/bus';
import { checkTournamentFields } from '../../../src/core/validate';
import { insertRuleSet, loadRuleSets, newId, nowDate, placeCols, placeFromRow, toDate, toMs, type Row, type Trx } from './util';

type Doc = Omit<Tournament, 'id' | 'createdAt'>;

export async function loadTournaments(db: Trx, ids: string[]): Promise<Tournament[]> {
  if (!ids.length) return [];
  const rows = await db('tournaments').whereIn('id', ids);
  const [rules, teams, fixtures] = await Promise.all([
    loadRuleSets(db, rows.map((r: { rule_set_id: number }) => Number(r.rule_set_id))),
    db('tournament_teams').whereIn('tournament_id', ids).orderBy(['tournament_id', 'sort_order']),
    db('fixtures').whereIn('tournament_id', ids).orderBy(['tournament_id', 'round', 'idx']),
  ]);
  const byId = new Map<string, Tournament>();
  for (const r of rows) {
    byId.set(r.id, {
      id: r.id,
      name: r.name,
      organizerId: r.organizer_id,
      format: r.format,
      rules: rules.get(Number(r.rule_set_id))!,
      startDate: toMs(r.start_date)!,
      endDate: toMs(r.end_date)!,
      location: placeFromRow(r)!,
      teams: teams.filter((t: { tournament_id: string }) => t.tournament_id === r.id).map((t: { team_key: string; name: string; color: string }): TournamentTeam => ({ id: t.team_key, name: t.name, color: t.color })),
      fixtures: fixtures
        .filter((f: { tournament_id: string }) => f.tournament_id === r.id)
        .map((f: Row): Fixture => ({
          id: f.fixture_key,
          round: f.round,
          index: f.idx,
          homeId: f.home_key,
          awayId: f.away_key,
          ...(f.home_from ? { homeFrom: f.home_from } : {}),
          ...(f.away_from ? { awayFrom: f.away_from } : {}),
          ...(f.match_id ? { matchId: f.match_id } : {}),
        })),
      status: r.status,
      createdAt: toMs(r.created_at)!,
    });
  }
  return ids.map((id) => byId.get(id)).filter((t): t is Tournament => !!t);
}

/** Tournament teams are registered teams with at least MIN_PLAYERS members (no name-only teams). */
async function checkTournamentTeams(trx: Trx, keys: string[]) {
  if (!keys.length) return;
  const rows: { id: string; n: number | string }[] = await trx('teams')
    .leftJoin('team_members', 'team_members.team_id', 'teams.id')
    .whereIn('teams.id', keys)
    .groupBy('teams.id')
    .select('teams.id', trx.raw('COUNT(team_members.user_id) as n'));
  const count = new Map(rows.map((r) => [r.id, Number(r.n)]));
  const unknown = keys.filter((k) => !count.has(k));
  if (unknown.length) throw badRequest(`${TOURNAMENT_TEAMS_MESSAGE}: ${unknown.join(', ')}`);
  const small = keys.filter((k) => count.get(k)! < MIN_PLAYERS);
  if (small.length) throw badRequest(`${TEAM_TOO_SMALL_MESSAGE}: ${small.join(', ')}`);
}

async function writeTournament(trx: Trx, id: string, before: Doc | null, after: Doc) {
  const keys = after.teams.map((t) => t.id);
  // QA G8 / G9: at least 2 different teams, end on or after start, a new start not in the past.
  const teamsChanged0 = !before || JSON.stringify(before.teams.map((t) => t.id)) !== JSON.stringify(keys);
  checkTournamentFields(
    { startDate: after.startDate, endDate: after.endDate, ...(teamsChanged0 ? { teams: after.teams } : {}) },
    { startChanged: !before || before.startDate !== after.startDate },
  );
  const fkeys = after.fixtures.map((f) => f.id);
  if (new Set(fkeys).size !== fkeys.length) throw badRequest('Duplicate fixture ids');
  for (const f of after.fixtures) {
    for (const k of [f.homeId, f.awayId]) if (k && !keys.includes(k)) throw badRequest(`Fixture ${f.id} references unknown team ${k}`);
  }
  const matchIds = after.fixtures.map((f) => f.matchId).filter((m): m is string => !!m);
  if (matchIds.length) {
    const found = new Set((await trx('matches').whereIn('id', matchIds).select('id')).map((r: { id: string }) => r.id));
    const missing = matchIds.filter((m) => !found.has(m));
    if (missing.length) throw badRequest(`Unknown match(es): ${missing.join(', ')}`);
  }
  const now = nowDate();
  const row = {
    name: after.name.trim(),
    organizer_id: after.organizerId,
    format: after.format,
    start_date: toDate(after.startDate),
    end_date: toDate(after.endDate),
    ...placeCols(after.location),
    status: after.status,
    updated_at: now,
  };
  const ruleChanged = !before || JSON.stringify(before.rules) !== JSON.stringify(after.rules);
  if (!before) {
    const ruleSetId = await insertRuleSet(trx, after.rules);
    await trx('tournaments').insert({ id, ...row, rule_set_id: ruleSetId, created_at: now });
  } else {
    const old = await trx('tournaments').where({ id }).first('rule_set_id');
    const ruleSetId = ruleChanged ? await insertRuleSet(trx, after.rules) : old.rule_set_id;
    await trx('tournaments').where({ id }).update({ ...row, rule_set_id: ruleSetId });
    if (ruleChanged) await trx('rule_sets').where({ id: old.rule_set_id }).del();
  }
  const teamsChanged = !before || JSON.stringify(before.teams) !== JSON.stringify(after.teams);
  if (teamsChanged) await checkTournamentTeams(trx, keys);
  const fixturesChanged = teamsChanged || JSON.stringify(before?.fixtures) !== JSON.stringify(after.fixtures);
  if (fixturesChanged) await trx('fixtures').where({ tournament_id: id }).del();
  if (teamsChanged) {
    await trx('tournament_teams').where({ tournament_id: id }).del();
    if (after.teams.length)
      await trx('tournament_teams').insert(after.teams.map((t, i) => ({ tournament_id: id, team_key: t.id, team_id: t.id, name: t.name, color: t.color, sort_order: i })));
  }
  if (fixturesChanged && after.fixtures.length) {
    await trx('fixtures').insert(
      after.fixtures.map((f) => ({
        tournament_id: id,
        fixture_key: f.id,
        round: f.round,
        idx: f.index,
        home_key: f.homeId,
        away_key: f.awayId,
        home_from: f.homeFrom ?? null,
        away_from: f.awayFrom ?? null,
        match_id: f.matchId ?? null,
      })),
    );
  }
}

const publish = (s: Services, id: string, deleted = false) => {
  s.bus.publish({ topic: topics.tournament(id), type: deleted ? 'deleted' : 'invalidate' });
  s.bus.publish({ topic: topics.tournaments, type: 'invalidate' });
};

/** tournaments create: organizerId == uid() */
export async function createTournament(s: Services, viewer: Identity, t: Doc, fixedId?: string) {
  if (t.organizerId !== viewer.uid) throw forbidden('tournaments.create', 'You must be the organiser');
  const id = fixedId ?? newId(); // fixedId: seeds only
  await s.db.transaction((trx) => writeTournament(trx, id, null, t));
  publish(s, id);
  return id;
}

/** tournaments update: resource.organizerId == uid() && request.organizerId == uid() */
export async function patchTournament(s: Services, viewer: Identity, id: string, patch: Partial<Doc>) {
  await s.db.transaction(async (trx) => {
    if (!(await trx('tournaments').where({ id }).forUpdate().first('id'))) throw notFound('Tournament not found');
    const [cur] = await loadTournaments(trx, [id]);
    const { id: _i, createdAt: _c, ...before } = cur;
    const after: Doc = { ...before, ...patch };
    // 1.4.19: the owner only (core/tournamentAdmin; app admins too get 403), never a change of owner
    try { guardTournamentEdit(before as Tournament, viewer.uid, patch); } catch { throw notAdmin(); }
    await writeTournament(trx, id, before, after);
  });
  publish(s, id);
  const [t] = await loadTournaments(s.db, [id]);
  return t;
}

/** tournaments delete: organizerId == uid() */
export async function deleteTournament(s: Services, viewer: Identity, id: string) {
  const r = await s.db('tournaments').where({ id }).first('organizer_id', 'rule_set_id');
  if (!r) throw notFound('Tournament not found');
  if (!isTournamentAdmin({ organizerId: r.organizer_id }, viewer.uid)) throw notAdmin(); // 1.4.19
  await s.db.transaction(async (trx) => {
    await trx('tournaments').where({ id }).del();
    await trx('rule_sets').where({ id: r.rule_set_id }).del();
  });
  publish(s, id, true);
}

/** 1.4.19: the owner of a tournament (null = no such tournament) – for the match link check. */
export async function tournamentOwner(db: Trx, id: string): Promise<{ organizerId: string } | null> {
  const r = await db('tournaments').where({ id }).first('organizer_id');
  return r ? { organizerId: r.organizer_id } : null;
}

export async function listTournamentIds(db: Trx) {
  return (await db('tournaments').select('id').orderBy('start_date', 'desc').limit(50)).map((r: { id: string }) => r.id);
}
