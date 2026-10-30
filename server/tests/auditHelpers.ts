/** 1.4.26 DB audit: the API simulation's client on the test harness. */
import type { RateLimiter } from '../src/rateLimit';
import { buildMatch } from '../../src/core/buildMatch';
import { INDOOR_RULES, type RuleSet } from '../../src/core/rules';
import { generateKnockout, generateRoundRobin } from '../../src/core/tournament';
import { makeTeam, makeUsers, registerUser, type ClientFor, type SimUser } from '../scripts/auditSim';
import type { Harness } from './helpers';

export const clientFor = (hh: Harness): ClientFor => (uid, phone) => async (method, path, body, headers = {}) => {
  const a = hh.as({ uid, phone });
  let r = method === 'GET' ? a.get(path) : method === 'POST' ? a.post(path) : method === 'PUT' ? a.put(path) : method === 'PATCH' ? a.patch(path) : a.del(path);
  for (const [k, v] of Object.entries(headers)) r = r.set(k, v);
  const res = body === undefined ? await r : await r.send(body as object);
  return { status: res.status, body: res.body };
};

/** The simulation is one busy organiser: lift the per-user write limits (the limiter itself is tested elsewhere). */
export const liftLimits = (l: RateLimiter) => { for (const k of ['terms', 'verify', 'matchWrite'] as const) l.limits[k] = { burst: 1e6, perMinute: 1e6 }; l.liftNamed = true; };

export const AUDIT_RULES: RuleSet = { ...INDOOR_RULES, bestOf: 3 };

/** A small world for the scenario tests: 3 registered teams of 6 and an organiser. */
export async function makeWorld(c: ClientFor, prefix: string, phoneBase: number, format: 'knockout' | 'league' = 'knockout') {
  const us = makeUsers(prefix, 19, phoneBase);
  for (const [i, u] of us.entries()) await registerUser(c, u, i);
  const as = (u: SimUser) => c(u.uid, u.phone);
  const teams = [await makeTeam(c, `${prefix} A`, us.slice(0, 6)), await makeTeam(c, `${prefix} B`, us.slice(6, 12)), await makeTeam(c, `${prefix} C`, us.slice(12, 18))];
  const org = us[18];
  const side = async (id: string) => {
    const t = (await as(org)('GET', `/api/teams/${id}`)).body;
    const ps = await Promise.all(t.memberIds.map(async (m: string) => (await as(org)('GET', `/api/users/${m}`)).body));
    return { mt: { teamId: id, name: t.name, color: t.color, players: ps.map((p: { id: string; name: string }) => ({ id: p.id, name: p.name, photoURL: null })) }, cap: t.captainId as string };
  };
  const matchDoc = async (a: string, b: string, extra: { tournamentId?: string; fixtureId?: string } = {}) => {
    const [x, y] = [await side(a), await side(b)];
    return { doc: buildMatch({ teamA: x.mt, teamB: y.mt, rules: AUDIT_RULES, createdBy: org.uid, scorerId: org.uid, startNow: true, captains: { A: x.cap, B: y.cap }, ...extra }), players: { A: x.mt.players.map((p) => p.id), B: y.mt.players.map((p) => p.id) } };
  };
  const tournament = async () => (await as(org)('POST', '/api/tournaments', {
    name: `${prefix} Cup`, organizerId: org.uid, format, rules: AUDIT_RULES, startDate: Date.now() + 864e5, endDate: Date.now() + 2 * 864e5,
    location: { name: 'Ground', lat: 28.5, lng: 77.2 }, teams: teams.map((id, i) => ({ id, name: `${prefix} ${'ABC'[i]}`, color: '#E53935' })), fixtures: format === 'knockout' ? generateKnockout(teams) : generateRoundRobin(teams), status: 'registration',
  })).body.id as string;
  return { us, as, org, teams, matchDoc, tournament, put: (mid: string, events: unknown[], seq?: number) => as(org)('PUT', `/api/matches/${mid}/progress`, { events, ...(seq != null ? { seq } : {}) }) };
}

