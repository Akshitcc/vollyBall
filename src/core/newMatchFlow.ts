/**
 * New match as a 3-step flow (1.3.2, design-spec §8 05): Teams → Rules → Start. Pure helpers shared by
 * the screen and its tests: what still blocks the Teams step, which steps may be opened, where back goes.
 *
 * Rules: tapping a step tab may go back to any earlier step, or forward only when every step before
 * the target is complete. The Rules step is always complete (validateRules clamps every setting), so
 * once the teams are ready both Rules and Start can be opened.
 */
import { maxPlayersFor, MIN_PLAYERS, type TeamSizeMode } from './roster';

export const NEW_MATCH_STEPS = ['teams', 'rules', 'start'] as const;
export type NewMatchStep = 0 | 1 | 2;

/** What the Teams step knows about one side. */
export interface SideSummary {
  kind: 'team' | 'build';
  /** Registered team id (team sides). */
  teamId?: string | null;
  name: string;
  players: number;
  /** Built sides: the captain named by the creator (registered teams have a fixed captain). */
  captain?: string | null;
}

export type TeamsProblem =
  | { code: 'pickBoth' }
  | { code: 'nameRequired'; side: 'A' | 'B' }
  | { code: 'needPlayers'; side: 'A' | 'B'; missing: number }
  | { code: 'tooMany'; side: 'A' | 'B'; max: number }
  | { code: 'captainRequired'; side: 'A' | 'B' }
  | { code: 'sameTeams' };

/** The first thing keeping "Next: Rules" disabled (null = both teams are ready). */
export function teamsProblem(a: SideSummary | null, b: SideSummary | null, mode?: TeamSizeMode | null): TeamsProblem | null {
  for (const [v, side] of [[a, 'A'], [b, 'B']] as const) {
    if (!v) return { code: 'pickBoth' };
    if (v.kind === 'build' && !v.name.trim()) return { code: 'nameRequired', side };
    if (v.players < MIN_PLAYERS) return { code: 'needPlayers', side, missing: MIN_PLAYERS - v.players };
    if (v.players > maxPlayersFor(mode)) return { code: 'tooMany', side, max: maxPlayersFor(mode) };
    if (v.kind === 'build' && !v.captain) return { code: 'captainRequired', side };
  }
  if (a!.kind === 'team' && b!.kind === 'team' && a!.teamId && a!.teamId === b!.teamId) return { code: 'sameTeams' };
  return null;
}

/**
 * Furthest step that may be opened: Teams always; Rules once both teams are ready; Start once the
 * Rules step is complete too (`rulesReady`: a typed-in location needs a name, a scheduled time must
 * be in the future).
 */
export const maxReachableStep = (teamsReady: boolean, rulesReady = true): NewMatchStep => (!teamsReady ? 0 : !rulesReady ? 1 : 2);
/** Whether a step tab may be opened from anywhere (back always; forward only past complete steps). */
export const canOpenStep = (target: NewMatchStep, teamsReady: boolean, rulesReady = true): boolean => target <= maxReachableStep(teamsReady, rulesReady);
/** Where back (header arrow / Android back) goes: the previous step, or null = leave the screen. */
export const previousStep = (s: NewMatchStep): NewMatchStep | null => (s > 0 ? ((s - 1) as NewMatchStep) : null);

/**
 * 1.3.6: players a registered team brings in this team size mode. Exact 6 = its first 6 (starters
 * first, then subs); Custom = everyone (6–12).
 */
export const teamSidePlayers = (members: number, mode: TeamSizeMode) => (mode === 'exact' ? Math.min(members, MIN_PLAYERS) : members);

/**
 * 1.3.7 (R136-11): Exact 6 with a registered team of 7+ — the creator picks the 6 who play. The
 * captain always plays (can't be unticked); the starting suggestion is the captain plus the first
 * others in roster order (starters first). Returns ids in roster order.
 */
export function exactDefaultPick(playerIds: readonly string[], captainId: string | null | undefined, size = 6): string[] {
  const out = captainId && playerIds.includes(captainId) ? [captainId] : [];
  for (const id of playerIds) if (out.length < size && !out.includes(id)) out.push(id);
  return playerIds.filter((id) => out.includes(id));
}
/** Toggle one player in an Exact 6 pick (the captain stays; at most `size`). */
export function toggleExactPick(pick: readonly string[], id: string, captainId: string | null | undefined, playerIds: readonly string[], size = 6): string[] {
  if (id === captainId) return [...pick];
  const next = pick.includes(id) ? pick.filter((x) => x !== id) : pick.length < size ? [...pick, id] : [...pick];
  return playerIds.filter((x) => next.includes(x));
}
