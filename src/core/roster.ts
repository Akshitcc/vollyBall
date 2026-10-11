/**
 * Match roster rules (shared by the app, demo backend and API server):
 * every player is a registered user (referenced by user id, never a typed name),
 * at most 12 per team, nobody twice, nobody on both teams, and each team needs
 * at least 6 players before scoring can start.
 */
import type { MatchTeam } from './types';
import { MAX_SUBS, TEAM_SIZE, type Team } from './types';

/**
 * Minimum players per team before scoring can start (6 starters). Change it here: the app,
 * demo backend and API server all import it. firestore.rules can't import code, so it repeats the
 * number in `minPlayers()` (rules-tests check that they agree).
 */
export const MIN_PLAYERS = 6;
export const MAX_PLAYERS = TEAM_SIZE + MAX_SUBS; // 6 starters + 6 subs

/** User ids look like Firebase uids / seed ids. Typed names ("Rahul K") and old "guest:" ids don't. */
export const USER_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;
export const isUserId = (id: string) => USER_ID_RE.test(id);

export type RosterProblem =
  | { code: 'notUser'; side: 'A' | 'B'; playerId: string }
  | { code: 'tooMany'; side: 'A' | 'B' }
  | { code: 'duplicate'; side: 'A' | 'B'; playerId: string }
  | { code: 'bothTeams'; playerId: string }
  | { code: 'needPlayers'; side: 'A' | 'B'; count: number };

/** Problems that make a roster invalid at any time (create, edit). */
export function rosterErrors(a: Pick<MatchTeam, 'players'>, b: Pick<MatchTeam, 'players'>): RosterProblem[] {
  const out: RosterProblem[] = [];
  const sides = { A: a.players.map((p) => p.id), B: b.players.map((p) => p.id) };
  for (const side of ['A', 'B'] as const) {
    const ids = sides[side];
    if (ids.length > MAX_PLAYERS) out.push({ code: 'tooMany', side });
    const seen = new Set<string>();
    for (const id of ids) {
      if (!isUserId(id)) out.push({ code: 'notUser', side, playerId: id });
      if (seen.has(id)) out.push({ code: 'duplicate', side, playerId: id });
      seen.add(id);
    }
  }
  const inA = new Set(sides.A);
  for (const id of new Set(sides.B)) if (inA.has(id)) out.push({ code: 'bothTeams', playerId: id });
  return out;
}

/** Teams that don't have enough players to start scoring. */
export function missingPlayers(a: Pick<MatchTeam, 'players'>, b: Pick<MatchTeam, 'players'>): RosterProblem[] {
  const out: RosterProblem[] = [];
  if (a.players.length < MIN_PLAYERS) out.push({ code: 'needPlayers', side: 'A', count: a.players.length });
  if (b.players.length < MIN_PLAYERS) out.push({ code: 'needPlayers', side: 'B', count: b.players.length });
  return out;
}

export const canStartScoring = (m: { teamA: Pick<MatchTeam, 'players'>; teamB: Pick<MatchTeam, 'players'> }) =>
  rosterErrors(m.teamA, m.teamB).length === 0 && missingPlayers(m.teamA, m.teamB).length === 0;

/** Messages used by every backend (the app translates them in i18n/format.ts). */
export const ROSTER_MESSAGES = {
  notUser: 'Every player must be a registered VolleyLive user',
  tooMany: `A team can have at most ${MAX_PLAYERS} players`,
  duplicate: 'A player can only appear once in a match',
  bothTeams: 'A player can only appear once in a match',
  needPlayers: `Each team needs at least ${MIN_PLAYERS} players before scoring can start`,
} as const;

/** Throws the first problem as an Error with the shared message (demo backend). */
export function assertRoster(m: { teamA: Pick<MatchTeam, 'players'>; teamB: Pick<MatchTeam, 'players'> }, scoring: boolean) {
  const p = [...rosterErrors(m.teamA, m.teamB), ...(scoring ? missingPlayers(m.teamA, m.teamB) : [])][0];
  if (p) throw new Error(ROSTER_MESSAGES[p.code]);
}

/** participantIds in the canonical order the Firestore rules check: team A, team B, then creator/scorer. */
export function orderedParticipants(a: Pick<MatchTeam, 'players'>, b: Pick<MatchTeam, 'players'>, extra: string[]): string[] {
  const out: string[] = [];
  for (const id of [...a.players.map((p) => p.id), ...b.players.map((p) => p.id), ...extra]) if (!out.includes(id)) out.push(id);
  return out;
}

/**
 * participantIds reordered into the canonical form the Firestore rules require (team A's players,
 * team B's players, then the creator/scorer and anyone else listed). Only reorders: nobody is added
 * or dropped, so an invalid list stays invalid and is still rejected by participantsMatchRoster.
 * Every backend stores this form, so the API server, demo mode and Firestore agree on the order.
 */
export function canonicalParticipants(m: {
  teamA: Pick<MatchTeam, 'players'>;
  teamB: Pick<MatchTeam, 'players'>;
  participantIds: readonly string[];
  createdBy?: string;
  scorerId?: string;
}): string[] {
  const listed = new Set(m.participantIds);
  const order = [...m.teamA.players.map((p) => p.id), ...m.teamB.players.map((p) => p.id), m.createdBy, m.scorerId, ...m.participantIds];
  const out: string[] = [];
  for (const id of order) if (id && listed.has(id) && !out.includes(id)) out.push(id);
  // keep duplicates visible to the validator (canonical order can't hide them)
  return out.length === m.participantIds.length ? out : [...m.participantIds];
}

/**
 * participantIds must be exactly both teams' players plus, optionally, the creator and the scorer
 * (nobody twice, nobody else). Same as participantsOk()/playersOk() in firestore.rules, which also
 * fix the order (see orderedParticipants). This compares them as a set; every backend then stores
 * canonicalParticipants() so the stored order always matches what the rules require.
 */
export function participantsMatchRoster(m: {
  teamA: Pick<MatchTeam, 'players'>;
  teamB: Pick<MatchTeam, 'players'>;
  participantIds: readonly string[];
  createdBy: string;
  scorerId: string;
}): boolean {
  const players = [...m.teamA.players, ...m.teamB.players].map((p) => p.id);
  const ids = m.participantIds;
  if (new Set(ids).size !== ids.length) return false;
  const listed = new Set(ids);
  if (!players.every((p) => listed.has(p))) return false;
  const allowed = new Set([...players, m.createdBy, m.scorerId]);
  return ids.every((x) => allowed.has(x));
}
export const PARTICIPANTS_MESSAGE = 'Participants must be the players of both teams (plus the creator or scorer)';

/**
 * A legacy match left with fewer than MIN_PLAYERS (players removed by migration 0002, or written
 * before the rule) can't be scored, but its scorer may still close it: only the status (and the
 * finish time) change, to 'abandoned'. Nothing else about scoring is relaxed.
 */
export function isAbandonOnly(changed: readonly string[], afterStatus: string): boolean {
  return afterStatus === 'abandoned' && changed.every((k) => k === 'status' || k === 'finishedAt' || k === 'updatedAt');
}

/** Tournaments take registered teams only (their rosters become the fixture rosters). */
export const TOURNAMENT_TEAMS_MESSAGE = 'Tournament teams must be registered teams';

/** A registered team can play (New Match, challenges, tournaments) once it has this many members. */
export const teamCanPlay = (t: Pick<Team, 'memberIds'>) => t.memberIds.length >= MIN_PLAYERS;
export const TEAM_TOO_SMALL_MESSAGE = `A team needs at least ${MIN_PLAYERS} players to play`;
export const ROSTER_LOCKED_MESSAGE = 'Players can only be changed before the first rally';

/**
 * Why a tournament's team list can't be used, or null. Shared by the demo and Firebase backends
 * (the API server and firestore.rules check the same): at least 2 teams, nobody twice, every team
 * registered and able to play (MIN_PLAYERS members).
 */
export function tournamentTeamsProblem(teams: readonly { id: string }[], lookup: (id: string) => Pick<Team, 'memberIds'> | null | undefined): string | null {
  const ids = teams.map((t) => t.id);
  if (new Set(ids).size !== ids.length) return 'Duplicate team ids';
  if (ids.length < 2) return 'Need at least 2 teams';
  for (const id of ids) {
    const t = lookup(id);
    if (!t) return TOURNAMENT_TEAMS_MESSAGE;
    if (!teamCanPlay(t)) return TEAM_TOO_SMALL_MESSAGE;
  }
  return null;
}

/**
 * Teams a tournament organiser may add (QA B121-2): registered teams not already in the list that can
 * field MIN_PLAYERS (tournamentTeamsProblem, the API server and firestore.rules tTeamOk refuse others).
 */
export function tournamentCandidates<T extends { id: string } & Pick<Team, 'memberIds'>>(results: readonly T[], chosenIds: readonly string[]): { offered: T[]; tooSmall: T[] } {
  const rest = results.filter((t) => !chosenIds.includes(t.id));
  return { offered: rest.filter(teamCanPlay), tooSmall: rest.filter((t) => !teamCanPlay(t)) };
}

export const TOURNAMENT_ORGANIZER_MESSAGE = 'Only the organiser can change this tournament';
export const CHALLENGE_CAPTAIN_MESSAGE = 'Only the team captain can send a challenge for this team';
export const CHALLENGE_SAME_TEAM_MESSAGE = 'A team cannot challenge itself';
/** Why a challenge can't be sent, or null (demo and Firebase backends; the rules and API check the same). */
export function challengeProblem(
  c: { fromTeamId: string; toTeamId: string; fromCaptainId: string; toCaptainId: string },
  from: Pick<Team, 'memberIds' | 'captainId'> | null | undefined,
  to: Pick<Team, 'memberIds' | 'captainId'> | null | undefined,
  me: string | null,
): string | null {
  if (!from || !to) return 'Team not found';
  if (c.fromTeamId === c.toTeamId) return CHALLENGE_SAME_TEAM_MESSAGE;
  if (from.captainId !== c.fromCaptainId || (me && me !== c.fromCaptainId) || to.captainId !== c.toCaptainId) return CHALLENGE_CAPTAIN_MESSAGE;
  if (!teamCanPlay(from) || !teamCanPlay(to)) return TEAM_TOO_SMALL_MESSAGE;
  return null;
}

