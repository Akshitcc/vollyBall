/**
 * 1.4.27 (Akshit, E2E-4): a whole tournament over 10 teams THROUGH THE API, the way app/tournament/[id].tsx runs it –
 * "groups" (groups + knockout: group round robins, then the seeded bracket filled from the group tables) or "playin"
 * (a knockout of a field that is not a power of two: the play-in round, then the bracket). Every match is scored,
 * POTM set; the organiser also tries the things that must be refused (a knockout slot before its groups are done,
 * editing a played fixture, a non-owner edit). Used by tests/groups1427.test.ts and scripts/db-audit.ts --groups.
 */
import { buildMatch } from '../../src/core/buildMatch';
import { INDOOR_RULES, type RuleSet } from '../../src/core/rules';
import { assignGroups, defaultGroupPlan, generateGroupsKnockout, groupId, groupTables, playIn, resolveFixtures } from '../../src/core/groups';
import { generateKnockout, type Fixture, type FixtureResult } from '../../src/core/tournament';
import { makeTeam, makeUsers, matchTeam, playSets, registerUser, type ClientFor, type Res, type SimUser } from './auditSim';

const must = (r: Res, ok: number[], what: string) => {
  if (!ok.includes(r.status)) throw new Error(`${what}: HTTP ${r.status} ${JSON.stringify(r.body).slice(0, 400)}`);
  return r.body;
};

export interface GroupsRunReport {
  tournamentId: string;
  mode: 'groups' | 'playin';
  teams: number;
  planned: number;
  played: number;
  groupMatches: number;
  knockoutMatches: number;
  champion: string | null;
  expectedChampion: string | null;
  tables: { group: string; order: string[]; complete: boolean }[];
  qualifiersOk: boolean;
  refused: { earlySlot: number; earlyCode?: string; lockedEdit: number; lockedCode?: string; nonOwner: number };
  matchIds: string[];
  names: Record<string, string>;
}

/** Strength = registration order (team 1 strongest), with a few upsets so the tables are not trivially ordered. */
const upset = (round: number, index: number) => (round * 7 + index * 3) % 5 === 0;

export async function simulateGroups(c: ClientFor, opts: { teams: number; mode: 'groups' | 'playin'; prefix: string; phoneBase: number }): Promise<GroupsRunReport> {
  const { teams: n, mode, prefix: P } = opts;
  const users = makeUsers(P, n * 6 + 2, opts.phoneBase);
  for (const [i, u] of users.entries()) await registerUser(c, u, i);
  const as = (u: SimUser) => c(u.uid, u.phone);
  const org = users[n * 6];
  const stranger = users[n * 6 + 1];
  const teamIds: string[] = [];
  for (let i = 0; i < n; i++) teamIds.push(await makeTeam(c, `${P} T${String(i + 1).padStart(2, '0')}`, users.slice(i * 6, i * 6 + 6), ['#E53935', '#1E88E5', '#43A047', '#FB8C00', '#8E24AA', '#00897B'][i % 6]));
  const rank = new Map(teamIds.map((id, i) => [id, i]));
  const names: Record<string, string> = {};
  for (const id of teamIds) names[id] = must(await as(org)('GET', `/api/teams/${id}`), [200], 'team').name;
  const rules: RuleSet = { ...INDOOR_RULES, bestOf: 3, pointsPerSet: 15, decidingSetPoints: 15 };
  const day = 86_400_000;
  let body: Record<string, unknown>;
  let planned: number;
  if (mode === 'groups') {
    const plan = defaultGroupPlan(n)!;
    const groups = assignGroups(teamIds, plan.groups, 'seeded');
    body = {
      format: 'groups', advance: plan.advance,
      teams: teamIds.map((id) => ({ id, name: names[id], color: '#E53935', group: groupId(groups.findIndex((g) => g.includes(id))) })),
      fixtures: generateGroupsKnockout(groups, plan.advance),
    };
    planned = plan.total;
  } else {
    body = { format: 'knockout', teams: teamIds.map((id) => ({ id, name: names[id], color: '#E53935' })), fixtures: generateKnockout(teamIds) };
    planned = playIn(n).total;
  }
  const tid = must(await as(org)('POST', '/api/tournaments', {
    name: `${P} ${mode === 'groups' ? 'Groups Cup' : 'Play-in Cup'}`, organizerId: org.uid, rules, startDate: Date.now() + day, endDate: Date.now() + 3 * day,
    location: { name: 'Thyagaraj Stadium', lat: 28.58, lng: 77.21 }, status: 'running', ...body,
  }), [201], `create ${mode} tournament`).id as string;

  const results: FixtureResult[] = [];
  const matchIds: string[] = [];
  const refused: GroupsRunReport['refused'] = { earlySlot: 0, lockedEdit: 0, nonOwner: 0 };
  let groupMatches = 0;
  let knockoutMatches = 0;

  const play = async (t: any, f: Fixture) => {
    const [h, w] = [await matchTeam(c, org, f.homeId!), await matchTeam(c, org, f.awayId!)];
    const md = buildMatch({ teamA: h.mt, teamB: w.mt, rules: t.rules, createdBy: org.uid, scorerId: org.uid, startNow: true, scheduledAt: Date.now(), title: `${t.name} · ${f.group ? `Group ${f.group}` : `R${f.round}`}`, tournamentId: tid, fixtureId: f.id, captains: { A: h.captainId, B: w.captainId }, location: t.location });
    const mid = must(await as(org)('POST', '/api/matches', md), [201], `create ${f.id}`).id as string;
    const cur = must(await as(org)('GET', `/api/tournaments/${tid}`), [200], 'reload');
    must(await as(org)('PATCH', `/api/tournaments/${tid}`, { fixtures: cur.fixtures.map((x: Fixture) => (x.id === f.id ? { ...x, matchId: mid } : x)) }), [200], `claim ${f.id}`);
    const homeStronger = rank.get(f.homeId!)! < rank.get(f.awayId!)!;
    const homeWins = upset(f.round, f.index) ? !homeStronger : homeStronger;
    const sets: ('A' | 'B')[] = homeWins ? (f.index % 2 ? ['A', 'A'] : ['A', 'B', 'A']) : f.index % 2 ? ['B', 'B'] : ['B', 'A', 'B'];
    const ev = playSets(t.rules, sets, { A: h.mt.players.map((p) => p.id), B: w.mt.players.map((p) => p.id) });
    must(await as(org)('PUT', `/api/matches/${mid}/progress`, { events: ev.slice(0, Math.floor(ev.length / 2)), status: 'live' }), [200], `half ${f.id}`);
    const m = must(await as(org)('PUT', `/api/matches/${mid}/progress`, { events: ev, status: 'live' }), [200], `finish ${f.id}`);
    if (m.status !== 'finished') throw new Error(`${f.id} not finished`);
    must(await as(org)('PUT', `/api/matches/${mid}/player-of-match`, { playerId: (homeWins ? h : w).mt.players[1].id }), [200], `potm ${f.id}`);
    const sc = m.summary.setScores as { a: number; b: number }[];
    results.push({ fixtureId: f.id, homeSets: m.summary.setsA, awaySets: m.summary.setsB, homePoints: sc.reduce((x, s) => x + s.a, 0), awayPoints: sc.reduce((x, s) => x + s.b, 0) });
    matchIds.push(mid);
    if (f.group) groupMatches++;
    else knockoutMatches++;
  };

  let probedEarly = false;
  let probedLock = false;
  for (let guard = 0; guard < 200; guard++) {
    const t = must(await as(org)('GET', `/api/tournaments/${tid}`), [200], 'get tournament');
    const res = resolveFixtures(t, results, names);
    const done = new Set(results.map((r) => r.fixtureId));
    const ready = res.fixtures.filter((f) => f.homeId && f.awayId && !done.has(f.id) && !f.matchId);
    // probes: a knockout slot before its groups are complete; a played fixture edited; a stranger editing
    if (mode === 'groups' && !probedEarly) { // before any group match: no knockout slot can start yet
      probedEarly = true;
      const slot = t.fixtures.find((f: Fixture) => f.homeSeed && f.awaySeed) as Fixture;
      const [a, b] = [teamIds[0], teamIds[1]];
      const [x, y] = [await matchTeam(c, org, a), await matchTeam(c, org, b)];
      const md = buildMatch({ teamA: x.mt, teamB: y.mt, rules: t.rules, createdBy: org.uid, scorerId: org.uid, startNow: true, tournamentId: tid, fixtureId: slot.id, captains: { A: x.captainId, B: y.captainId } });
      const r = await as(org)('POST', '/api/matches', md);
      refused.earlySlot = r.status;
      refused.earlyCode = r.body?.error;
    }
    if (!probedLock && results.length > 0) {
      probedLock = true;
      const played = results[0].fixtureId;
      const r = await as(org)('PATCH', `/api/tournaments/${tid}`, { fixtures: t.fixtures.map((f: Fixture) => (f.id === played ? { ...f, homeId: f.awayId, awayId: f.homeId } : f)) });
      refused.lockedEdit = r.status;
      refused.lockedCode = r.body?.error;
      refused.nonOwner = (await as(stranger)('PATCH', `/api/tournaments/${tid}`, { name: 'Taken over' })).status;
    }
    if (!ready.length) break;
    for (const f of ready) await play(t, f);
  }
  const t = must(await as(org)('GET', `/api/tournaments/${tid}`), [200], 'final tournament');
  const fin = resolveFixtures(t, results, names);
  const tables = mode === 'groups' ? groupTables(t, results, names) : [];
  // qualifiers: the first knockout round is exactly the cross-group seeds of the final tables
  let qualifiersOk = true;
  if (mode === 'groups') {
    const seat = new Map<string, string>();
    for (const tb of tables) tb.rows.forEach((r, i) => seat.set(`${tb.group}${i + 1}`, r.teamId));
    for (const f of fin.fixtures.filter((x: Fixture) => x.homeSeed || x.awaySeed)) {
      if (f.homeSeed && f.homeId !== seat.get(f.homeSeed)) qualifiersOk = false;
      if (f.awaySeed && f.awayId !== seat.get(f.awaySeed)) qualifiersOk = false;
    }
  }
  if (fin.championId) must(await as(org)('PATCH', `/api/tournaments/${tid}`, { status: 'finished' }), [200], 'finished');
  return {
    tournamentId: tid, mode, teams: n, planned, played: matchIds.length, groupMatches, knockoutMatches,
    champion: fin.championId, expectedChampion: null,
    tables: tables.map((tb) => ({ group: tb.group, order: tb.rows.map((r) => r.teamId), complete: tb.complete })),
    qualifiersOk, refused, matchIds, names,
  };
}
