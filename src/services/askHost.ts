/**
 * 1.5.0 Ask VolleyLive without our API server (demo backend, Firebase build): a ToolHost over the app's own Backend
 * calls for the signed-in user, so the tools read exactly what the app itself may read (demo data / Firestore rules).
 * Player lookup by name uses public names only (the rankings list and the members of my teams).
 */
import type { ToolHost } from '../core/ask/tools';
import type { RankingRow } from '../core/ranking';
import type { Backend } from './backend/types';
import type { Team } from '../core/types';

function once<T>(subscribe: (cb: (v: T) => void) => () => void, timeoutMs = 4000): Promise<T> {
  return new Promise((resolve, reject) => {
    let done = false;
    let unsub: (() => void) | null = null;
    const timer = setTimeout(() => { if (!done) { done = true; unsub?.(); reject(new Error('timeout')); } }, timeoutMs);
    unsub = subscribe((v) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(v);
      if (unsub) unsub();
      else setTimeout(() => unsub?.(), 0);
    });
    if (done) unsub();
  });
}

export function backendToolHost(b: Backend, viewerId: string): ToolHost {
  let rankingsP: ReturnType<Backend['getRankings']> | null = null;
  const rankings = () => (rankingsP ??= b.getRankings(viewerId));
  const myTeams = () => once<Team[]>((cb) => b.watchMyTeams(viewerId, cb));
  return {
    viewerId,
    async rankings(limit) { const r = await rankings(); return { ranked: r.ranked.slice(0, limit), me: r.me, total: r.total }; },
    async playerTotals(uid) {
      const r = await rankings();
      if (uid === viewerId) return r.me;
      return (r.ranked.find((x) => x.playerId === uid) as RankingRow | undefined) ?? null;
    },
    async findPlayers() {
      const r = await rankings();
      const teams: Team[] = await myTeams().catch(() => []);
      const ids = [...new Set(teams.flatMap((t) => t.memberIds))].filter((id) => !r.ranked.some((x) => x.playerId === id));
      const profiles = ids.length ? await b.getProfiles(ids.slice(0, 60)).catch(() => []) : [];
      return [...r.ranked.map((x) => ({ id: x.playerId, name: x.name ?? '' })), ...profiles.map((p) => ({ id: p.id, name: p.name }))].filter((x) => x.name);
    },
    async names(ids) {
      const profiles = ids.length ? await b.getProfiles(ids.slice(0, 60)).catch(() => []) : [];
      return Object.fromEntries(profiles.map((p) => [p.id, p.name]));
    },
    myMatches: () => once((cb) => b.watchMyMatches(viewerId, cb)),
    liveMatches: () => once((cb) => b.watchLiveMatches(cb)),
    myTeams,
    async findTeams(q) { return b.searchTeams(q.toLocaleLowerCase().slice(0, 40)).catch(() => []); },
    tournaments: () => once((cb) => b.watchTournaments(cb)),
    tournamentMatches: (id) => once((cb) => b.watchTournamentMatches(id, cb)),
    challengesFor: (teamIds) => once((cb) => b.watchChallenges(teamIds, cb)),
  };
}
