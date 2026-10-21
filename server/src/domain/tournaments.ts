/** Tournaments, their teams and fixtures. Port of `match /tournaments/{id}`. */
import type { Fixture, FixtureResult } from '../../../src/core/tournament';
import { groupsProblem, resolveFixtures } from '../../../src/core/groups';
import { LOCK_KEYS } from '../../../src/core/fixtureLock';
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
      ...(r.advance != null ? { advance: Number(r.advance) } : {}),
      rules: rules.get(Number(r.rule_set_id))!,
      startDate: toMs(r.start_date)!,
      endDate: toMs(r.end_date)!,
      location: placeFromRow(r)!,
      teams: teams.filter((t: { tournament_id: string }) => t.tournament_id === r.id).map((t: { team_key: string; name: string; color: string; group_key?: string | null }): TournamentTeam => ({ id: t.team_key, name: t.name, color: t.color, ...(t.group_key ? { group: t.group_key } : {}) })),
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
          ...(f.group_key ? { group: f.group_key } : {}),
          ...(f.home_seed ? { homeSeed: f.home_seed } : {}),
          ...(f.away_seed ? { awaySeed: f.away_seed } : {}),
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
  // 1.4.26 (DB-6): a claim is never dropped by an older copy of the fixtures (another device's PATCH from before the
  // claim): a fixture sent without matchId keeps the match the server already has for it
  if (before) {
    const claimed = new Map(before.fixtures.filter((f) => f.matchId).map((f) => [f.id, f.matchId as string]));
    after.fixtures = after.fixtures.map((f) => (!f.matchId && claimed.has(f.id) ? { ...f, matchId: claimed.get(f.id) } : f));
  }
  // 1.4.27: groups format consistency (every team in a group A–H, group fixtures inside their group, seeds A1–H2)
  const gp = groupsProblem(after);
  if (gp) throw new HttpError(400, gp, `Invalid groups tournament: ${gp}`);
  const fkeys = after.fixtures.map((f) => f.id);
  if (new Set(fkeys).size !== fkeys.length) throw badRequest('Duplicate fixture ids');
  for (const f of after.fixtures) {
    for (const k of [f.homeId, f.awayId]) if (k && !keys.includes(k)) throw badRequest(`Fixture ${f.id} references unknown team ${k}`);
  }
  const matchIds = after.fixtures.map((f) => f.matchId).filter((m): m is string => !!m);
  if (matchIds.length) {
    const rows: { id: string; tournament_id: string | null; fixture_key: string | null }[] = await trx('matches').whereIn('id', matchIds).select('id', 'tournament_id', 'fixture_key');
    const found = new Map(rows.map((r) => [r.id, r]));
    const missing = matchIds.filter((m) => !found.has(m));
    if (missing.length) throw badRequest(`Unknown match(es): ${missing.join(', ')}`);
    // 1.4.26 (DB-3): a fixture claims only a match started for it (same tournament and fixture) – never a friendly or
    // another tournament's match, which would then count in this table / bracket. Claims already stored are kept.
    const stored = new Map((before?.fixtures ?? []).map((f) => [f.id, f.matchId ?? null]));
    for (const f of after.fixtures) {
      if (!f.matchId || stored.get(f.id) === f.matchId) continue;
      const m = found.get(f.matchId)!;
      if (m.tournament_id !== id || m.fixture_key !== f.id) throw new HttpError(400, 'fixture_match_mismatch', `Match ${f.matchId} was not started for fixture ${f.id}`);
    }
  }
  // 1.4.26 (E2E-2): a fixture whose match has a result is locked – its teams, feeders and match can't change and it
  // can't be removed (otherwise the table credits a team that never played it)
  if (before) {
    const played = new Set((await claimedResults(trx, id)).map((r) => r.fixtureId));
    const next = new Map(after.fixtures.map((f) => [f.id, f]));
    for (const f of before.fixtures.filter((x) => played.has(x.id))) {
      const n = next.get(f.id);
      const same = (k: (typeof LOCK_KEYS)[number]) => ((n?.[k] ?? null) === (f[k] ?? null));
      if (!n || !LOCK_KEYS.every(same))
        throw new HttpError(409, FIXTURE_LOCKED, `Fixture ${f.id} has a result and can no longer be changed`, { fixtureId: f.id });
    }
  }
  const now = nowDate();
  const row = {
    name: after.name.trim(),
    organizer_id: after.organizerId,
    format: after.format,
    advance: after.format === 'groups' ? after.advance ?? null : null,
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
      await trx('tournament_teams').insert(after.teams.map((t, i) => ({ tournament_id: id, team_key: t.id, team_id: t.id, name: t.name, color: t.color, group_key: t.group ?? null, sort_order: i })));
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
        group_key: f.group ?? null,
        home_seed: f.homeSeed ?? null,
        away_seed: f.awaySeed ?? null,
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
  if (t.organizerId !== viewer.uid) throw notAdmin(); // 1.4.20 (QA V1419-1): same code as edit / delete
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
    // 1.4.26 (DB-5): the matches stay (history) but no longer point at a fixture of a tournament that is gone
    await trx('matches').where({ tournament_id: id }).update({ fixture_key: null });
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

/**
 * 1.4.26 (E2E-2/E2E-3): results of the matches the fixtures claim (finished only), from the stored summary – the same
 * numbers core/results fixtureResultFromMatch derives from the events.
 */
export async function claimedResults(db: Trx, tournamentId: string): Promise<FixtureResult[]> {
  const rows: { fixture_key: string; summary: unknown }[] = await db('fixtures as f')
    .join('matches as m', 'm.id', 'f.match_id')
    .where('f.tournament_id', tournamentId)
    .where('m.status', 'finished')
    .whereRaw('m.tournament_id = f.tournament_id AND m.fixture_key = f.fixture_key')
    .select('f.fixture_key', 'm.summary');
  return rows.map((r) => {
    const sm = (typeof r.summary === 'string' ? JSON.parse(r.summary) : r.summary) as { setsA: number; setsB: number; setScores: { a: number; b: number }[] };
    return { fixtureId: r.fixture_key, homeSets: sm.setsA, awaySets: sm.setsB, homePoints: sm.setScores.reduce((n, x) => n + x.a, 0), awayPoints: sm.setScores.reduce((n, x) => n + x.b, 0) };
  });
}

export const FIXTURE_NOT_READY = 'fixture_not_ready';
export const FIXTURE_TEAMS = 'fixture_teams';
export const FIXTURE_LOCKED = 'fixture_locked';

/**
 * 1.4.26 (E2E-3): the two teams a fixture is played by right now – a knockout slot is filled from its decided feeders
 * (core resolveKnockout, like the app's bracket); null while a side is still open (feeder not played, or a bye).
 */
export async function fixtureTeamsNow(db: Trx, tournamentId: string): Promise<Map<string, { home: string | null; away: string | null }>> {
  const [t] = await loadTournaments(db, [tournamentId]);
  if (!t) return new Map();
  const fixtures = resolveFixtures(t, await claimedResults(db, tournamentId)).fixtures; // 1.4.27: groups → seeded bracket
  return new Map(fixtures.map((f) => [f.id, { home: f.homeId, away: f.awayId }]));
}
