# VolleyLive 1.4.11 (versionCode 27) – fixes for the 1.4.10 QA findings (V1410-1..4, 0019 hint, demo seed)

> **Abandon policy: still INTERIM ('review').** **Open decision for Akshit:** may a player be in two registered teams
> (unchanged: allowed; refused only when both teams meet in one match).

| # | Status | Cause → change |
|---|--------|----------------|
| V1410-2 (Medium) | fixed | **Cause:** core `guardUpdate` and the API ran the verdict check on any change to teamA/teamB (a rename included), the rules skipped it when players / participants / captains were unchanged – an already-broken older match (GU11) could be renamed on Firebase only. **Change:** one test everywhere – core `verdictSetupChanged` (player ids in order, participants, captains, creator); used by `guardUpdate` (demo, Firebase client) and the API `writeMatch`; the rules' "unchanged" skip already matched. Tests: core + demo (`demo1411`: GU11 rename stored, roster swap `match_no_verdict`), API (`fixes1411`: rename 200, swap 400), rules (V1410-2). |
| V1410-1 | fixed | **Cause:** without scorerReassign the update check fell back to `setupVerdictOk` (four `onSide` slices); a 12-a-side invalid move went over 1000 expressions. **Change:** every update uses the let-bound `setupVerdictRefOk` (reference = scorerReassign.from or the scorer). Test: 12-a-side scorer move and creator move are denied with a plain `false` (asserted: no expression-limit message), a valid edit passes; fails on the 1.4.10 rules. |
| V1410-3 | fixed | **Cause:** the rules' captain repair only checked the captain was off its side, not that the new captain can confirm. **Change:** `repairSideClean` – the repaired side has none of the scorer, the verdict reference and the creator (so core's invariant holds after the fix). Test: both captains swapped: a fix of the scorer's side refused (core `repair_invalid`), the other side accepted, a repeat afterwards refused (core: not needed). Fails on the 1.4.10 rules. |
| V1410-4 | fixed | In Custom, players in both squads are left out of each side's "will play" count and header. |
| 0019 error | fixed | The runner's mapping adds "(ALTER TABLE matches MODIFY verdict_repair JSON NULL) and run the migrations again" to 0019's own refusal; 0019 unchanged. |
| Demo seed | added | `match_demo_gu11` (handoff from a team-B player, creator on A → scorer chips) and `match_demo_capmix` (team B's captain is a team-A player → captain chips), scheduled. Demo only: `demoSeed.ts` is swapped for `src/stubs/demoSeed.prod.ts` in production bundles; `check-strip.js` now also fails on either id (stripped export checked: OK). |

## Tests (all green, run one at a time)

- App: tsc clean; jest 1298 / 1298 (107 suites); test:tz 1298 × 5 zones.
- Server: tsc clean; 314 / 314.
- Rules: 198 / 198; policy suites passed.

## Screenshots

`411-01`…`411-06`, EN and HI. There is no rename UI in the app (team names are set at creation), so the GU11 rename is
covered by tests on all four backends, not by a screenshot; `411-06` shows the seeded GU11 match page with its repair card.
