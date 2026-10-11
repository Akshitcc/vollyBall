/**
 * Client-side mirror of the API server's match write checks (server/src/domain/matches.ts writeMatch,
 * deleteMatch) and of firestore.rules (1.3.0), used by the Firebase and demo backends so all three
 * backends refuse the same writes with the same codes (QA N121-1..3, AF-14, AF-18, AF-50).
 */
import { CodedError } from './codedError';
import { captainsProblem, CAPTAIN_MESSAGES, isTerminal, statusMoveOk } from './antifraud';
import type { Match, MatchCaptains } from './types';

export const MATCH_BAD_STATUS = 'match_bad_status';
export const MATCH_TERMINAL = 'match_terminal';
export const MATCH_STATUS_MOVE = 'match_status_move';
export const SERVER_TIME = 'server_time';
export const SERVER_FIELD = 'server_field';
export const MATCH_DELETE_FORBIDDEN = 'match_delete_forbidden';

export const GUARD_MESSAGES: Record<string, string> = {
  [MATCH_BAD_STATUS]: 'A new match must be scheduled or live',
  [MATCH_TERMINAL]: 'This match is closed and can no longer be changed',
  [MATCH_STATUS_MOVE]: "This match can't change to that status",
  [SERVER_TIME]: 'Start and finish times are set by the server',
  [SERVER_FIELD]: 'This field is set by the server only',
  [MATCH_DELETE_FORBIDDEN]: 'Only an admin can delete a finished match; a live match can’t be deleted',
};
const fail = (code: string): never => {
  throw new CodedError(code, GUARD_MESSAGES[code] ?? CAPTAIN_MESSAGES[code as keyof typeof CAPTAIN_MESSAGES] ?? code);
};

/** Fields no client may write on a match (server/rules-set). */
export const MATCH_SERVER_FIELDS = ['verification', 'startedServerAt', 'finishedServerAt'] as const;

type CreateInput = Pick<Match, 'status' | 'teamA' | 'teamB'> & { captains?: MatchCaptains | null } & Partial<Pick<Match, 'playerOfMatchId' | 'finishedAt'>> & Record<string, unknown>;

/**
 * A new match: scheduled or live only (AF-18 / N121-2), no POTM, no finish time, no server fields,
 * and valid captains (`teamCaptains` = the registered teams' captains).
 */
export function guardCreate(m: CreateInput, teamCaptains: { A?: string | null; B?: string | null }): void {
  if (m.status !== 'scheduled' && m.status !== 'live') fail(MATCH_BAD_STATUS);
  if (m.playerOfMatchId != null || m.finishedAt != null) fail(MATCH_BAD_STATUS);
  if (MATCH_SERVER_FIELDS.some((k) => m[k] != null)) fail(SERVER_FIELD);
  const c = captainsProblem(m, teamCaptains);
  if (c) throw new CodedError(c, CAPTAIN_MESSAGES[c]);
}

/**
 * A metadata update (PATCH): no client times or server fields (N121-3, INFO), nothing on a terminal
 * match except "I want to play", no handover after the end, and one-way statuses (N121-1).
 */
export function guardUpdate(before: Match, patch: Partial<Match>): void {
  const keys = Object.keys(patch).filter((k) => k !== 'updatedAt');
  if (keys.includes('startedAt') || keys.includes('finishedAt')) fail(SERVER_TIME);
  if (keys.some((k) => (MATCH_SERVER_FIELDS as readonly string[]).includes(k))) fail(SERVER_FIELD);
  if (keys.includes('playerOfMatchId')) fail('potm_use_endpoint');
  const changed = keys.filter((k) => JSON.stringify((patch as Record<string, unknown>)[k]) !== JSON.stringify((before as unknown as Record<string, unknown>)[k]));
  if (isTerminal(before) && changed.some((k) => k !== 'interestedIds')) fail(MATCH_TERMINAL);
  if ((before.status === 'finished' || before.status === 'abandoned') && changed.includes('scorerId')) fail(MATCH_TERMINAL);
  if (patch.status && !statusMoveOk(before, patch.status)) fail(MATCH_STATUS_MOVE);
  if (changed.includes('captains') && before.events.length > 0) fail(MATCH_TERMINAL);
}

/** Scoring progress: never on a terminal match; the status move must be allowed. */
export function guardProgress(before: Match, nextStatus: Match['status']): void {
  if (isTerminal(before)) fail(MATCH_TERMINAL);
  if (!statusMoveOk(before, nextStatus)) fail(MATCH_STATUS_MOVE);
}

/** Server start/finish stamps for a status change (server time only; `now` = the server clock where there is one). */
export function stampTimes(before: Pick<Match, 'status' | 'startedAt' | 'finishedAt'> | null, next: Match['status'], now: number) {
  const out: { startedAt?: number | null; startedServerAt?: number | null; finishedAt?: number | null; finishedServerAt?: number | null } = {};
  const from = before?.status ?? null;
  if (next === 'live' && (from === null || from === 'scheduled') && before?.startedAt == null) {
    out.startedAt = now;
    out.startedServerAt = now;
  }
  if (next === 'scheduled' && from === 'live') {
    out.startedAt = null;
    out.startedServerAt = null;
  }
  if (next === 'finished' && from !== 'finished') {
    out.finishedAt = now;
    out.finishedServerAt = now;
  }
  if (next === 'live' && from === 'finished') {
    out.finishedAt = null;
    out.finishedServerAt = null;
  }
  return out;
}

/** Delete (AF-50 / N121-3): never live; a finished match only by an admin; otherwise its creator or an admin. */
export function deleteProblem(m: Pick<Match, 'status' | 'createdBy'>, uid: string | null | undefined, admin: boolean): string | null {
  if (m.status === 'live') return MATCH_DELETE_FORBIDDEN;
  if (admin) return null;
  if (m.status === 'finished') return MATCH_DELETE_FORBIDDEN;
  return uid && uid === m.createdBy ? null : MATCH_DELETE_FORBIDDEN;
}
