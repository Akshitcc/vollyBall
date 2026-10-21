/**
 * 1.4.26 DB audit: simulates real use THROUGH THE API (no direct writes) – registered users, two teams and a full
 * match (undo, an offline catch-up save, timeouts, POTM, the result confirmed), an abandoned match, and a full
 * 10-team knockout (1.4.26 size; 1.4.27 raised the limit to MAX_TOURNAMENT_TEAMS = 32, a 33-team one is refused) played round by round,
 * and a round-robin league of the same teams the way app/tournament/[id].tsx starts fixtures.
 * Shared by tests/dbaudit1426.test.ts and scripts/db-audit.ts.
 */
import { buildMatch } from '../../src/core/buildMatch';
import type { RuleSet } from '../../src/core/rules';
import { INDOOR_RULES } from '../../src/core/rules';
import { TERMS_VERSION } from '../../src/core/terms';
import { MAX_TOURNAMENT_TEAMS } from '../../src/core/limits';
import { generateKnockout, generateRoundRobin, resolveKnockout, standings, type Fixture, type FixtureResult } from '../../src/core/tournament';

export interface Res { status: number; body: any }
export type Call = (method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', path: string, body?: unknown, headers?: Record<string, string>) => Promise<Res>;
/** A client acting as one user (uid, phone). */
export type ClientFor = (uid: string, phone: string) => Call;

export interface SimUser { uid: string; phone: string; name: string }
export interface SimReport {
  users: SimUser[];
  teams: string[];
  friendly: { matchId: string; rallies: number; timeouts: number; undone: number; winner: 'A' | 'B' };
  abandonedId: string;
  support: { tickets: number; feedback: number };
  tournament: { id: string; fixtures: number; played: number; byes: number; champion: string | null; matchIds: string[] };
  league: { id: string; fixtures: number; played: number; table: { teamId: string; played: number; won: number; points: number }[]; matchIds: string[] };
  oversizeStatus: number;
}

const must = (r: Res, ok: number[], what: string) => {
  if (!ok.includes(r.status)) throw new Error(`${what}: HTTP ${r.status} ${JSON.stringify(r.body).slice(0, 400)}`);
  return r.body;
};

const FIRST = ['Aarav', 'Vihaan', 'Ishaan', 'Kabir', 'Arjun', 'Rohan', 'Priya', 'Diya', 'Ananya', 'Kavya', 'Sneha', 'Meera'];
const LAST = ['Sharma', 'Verma', 'Gupta', 'Iyer', 'Nair', 'Das', 'Rao', 'Singh', 'Patel', 'Khan'];

export function makeUsers(prefix: string, n: number, phoneBase: number): SimUser[] {
  return Array.from({ length: n }, (_, i) => ({ uid: `${prefix}${i + 1}`, phone: `+91${phoneBase + i}`, name: `${FIRST[i % FIRST.length]} ${LAST[(i * 7) % LAST.length]}` }));
}

export async function registerUser(c: ClientFor, u: SimUser, i: number) {
  const call = c(u.uid, u.phone);
  const [firstName, lastName] = u.name.split(' ');
  const year = 1975 + (i % 30);
  must(await call('POST', '/api/me/terms/accept', { version: TERMS_VERSION }), [200], `terms ${u.uid}`);
  must(await call('PUT', `/api/users/${u.uid}`, { name: u.name, phone: u.phone, position: 'any', firstName, lastName, dob: `${year}-0${1 + (i % 9)}-1${i % 9}`, pincode: `${110001 + (i % 90)}` }), [200], `register ${u.uid}`);
}

export async function makeTeam(c: ClientFor, name: string, members: SimUser[], color = '#E53935') {
  const cap = members[0];
  const id = must(await c(cap.uid, cap.phone)('POST', '/api/teams', { name, color, captainId: cap.uid, memberIds: [cap.uid], subIds: [], pendingPhones: [] }), [201], `team ${name}`).id as string;
  for (const m of members.slice(1)) {
    must(await c(cap.uid, cap.phone)('PATCH', `/api/teams/${id}`, { pendingPhones: [m.phone] }), [200], `invite ${m.uid}`);
    must(await c(m.uid, m.phone)('POST', `/api/teams/${id}/accept`), [200], `accept ${m.uid}`);
  }
  return id;
}

export async function matchTeam(c: ClientFor, viewer: SimUser, teamId: string) {
  const t = must(await c(viewer.uid, viewer.phone)('GET', `/api/teams/${teamId}`), [200], 'get team');
  const ordered: string[] = [...t.memberIds.filter((i: string) => !t.subIds.includes(i)), ...t.subIds];
  const profiles = await Promise.all(ordered.map(async (id) => must(await c(viewer.uid, viewer.phone)('GET', `/api/users/${id}`), [200], 'profile')));
  return { mt: { teamId: t.id, name: t.name, color: t.color, players: profiles.map((p: any) => ({ id: p.id, name: p.name, photoURL: p.photoURL ?? null })) }, captainId: t.captainId as string };
}

type Ev = { type: 'point' | 'timeout'; side: 'A' | 'B'; at: number; playerId?: string; kind?: string };
/** Rallies for whole sets: `winners` per set; the loser reaches target-3; one timeout per set for the loser; players rotate. */
export function playSets(rules: RuleSet, winners: ('A' | 'B')[], players: { A: string[]; B: string[] }, t0 = Date.now() - 3_600_000): Ev[] {
  const ev: Ev[] = [];
  let at = t0;
  const kinds = ['kill', 'block', 'ace', 'tip'];
  winners.forEach((w, si) => {
    const deciding = si === rules.bestOf - 1;
    const target = deciding ? rules.decidingSetPoints : rules.pointsPerSet;
    const l = w === 'A' ? 'B' : 'A';
    const lose = Math.max(0, target - 3);
    let a = 0;
    let b = 0;
    const seq: ('A' | 'B')[] = [];
    for (let i = 0; i < lose; i++) seq.push(l, w);
    while (seq.filter((x) => x === w).length < target) seq.push(w);
    for (const [i, side] of seq.entries()) {
      if (i === 4) ev.push({ type: 'timeout', side: l, at: (at += 30_000) });
      const ps = players[side];
      ev.push({ type: 'point', side, at: (at += 20_000), playerId: ps[(side === 'A' ? a++ : b++) % ps.length], kind: kinds[i % 4] });
    }
  });
  return ev;
}

export async function simulate(c: ClientFor, opts: { prefix?: string; phoneBase?: number; tournamentTeams?: number } = {}): Promise<SimReport> {
  const P = opts.prefix ?? 'au';
  const nT = opts.tournamentTeams ?? 10; // groups + knockout runs: scripts/groupsSim.ts
  const nUsersT = Math.max(nT, 15);
  const users = makeUsers(P, 12 + nUsersT * 6 + 1, opts.phoneBase ?? 9100000000);
  for (const [i, u] of users.entries()) await registerUser(c, u, i);
  const as = (u: SimUser) => c(u.uid, u.phone);

  // ---- friendly: two registered teams, best of 3 to 25 ----
  const [sqA, sqB] = [users.slice(0, 6), users.slice(6, 12)];
  const tA = await makeTeam(c, `${P} Spikers`, sqA, '#E53935');
  const tB = await makeTeam(c, `${P} Blockers`, sqB, '#1E88E5');
  const cap = sqA[0];
  const rules: RuleSet = { ...INDOOR_RULES, bestOf: 3 };
  const [a, b] = [await matchTeam(c, cap, tA), await matchTeam(c, cap, tB)];
  const doc = buildMatch({ teamA: a.mt, teamB: b.mt, rules, createdBy: cap.uid, scorerId: cap.uid, startNow: true, captains: { A: a.captainId, B: b.captainId }, location: { name: 'Lodhi Garden', lat: 28.59, lng: 77.22 } });
  const matchId = must(await as(cap)('POST', '/api/matches', doc), [201], 'create friendly').id as string;
  const players = { A: a.mt.players.map((p) => p.id), B: b.mt.players.map((p) => p.id) };
  const all = playSets(rules, ['A', 'B', 'A'], players);
  const put = (events: Ev[]) => as(cap)('PUT', `/api/matches/${matchId}/progress`, { events, status: 'live' });
  // rally by rally for the first 20 events, an Undo of 3, then an offline catch-up of 40 at once, then the rest in 10s
  for (let i = 1; i <= 20; i++) must(await put(all.slice(0, i)), [200], `rally ${i}`);
  must(await put(all.slice(0, 17)), [200], 'undo 3');
  must(await put(all.slice(0, 60)), [200], 'offline catch-up');
  for (let i = 70; i < all.length; i += 10) must(await put(all.slice(0, i)), [200], `save ${i}`);
  const fin = must(await put(all), [200], 'final rally');
  if (fin.status !== 'finished') throw new Error(`friendly not finished: ${fin.status}`);
  must(await as(cap)('PUT', `/api/matches/${matchId}/player-of-match`, { playerId: players.A[0] }), [200], 'potm');
  const capB = sqB[0];
  must(await as(capB)('POST', `/api/matches/${matchId}/confirm`), [200], 'confirm');

  // ---- an abandoned match (scorer abandons mid-set) ----
  const ab = buildMatch({ teamA: a.mt, teamB: b.mt, rules, createdBy: cap.uid, scorerId: cap.uid, startNow: true, captains: { A: a.captainId, B: b.captainId } });
  const abandonedId = must(await as(cap)('POST', '/api/matches', ab), [201], 'create abandoned').id as string;
  must(await as(cap)('PUT', `/api/matches/${abandonedId}/progress`, { events: playSets(rules, ['A'], players).slice(0, 9), status: 'live' }), [200], 'abandoned rallies');
  must(await as(cap)('POST', `/api/matches/${abandonedId}/abandon`, {}), [200], 'abandon');

  // ---- support tickets and feedback from players ----
  let tickets = 0;
  let fb = 0;
  for (const [i, u] of users.slice(0, 4).entries()) {
    must(await as(u)('POST', '/api/support/tickets', { topic: ['scoring', 'wallet', 'account', 'bug'][i], message: `Audit ticket ${i + 1}: score did not sync after the app restarted.`, appVersion: '1.4.26' }), [201], 'ticket');
    tickets++;
    must(await as(u)('POST', '/api/feedback', { stars: 1 + i, text: `Audit feedback ${i + 1}`, appVersion: '1.4.26' }), [201], 'feedback');
    fb++;
  }

  // ---- knockout: 15 teams registered, 10 of them in the knockout and the league ----
  const org = users[users.length - 1];
  const tTeams: string[] = [];
  const allTeams: string[] = [];
  for (let i = 0; i < nUsersT; i++) allTeams.push(await makeTeam(c, `${P} T${String(i + 1).padStart(2, '0')}`, users.slice(12 + i * 6, 18 + i * 6), ['#E53935', '#1E88E5', '#43A047', '#FB8C00', '#8E24AA'][i % 5]));
  tTeams.push(...allTeams.slice(0, nT));
  const teamNames = new Map<string, string>();
  for (const id of allTeams) teamNames.set(id, must(await as(org)('GET', `/api/teams/${id}`), [200], 'team').name);
  const trules: RuleSet = { ...INDOOR_RULES, bestOf: 3, pointsPerSet: 15, decidingSetPoints: 15 };
  const day = 86_400_000;
  const tBody = (format: 'knockout' | 'league', ids: string[], fixtures: Fixture[]) => ({
    name: `${P} ${format === 'knockout' ? 'Monsoon Cup' : 'Winter League'}`, organizerId: org.uid, format, rules: trules, startDate: Date.now() + day, endDate: Date.now() + 3 * day,
    location: { name: 'Nehru Stadium', lat: 28.58, lng: 77.23 }, teams: ids.map((id) => ({ id, name: teamNames.get(id)!, color: '#E53935' })), fixtures, status: 'registration',
  });
  // MAX_TOURNAMENT_TEAMS + 1 teams: refused, nothing written (1.4.27: the limit is 32)
  const over = Array.from({ length: MAX_TOURNAMENT_TEAMS + 1 }, (_, i) => allTeams[i] ?? `${P}x${i}`);
  const oversizeStatus = (await as(org)('POST', '/api/tournaments', { ...tBody('knockout', allTeams, []), teams: over.map((id) => ({ id, name: `T ${id}`.slice(0, 20), color: '#E53935' })) })).status;
  /** Starts a fixture like app/tournament/[id].tsx (create the match, then claim it in the fixture) and plays it. */
  const playFixture = async (tid: string, t: any, f: Fixture, round: number) => {
    const [h, w] = [await matchTeam(c, org, f.homeId!), await matchTeam(c, org, f.awayId!)];
    const md = buildMatch({ teamA: h.mt, teamB: w.mt, rules: t.rules, createdBy: org.uid, scorerId: org.uid, startNow: true, scheduledAt: Date.now(), title: `${t.name} R${round}`, tournamentId: tid, fixtureId: f.id, captains: { A: h.captainId, B: w.captainId }, location: t.location });
    const mid = must(await as(org)('POST', '/api/matches', md), [201], `create ${f.id}`).id as string;
    const cur = must(await as(org)('GET', `/api/tournaments/${tid}`), [200], 'reload tournament');
    must(await as(org)('PATCH', `/api/tournaments/${tid}`, { fixtures: cur.fixtures.map((x: any) => (x.id === f.id ? { ...x, matchId: mid } : x)) }), [200], `claim ${f.id}`);
    const winner: 'A' | 'B' = (f.index + round) % 3 === 0 ? 'B' : 'A';
    const sets = winner === 'A' ? ['A', 'B', 'A'] : ['B', 'B'];
    const ev = playSets(t.rules, sets as ('A' | 'B')[], { A: h.mt.players.map((p) => p.id), B: w.mt.players.map((p) => p.id) });
    must(await as(org)('PUT', `/api/matches/${mid}/progress`, { events: ev.slice(0, Math.floor(ev.length / 2)), status: 'live' }), [200], `half ${f.id}`);
    const m = must(await as(org)('PUT', `/api/matches/${mid}/progress`, { events: ev, status: 'live' }), [200], `finish ${f.id}`);
    if (m.status !== 'finished') throw new Error(`${f.id} not finished`);
    must(await as(org)('PUT', `/api/matches/${mid}/player-of-match`, { playerId: (winner === 'A' ? h : w).mt.players[1].id }), [200], `potm ${f.id}`);
    return { mid, result: { fixtureId: f.id, homeSets: m.summary.setsA, awaySets: m.summary.setsB } as FixtureResult };
  };
  const tid = must(await as(org)('POST', '/api/tournaments', tBody('knockout', tTeams, generateKnockout(tTeams))), [201], 'create tournament').id as string;
  must(await as(org)('PATCH', `/api/tournaments/${tid}`, { status: 'running' }), [200], 'tournament running');
  const results: FixtureResult[] = [];
  const matchIds: string[] = [];
  let byes = 0;
  for (let round = 1; ; round++) {
    const t = must(await as(org)('GET', `/api/tournaments/${tid}`), [200], 'get tournament');
    const ko = resolveKnockout(t.fixtures, results);
    if (ko.championId) break;
    const todo = ko.fixtures.filter((f) => f.round === round && f.homeId && f.awayId && !f.matchId);
    if (round === 1) byes = ko.fixtures.filter((f) => f.round === 1 && (!f.homeId || !f.awayId)).length;
    if (!todo.length) throw new Error(`round ${round}: nothing to play`);
    for (const f of todo) {
      const { mid, result } = await playFixture(tid, t, f, round);
      results.push(result);
      matchIds.push(mid);
    }
  }
  const t = must(await as(org)('GET', `/api/tournaments/${tid}`), [200], 'final tournament');
  const champion = resolveKnockout(t.fixtures, results).championId;
  must(await as(org)('PATCH', `/api/tournaments/${tid}`, { status: 'finished' }), [200], 'tournament finished');

  // ---- league (round robin) of the same teams: every fixture played, the table from the stored results ----
  const lid = must(await as(org)('POST', '/api/tournaments', tBody('league', tTeams, generateRoundRobin(tTeams))), [201], 'create league').id as string;
  const lt = must(await as(org)('GET', `/api/tournaments/${lid}`), [200], 'league');
  const lres: FixtureResult[] = [];
  const lmatch: string[] = [];
  for (const f of lt.fixtures as Fixture[]) {
    const { mid, result } = await playFixture(lid, lt, f, f.round);
    lres.push(result);
    lmatch.push(mid);
  }
  const table = standings(tTeams, lt.fixtures, lres).map((r: any) => ({ teamId: r.teamId, played: r.played, won: r.won, points: r.tablePoints }));
  return {
    league: { id: lid, fixtures: lt.fixtures.length, played: lmatch.length, table, matchIds: lmatch },
    oversizeStatus,
    users, teams: [tA, tB, ...tTeams],
    friendly: { matchId, rallies: all.filter((e) => e.type === 'point').length, timeouts: all.filter((e) => e.type === 'timeout').length, undone: 3, winner: 'A' },
    abandonedId,
    support: { tickets, feedback: fb },
    tournament: { id: tid, fixtures: t.fixtures.length, played: matchIds.length, byes, champion, matchIds },
  };
}
