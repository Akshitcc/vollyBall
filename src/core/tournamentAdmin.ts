/**
 * 1.4.19: tournament admin permissions – one shared check for core/demo, the app, the API server and (mirrored) the
 * Firestore rules, like verdictSetupChanged.
 *
 * The user who creates a tournament (`organizerId`) is its owner and only admin. Only the owner edits it (teams,
 * players / rosters, fixtures, groups / brackets, rules, dates, venue, status) or deletes it, and only the owner links a
 * match to it (a match's tournamentId / fixtureId feeds the standings, so a stranger's match must not count). Everyone
 * else – including app-wide admins, who keep their match review powers – is read-only on the tournament.
 * A tournament without an owner (an older / broken doc) has no admin: nobody can edit or delete it.
 */
import { CodedError } from './codedError';

export const NOT_TOURNAMENT_ADMIN = 'not_tournament_admin';
export const NOT_TOURNAMENT_ADMIN_MESSAGE = 'Only the tournament owner can change this tournament';
/** The match keys that tie a match to a tournament (set once, at create, by the owner). */
export const TOURNAMENT_LINK_KEYS = ['tournamentId', 'fixtureId'] as const;

type Owned = { organizerId?: string | null } | null | undefined;

/** Is `uid` the owner (and so the admin) of this tournament? */
export function isTournamentAdmin(t: Owned, uid: string | null | undefined): boolean {
  return !!uid && !!t && typeof t.organizerId === 'string' && t.organizerId.length > 0 && t.organizerId === uid;
}

/** What a non-owner sees: read-only. */
export const tournamentViewOnly = (t: Owned, uid: string | null | undefined) => !!t && !isTournamentAdmin(t, uid);

export function assertTournamentAdmin(t: Owned, uid: string | null | undefined): void {
  if (!isTournamentAdmin(t, uid)) throw new CodedError(NOT_TOURNAMENT_ADMIN, NOT_TOURNAMENT_ADMIN_MESSAGE);
}

/** An edit: the owner only, and the owner can't be changed (no hand-over yet). */
export function guardTournamentEdit(t: Owned, uid: string | null | undefined, patch: { organizerId?: unknown }): void {
  assertTournamentAdmin(t, uid);
  if ('organizerId' in patch && patch.organizerId !== t!.organizerId) throw new CodedError(NOT_TOURNAMENT_ADMIN, NOT_TOURNAMENT_ADMIN_MESSAGE);
}

/**
 * A match create / update and its tournament link: a new link needs the tournament's owner; an existing link never
 * changes. `lookup` returns the tournament (null = not found). Returns an error code or null.
 */
export function tournamentLinkProblem(
  before: { tournamentId?: string | null; fixtureId?: string | null } | null,
  after: { tournamentId?: string | null; fixtureId?: string | null },
  uid: string | null | undefined,
  lookup: (id: string) => Owned,
): string | null {
  const b = before ?? {};
  const changed = TOURNAMENT_LINK_KEYS.some((k) => (b[k] ?? null) !== (after[k] ?? null));
  if (!changed) return null;
  if (before) return NOT_TOURNAMENT_ADMIN; // the link is fixed at create
  if ((after.fixtureId ?? null) !== null && (after.tournamentId ?? null) === null) return NOT_TOURNAMENT_ADMIN;
  return isTournamentAdmin(lookup(after.tournamentId as string), uid) ? null : NOT_TOURNAMENT_ADMIN;
}

/**
 * The tournament's matches that count (standings, bracket, results): only those the owner claimed in a fixture
 * (fixture.matchId == match.id and match.fixtureId == fixture.id). A match anyone else tagged with this
 * tournamentId / fixtureId (possible on Firebase, where the create rule has no budget left for the owner check) is
 * ignored.
 */
export function claimedTournamentMatches<M extends { id: string; fixtureId?: string | null }>(
  t: { fixtures: { id: string; matchId?: string | null }[] } | null | undefined,
  matches: M[],
): M[] {
  if (!t) return [];
  const claimed = new Map(t.fixtures.filter((f) => f.matchId).map((f) => [f.matchId as string, f.id]));
  return matches.filter((m) => !!m.fixtureId && claimed.get(m.id) === m.fixtureId);
}
