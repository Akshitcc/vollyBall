import type { Place } from '../core/geo';
import type { RuleSet } from '../core/rules';
import { orderedParticipants, TEAM_TOO_SMALL_MESSAGE, teamCanPlay } from '../core/roster';
import { computeState, summarize, type Side } from '../core/scoring';
import { CHALLENGE_MATCH_TITLE, distinctColor, type Challenge, type MatchCaptains, type MatchTeam, type Team } from '../core/types';
import { backend, type NewMatch } from './backend';
import { isPastStart } from '../core/dates';

export async function matchTeamFromTeam(team: Team): Promise<MatchTeam> {
  const profiles = await backend.getProfiles(team.memberIds);
  const byId = new Map(profiles.map((p) => [p.id, p]));
  // starters first, then subs
  const ordered = [...team.memberIds.filter((i) => !team.subIds.includes(i)), ...team.subIds];
  return {
    teamId: team.id,
    name: team.name,
    color: team.color,
    // Only members with a profile (registered users) play; ids, not typed names.
    players: ordered.filter((id) => byId.has(id)).map((id) => ({ id, name: byId.get(id)!.name, photoURL: byId.get(id)!.photoURL ?? null })),
  };
}

export function buildMatch(input: {
  teamA: MatchTeam;
  teamB: MatchTeam;
  rules: RuleSet;
  createdBy: string;
  scorerId: string;
  firstServe?: Side;
  location?: Place | null;
  scheduledAt?: number | null;
  startNow?: boolean;
  title?: string;
  tournamentId?: string | null;
  fixtureId?: string | null;
  challengeId?: string | null;
  /** 1.3.0: a registered team's captain; for a side built by number, the player the creator named. */
  captains?: MatchCaptains | null;
}): NewMatch {
  const firstServe = input.firstServe ?? 'A';
  // Both sides must be told apart on the scoreboard: team B switches colour if it clashes (QA bug F).
  const teamB = { ...input.teamB, color: distinctColor(input.teamB.color, [input.teamA.color]) };
  // Team A players, team B players, then creator/scorer: the order the Firestore rules check.
  const participants = orderedParticipants(input.teamA, teamB, [input.createdBy, input.scorerId]);
  return {
    title: input.title,
    teamA: input.teamA,
    teamB,
    rules: input.rules,
    firstServe,
    events: [],
    summary: summarize(computeState(input.rules, [], firstServe)),
    status: input.startNow ? 'live' : 'scheduled',
    createdBy: input.createdBy,
    scorerId: input.scorerId,
    participantIds: participants,
    location: input.location ?? null,
    scheduledAt: input.scheduledAt ?? null,
    // set by the backend's clock when the match goes live (server time only, QA AF-14 / N121-3)
    startedAt: null,
    captains: input.captains ?? null,
    finishedAt: null,
    tournamentId: input.tournamentId ?? null,
    fixtureId: input.fixtureId ?? null,
    challengeId: input.challengeId ?? null,
    stream: null,
    interestedIds: [],
  };
}

/** Called by the challenged captain when accepting. */
export async function acceptChallenge(c: Challenge, myUid: string, teams: { from: Team; to: Team }) {
  if (!teamCanPlay(teams.from) || !teamCanPlay(teams.to)) throw new Error(TEAM_TOO_SMALL_MESSAGE);
  const [a, b] = await Promise.all([matchTeamFromTeam(teams.from), matchTeamFromTeam(teams.to)]);
  const id = await backend.createMatch(
    buildMatch({
      teamA: a,
      teamB: b,
      rules: c.rules,
      createdBy: myUid,
      scorerId: c.fromCaptainId,
      location: c.location,
      // Accepted after the agreed time: schedule it for now (a past start time is rejected, QA G9).
      scheduledAt: isPastStart(c.when) ? Date.now() : c.when,
      title: CHALLENGE_MATCH_TITLE,
      challengeId: c.id,
      captains: { A: teams.from.captainId, B: teams.to.captainId },
    }),
  );
  await backend.respondToChallenge(c, 'accepted', id);
  return id;
}

/** Resolve the first value of a watcher, then unsubscribe. */
export function getOnce<T>(subscribe: (cb: (v: T) => void) => () => void): Promise<T> {
  return new Promise((resolve) => {
    let done = false;
    let unsub: (() => void) | null = null;
    unsub = subscribe((v) => {
      if (done) return;
      done = true;
      resolve(v);
      if (unsub) unsub();
      else setTimeout(() => unsub?.(), 0);
    });
    if (done) unsub();
  });
}
