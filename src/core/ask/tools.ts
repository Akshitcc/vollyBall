import { resultStatus } from '../resultStatus';
import { maskPii, maskPiiStored } from '../pii';
/**
 * 1.5.0 Ask VolleyLive: server-side READ-ONLY tools.
 *
 * Every tool runs through a `ToolHost` bound to the signed-in user: the host only returns what that user could read
 * through the normal API (server: viewer-scoped domain functions; demo: the local demo data). The tools then keep a
 * WHITELIST of public fields (names, colours, scores, public stats) – phone, e-mail, wallet, date of birth, pincode,
 * pending invite numbers and challenge messages never leave this file – and `filterPii` runs over the result again.
 *
 * Arguments have a strict schema per tool (unknown keys, wrong types and out-of-range values are refused). There are
 * no write tools; an unknown name is refused too.
 */
import { claimedTournamentMatches } from '../tournamentAdmin';
import { fixtureResultFromMatch } from '../results';
import { resolveGroupsKnockout, tiebreakNames } from '../groups';
import { leagueChampion, resolveKnockout, standings, type Fixture, type FixtureResult, type StandingRow } from '../tournament';
import type { RankingRow } from '../ranking';
import type { Challenge, Match, Team, Tournament } from '../types';
import { ASK_CARD_ROWS, type AskCard, type FixtureItem, type FixturesCard, type ScoreboardCard, type StandingsCard, type StatCard } from './cards';

export type ToolLang = 'en' | 'hi';

// ---------- strict argument schemas ----------
export type ArgSpec =
  | { type: 'string'; min: number; max: number; optional?: boolean; description: string }
  | { type: 'enum'; values: readonly string[]; optional?: boolean; description: string }
  | { type: 'int'; min: number; max: number; optional?: boolean; description: string };
export interface ToolSpec { name: AskToolName; description: string; args: Readonly<Record<string, ArgSpec>> }

export const ASK_TOOL_NAMES = ['my_stats', 'player_stats', 'my_teams', 'team_roster', 'my_matches', 'live_score', 'tournament_standings', 'tournament_fixtures', 'challenges_status', 'leaderboard'] as const;
export type AskToolName = (typeof ASK_TOOL_NAMES)[number];

export const TOOL_SPECS: readonly ToolSpec[] = [
  { name: 'my_stats', description: "The signed-in user's own match stats and rank.", args: {} },
  { name: 'player_stats', description: "Another player's PUBLIC stats (matches, wins, ranking points, rank) by name.", args: { name: { type: 'string', min: 2, max: 60, description: 'Player name or part of it' } } },
  { name: 'my_teams', description: 'Teams the signed-in user belongs to.', args: {} },
  { name: 'team_roster', description: 'Players of a team (names, captain, substitutes) by team name.', args: { team: { type: 'string', min: 2, max: 40, description: 'Team name or part of it' } } },
  { name: 'my_matches', description: "The signed-in user's matches with scores: upcoming (scheduled or live), live (only theirs, now) or past (finished, each with its result state: counted, awaiting confirmation, under review, disputed or voided).", args: { when: { type: 'enum', values: ['upcoming', 'past', 'live', 'all'], optional: true, description: 'Which matches (default all); live = only your matches being played now' }, limit: { type: 'int', min: 1, max: 10, optional: true, description: 'How many (default 5)' } } },
  { name: 'live_score', description: 'Live matches and their current score, optionally for one team (a named team that is not live: its latest finished match).', args: { team: { type: 'string', min: 2, max: 40, optional: true, description: 'Team name to filter by' } } },
  { name: 'tournament_standings', description: 'Standings table(s) of a tournament (league table or group tables) and its champion if decided.', args: { tournament: { type: 'string', min: 2, max: 80, optional: true, description: 'Tournament name (default: the only or most recent one)' }, group: { type: 'enum', values: ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'], optional: true, description: 'Only this group (groups + knockout)' }, list: { type: 'enum', values: ['yes'], optional: true, description: "'yes' lists all tournaments instead of one table" } } },
  { name: 'tournament_fixtures', description: 'Fixtures of a tournament with results.', args: { tournament: { type: 'string', min: 2, max: 80, optional: true, description: 'Tournament name' }, status: { type: 'enum', values: ['upcoming', 'played', 'all'], optional: true, description: 'Which fixtures (default all)' } } },
  { name: 'challenges_status', description: "Challenges involving the signed-in user's teams and their status.", args: {} },
  { name: 'leaderboard', description: 'Top ranked players.', args: { limit: { type: 'int', min: 1, max: 10, optional: true, description: 'How many (default 5)' } } },
];
const SPEC = new Map(TOOL_SPECS.map((t) => [t.name, t]));
export const isAskTool = (n: unknown): n is AskToolName => typeof n === 'string' && SPEC.has(n as AskToolName);

/** JSON Schema of a tool's arguments (the providers' function declarations): no extra properties. */
export function toJsonSchema(spec: ToolSpec): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  for (const [k, a] of Object.entries(spec.args)) {
    properties[k] = a.type === 'string' ? { type: 'string', minLength: a.min, maxLength: a.max, description: a.description }
      : a.type === 'enum' ? { type: 'string', enum: [...a.values], description: a.description }
      : { type: 'integer', minimum: a.min, maximum: a.max, description: a.description };
    if (!a.optional) required.push(k);
  }
  return { type: 'object', properties, required, additionalProperties: false };
}

export type ArgCheck = { ok: true; args: Record<string, string | number> } | { ok: false; error: string };
/** Strict validation: a plain object, only known keys, right types and ranges; strings trimmed, hidden chars dropped. */
export function validateToolArgs(name: unknown, raw: unknown): ArgCheck {
  if (!isAskTool(name)) return { ok: false, error: 'unknown_tool' };
  const spec = SPEC.get(name)!;
  const obj = raw === undefined || raw === null ? {} : raw;
  if (typeof obj !== 'object' || Array.isArray(obj)) return { ok: false, error: 'args_not_object' };
  const out: Record<string, string | number> = {};
  for (const k of Object.keys(obj)) if (!(k in spec.args)) return { ok: false, error: `unknown_arg:${k.slice(0, 30)}` };
  for (const [k, a] of Object.entries(spec.args)) {
    const v = (obj as Record<string, unknown>)[k];
    if (v === undefined || v === null || v === '') { if (!a.optional) return { ok: false, error: `missing_arg:${k}` }; continue; }
    if (a.type === 'string') {
      if (typeof v !== 'string') return { ok: false, error: `bad_type:${k}` };
      // eslint-disable-next-line no-control-regex
      const t = v.replace(/[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2060-\u2064\ufeff]/g, '').replace(/\s+/g, ' ').trim();
      const n = [...t].length;
      if (n < a.min || n > a.max) return { ok: false, error: `bad_length:${k}` };
      out[k] = t;
    } else if (a.type === 'enum') {
      if (typeof v !== 'string' || !a.values.includes(v)) return { ok: false, error: `bad_value:${k}` };
      out[k] = v;
    } else {
      if (typeof v !== 'number' || !Number.isInteger(v) || v < a.min || v > a.max) return { ok: false, error: `bad_value:${k}` };
      out[k] = v;
    }
  }
  return { ok: true, args: out };
}

// ---------- host ----------
/** Everything a tool can read, already scoped to the signed-in viewer. */
export interface ToolHost {
  readonly viewerId: string;
  /** Ranked players (public), the viewer's own row and the number ranked. */
  rankings(limit: number): Promise<{ ranked: RankingRow[]; me: RankingRow | null; total: number }>;
  /** Public totals of one player (or null). */
  playerTotals(uid: string): Promise<RankingRow | null>;
  /** Players whose public name matches (id + name only). */
  findPlayers(q: string): Promise<{ id: string; name: string }[]>;
  /** Public display names. */
  names(ids: string[]): Promise<Record<string, string>>;
  myMatches(): Promise<Match[]>;
  liveMatches(): Promise<Match[]>;
  /** 1.5.6 (F155-3): recently finished matches the viewer can read (optional – the app host falls back to myMatches). */
  recentMatches?(): Promise<Match[]>;
  /** 1.5.7 (F156-5): finished matches of teams whose name matches `q` (optional). */
  teamMatches?(q: string): Promise<Match[]>;
  myTeams(): Promise<Team[]>;
  findTeams(q: string): Promise<Team[]>;
  tournaments(): Promise<Tournament[]>;
  tournamentMatches(id: string): Promise<Match[]>;
  challengesFor(teamIds: string[]): Promise<Challenge[]>;
}

// ---------- PII filter ----------
const PRIVATE_KEYS = new Set(['phone', 'phones', 'email', 'wallet', 'balance', 'dob', 'pincode', 'pushToken', 'pendingPhones', 'firstName', 'lastName', 'district', 'state', 'message', 'ingestUrl', 'token', 'apiKey', 'key', 'password', 'secret']);

/**
 * 1.5.2 (Tester F151-4): id / routing fields are carried as-is and never masked – a match, team, tournament, player or
 * OTP user id (or a route param) is not display text, and masking corrupted ~2 % of uuids (broken card navigation).
 */
export const ID_KEY = /^(?:id|ids|uid|route|href|path|params)$|(?:Id|Ids|_id|Uid)$/;

/** Deep copy without private keys; phone numbers and e-mails inside DISPLAY strings are masked, id fields untouched. */
export function filterPii<T>(v: T, key = '', stored = false): T {
  // same mask as the answers; stored = the audit copy (1.5.3: also every 10+ spaced-digit / digit-word run)
  if (typeof v === 'string') return (ID_KEY.test(key) ? v : stored ? maskPiiStored(v) : maskPii(v)) as T;
  if (Array.isArray(v)) return v.map((x) => filterPii(x, key, stored)) as T; // an array under an id key (teamIds) stays ids
  if (v && typeof v === 'object') {
    const o: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) if (!PRIVATE_KEYS.has(k)) o[k] = filterPii(x, k, stored);
    return o as T;
  }
  return v;
}

// ---------- name matching ----------
const normName = (s: string) => s.toLocaleLowerCase().normalize('NFC').replace(/[^\p{L}\p{N}\p{M}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
const words = (s: string) => normName(s).split(' ').filter((w) => [...w].length >= 2);
/** 0..1: how well `q` names `name` (exact 1, contained 0.9, else the share of the name's words found in q). */
export function nameScore(q: string, name: string): number {
  const a = normName(q), b = normName(name);
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.includes(b) || (b.includes(a) && [...a].length >= 3)) return 0.9;
  const qw = words(q), nw = words(name);
  if (!nw.length) return 0;
  const hit = nw.filter((w) => qw.some((x) => x === w || (x.length >= 3 && w.startsWith(x)) || (w.length >= 3 && x.startsWith(w)))).length;
  return (0.8 * hit) / nw.length;
}
export const NAME_MIN = 0.4;
export function bestByName<T>(q: string, items: readonly T[], nameOf: (x: T) => string): T[] {
  const scored = items.map((x) => ({ x, s: nameScore(q, nameOf(x)) })).filter((e) => e.s >= NAME_MIN).sort((a, b) => b.s - a.s);
  if (!scored.length) return [];
  return scored.filter((e) => e.s >= scored[0].s - 1e-9).map((e) => e.x);
}

/**
 * 1.5.7 (F156-2): the team a name query means, among the sides of `ms`. Exact case-insensitive name → that team; else the
 * best nameScore (≥ NAME_MIN); two or more distinct teams within AMBIG_GAP of the best and no exact name → ambiguous.
 * The chosen team's matches come back newest first (finished_at → started → created).
 */
const AMBIG_GAP = 0.05;
export function pickTeam(q: string, ms: readonly Match[]): { matches: Match[]; ambiguous: string[]; exact: boolean } {
  const nq = normName(q);
  const teams = new Map<string, { name: string; score: number; matches: Match[] }>();
  for (const m of ms) for (const side of [m.teamA, m.teamB]) {
    const key = normName(side.name);
    if (!key) continue;
    const sc = nameScore(q, side.name);
    if (sc < NAME_MIN) continue;
    const t = teams.get(key) ?? { name: side.name, score: sc, matches: [] };
    if (!t.matches.includes(m)) t.matches.push(m);
    teams.set(key, t);
  }
  const when = (m: Match) => m.finishedAt ?? m.startedAt ?? m.createdAt ?? 0;
  const byDate = (xs: Match[]) => [...xs].sort((a, b) => (when(b) as number) - (when(a) as number));
  const exact = teams.get(nq);
  if (exact) return { matches: byDate(exact.matches), ambiguous: [], exact: true };
  const ranked = [...teams.values()].sort((a, b) => b.score - a.score);
  if (!ranked.length) return { matches: [], ambiguous: [], exact: false };
  const close = ranked.filter((t) => t.score >= ranked[0].score - AMBIG_GAP);
  if (close.length > 1) return { matches: [], ambiguous: close.map((t) => t.name).slice(0, 6), exact: false };
  return { matches: byDate(ranked[0].matches), ambiguous: [], exact: false };
}
const ambiguousTeam = (q: string, names: string[]) => ({ data: { team: q, live: [], total: 0, ambiguous: names }, cards: [] as AskCard[] });

// ---------- labels (EN / HI) ----------
const L = {
  en: { final: 'Final', semi: 'Semi-finals', quarter: 'Quarter-finals', round: (n: number) => `Round ${n}`, group: (g: string) => `Group ${g}`, groupRound: (n: number) => `Group stage · Round ${n}`, upcoming: 'Upcoming matches', past: 'Past matches', mine: 'Your matches', fixtures: (t: string) => `${t} · fixtures` },
  hi: { final: 'फ़ाइनल', semi: 'सेमीफ़ाइनल', quarter: 'क्वार्टर फ़ाइनल', round: (n: number) => `राउंड ${n}`, group: (g: string) => `ग्रुप ${g}`, groupRound: (n: number) => `ग्रुप स्टेज · राउंड ${n}`, upcoming: 'आने वाले मैच', past: 'पिछले मैच', mine: 'आपके मैच', fixtures: (t: string) => `${t} · मुकाबले` },
} as const;
const koLabel = (lang: ToolLang, round: number, total: number) => { const d = total - round; return d === 0 ? L[lang].final : d === 1 ? L[lang].semi : d === 2 ? L[lang].quarter : L[lang].round(round); };

// ---------- results ----------
export interface ToolOutcome {
  name: string;
  args: Record<string, string | number>;
  ok: boolean;
  /** Whitelisted, PII-filtered data: what a model sees (as data) and what the answer text is written from. */
  data: Record<string, unknown>;
  cards: AskCard[];
  error?: string;
  ms: number;
}

const scoreboard = (m: Match): ScoreboardCard => ({
  type: 'scoreboard', matchId: m.id, status: m.status, title: m.title ?? null,
  teamA: { id: m.teamA.teamId ?? null, name: m.teamA.name, color: m.teamA.color }, teamB: { id: m.teamB.teamId ?? null, name: m.teamB.name, color: m.teamB.color },
  setsA: m.summary?.setsA ?? 0, setsB: m.summary?.setsB ?? 0, currentA: m.summary?.currentA ?? 0, currentB: m.summary?.currentB ?? 0,
  sets: (m.summary?.setScores ?? []).map((x) => [x.a, x.b] as [number, number]), winner: m.summary?.winner ?? null,
});
const statCard = (row: RankingRow | null, id: string, name: string, mine: boolean): StatCard => ({
  type: 'stat', playerId: id, name, mine, rank: row?.rank ?? null, matches: row?.matches ?? 0, wins: row?.wins ?? 0, winPct: row?.winPct ?? 0, rankingPoints: row?.rankingPoints ?? 0, potm: row?.potm ?? 0,
});
const matchWhen = (m: Match) => (m.status === 'finished' ? m.finishedAt ?? m.startedAt ?? null : m.scheduledAt ?? m.startedAt ?? null);
const matchItem = (m: Match, label: string): FixtureItem => ({ id: m.id, matchId: m.id, label, home: m.teamA.name, away: m.teamB.name, status: m.status, setsA: m.summary?.setsA ?? null, setsB: m.summary?.setsB ?? null, when: matchWhen(m) });

/** Picks a tournament by name; with no name the only one, else the running/most recent one. */
async function pickTournament(host: ToolHost, q: string | undefined): Promise<{ t: Tournament | null; ambiguous: Tournament[]; all: Tournament[] }> {
  const all = await host.tournaments();
  if (!all.length) return { t: null, ambiguous: [], all };
  if (q) {
    const hits = bestByName(q, all, (x) => x.name);
    return hits.length === 1 ? { t: hits[0], ambiguous: [], all } : { t: null, ambiguous: hits, all };
  }
  if (all.length === 1) return { t: all[0], ambiguous: [], all };
  const order = (x: Tournament) => (x.status === 'running' ? 2 : x.status === 'registration' ? 1 : 0) * 1e15 + (x.startDate ?? 0);
  return { t: [...all].sort((a, b) => order(b) - order(a))[0], ambiguous: [], all };
}

/** The page's own view of a tournament: claimed matches → results → resolved fixtures + tables (tiebreakNames). */
export function tournamentView(t: Tournament, tagged: Match[]) {
  const matches = claimedTournamentMatches(t, tagged);
  const results: FixtureResult[] = matches.map(fixtureResultFromMatch).filter((r): r is FixtureResult => !!r);
  const byFixture = new Map(matches.filter((m) => m.fixtureId).map((m) => [m.fixtureId!, m]));
  const names = tiebreakNames(t);
  const ids = t.teams.map((x) => x.id);
  if (t.format === 'knockout') { const ko = resolveKnockout(t.fixtures, results); return { fixtures: ko.fixtures, champion: ko.championId, tables: [] as { group: string | null; rows: StandingRow[] }[], byFixture }; }
  if (t.format === 'groups') { const g = resolveGroupsKnockout(t, results, names); return { fixtures: g.fixtures, champion: g.championId, tables: g.tables.map((x) => ({ group: x.group as string | null, rows: x.rows })), byFixture }; }
  return { fixtures: t.fixtures, champion: leagueChampion(ids, t.fixtures, results, names), tables: [{ group: null as string | null, rows: standings(ids, t.fixtures, results, names) }], byFixture };
}

const tournamentList = (ts: Tournament[]): AskCard => ({ type: 'list', kind: 'tournaments', items: ts.slice(0, ASK_CARD_ROWS).map((t) => ({ id: t.id, title: t.name, subtitle: t.format })) });

type Impl = (host: ToolHost, args: Record<string, string | number>, lang: ToolLang) => Promise<{ data: Record<string, unknown>; cards: AskCard[] }>;
const IMPL: Record<AskToolName, Impl> = {
  async my_stats(host) {
    const r = await host.rankings(1);
    const row = r.me ?? (await host.playerTotals(host.viewerId));
    const name = (await host.names([host.viewerId]))[host.viewerId] ?? '';
    const card = statCard(row, host.viewerId, name, true);
    return { data: { player: { name, rank: card.rank, rankedPlayers: r.total, matches: card.matches, wins: card.wins, winPct: card.winPct, rankingPoints: card.rankingPoints, potm: card.potm } }, cards: [card] };
  },
  async player_stats(host, args) {
    const found = await host.findPlayers(String(args.name));
    const best = bestByName(String(args.name), found, (p) => p.name);
    if (!best.length) return { data: { found: 0 }, cards: [] };
    if (best.length > 1) return { data: { found: best.length, candidates: best.slice(0, 5).map((p) => p.name) }, cards: [{ type: 'list', kind: 'players', items: best.slice(0, ASK_CARD_ROWS).map((p) => ({ id: p.id, title: p.name })) }] };
    const p = best[0];
    const row = await host.playerTotals(p.id);
    if (!row) return { data: { found: 1, player: { name: p.name, noStats: true } }, cards: [] };
    const card = statCard(row, p.id, p.name, p.id === host.viewerId);
    return { data: { found: 1, player: { name: p.name, rank: card.rank, matches: card.matches, wins: card.wins, winPct: card.winPct, rankingPoints: card.rankingPoints, potm: card.potm } }, cards: [card] };
  },
  async my_teams(host) {
    const teams = await host.myTeams();
    const items = teams.slice(0, ASK_CARD_ROWS).map((t) => ({ id: t.id, title: t.name, subtitle: `${t.memberIds.length}`, value: t.captainId === host.viewerId ? 'captain' : null, mine: t.captainId === host.viewerId }));
    return { data: { teams: teams.map((t) => ({ name: t.name, players: t.memberIds.length, captain: t.captainId === host.viewerId })) }, cards: teams.length ? [{ type: 'list', kind: 'teams', items }] : [] };
  },
  async team_roster(host, args) {
    const q = String(args.team);
    const pool = [...(await host.myTeams()), ...(await host.findTeams(q))];
    const uniq = [...new Map(pool.map((t) => [t.id, t])).values()];
    const best = bestByName(q, uniq, (t) => t.name);
    if (!best.length) return { data: { found: 0 }, cards: [] };
    if (best.length > 1) return { data: { found: best.length, candidates: best.slice(0, 5).map((t) => t.name) }, cards: [{ type: 'list', kind: 'teams', items: best.slice(0, ASK_CARD_ROWS).map((t) => ({ id: t.id, title: t.name })) }] };
    const t = best[0];
    const names = await host.names(t.memberIds);
    const players = t.memberIds.map((id) => ({ id, name: names[id] ?? '—', captain: id === t.captainId, sub: t.subIds.includes(id) }));
    players.sort((a, b) => Number(b.captain) - Number(a.captain) || Number(a.sub) - Number(b.sub));
    return { data: { found: 1, team: { name: t.name, players: players.map((p) => ({ name: p.name, captain: p.captain, sub: p.sub })) } }, cards: [{ type: 'roster', teamId: t.id, name: t.name, color: t.color, players }] };
  },
  async my_matches(host, args, lang) {
    const when = (args.when as string) ?? 'all';
    const limit = (args.limit as number) ?? 5;
    const all = await host.myMatches();
    const up = all.filter((m) => m.status === 'scheduled' || m.status === 'live').sort((a, b) => (a.status === 'live' ? -1 : 0) - (b.status === 'live' ? -1 : 0) || (matchWhen(a) ?? 9e15) - (matchWhen(b) ?? 9e15));
    const past = all.filter((m) => m.status === 'finished').sort((a, b) => (matchWhen(b) ?? 0) - (matchWhen(a) ?? 0));
    // 1.5.1: 'live' = only the viewer's own matches being played now ('is my match live')
    const pick = when === 'live' ? up.filter((m) => m.status === 'live').slice(0, limit) : when === 'upcoming' ? up.slice(0, limit) : when === 'past' ? past.slice(0, limit) : [...up, ...past].slice(0, limit);
    const cards: AskCard[] = [];
    const live = pick.find((m) => m.status === 'live');
    if (live) cards.push(scoreboard(live));
    // 1.5.1 (Tester F150-7): every finished result carries its state (counted / awaiting / potm / review / disputed / voided)
    if (pick.length) cards.push({ type: 'fixtures', title: when === 'upcoming' || when === 'live' ? L[lang].upcoming : when === 'past' ? L[lang].past : L[lang].mine, items: pick.map((m) => ({ ...matchItem(m, m.title ?? ''), result: resultStatus(m) })) } as FixturesCard);
    return { data: { when, matches: pick.map((m) => ({ status: m.status, teamA: m.teamA.name, teamB: m.teamB.name, setsA: m.summary?.setsA ?? 0, setsB: m.summary?.setsB ?? 0, winner: m.summary?.winner ?? null, when: matchWhen(m), result: resultStatus(m) })) }, cards };
  },
  async live_score(host, args) {
    let live = (await host.liveMatches()).filter((m) => m.status === 'live');
    const q = args.team ? String(args.team) : null;
    // 1.5.7 (Tester F156-2): a named team is picked by NAME-MATCH QUALITY – an exact (case-insensitive) name first, then
    // the best fuzzy score; the date only breaks ties between matches of the chosen team. Several teams with no clear
    // winner ("Juhu" → Juhu Herons / Juhu Hornets) → "which team?" with the candidates, never a guess.
    if (q) {
      const pickL = pickTeam(q, live);
      if (pickL.ambiguous.length) return ambiguousTeam(q, pickL.ambiguous);
      live = pickL.matches;
    }
    const top = live.slice(0, 3);
    // 1.5.6 (F155-3): a named team that isn't live → its latest finished match
    if (q && !top.length) {
      const window = await (host.recentMatches ? host.recentMatches() : host.myMatches());
      let pool = window.filter((m) => m.status === 'finished');
      let picked = pickTeam(q, pool);
      // 1.5.7 (F156-5): not (clearly) in the window → that team's own finished matches, queried directly
      if (!picked.exact && host.teamMatches) {
        const seen = new Set(pool.map((m) => m.id));
        pool = [...pool, ...(await host.teamMatches(q)).filter((m) => m.status === 'finished' && !seen.has(m.id))];
        picked = pickTeam(q, pool);
      }
      if (picked.ambiguous.length) return ambiguousTeam(q, picked.ambiguous);
      const m = picked.matches[0];
      if (m) {
        const sets = (m.summary?.setScores ?? []).map((x) => `${x.a}-${x.b}`);
        return { data: { team: q, live: [], total: 0, latest: { teamA: m.teamA.name, teamB: m.teamB.name, setsA: m.summary?.setsA ?? 0, setsB: m.summary?.setsB ?? 0, sets: sets.join(', '), lastSet: sets[sets.length - 1] ?? null, result: resultStatus(m), when: matchWhen(m) } }, cards: [scoreboard(m)] };
      }
    }
    return { data: { team: q, live: top.map((m) => ({ teamA: m.teamA.name, teamB: m.teamB.name, setsA: m.summary?.setsA ?? 0, setsB: m.summary?.setsB ?? 0, currentA: m.summary?.currentA ?? 0, currentB: m.summary?.currentB ?? 0 })), total: live.length }, cards: top.map(scoreboard) };
  },
  async tournament_standings(host, args) {
    if (args.list === 'yes') {
      const all = await host.tournaments();
      return { data: { list: all.slice(0, ASK_CARD_ROWS).map((x) => ({ name: x.name, format: x.format, status: x.status })), total: all.length }, cards: all.length ? [tournamentList(all)] : [] };
    }
    const { t, ambiguous, all } = await pickTournament(host, args.tournament as string | undefined);
    if (!t) return { data: { found: ambiguous.length, candidates: ambiguous.map((x) => x.name), tournaments: all.length }, cards: ambiguous.length ? [tournamentList(ambiguous)] : all.length ? [tournamentList(all)] : [] };
    const v = tournamentView(t, await host.tournamentMatches(t.id));
    const nameOf = (id: string | null) => t.teams.find((x) => x.id === id)?.name ?? '';
    const colorOf = (id: string) => t.teams.find((x) => x.id === id)?.color ?? '#888888';
    const adv = t.format === 'groups' ? t.advance ?? 2 : 0;
    const champion = v.champion ? nameOf(v.champion) : null;
    const g = args.group as string | undefined;
    const tables = g ? v.tables.filter((x) => x.group === g) : v.tables;
    const cards: StandingsCard[] = tables.slice(0, 4).map((tb) => ({
      type: 'standings', tournamentId: t.id, title: t.name, group: tb.group, champion,
      rows: tb.rows.slice(0, ASK_CARD_ROWS).map((r, i) => ({ pos: i + 1, teamId: r.teamId, name: nameOf(r.teamId), color: colorOf(r.teamId), played: r.played, won: r.won, lost: r.lost, setsWon: r.setsWon, setsLost: r.setsLost, points: r.tablePoints, q: i < adv })),
    }));
    if (!cards.length) cards.push({ type: 'standings', tournamentId: t.id, title: t.name, group: null, champion, rows: [] });
    return { data: { tournament: t.name, format: t.format, group: g ?? null, champion, tables: cards.map((c) => ({ group: c.group, rows: c.rows.map((r) => ({ pos: r.pos, team: r.name, played: r.played, won: r.won, lost: r.lost, sets: `${r.setsWon}-${r.setsLost}`, points: r.points, qualifies: r.q })) })) }, cards: cards.slice(0, 3) };
  },
  async tournament_fixtures(host, args, lang) {
    const { t, ambiguous, all } = await pickTournament(host, args.tournament as string | undefined);
    if (!t) return { data: { found: ambiguous.length, candidates: ambiguous.map((x) => x.name), tournaments: all.length }, cards: ambiguous.length ? [tournamentList(ambiguous)] : all.length ? [tournamentList(all)] : [] };
    const v = tournamentView(t, await host.tournamentMatches(t.id));
    const nameOf = (id: string | null | undefined) => t.teams.find((x) => x.id === id)?.name ?? null;
    const ko = v.fixtures.filter((f) => !f.group);
    const koTotal = ko.length ? Math.max(...ko.map((f) => f.round)) : 0;
    const label = (f: Fixture) => (t.format === 'league' ? L[lang].round(f.round) : f.group ? `${L[lang].group(f.group)} · ${L[lang].round(f.round)}` : koLabel(lang, f.round, koTotal));
    const status = (args.status as string) ?? 'all';
    const items: FixtureItem[] = v.fixtures.map((f) => {
      const m = v.byFixture.get(f.id);
      return { id: f.id, matchId: m?.id ?? null, label: label(f), home: nameOf(f.homeId) ?? (f.homeSeed ? L[lang].group(f.homeSeed[0]) + ` #${f.homeSeed.slice(1)}` : 'TBD'), away: nameOf(f.awayId) ?? (f.awaySeed ? L[lang].group(f.awaySeed[0]) + ` #${f.awaySeed.slice(1)}` : 'TBD'), status: (m ? m.status : 'open') as FixtureItem['status'], setsA: m?.summary?.setsA ?? null, setsB: m?.summary?.setsB ?? null, when: m ? matchWhen(m) : null };
    }).filter((i) => (status === 'played' ? i.status === 'finished' : status === 'upcoming' ? i.status !== 'finished' : true));
    const shown = items.slice(0, ASK_CARD_ROWS);
    return { data: { tournament: t.name, status, total: items.length, fixtures: shown.map((i) => ({ round: i.label, home: i.home, away: i.away, status: i.status, score: i.setsA === null ? null : `${i.setsA}-${i.setsB}` })) }, cards: [{ type: 'fixtures', title: L[lang].fixtures(t.name), items: shown }] };
  },
  async challenges_status(host) {
    const mine = await host.myTeams();
    const list = mine.length ? await host.challengesFor(mine.map((t) => t.id)) : [];
    const ids = new Set(mine.map((t) => t.id));
    const rel = list.filter((c) => ids.has(c.fromTeamId) || ids.has(c.toTeamId)).sort((a, b) => b.when - a.when).slice(0, ASK_CARD_ROWS);
    return {
      data: { teams: mine.length, challenges: rel.map((c) => ({ from: c.fromTeamName, to: c.toTeamName, status: c.status, when: c.when, place: c.location?.name ?? null })) },
      cards: rel.length ? [{ type: 'list', kind: 'challenges', items: rel.map((c) => ({ id: c.id, title: `${c.fromTeamName} → ${c.toTeamName}`, subtitle: c.location?.name ?? null, value: c.status })) }] : [],
    };
  },
  async leaderboard(host, args) {
    const limit = (args.limit as number) ?? 5;
    const r = await host.rankings(limit);
    const rows = r.ranked.slice(0, limit);
    return {
      data: { total: r.total, top: rows.map((x) => ({ rank: x.rank, name: x.name ?? '', rankingPoints: x.rankingPoints, matches: x.matches, wins: x.wins })), me: r.me ? { rank: r.me.rank, rankingPoints: r.me.rankingPoints } : null },
      cards: rows.length ? [{ type: 'list', kind: 'leaderboard', items: rows.map((x) => ({ id: x.playerId, title: x.name ?? '', subtitle: `#${x.rank}`, value: String(x.rankingPoints), mine: x.playerId === host.viewerId })) }] : [],
    };
  },
};

/** Validates, runs one tool as the viewer and filters its output. Never throws (errors are a failed outcome). */
export async function runTool(host: ToolHost, name: unknown, rawArgs: unknown, lang: ToolLang): Promise<ToolOutcome> {
  const t0 = Date.now();
  const nm = typeof name === 'string' ? name.slice(0, 40) : 'invalid';
  const v = validateToolArgs(name, rawArgs);
  if (!v.ok) return { name: nm, args: {}, ok: false, data: { error: v.error }, cards: [], error: v.error, ms: Date.now() - t0 };
  try {
    const r = await IMPL[name as AskToolName](host, v.args, lang);
    return { name: nm, args: v.args, ok: true, data: filterPii(r.data), cards: filterPii(r.cards), ms: Date.now() - t0 };
  } catch {
    return { name: nm, args: v.args, ok: false, data: { error: 'tool_failed' }, cards: [], error: 'tool_failed', ms: Date.now() - t0 };
  }
}
