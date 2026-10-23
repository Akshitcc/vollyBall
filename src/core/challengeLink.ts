/**
 * 1.5.1 (Tester F150-1): a challenge match is created ONLY by the challenged captain's Accept, atomically with the
 * accept (API POST /challenges/:id/accept, demo acceptChallenge). A plain create that claims a challenge is always
 * refused (pending → challenge_pending, declined / cancelled → challenge_closed, accepted → challenge_used), an answer
 * (PATCH) never links a match, and an accept without its match is refused (challenge_accept_match). So a pending,
 * declined or cancelled challenge never has a match, and a decline can never leave one behind.
 *
 * 1.5.0 (Tester F1428-2): the challenge ↔ match link, one rule set for the API and the demo backend.
 *  - A match may carry a challengeId only when it is created by a captain of one of the challenge's two teams, is
 *    played by exactly those two teams, and the challenge is still open (pending, or accepted without a live match).
 *  - Accepting links a matchId only if that match carries this challengeId, has the two teams and was created by
 *    one of the two captains. A decline / cancel never carries a match.
 *  - The link is frozen once the match exists (a later update can't add, move or drop it).
 */
import type { Challenge } from './types';

export const CHALLENGE_UNKNOWN = 'challenge_unknown';
export const CHALLENGE_NOT_CAPTAIN = 'challenge_not_captain';
export const CHALLENGE_CLOSED = 'challenge_closed';
export const CHALLENGE_USED = 'challenge_used';
export const CHALLENGE_TEAMS = 'challenge_teams';
export const CHALLENGE_MATCH_INVALID = 'challenge_match_invalid';
export const CHALLENGE_LINK_FROZEN = 'challenge_link_frozen';
export const CHALLENGE_PENDING = 'challenge_pending';
export const CHALLENGE_ACCEPT_MATCH = 'challenge_accept_match';
export const CHALLENGE_CODES = [CHALLENGE_UNKNOWN, CHALLENGE_NOT_CAPTAIN, CHALLENGE_CLOSED, CHALLENGE_USED, CHALLENGE_TEAMS, CHALLENGE_MATCH_INVALID, CHALLENGE_LINK_FROZEN, CHALLENGE_PENDING, CHALLENGE_ACCEPT_MATCH] as const;
export type ChallengeLinkCode = (typeof CHALLENGE_CODES)[number];

/** HTTP status per code (4xx). */
export const CHALLENGE_LINK_STATUS: Record<ChallengeLinkCode, number> = {
  challenge_unknown: 404, challenge_not_captain: 403, challenge_closed: 409, challenge_used: 409, challenge_teams: 400, challenge_match_invalid: 400, challenge_link_frozen: 400, challenge_pending: 409, challenge_accept_match: 400,
};
export const CHALLENGE_LINK_MESSAGES: Record<ChallengeLinkCode, string> = {
  challenge_unknown: 'This challenge does not exist',
  challenge_not_captain: "Only the two teams' captains can play a challenge",
  challenge_closed: 'This challenge was declined or cancelled',
  challenge_used: 'This challenge already has a match',
  challenge_teams: "A challenge match must be played by the challenge's two teams",
  challenge_match_invalid: 'That match does not belong to this challenge',
  challenge_link_frozen: 'The challenge of a match cannot be changed',
  challenge_pending: 'Only the challenged captain can create this match, by accepting the challenge',
  challenge_accept_match: 'Accepting a challenge creates its match – please update the app',
};

type C = Pick<Challenge, 'id' | 'fromTeamId' | 'toTeamId' | 'fromCaptainId' | 'toCaptainId' | 'status'> & { matchId?: string | null };
interface MatchLike { challengeId?: string | null; createdBy: string; teamA: { teamId?: string | null }; teamB: { teamId?: string | null }; status?: string }

const sameTeams = (c: C, m: MatchLike) => {
  const a = m.teamA.teamId ?? null;
  const b = m.teamB.teamId ?? null;
  return (a === c.fromTeamId && b === c.toTeamId) || (a === c.toTeamId && b === c.fromTeamId);
};
const isCaptain = (c: C, uid: string | null | undefined) => !!uid && (uid === c.fromCaptainId || uid === c.toCaptainId);

/**
 * 1.5.1 (F150-1): a plain create (POST /matches, demo createMatch) that claims `c` – always refused with the reason
 * (null `c` = unknown id). Only challengeAcceptProblem's path creates a challenge match.
 */
export function challengeCreateProblem(c: C | null, m: MatchLike, actor: string | null | undefined, _activeMatch?: boolean): ChallengeLinkCode {
  if (!c) return CHALLENGE_UNKNOWN;
  if (!isCaptain(c, actor) || m.createdBy !== actor) return CHALLENGE_NOT_CAPTAIN;
  if (c.status === 'declined' || c.status === 'cancelled') return CHALLENGE_CLOSED;
  if (c.status === 'accepted') return CHALLENGE_USED;
  return CHALLENGE_PENDING;
}

/** 1.5.1 (F150-1): the challenged captain accepting `c` and creating its match `m` in the same step. */
export function challengeAcceptProblem(c: C | null, m: MatchLike, actor: string | null | undefined): ChallengeLinkCode | null {
  if (!c) return CHALLENGE_UNKNOWN;
  if (!actor || actor !== c.toCaptainId || m.createdBy !== actor) return CHALLENGE_NOT_CAPTAIN;
  if (c.status === 'declined' || c.status === 'cancelled') return CHALLENGE_CLOSED;
  if (c.status !== 'pending' || c.matchId) return CHALLENGE_USED;
  if ((m.challengeId ?? c.id) !== c.id) return CHALLENGE_MATCH_INVALID;
  if (!sameTeams(c, m)) return CHALLENGE_TEAMS;
  return null;
}

/**
 * Answering `c` (PATCH): `nextStatus` / `matchId` as sent. 1.5.1 (F150-1): an answer never links a match – only the
 * same, already linked id is a no-op – and an accept must come with its match (challengeAcceptProblem's path).
 */
export function challengeRespondLinkProblem(c: C, nextStatus: Challenge['status'], matchId: string | null | undefined, _m?: MatchLike | null): ChallengeLinkCode | null {
  if (matchId && matchId !== (c.matchId ?? null)) return CHALLENGE_MATCH_INVALID;
  if (!matchId && c.matchId && matchId !== undefined) return CHALLENGE_MATCH_INVALID;
  if (nextStatus === 'accepted' && c.status === 'pending') return CHALLENGE_ACCEPT_MATCH;
  return null;
}
