/**
 * Court positions & rotation. Pure TypeScript.
 *
 * Positions follow the standard numbering: 1 = right back (server),
 * 2 = right front, 3 = middle front, 4 = left front, 5 = left back, 6 = middle back.
 * Lineups are arrays of 6 slots where index 0 = position 1 … index 5 = position 6.
 *
 * Like the score, rotation is derived by replaying the event log, so undo
 * (dropping the last event) reverses a rotation exactly.
 *
 * Rules: when the receiving team wins a rally (side-out) it rotates clockwise
 * (2→1, 3→2, 4→3, 5→4, 6→5, 1→6) and its new position-1 player serves.
 * No rotation when the serving team wins the rally. At the start of each set
 * the set's starting lineup is used, and the first server does not rotate.
 */
import { setsToWin, type RuleSet } from './rules';
import { isSetWon, other, type MatchEvent, type Side } from './scoring';

export type Slot = string | null;
export const COURT_SIZE = 6;

export interface SideLineups {
  A: Slot[];
  B: Slot[];
}
/** Starting lineup per set, keyed by 1-based set number ("1", "2", …). */
export type Lineups = Record<string, SideLineups>;

/** Default order: the first six players of the roster into positions 1–6 (empty slots stay null). */
export function defaultLineup(playerIds: readonly string[]): Slot[] {
  return Array.from({ length: COURT_SIZE }, (_, i) => playerIds[i] ?? null);
}

/** Keep only known players, no duplicates, always 6 slots. */
export function normalizeLineup(lineup: readonly Slot[] | undefined | null, playerIds: readonly string[]): Slot[] {
  const known = new Set(playerIds);
  const seen = new Set<string>();
  return Array.from({ length: COURT_SIZE }, (_, i) => {
    const p = lineup?.[i] ?? null;
    if (!p || !known.has(p) || seen.has(p)) return null;
    seen.add(p);
    return p;
  });
}

/** One clockwise rotation: the player in position 2 moves to position 1, 1 → 6, etc. */
export function rotateClockwise(slots: readonly Slot[]): Slot[] {
  return slots.map((_, i) => slots[(i + 1) % slots.length]);
}

/** Put `playerId` in `position` (1–6); if they were elsewhere, the two slots swap. */
export function assignPosition(slots: readonly Slot[], position: number, playerId: string | null): Slot[] {
  const out = [...slots];
  const idx = position - 1;
  const from = playerId ? out.indexOf(playerId) : -1;
  if (from >= 0) out[from] = out[idx];
  out[idx] = playerId;
  return out;
}

/** Starting lineup for a set: explicit lineup, else the previous set's starting lineup, else the default order. */
export function startingLineup(lineups: Lineups | null | undefined, setNumber: number, side: Side, roster: readonly string[]): Slot[] {
  for (let n = setNumber; n >= 1; n--) {
    const l = lineups?.[String(n)]?.[side];
    if (l) return normalizeLineup(l, roster);
  }
  return defaultLineup(roster);
}

export interface RotationState {
  /** 0-based index of the set the positions belong to. */
  setIndex: number;
  /** Current positions per team (index 0 = position 1). */
  positions: { A: Slot[]; B: Slot[] };
  serving: Side;
  /** Player serving right now (position 1 of the serving team), if known. */
  server: string | null;
  /** Number of rotations each team made in this set. */
  rotations: { A: number; B: number };
  /** True while no rally has been played in the current set (lineup can still be changed). */
  atSetStart: boolean;
}

/** Who served one rally (one entry per accepted point event). */
export interface RotationPoint {
  /** Index into the event list. */
  eventIndex: number;
  /** 0-based set the rally belongs to. */
  setIndex: number;
  /** Team that served the rally. */
  servingSide: Side;
  /** Player in position 1 of the serving team when the rally was served. */
  server: string | null;
}

export interface RotationTimeline {
  points: RotationPoint[];
  /** Rotations per team for every set that has started (index = setIndex). */
  setRotations: { A: number; B: number }[];
  final: RotationState;
}

/** Current court positions (see rotationTimeline). */
export function rotationState(
  rules: RuleSet,
  events: readonly MatchEvent[],
  firstServe: Side,
  rosters: { A: readonly string[]; B: readonly string[] },
  lineups?: Lineups | null,
): RotationState {
  return rotationTimeline(rules, events, firstServe, rosters, lineups).final;
}

/**
 * Replays the event log once and returns the server of every rally, the
 * rotations per set and the final positions. Used by the API to store the
 * server of each point and the rotation count of each set.
 */
export function rotationTimeline(
  rules: RuleSet,
  events: readonly MatchEvent[],
  firstServe: Side,
  rosters: { A: readonly string[]; B: readonly string[] },
  lineups?: Lineups | null,
): RotationTimeline {
  const points: RotationPoint[] = [];
  const setRotations: { A: number; B: number }[] = [];
  const need = setsToWin(rules);
  let setIndex = 0;
  let a = 0;
  let b = 0;
  const setsWon = { A: 0, B: 0 };
  let serving: Side = firstServe;
  let finished = false;
  const start = (i: number) => ({ A: startingLineup(lineups, i + 1, 'A', rosters.A), B: startingLineup(lineups, i + 1, 'B', rosters.B) });
  let positions = start(0);
  let rotations = { A: 0, B: 0 };
  let pointsInSet = 0;

  for (let i = 0; i < events.length; i++) {
    const ev = events[i];
    if (finished) break;
    if (ev.type !== 'point') continue;
    points.push({ eventIndex: i, setIndex, servingSide: serving, server: positions[serving][0] ?? null });
    if (ev.side !== serving) {
      positions = { ...positions, [ev.side]: rotateClockwise(positions[ev.side]) };
      rotations = { ...rotations, [ev.side]: rotations[ev.side] + 1 };
    }
    serving = ev.side;
    pointsInSet++;
    if (ev.side === 'A') a++;
    else b++;
    const deciding = setIndex === rules.bestOf - 1 && rules.bestOf > 1;
    const target = deciding ? rules.decidingSetPoints : rules.pointsPerSet;
    const mine = ev.side === 'A' ? a : b;
    const opp = ev.side === 'A' ? b : a;
    if (isSetWon(mine, opp, target, rules)) {
      setsWon[ev.side]++;
      setRotations[setIndex] = rotations;
      if (setsWon[ev.side] >= need) {
        finished = true;
      } else {
        setIndex++;
        a = 0;
        b = 0;
        pointsInSet = 0;
        serving = setIndex % 2 === 0 ? firstServe : other(firstServe);
        positions = start(setIndex);
        rotations = { A: 0, B: 0 };
      }
    }
  }
  if (!finished) setRotations[setIndex] = rotations;
  return {
    points,
    setRotations,
    final: {
      setIndex,
      positions,
      serving,
      server: positions[serving][0] ?? null,
      rotations,
      atSetStart: !finished && pointsInSet === 0,
    },
  };
}

/**
 * Court layout for drawing a team's half with the net in the middle of the
 * screen. Returns 3 rows (top → bottom) of 2 position numbers (left → right).
 * A team on the left faces right, so its front row (4-3-2) is the right column;
 * a team on the right faces left, so everything is mirrored.
 */
export function courtGrid(screenSide: 'left' | 'right'): [number, number][] {
  return screenSide === 'left'
    ? [
        [5, 4],
        [6, 3],
        [1, 2],
      ]
    : [
        [2, 1],
        [3, 6],
        [4, 5],
      ];
}
