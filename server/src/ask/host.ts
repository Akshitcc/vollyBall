/**
 * 1.5.0 Ask VolleyLive: the server ToolHost. Every method runs AS the signed-in user and returns only what that user
 * could read through the normal API routes (the same viewer-scoped domain functions: viewTeam hides other people's
 * pending invite numbers, loadMatches applies the viewer, rankings are public totals). Player lookup by name selects
 * id + name only. The tools (src/core/ask/tools.ts) then whitelist public fields again.
 */
import type { Services } from '../context';
import type { Identity } from '../auth/verifier';
import * as teams from '../domain/teams';
import * as matches from '../domain/matches';
import * as rankings from '../domain/rankings';
import * as challenges from '../domain/challenges';
import * as tournaments from '../domain/tournaments';
import type { ToolHost } from '../../../src/core/ask/tools';
import { toRow, type RankingRow } from '../../../src/core/ranking';
import type { Match } from '../../../src/core/types';

const like = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

export function serverToolHost(s: Services, viewer: Identity): ToolHost {
  let rk: ReturnType<typeof rankings.getRankings> | null = null;
  const allRankings = () => (rk ??= rankings.getRankings(s, viewer.uid, rankings.RANKINGS_MAX_LIMIT));
  const myTeams = async () => (await teams.teamsForMember(s.db, viewer.uid)).map((t) => teams.viewTeam(t, viewer));
  return {
    viewerId: viewer.uid,
    async rankings(limit) {
      const r = await allRankings();
      return { ranked: r.ranked.slice(0, limit), me: r.me, total: r.total };
    },
    async playerTotals(uid) {
      const r = await allRankings();
      const ranked = r.ranked.find((x) => x.playerId === uid);
      if (ranked) return ranked as RankingRow;
      const [t] = await rankings.rankingTotals(s, s.db, uid);
      return t ? toRow(t) : null;
    },
    async findPlayers(q) {
      const words = q.toLocaleLowerCase().split(/\s+/).filter((w) => [...w].length >= 2).slice(0, 4);
      if (!words.length) return [];
      const rows: { id: string; name: string }[] = await s.db('users').select('id', 'name')
        .where((b) => { for (const w of words) b.orWhere('name', 'like', `%${like(w)}%`); })
        .orderBy('name').limit(25);
      return rows.map((r) => ({ id: r.id, name: r.name }));
    },
    async names(ids) {
      if (!ids.length) return {};
      const rows: { id: string; name: string }[] = await s.db('users').whereIn('id', ids.slice(0, 100)).select('id', 'name');
      return Object.fromEntries(rows.map((r) => [r.id, r.name]));
    },
    async myMatches() {
      const ids = await matches.listMatchIds(s.db, { participant: viewer.uid, limit: 200 });
      return (await matches.loadMatches(s, s.db, ids, viewer)) as unknown as Match[];
    },
    async liveMatches() {
      const ids = await matches.listMatchIds(s.db, { status: ['live'], limit: 50 });
      return (await matches.loadMatches(s, s.db, ids, viewer)) as unknown as Match[];
    },
    async recentMatches() {
      // 1.5.6 (F155-3): the same viewer-scoped loader as liveMatches, for a named team's latest finished match
      const ids = await matches.listMatchIds(s.db, { status: ['finished'], byFinished: true, limit: 200 });
      return (await matches.loadMatches(s, s.db, ids, viewer)) as unknown as Match[];
    },
    async teamMatches(q) {
      // 1.5.7 (F156-5): a named team outside the window – its own finished matches, same viewer-scoped loader
      const ws = q.toLocaleLowerCase().split(/\s+/).filter((w) => [...w].length >= 3).slice(0, 4);
      if (!ws.length) return [];
      const ids = await matches.listMatchIds(s.db, { status: ['finished'], byFinished: true, sideNameLike: ws, limit: 100 });
      return (await matches.loadMatches(s, s.db, ids, viewer)) as unknown as Match[];
    },
    myTeams,
    async findTeams(q) {
      const words = [q, ...q.split(/\s+/).filter((w) => [...w].length >= 3)].slice(0, 4);
      const found = (await Promise.all(words.map((w) => teams.searchTeams(s.db, w.slice(0, 40))))).flat();
      return [...new Map(found.map((t) => [t.id, teams.viewTeam(t, viewer)])).values()];
    },
    async tournaments() {
      return tournaments.loadTournaments(s.db, await tournaments.listTournamentIds(s.db));
    },
    async tournamentMatches(id) {
      const ids = await matches.listMatchIds(s.db, { tournament: id, limit: 500 });
      return (await matches.loadMatches(s, s.db, ids, viewer)) as unknown as Match[];
    },
    async challengesFor(teamIds) {
      // only the viewer's own teams (the tool passes them; re-checked here)
      const mine = new Set((await teams.teamsForMember(s.db, viewer.uid)).map((t) => t.id));
      const ids = teamIds.filter((id) => mine.has(id)).slice(0, 30);
      return ids.length ? ((await challenges.challengesForTeams(s.db, ids)) as never) : [];
    },
  };
}
