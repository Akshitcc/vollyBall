import { TEAM_TOO_SMALL_MESSAGE, teamCanPlay } from '../core/roster';
import { buildMatch } from '../core/buildMatch';
export { buildMatch };
import { CHALLENGE_MATCH_TITLE, type Challenge, type MatchTeam, type Team } from '../core/types';
import { backend } from './backend';
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
