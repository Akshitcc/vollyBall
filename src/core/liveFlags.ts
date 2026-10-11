/**
 * Live scoring feature flags.
 *
 * TEAM_HALF_TAP (1.3.3, confirmed by Akshit): keep team-half tapping ALONGSIDE the player chips. In
 * Live match v2 (§11) the tap target is the team's score panel in the scoreboard (not a court half):
 * tap it → team +1 with no player credit (logged as "Team point", Light haptic). Player chips stay the
 * main way to score (player +1 and team +1, Medium haptic). Both go through core/scoring addPoint().
 * The separate "+1 · Opp. error" buttons were removed in favour of the panels.
 *
 * LEGACY_HALVES – the v1 screen layout (§8 · 02: two big team halves + the "Who scored?" sheet). Off;
 * kept so the v1 layout (and its C131-1 fix) can come back by flipping one constant.
 */
export const TEAM_HALF_TAP = true;
export const LEGACY_HALVES = false;

/** Ignore a second tap on the same player chip or team panel within this window (accidental double points, §11.3). */
export const CHIP_DEBOUNCE_MS = 250;
