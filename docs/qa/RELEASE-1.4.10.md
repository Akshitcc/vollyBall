# VolleyLive 1.4.10 (versionCode 26) – fixes for the 1.4.9 QA findings (V149-1..5, 0019 notes)

> **Abandon policy: still INTERIM ('review').** **Open decision for Akshit:** may a player be in two registered teams
> (unchanged: allowed; refused only when both teams meet in one match).

## Items

| # | Status | Cause → change |
|---|--------|----------------|
| V149-1 | fixed | **Cause:** 1.4.9's `setupVerdictUpdOk` evaluated `setupVerdictOk` (4 `onSide` slices) plus `setupVerdictRefOk` (6 more) on every roster/team write of a doc with scorerReassign – over 1000 expressions at ≥10 a side, even for a rename. **Change:** skipped when players, participants and captains are unchanged (a rename / colour); otherwise one form only: with scorerReassign, `setupVerdictRefOk` binds each side's id slice once (`let`) and uses `in`. Rules test at 12-a-side with scorerReassign: rename and valid roster edit pass, GU11 edit still refused (fails on the 1.4.9 rules with the budget error). |
| V149-2 | fixed | **Cause:** `writeMatch` checked `after` (the client doc), which never carries scorerReassign. **Change:** the check uses the stored `scorerReassign`. Test: handoff from B, creator on A → roster swap 400 `match_no_verdict`; without the record or with the reference on A → 200. |
| V149-3 | fixed (safe path) | **Cause:** when team B's captain is a team-A player (older data), no scorer can make anyone a valid confirmer. **Change:** the captain repair is back ONLY for a side whose stored captain doesn't play for it (core `captainFixAllowed`): the new captain is a player of that side, the result must pass the invariant, same lifecycle action `repairVerdict` (admin outside the match, nobody can confirm, no verdict/review), audited in `verdictRepair` (kind 'confirmer'). Core, demo, API, Firebase (`repairDoc`) and rules (`verdictRepairOk`: kind 'confirmer' with the captain off its side – `scorerTargetOk` can't see that case). Card: captain chips + `abandon.repairHintCaptain`; when nothing helps `abandon.repairNone`. EN/HI. Tests: core `verdict149`, `demo148`, server `fixes1410`, rules "V148-2 / V149-3 (RP9)" (rules == core for 8 cases), `ui1410`. |
| V149-4 | fixed | "N players from Team will play" used `memberIds.length`; now the playing count (Exact 6: 6), like the header. |
| V149-5 | fixed | Void on the review list / match page asks `verify.voidAskScore` with the final score. **Void on the abandoned-match panel:** LIFECYCLE.md allows `void` only on a *finished* match ("completed (POTM) or without a winner; not approved / voided yet") – not on an abandoned one, so it is not added. |
| 0019 notes | fixed (runner) | `checkSchema` after every migrate and at every API start (read-only): 0018 recorded but the column missing → "0018_verdict_repair.sql is recorded but matches.verdict_repair is missing – add it by hand …"; not JSON (also if retyped later) → "matches.verdict_repair must be JSON, found … – fix the column by hand …". A guarded migration's "Unknown column '00NN: …'" is rethrown as `SchemaCheckError` "Migration 0019_… stopped: …". No migration file changed or added. |
| HI focused fields | checked | Login phone and OTP, team name and add-player with the (simulated) keyboard open stay in view, EN and HI (`410-01`…`04`). No change needed. |

## Tests (all green, run one at a time)

- App: tsc clean; jest 1292 / 1292 (105 suites); test:tz 1292 × 5 zones.
- Server: tsc clean; 311 / 311 (new `fixes1410.test.ts`).
- Rules: 195 / 195; policy suites (review / flag / consent) passed.

## Screenshots

`410-01`…`410-08`, EN and HI, 360×640, IST.
