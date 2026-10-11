/**
 * Live scoring feature flags (1.3.2).
 *
 * TEAM_HALF_TAP – the v1 scoring model where the whole team half is the tap target (§8 · 02), with
 * the "Who scored?" sheet after each point. Live match v2 (§11) replaces it: tap the PLAYER who won
 * the rally, and use the "+1 · Opp. error" buttons for team-only points. Removing team-half tapping
 * still waits on Akshit's confirmation, so it is OFF here and comes back by flipping this one constant
 * (score.tsx renders the v1 halves + sheet again; nothing else needs to change).
 */
export const TEAM_HALF_TAP = false;

/** Ignore a second tap on the same player chip within this window (accidental double points, §11.3). */
export const CHIP_DEBOUNCE_MS = 250;
