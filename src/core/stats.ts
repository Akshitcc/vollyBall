/** Player / team statistics derived from match event logs. Pure TypeScript. */
import { RuleSet, describeRules } from './rules';
import { MatchEvent, MatchState, PointKind, Side, computeState } from './scoring';

export interface PlayerLine {
  playerId: string;
  points: number;
  kill: number;
  block: number;
  ace: number;
  tip: number;
}

/** Shot-type icons (timeline, stats table). */
export const KIND_EMOJI: Record<PointKind, string> = { kill: '💥', block: '🧱', ace: '🎯', tip: '🪶' };
/**
 * The timeline's icon for a point: its shot type's, or none when the point was credited to a player
 * without one (fix re-test 212 #2). Such a point counts in the player's points but in no shot type,
 * so showing 💥 for it disagreed with the stats.
 */
export const kindEmoji = (kind?: PointKind | null): string => (kind ? KIND_EMOJI[kind] : '');
/** "💥 Rohan Das" for a typed credit, "Rohan Das" for an untyped one. */
export const creditLabel = (name: string, kind?: PointKind | null): string => (kind ? `${KIND_EMOJI[kind]} ${name}` : name);

const emptyLine = (playerId: string): PlayerLine => ({ playerId, points: 0, kill: 0, block: 0, ace: 0, tip: 0 });

/** The two rosters of a match (only the player ids are used). */
export interface MatchRosters {
  teamA: { players: readonly { id: string }[] };
  teamB: { players: readonly { id: string }[] };
}

/**
 * Is this point credit valid: the credited player belongs to the side that won the rally (QA NB-R5;
 * the API rejects such events in validateEvents, Firebase documents may still carry them). Without
 * rosters every credit counts (callers that only have the event log).
 */
export function creditCounts(ev: MatchEvent, rosters?: MatchRosters): boolean {
  if (ev.type !== 'point' || !ev.playerId) return false;
  if (!rosters) return true;
  const team = ev.side === 'A' ? rosters.teamA : rosters.teamB;
  return team.players.some((p) => p.id === ev.playerId);
}

/**
 * Count attributed points per player in a single match (only counted points). Pass the match's
 * rosters so a credit to a player who isn't on the rally-winning side is ignored (QA NB-R5).
 */
export function playerStats(rules: RuleSet, events: readonly MatchEvent[], firstServe: Side = 'A', rosters?: MatchRosters): Record<string, PlayerLine> {
  const out: Record<string, PlayerLine> = {};
  // Only count points that the engine accepted (ignore anything after match end).
  const accepted = acceptedEvents(rules, events, firstServe);
  for (const ev of accepted) {
    if (ev.type !== 'point' || !ev.playerId || !creditCounts(ev, rosters)) continue;
    const line = (out[ev.playerId] ??= emptyLine(ev.playerId));
    line.points++;
    if (ev.kind) line[ev.kind as PointKind]++;
  }
  return out;
}

/**
 * 1.3.2: live point count per player (the number on each court tile). The same derivation as the
 * match stats, Profile career, rankings and the Player of the Match (playerStats), so the counts
 * shown while scoring always agree with them.
 */
export function playerPointCounts(rules: RuleSet, events: readonly MatchEvent[], firstServe: Side = 'A', rosters?: MatchRosters): Record<string, number> {
  return Object.fromEntries(Object.entries(playerStats(rules, events, firstServe, rosters)).map(([id, l]) => [id, l.points]));
}

/** Events up to and including the match-winning point. */
export function acceptedEvents(rules: RuleSet, events: readonly MatchEvent[], firstServe: Side = 'A'): MatchEvent[] {
  const st = computeState(rules, events, firstServe);
  if (!st.finished) return [...events];
  // find the minimal prefix that finishes the match
  for (let i = 1; i <= events.length; i++) {
    if (computeState(rules, events.slice(0, i), firstServe).finished) return events.slice(0, i);
  }
  return [...events];
}

export interface Run {
  side: Side | null;
  length: number;
}

/** Longest streak of consecutive points by one team (timeouts don't break a run). */
export function longestRun(events: readonly MatchEvent[]): { A: number; B: number; best: Run } {
  let curSide: Side | null = null;
  let cur = 0;
  const best = { A: 0, B: 0 };
  for (const ev of events) {
    if (ev.type !== 'point') continue;
    if (ev.side === curSide) cur++;
    else {
      curSide = ev.side;
      cur = 1;
    }
    if (cur > best[ev.side]) best[ev.side] = cur;
  }
  const side: Side | null = best.A === 0 && best.B === 0 ? null : best.A >= best.B ? 'A' : 'B';
  return { ...best, best: { side, length: side ? best[side] : 0 } };
}

export interface TeamTotals {
  points: { A: number; B: number };
  byKind: { A: Record<PointKind, number>; B: Record<PointKind, number> };
  unattributed: { A: number; B: number };
}

export function teamTotals(events: readonly MatchEvent[]): TeamTotals {
  const zero = (): Record<PointKind, number> => ({ kill: 0, block: 0, ace: 0, tip: 0 });
  const t: TeamTotals = { points: { A: 0, B: 0 }, byKind: { A: zero(), B: zero() }, unattributed: { A: 0, B: 0 } };
  for (const ev of events) {
    if (ev.type !== 'point') continue;
    t.points[ev.side]++;
    if (ev.kind) t.byKind[ev.side][ev.kind]++;
    else t.unattributed[ev.side]++;
  }
  return t;
}

/** Minimal shape of a stored match needed for career stats. */
export interface MatchForStats {
  /** Stored match status; only 'finished' matches count (live, scheduled and abandoned don't). */
  status?: string;
  rules: RuleSet;
  events: MatchEvent[];
  firstServe?: Side;
  teamA: { players: { id: string }[] };
  teamB: { players: { id: string }[] };
}

export interface CareerStats {
  matches: number;
  finished: number;
  wins: number;
  losses: number;
  points: number;
  kill: number;
  block: number;
  ace: number;
  tip: number;
  winRate: number; // 0..1
}

export function sideOfPlayer(m: MatchForStats, playerId: string): Side | null {
  if (m.teamA.players.some((p) => p.id === playerId)) return 'A';
  if (m.teamB.players.some((p) => p.id === playerId)) return 'B';
  return null;
}

/**
 * Career totals over COMPLETED matches only: a match counts when its stored
 * status is 'finished' (if given) and the scoring engine agrees it is over.
 * Live, scheduled, abandoned and unscored matches are ignored.
 */
export function careerStats(playerId: string, matches: readonly MatchForStats[]): CareerStats {
  const c: CareerStats = { matches: 0, finished: 0, wins: 0, losses: 0, points: 0, kill: 0, block: 0, ace: 0, tip: 0, winRate: 0 };
  for (const m of matches) {
    if (m.status !== undefined && m.status !== 'finished') continue;
    const st = computeState(m.rules, m.events, m.firstServe);
    if (!st.finished) continue;
    const side = sideOfPlayer(m, playerId);
    const lines = playerStats(m.rules, m.events, m.firstServe, m);
    const line = lines[playerId];
    if (!side && !line) continue;
    c.matches++;
    if (line) {
      c.points += line.points;
      c.kill += line.kill;
      c.block += line.block;
      c.ace += line.ace;
      c.tip += line.tip;
    }
    if (side) {
      c.finished++;
      if (st.winner === side) c.wins++;
      else c.losses++;
    }
  }
  c.winRate = c.finished ? c.wins / c.finished : 0;
  return c;
}

/**
 * QA C130-8 (1.3.1): Profile's Career stats over exactly the matches behind the rank card: the
 * rankings result's `myCountedMatchIds` (completed + confirmed + not flagged + caps, core/antifraud.ts).
 * `stats` is null while the rankings load or when they failed (shown as "–", never a misleading 0);
 * `notCounted` = my finished matches that don't count (yet).
 */
export function profileCareer(
  playerId: string,
  matches: readonly (MatchForStats & { id: string })[],
  rankings: { myCountedMatchIds?: readonly string[] } | null | undefined,
): { stats: CareerStats | null; notCounted: number } {
  const finishedMine = matches.filter((m) => m.status === 'finished' && sideOfPlayer(m, playerId));
  if (!rankings) return { stats: null, notCounted: 0 };
  const ids = new Set(rankings.myCountedMatchIds ?? []);
  return { stats: careerStats(playerId, matches.filter((m) => ids.has(m.id))), notCounted: finishedMine.filter((m) => !ids.has(m.id)).length };
}

/** Plain-text result for sharing (WhatsApp, SMS...). */
export function shareText(
  nameA: string,
  nameB: string,
  rules: RuleSet,
  events: readonly MatchEvent[],
  firstServe: Side = 'A',
  extra?: { location?: string },
): string {
  const st: MatchState = computeState(rules, events, firstServe);
  const sets = st.sets.map((s) => `${s.a}-${s.b}`);
  if (!st.finished && (st.current.a || st.current.b)) sets.push(`${st.current.a}-${st.current.b}*`);
  const head = st.finished
    ? `🏐 ${st.winner === 'A' ? nameA : nameB} beat ${st.winner === 'A' ? nameB : nameA} ${Math.max(st.setsWon.A, st.setsWon.B)}-${Math.min(st.setsWon.A, st.setsWon.B)}`
    : `🏐 LIVE: ${nameA} ${st.setsWon.A} - ${st.setsWon.B} ${nameB}`;
  const run = longestRun(acceptedEvents(rules, events, firstServe));
  const lines = [head, `Sets: ${sets.join(', ') || '—'}`];
  if (run.best.side) lines.push(`Longest run: ${run.best.length} points (${run.best.side === 'A' ? nameA : nameB})`);
  lines.push(describeRules(rules));
  if (extra?.location) lines.push(`📍 ${extra.location}`);
  lines.push('Scored with VolleyLive');
  return lines.join('\n');
}
