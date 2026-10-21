/**
 * 1.4.27 (Akshit, E2E-4): the "Groups + knockout" format and the knockout field sizes over 10 teams.
 *
 * Groups: teams are split into G balanced groups (sizes differ by at most 1, the larger groups first), each group plays
 * a round robin, and the top K of every group go to a single-elimination bracket. G·K qualifiers are seeded across the
 * groups (A1 v B2, B1 v A2, C1 v D2, …) into a power-of-two bracket; byes go to the group winners when G·K is not a
 * power of two. Group tables use the league table order (core/tournament standings: points, wins, set ratio, point
 * ratio, then name). The bracket is filled automatically once a group's matches are all played.
 *
 * Match count = Σ C(size, 2) over the groups + (G·K − 1) knockout matches (each knockout match removes one team).
 * 15 teams, 4 groups 4/4/4/3, top 2: 6+6+6+3 = 21 group matches + 4 QF + 2 SF + 1 F = 28.
 *
 * Knockout without groups (e.g. 17 teams): the bracket is the next power of two and the top seeds get byes, so the
 * first round is a play-in (17 → 16: 1 match) and the total is always teams − 1.
 */
import { generateRoundRobin, nextPowerOfTwo, resolveKnockout, seedOrder, standings, type Fixture, type FixtureResult, type StandingRow, type TeamNames } from './tournament';

export const GROUP_LETTERS = 'ABCDEFGH';
export const MAX_GROUPS = 8;
export const MIN_GROUPS_TEAMS = 4;
export const GROUPS_TOO_FEW = 'groups_too_few';
export const GROUPS_TOO_SMALL = 'groups_too_small';
export type GroupMode = 'seeded' | 'random';

export interface GroupPlan {
  groups: number;
  /** teams per group that go to the knockout */
  advance: number;
  /** group sizes, larger first */
  sizes: number[];
  qualifiers: number;
  /** bracket size (power of two) and byes in its first round */
  bracket: number;
  byes: number;
  groupMatches: number;
  knockoutMatches: number;
  total: number;
}

const pairs = (n: number) => (n * (n - 1)) / 2;

export function groupSizes(teams: number, groups: number): number[] {
  const base = Math.floor(teams / groups);
  return Array.from({ length: groups }, (_, i) => base + (i < teams % groups ? 1 : 0));
}

export function makePlan(teams: number, groups: number, advance: number): GroupPlan {
  const sizes = groupSizes(teams, groups);
  const qualifiers = groups * advance;
  const bracket = nextPowerOfTwo(qualifiers);
  const groupMatches = sizes.reduce((n, s) => n + pairs(s), 0);
  return { groups, advance, sizes, qualifiers, bracket, byes: bracket - qualifiers, groupMatches, knockoutMatches: qualifiers - 1, total: groupMatches + qualifiers - 1 };
}

/**
 * Every sensible plan for `teams`, best first: G in 2..8, K in 1..2, each group has at least K+1 teams (at least 3
 * when K = 2) and at most 6. Preferred: no byes (G·K a power of two), groups of about 4, top 2, fewer matches.
 */
export function groupPlans(teams: number): GroupPlan[] {
  const out: GroupPlan[] = [];
  if (teams < MIN_GROUPS_TEAMS) return out;
  for (let g = 2; g <= MAX_GROUPS; g++) {
    for (const k of [2, 1]) {
      const p = makePlan(teams, g, k);
      const min = p.sizes[p.sizes.length - 1];
      const max = p.sizes[0];
      if (min < k + 1 || (k === 2 && min < 3 && teams > 4) || max > 6 || p.qualifiers < 2) continue;
      out.push(p);
    }
  }
  const cost = (p: GroupPlan) => p.byes * 10 + Math.abs(p.sizes[0] - 4) * 3 + (p.advance === 2 ? 0 : 2) + p.total / 100;
  return out.sort((a, b) => cost(a) - cost(b));
}

export const defaultGroupPlan = (teams: number): GroupPlan | null => groupPlans(teams)[0] ?? null;

/** Knockout only: teams that play the first (play-in) round, and the field after it. */
export function playIn(teams: number): { bracket: number; playInMatches: number; byes: number; field: number; total: number } {
  const bracket = nextPowerOfTwo(teams);
  const byes = bracket - teams;
  return { bracket, byes, playInMatches: bracket / 2 - byes, field: bracket / 2, total: teams - 1 };
}

/** Fisher–Yates with an injectable random source (tests pass a seeded one). */
export function shuffle<T>(xs: readonly T[], rnd: () => number = Math.random): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Split into `groups` balanced groups. 'seeded': teamIds are in seed order and are dealt in a snake (A B C D D C B A …),
 * so the top seeds are in different groups; 'random': shuffled first, then dealt the same way.
 */
export function assignGroups(teamIds: readonly string[], groups: number, mode: GroupMode = 'seeded', rnd: () => number = Math.random): string[][] {
  if (new Set(teamIds).size !== teamIds.length) throw new Error('Duplicate team ids');
  if (groups < 2 || groups > MAX_GROUPS || groups > teamIds.length) throw new Error('Bad group count');
  const ids = mode === 'random' ? shuffle(teamIds, rnd) : [...teamIds];
  const sizes = groupSizes(ids.length, groups);
  const out: string[][] = Array.from({ length: groups }, () => []);
  let row = 0;
  let k = 0;
  while (k < ids.length) {
    const order = Array.from({ length: groups }, (_, i) => (row % 2 === 0 ? i : groups - 1 - i));
    for (const g of order) if (k < ids.length && out[g].length < sizes[g]) out[g].push(ids[k++]);
    row++;
  }
  return out;
}

export const groupId = (i: number) => GROUP_LETTERS[i];
export const seedLabel = (group: string, place: number) => `${group}${place}`;
export const SEED_RE = /^([A-H])([1-4])$/;

/** Qualifier labels in bracket seed order: all group winners, then runners-up paired across groups (A1 v B2). */
export function qualifierSeeds(groups: number, advance: number): string[] {
  const winners = Array.from({ length: groups }, (_, i) => seedLabel(groupId(i), 1));
  if (advance === 1) return winners;
  // seed s (1-based) meets seed B+1-s in round one when B = 2G; the runner-up of the partner group gets seed 2G+1-s
  const partner = (i: number) => (groups % 2 === 0 ? i ^ 1 : (i + 1) % groups);
  const runners: string[] = new Array(groups);
  for (let i = 0; i < groups; i++) runners[groups - 1 - i] = seedLabel(groupId(partner(i)), 2);
  return [...winners, ...runners];
}

/**
 * Fixtures of a groups + knockout tournament. Group fixtures: id "G{A}-{round}-{n}", `group` set, rounds 1..R (R = the
 * largest group's round count), index unique per round across groups. Knockout: id "K{r}-M{i}", rounds R+1…, the
 * first knockout round carries `homeSeed` / `awaySeed` (a missing seed = a bye), later rounds `homeFrom` / `awayFrom`.
 */
export function generateGroupsKnockout(groups: readonly (readonly string[])[], advance: number): Fixture[] {
  const all = groups.flat();
  if (new Set(all).size !== all.length) throw new Error('Duplicate team ids');
  if (groups.length < 2 || groups.length > MAX_GROUPS) throw new Error('Bad group count');
  if (groups.some((g) => g.length < advance + 1 && g.length < 2)) throw new Error('Group too small');
  const fixtures: Fixture[] = [];
  const nextIndex = new Map<number, number>();
  groups.forEach((g, gi) => {
    const letter = groupId(gi);
    for (const f of generateRoundRobin(g)) {
      const index = nextIndex.get(f.round) ?? 0;
      nextIndex.set(f.round, index + 1);
      fixtures.push({ id: `G${letter}-${f.round}-${f.index}`, round: f.round, index, homeId: f.homeId, awayId: f.awayId, group: letter });
    }
  });
  const R = Math.max(0, ...fixtures.map((f) => f.round));
  const seeds = qualifierSeeds(groups.length, advance);
  const size = nextPowerOfTwo(seeds.length);
  const order = seedOrder(size);
  const seedAt = (s: number) => (s <= seeds.length ? seeds[s - 1] : undefined);
  for (let i = 0; i < size / 2; i++) {
    const hs = seedAt(order[2 * i]);
    const as = seedAt(order[2 * i + 1]);
    fixtures.push({ id: `K1-M${i}`, round: R + 1, index: i, homeId: null, awayId: null, ...(hs ? { homeSeed: hs } : {}), ...(as ? { awaySeed: as } : {}) });
  }
  const rounds = Math.log2(size);
  for (let r = 2; r <= rounds; r++) {
    for (let i = 0; i < size / 2 ** r; i++) {
      fixtures.push({ id: `K${r}-M${i}`, round: R + r, index: i, homeId: null, awayId: null, homeFrom: `K${r - 1}-M${2 * i}`, awayFrom: `K${r - 1}-M${2 * i + 1}` });
    }
  }
  return fixtures;
}

export interface GroupTable {
  group: string;
  teamIds: string[];
  rows: StandingRow[];
  /** every group fixture has a result */
  complete: boolean;
}

/** Teams of each group, from the tournament teams' `group` (falls back to the group fixtures). */
export function groupMembers(t: { teams: readonly { id: string; group?: string }[]; fixtures: readonly Fixture[] }): Map<string, string[]> {
  const m = new Map<string, string[]>();
  const add = (g: string, id: string) => { const l = m.get(g) ?? []; if (!l.includes(id)) l.push(id); m.set(g, l); };
  for (const tm of t.teams) if (tm.group) add(tm.group, tm.id);
  if (!m.size) for (const f of t.fixtures) if (f.group) for (const id of [f.homeId, f.awayId]) if (id) add(f.group, id);
  return new Map([...m.entries()].sort(([a], [b]) => a.localeCompare(b)));
}

/**
 * 1.4.28 (QA V1427-1): THE tiebreak names for every standings / bracket path (app, API, demo): the names passed in, else
 * the tournament's own team names – so a full tie is broken by name (PRD TOUR-03) everywhere, never by id.
 */
export function tiebreakNames(t: { teams: readonly { id: string; name?: string }[] }, names?: TeamNames): TeamNames {
  if (names) return names;
  return new Map(t.teams.filter((x) => x.name).map((x) => [x.id, x.name as string]));
}

export function groupTables(t: { teams: readonly { id: string; group?: string; name?: string }[]; fixtures: readonly Fixture[] }, results: readonly FixtureResult[], names0?: TeamNames): GroupTable[] {
  const names = tiebreakNames(t, names0);
  const decided = new Set(results.filter((r) => r.homeSets !== r.awaySets).map((r) => r.fixtureId));
  return [...groupMembers(t).entries()].map(([group, teamIds]) => {
    const fx = t.fixtures.filter((f) => f.group === group);
    return { group, teamIds, rows: standings(teamIds, fx, results, names), complete: fx.length > 0 && fx.every((f) => decided.has(f.id)) };
  });
}

/** Seed label → team, for complete groups only (an incomplete group's places are not final). */
export function resolvedSeeds(tables: readonly GroupTable[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const tb of tables) if (tb.complete) tb.rows.forEach((r, i) => m.set(seedLabel(tb.group, i + 1), r.teamId));
  return m;
}

export interface ResolvedTournament {
  fixtures: Fixture[];
  championId: string | null;
  tables: GroupTable[];
}

/**
 * Knockout fixtures of the groups format with their teams filled in: seeded slots from the complete group tables
 * (both seeds must be known before either is shown in a slot, so a half-known slot is never taken for a bye), later
 * rounds from the winners. Group fixtures are returned unchanged.
 */
export function resolveGroupsKnockout(t: { teams: readonly { id: string; group?: string; name?: string }[]; fixtures: readonly Fixture[] }, results: readonly FixtureResult[], names?: TeamNames): ResolvedTournament {
  const tables = groupTables(t, results, names);
  const seeds = resolvedSeeds(tables);
  const group = t.fixtures.filter((f) => f.group);
  const ko = t.fixtures.filter((f) => !f.group);
  if (!ko.length) return { fixtures: group.map((f) => ({ ...f })), championId: null, tables };
  const R = Math.min(...ko.map((f) => f.round)) - 1;
  const filled = ko.map((f) => {
    const c = { ...f, round: f.round - R };
    if (c.round === 1) {
      const h = f.homeSeed ? seeds.get(f.homeSeed) ?? null : null;
      const a = f.awaySeed ? seeds.get(f.awaySeed) ?? null : null;
      const known = (!f.homeSeed || h) && (!f.awaySeed || a);
      c.homeId = known ? h : null;
      c.awayId = known ? a : null;
    }
    return c;
  });
  const st = resolveKnockout(filled, results);
  return { fixtures: [...group.map((f) => ({ ...f })), ...st.fixtures.map((f) => ({ ...f, round: f.round + R }))], championId: st.championId, tables };
}

/** Any format: fixtures with the teams a fixture is played by right now, and the champion (null until decided). */
export function resolveFixtures(
  t: { format: string; teams: readonly { id: string; group?: string; name?: string }[]; fixtures: readonly Fixture[] },
  results: readonly FixtureResult[],
  names?: TeamNames,
): { fixtures: Fixture[]; championId: string | null } {
  if (t.format === 'groups') return resolveGroupsKnockout(t, results, names);
  if (t.format === 'knockout') return resolveKnockout(t.fixtures, results);
  return { fixtures: t.fixtures.map((f) => ({ ...f })), championId: null };
}

/** Validation of a stored groups tournament (API + demo): every team in one group, fixtures consistent. Null = ok. */
export function groupsProblem(t: { format: string; advance?: number | null; teams: readonly { id: string; group?: string }[]; fixtures: readonly Fixture[] }): string | null {
  if (t.format !== 'groups') {
    if (t.teams.some((x) => x.group) || t.fixtures.some((f) => f.group || f.homeSeed || f.awaySeed)) return 'groups_only';
    return null;
  }
  if (!t.advance || t.advance < 1 || t.advance > 2) return 'groups_advance';
  const groups = new Set(t.teams.map((x) => x.group));
  if (t.teams.some((x) => !x.group || !GROUP_LETTERS.includes(x.group))) return 'groups_team';
  if (groups.size < 2) return 'groups_count';
  // 1.4.28 (QA V1427-2): the same limits as the app's plans (groupPlans): at least MIN_GROUPS_TEAMS teams, and every
  // group bigger than the number advancing from it ('Group too small' in the generator)
  if (t.teams.length < MIN_GROUPS_TEAMS) return GROUPS_TOO_FEW;
  const sizes = new Map<string, number>();
  for (const x of t.teams) sizes.set(x.group as string, (sizes.get(x.group as string) ?? 0) + 1);
  if ([...sizes.values()].some((n) => n < t.advance! + 1)) return GROUPS_TOO_SMALL;
  const teamGroup = new Map(t.teams.map((x) => [x.id, x.group]));
  for (const f of t.fixtures) {
    if (f.group) {
      if (!groups.has(f.group) || (f.homeId && teamGroup.get(f.homeId) !== f.group) || (f.awayId && teamGroup.get(f.awayId) !== f.group)) return 'groups_fixture';
    }
    for (const s of [f.homeSeed, f.awaySeed]) {
      if (s === undefined) continue;
      const m = SEED_RE.exec(s);
      if (!m || !groups.has(m[1]) || Number(m[2]) > t.advance) return 'groups_seed';
    }
  }
  return null;
}

/** Small deterministic PRNG (mulberry32): the random draw is repeatable for one seed (preview = what is saved). */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
