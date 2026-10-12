/**
 * The match document a new match starts from (moved out of services/matchFactory.ts in 1.4.4 so the
 * rules tests build their create documents with the app's own code, QA V143-5). Pure: no backend.
 */
import type { Place } from './geo';
import type { RuleSet } from './rules';
import { orderedParticipants } from './roster';
import { computeState, summarize, type Side } from './scoring';
import { distinctColor, type Match, type MatchCaptains, type MatchTeam } from './types';

/** Same shape as services/backend NewMatch. */
export type NewMatchDoc = Omit<Match, 'id' | 'createdAt' | 'updatedAt'>;

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
}): NewMatchDoc {
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
