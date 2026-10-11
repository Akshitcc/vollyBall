/**
 * Event-sourced volleyball scoring engine. Pure TypeScript.
 *
 * A match is a list of immutable events. The full state is always derived by
 * replaying events, which makes undo trivial (drop the last event), sync
 * conflict-free for a single scorer, and the timeline free.
 */
import { RuleSet, setsToWin } from './rules';

export type Side = 'A' | 'B';
export type PointKind = 'kill' | 'block' | 'ace' | 'tip';
export const POINT_KINDS: PointKind[] = ['kill', 'block', 'ace', 'tip'];

export interface PointEvent {
  type: 'point';
  side: Side;
  at: number;
  playerId?: string;
  kind?: PointKind;
}
export interface TimeoutEvent {
  type: 'timeout';
  side: Side;
  at: number;
}
export type MatchEvent = PointEvent | TimeoutEvent;

export interface SetScore {
  a: number;
  b: number;
  winner: Side | null;
}

export interface MatchState {
  /** Completed sets, in order. */
  sets: SetScore[];
  /** Score of the set in progress (or the final set once finished). */
  current: { a: number; b: number };
  /** 0-based index of the set in progress. */
  setIndex: number;
  setsWon: { A: number; B: number };
  serving: Side;
  winner: Side | null;
  finished: boolean;
  isDecidingSet: boolean;
  targetPoints: number;
  timeoutsUsed: { A: number; B: number };
  timeoutsLeft: { A: number; B: number };
  /** True right after the point that triggers a side switch. */
  sideSwitchDue: boolean;
  setPoint: Side | null;
  matchPoint: Side | null;
  totalPoints: { A: number; B: number };
}

export const other = (s: Side): Side => (s === 'A' ? 'B' : 'A');

/** Exported for the rotation tracker (core/rotation.ts); behaviour unchanged. */
export function isSetWon(score: number, opp: number, target: number, rules: RuleSet): boolean {
  if (rules.pointCap !== null && score >= rules.pointCap) return true;
  return score >= target && score - opp >= rules.winBy;
}

/** Would `side` win the set by scoring the next point? */
function wouldWinSet(a: number, b: number, side: Side, target: number, rules: RuleSet): boolean {
  return side === 'A' ? isSetWon(a + 1, b, target, rules) : isSetWon(b + 1, a, target, rules);
}

export function computeState(rules: RuleSet, events: readonly MatchEvent[], firstServe: Side = 'A'): MatchState {
  const need = setsToWin(rules);
  const sets: SetScore[] = [];
  let a = 0;
  let b = 0;
  let setIndex = 0;
  const setsWon = { A: 0, B: 0 };
  let serving: Side = firstServe;
  let winner: Side | null = null;
  let timeoutsUsed = { A: 0, B: 0 };
  let sideSwitchDue = false;
  let decidingSwitchDone = false;
  const totalPoints = { A: 0, B: 0 };

  const isDeciding = () => setIndex === rules.bestOf - 1 && rules.bestOf > 1;
  const target = () => (isDeciding() ? rules.decidingSetPoints : rules.pointsPerSet);

  for (const ev of events) {
    if (winner) break; // events after match end are ignored
    if (ev.type === 'timeout') {
      if (timeoutsUsed[ev.side] < rules.timeoutsPerSet) {
        timeoutsUsed = { ...timeoutsUsed, [ev.side]: timeoutsUsed[ev.side] + 1 };
      }
      sideSwitchDue = false;
      continue;
    }
    // point
    if (ev.side === 'A') a++;
    else b++;
    totalPoints[ev.side]++;
    serving = ev.side; // rally scoring: rally winner serves
    sideSwitchDue = false;

    const t = target();
    const scorer = ev.side === 'A' ? a : b;
    const opp = ev.side === 'A' ? b : a;
    if (isSetWon(scorer, opp, t, rules)) {
      sets.push({ a, b, winner: ev.side });
      setsWon[ev.side]++;
      if (setsWon[ev.side] >= need) {
        winner = ev.side;
      } else {
        setIndex++;
        a = 0;
        b = 0;
        timeoutsUsed = { A: 0, B: 0 };
        decidingSwitchDone = false;
        // Serve alternates at the start of each set.
        serving = setIndex % 2 === 0 ? firstServe : other(firstServe);
      }
      continue;
    }
    // side switches (only inside a set that continues)
    const combined = a + b;
    const every = isDeciding() ? rules.decidingSideSwitchEvery : rules.sideSwitchEvery;
    if (every && combined % every === 0) sideSwitchDue = true;
    if (isDeciding() && rules.decidingSwitchAt && !decidingSwitchDone && Math.max(a, b) === rules.decidingSwitchAt) {
      sideSwitchDue = true;
      decidingSwitchDone = true;
    }
  }

  const finished = winner !== null;
  const current = finished ? { a: sets[sets.length - 1].a, b: sets[sets.length - 1].b } : { a, b };
  const t = target();
  let setPoint: Side | null = null;
  let matchPoint: Side | null = null;
  if (!finished) {
    for (const s of ['A', 'B'] as Side[]) {
      if (wouldWinSet(a, b, s, t, rules)) {
        setPoint = s;
        if (setsWon[s] + 1 >= need) matchPoint = s;
      }
    }
  }
  return {
    sets,
    current,
    setIndex: finished ? sets.length - 1 : setIndex,
    setsWon,
    serving,
    winner,
    finished,
    isDecidingSet: isDeciding(),
    targetPoints: t,
    timeoutsUsed,
    timeoutsLeft: {
      A: rules.timeoutsPerSet - timeoutsUsed.A,
      B: rules.timeoutsPerSet - timeoutsUsed.B,
    },
    sideSwitchDue,
    setPoint,
    matchPoint,
    totalPoints,
  };
}

/** Add a rally point. Returns the same array if the match is already over. */
export function addPoint(
  rules: RuleSet,
  events: readonly MatchEvent[],
  side: Side,
  opts: { at?: number; playerId?: string; kind?: PointKind; firstServe?: Side } = {},
): MatchEvent[] {
  if (computeState(rules, events, opts.firstServe).finished) return [...events];
  const ev: PointEvent = { type: 'point', side, at: opts.at ?? Date.now() };
  if (opts.playerId) ev.playerId = opts.playerId;
  if (opts.kind) ev.kind = opts.kind;
  return [...events, ev];
}

/** Call a timeout; ignored if the team has none left or the match is over. */
export function callTimeout(
  rules: RuleSet,
  events: readonly MatchEvent[],
  side: Side,
  opts: { at?: number; firstServe?: Side } = {},
): MatchEvent[] {
  const st = computeState(rules, events, opts.firstServe);
  if (st.finished || st.timeoutsLeft[side] <= 0) return [...events];
  return [...events, { type: 'timeout', side, at: opts.at ?? Date.now() }];
}

/** Undo the last event (point or timeout). */
export function undo(events: readonly MatchEvent[]): MatchEvent[] {
  return events.slice(0, -1);
}

/**
 * Attribute the most recent point to a player (optional step after a tap).
 * Only allowed when the last event is a point. Prefer `attributePoint`, which
 * targets the rally by index and survives a timeout called in between.
 */
export function attributeLastPoint(events: readonly MatchEvent[], playerId: string, kind: PointKind, roster?: readonly string[]): MatchEvent[] {
  return attributePoint(events, events.length - 1, playerId, kind, roster);
}

/**
 * Credit the point at `index` (captured when the rally was tapped) to a player.
 * Returns the events unchanged if that event is not a point or, when the
 * scoring team's `roster` is given, if the player is not on that team – a
 * point can never be credited to a player of the other team.
 */
export function attributePoint(
  events: readonly MatchEvent[],
  index: number,
  playerId: string,
  kind?: PointKind,
  roster?: readonly string[],
): MatchEvent[] {
  const ev = events[index];
  if (!ev || ev.type !== 'point') return [...events];
  if (roster && !roster.includes(playerId)) return [...events];
  const next = [...events];
  // The shot type is optional: crediting a player alone counts the point for them.
  const { kind: _old, ...rest } = ev;
  next[index] = kind ? { ...rest, playerId, kind } : { ...rest, playerId };
  return next;
}

/** Compact summary stored next to the event log (used by list screens & rules). */
export interface MatchSummary {
  setsA: number;
  setsB: number;
  currentA: number;
  currentB: number;
  setScores: { a: number; b: number }[];
  winner: Side | null;
  serving: Side;
}

export function summarize(state: MatchState): MatchSummary {
  return {
    setsA: state.setsWon.A,
    setsB: state.setsWon.B,
    currentA: state.current.a,
    currentB: state.current.b,
    setScores: state.sets.map((s) => ({ a: s.a, b: s.b })),
    winner: state.winner,
    serving: state.serving,
  };
}

/** Points timeline split per set, for the point-by-point view. */
export interface TimelineEntry {
  set: number;
  a: number;
  b: number;
  event: MatchEvent;
}
export function timeline(rules: RuleSet, events: readonly MatchEvent[], firstServe: Side = 'A'): TimelineEntry[] {
  const out: TimelineEntry[] = [];
  for (let i = 0; i < events.length; i++) {
    const before = computeState(rules, events.slice(0, i), firstServe);
    if (before.finished) break;
    const after = computeState(rules, events.slice(0, i + 1), firstServe);
    const setNo = before.setIndex;
    // If the event completed a set, read the final score of that set.
    const done = after.sets.length > before.sets.length ? after.sets[after.sets.length - 1] : null;
    out.push({
      set: setNo + 1,
      a: done ? done.a : after.current.a,
      b: done ? done.b : after.current.b,
      event: events[i],
    });
  }
  return out;
}

/**
 * 1.3.2 "tap a player to score": ONE point event that gives the rally to the player's team AND
 * credits the player (rules allow one event per write; undo drops it, reverting both). The player
 * must be on that team's roster and, when `onCourt` is given, on court (bench players can't win a
 * rally). Returns the events unchanged otherwise or when the match is over.
 */
export function playerPoint(
  rules: RuleSet,
  events: readonly MatchEvent[],
  side: Side,
  playerId: string,
  opts: { roster: readonly string[]; onCourt?: readonly (string | null)[]; at?: number; firstServe?: Side; kind?: PointKind },
): MatchEvent[] {
  if (!playerId || !opts.roster.includes(playerId)) return [...events];
  if (opts.onCourt && !opts.onCourt.includes(playerId)) return [...events];
  return addPoint(rules, events, side, { at: opts.at, playerId, kind: opts.kind, firstServe: opts.firstServe });
}
