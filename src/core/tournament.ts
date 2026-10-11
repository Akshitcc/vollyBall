/** Tournament fixtures, knockout brackets and league tables. Pure TypeScript. */

export type TournamentFormat = 'knockout' | 'league';

export interface Fixture {
  id: string;
  round: number; // 1-based
  index: number; // 0-based position within round
  homeId: string | null;
  awayId: string | null;
  /** Knockout: winner of these fixtures feeds this slot. */
  homeFrom?: string;
  awayFrom?: string;
  /** Linked live match id once started. */
  matchId?: string;
}

export interface FixtureResult {
  fixtureId: string;
  homeSets: number;
  awaySets: number;
  homePoints: number;
  awayPoints: number;
}

// ---------------- League (round robin) ----------------

/** Circle-method round robin. With an odd team count one team rests each round. */
export function generateRoundRobin(teamIds: readonly string[], opts: { doubleRound?: boolean } = {}): Fixture[] {
  if (new Set(teamIds).size !== teamIds.length) throw new Error('Duplicate team ids');
  if (teamIds.length < 2) throw new Error('Need at least 2 teams');
  const ids: (string | null)[] = [...teamIds];
  if (ids.length % 2 === 1) ids.push(null); // bye
  const n = ids.length;
  const rounds = n - 1;
  const fixtures: Fixture[] = [];
  let arr = [...ids];
  for (let r = 0; r < rounds; r++) {
    let idx = 0;
    for (let i = 0; i < n / 2; i++) {
      const h = arr[i];
      const a = arr[n - 1 - i];
      if (h === null || a === null) continue;
      // alternate home/away for fairness
      const [home, away] = r % 2 === 0 ? [h, a] : [a, h];
      fixtures.push({ id: `L${r + 1}-${idx}`, round: r + 1, index: idx, homeId: home, awayId: away });
      idx++;
    }
    // rotate all but first
    arr = [arr[0], arr[n - 1], ...arr.slice(1, n - 1)];
  }
  if (opts.doubleRound) {
    const second = fixtures.map((f) => ({
      ...f,
      id: `L${f.round + rounds}-${f.index}`,
      round: f.round + rounds,
      homeId: f.awayId,
      awayId: f.homeId,
    }));
    return [...fixtures, ...second];
  }
  return fixtures;
}

export interface StandingRow {
  teamId: string;
  played: number;
  won: number;
  lost: number;
  setsWon: number;
  setsLost: number;
  pointsFor: number;
  pointsAgainst: number;
  /** League points: 3 for a 3-0/3-1 (or 2-0) win, 2 for a 3-2 (2-1) win, 1 for a 2-3 (1-2) loss. */
  tablePoints: number;
}

export function matchTablePoints(setsFor: number, setsAgainst: number): number {
  if (setsFor > setsAgainst) return setsFor - setsAgainst >= 2 ? 3 : 2;
  return setsAgainst - setsFor === 1 ? 1 : 0;
}

const ratio = (a: number, b: number) => (b === 0 ? (a === 0 ? 0 : Infinity) : a / b);

/** League table sorted by points, wins, set ratio, point ratio, then name/id. */
export function standings(teamIds: readonly string[], fixtures: readonly Fixture[], results: readonly FixtureResult[]): StandingRow[] {
  const rows = new Map<string, StandingRow>();
  for (const id of teamIds) {
    rows.set(id, { teamId: id, played: 0, won: 0, lost: 0, setsWon: 0, setsLost: 0, pointsFor: 0, pointsAgainst: 0, tablePoints: 0 });
  }
  const byId = new Map(fixtures.map((f) => [f.id, f]));
  for (const r of results) {
    const f = byId.get(r.fixtureId);
    if (!f || !f.homeId || !f.awayId) continue;
    if (r.homeSets === r.awaySets) continue; // unfinished
    const h = rows.get(f.homeId);
    const a = rows.get(f.awayId);
    if (!h || !a) continue;
    h.played++;
    a.played++;
    h.setsWon += r.homeSets;
    h.setsLost += r.awaySets;
    a.setsWon += r.awaySets;
    a.setsLost += r.homeSets;
    h.pointsFor += r.homePoints;
    h.pointsAgainst += r.awayPoints;
    a.pointsFor += r.awayPoints;
    a.pointsAgainst += r.homePoints;
    if (r.homeSets > r.awaySets) {
      h.won++;
      a.lost++;
    } else {
      a.won++;
      h.lost++;
    }
    h.tablePoints += matchTablePoints(r.homeSets, r.awaySets);
    a.tablePoints += matchTablePoints(r.awaySets, r.homeSets);
  }
  return [...rows.values()].sort(
    (x, y) =>
      y.tablePoints - x.tablePoints ||
      y.won - x.won ||
      ratio(y.setsWon, y.setsLost) - ratio(x.setsWon, x.setsLost) ||
      ratio(y.pointsFor, y.pointsAgainst) - ratio(x.pointsFor, x.pointsAgainst) ||
      x.teamId.localeCompare(y.teamId),
  );
}

// ---------------- Knockout ----------------

export function nextPowerOfTwo(n: number): number {
  let p = 1;
  while (p < n) p *= 2;
  return p;
}

/** Standard seeding order, e.g. size 8 -> [1,8,4,5,2,7,3,6]. */
export function seedOrder(size: number): number[] {
  let order = [1];
  while (order.length < size) {
    const m = order.length * 2 + 1;
    order = order.flatMap((s) => [s, m - s]);
  }
  return order;
}

/**
 * Single-elimination bracket. teamIds are in seed order (index 0 = top seed).
 * Byes go to the top seeds and are auto-advanced by `resolveKnockout`.
 */
export function generateKnockout(teamIds: readonly string[]): Fixture[] {
  if (new Set(teamIds).size !== teamIds.length) throw new Error('Duplicate team ids');
  if (teamIds.length < 2) throw new Error('Need at least 2 teams');
  const size = nextPowerOfTwo(teamIds.length);
  const order = seedOrder(size);
  const slot = (seed: number) => (seed <= teamIds.length ? teamIds[seed - 1] : null);
  const fixtures: Fixture[] = [];
  for (let i = 0; i < size / 2; i++) {
    fixtures.push({ id: `R1-M${i}`, round: 1, index: i, homeId: slot(order[2 * i]), awayId: slot(order[2 * i + 1]) });
  }
  const rounds = Math.log2(size);
  for (let r = 2; r <= rounds; r++) {
    const count = size / 2 ** r;
    for (let i = 0; i < count; i++) {
      fixtures.push({
        id: `R${r}-M${i}`,
        round: r,
        index: i,
        homeId: null,
        awayId: null,
        homeFrom: `R${r - 1}-M${2 * i}`,
        awayFrom: `R${r - 1}-M${2 * i + 1}`,
      });
    }
  }
  return fixtures;
}

export function isBye(f: Fixture): boolean {
  return f.round === 1 && (f.homeId === null) !== (f.awayId === null);
}

export interface KnockoutState {
  fixtures: Fixture[];
  winners: Record<string, string>;
  championId: string | null;
}

/** Fill later-round slots from results and byes. Returns new fixture objects. */
export function resolveKnockout(fixtures: readonly Fixture[], results: readonly FixtureResult[]): KnockoutState {
  const res = new Map(results.map((r) => [r.fixtureId, r]));
  const out = fixtures.map((f) => ({ ...f })).sort((a, b) => a.round - b.round || a.index - b.index);
  const winners: Record<string, string> = {};
  for (const f of out) {
    if (f.homeFrom) f.homeId = winners[f.homeFrom] ?? null;
    if (f.awayFrom) f.awayId = winners[f.awayFrom] ?? null;
    if (isBye(f)) {
      winners[f.id] = (f.homeId ?? f.awayId) as string;
      continue;
    }
    const r = res.get(f.id);
    if (f.homeId && f.awayId && r && r.homeSets !== r.awaySets) {
      winners[f.id] = r.homeSets > r.awaySets ? f.homeId : f.awayId;
    }
  }
  const maxRound = Math.max(...out.map((f) => f.round));
  const final = out.find((f) => f.round === maxRound);
  return { fixtures: out, winners, championId: final ? winners[final.id] ?? null : null };
}

export function roundName(round: number, totalRounds: number): string {
  const fromEnd = totalRounds - round;
  if (fromEnd === 0) return 'Final';
  if (fromEnd === 1) return 'Semi-finals';
  if (fromEnd === 2) return 'Quarter-finals';
  return `Round ${round}`;
}

/**
 * Stored title of a fixture's match: "<tournament> · <round>". It is data, so it is always written
 * in English (never the creator's UI language) and translated for display by i18n/format dataLabel,
 * so every viewer reads it in their own language (QA bug K).
 */
export function fixtureTitle(tournamentName: string, format: 'league' | 'knockout', round: number, totalRounds: number): string {
  return `${tournamentName} · ${format === 'knockout' ? roundName(round, totalRounds) : `Round ${round}`}`;
}

/** League champion once every fixture has a result. */
export function leagueChampion(teamIds: readonly string[], fixtures: readonly Fixture[], results: readonly FixtureResult[]): string | null {
  const done = new Set(results.filter((r) => r.homeSets !== r.awaySets).map((r) => r.fixtureId));
  if (!fixtures.every((f) => done.has(f.id))) return null;
  return standings(teamIds, fixtures, results)[0]?.teamId ?? null;
}

/** What a tournament list shows (QA build-217 browser pass #1). */
export type TournamentDisplayStatus = 'upcoming' | 'running' | 'finished';
/**
 * Status from the stored state and the dates: Finished once the organiser's tournament is closed
 * (champion decided), Upcoming before the start date even if the stored status is 'running'
 * (fixtures are generated at creation), Running only once it has started.
 */
export function tournamentDisplayStatus(
  t: { status: 'registration' | 'running' | 'finished'; startDate: number },
  now: number = Date.now(),
): TournamentDisplayStatus {
  if (t.status === 'finished') return 'finished';
  if (now < t.startDate) return 'upcoming';
  return 'running';
}
