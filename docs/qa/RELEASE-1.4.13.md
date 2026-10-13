# VolleyLive 1.4.13 (versionCode 29) – fixes for the 1.4.12 QA findings (V1412-1..6, KNOWN-GAPS)

> **Abandon policy: still INTERIM ('review').** **Open decision for Akshit:** may a player be in two registered teams
> (unchanged: allowed; refused only when both teams meet in one match). No migration.

| # | Status | Cause → change |
|---|--------|----------------|
| V1412-1 (High) | fixed | **Cause:** base confirm / dispute / the verdict captains and the audit roles took a captain's side from the `captains` slot (A/B), not from the roster the captain plays on – so team B's captain who plays for A (captain mix) could confirm A's own result. **Change:** core `confirmProblem`, `verdictCaptains`, lifecycle reporter role and `answerAbandon` (a captain can't agree to their own side's request) use `sideOfPlayer`; demo, API (`/confirm`, dispute) and rules (`verdictCaptS`, `reporterOk`, `agreeOk`) the same. The repair still works (no 409); the card title is unchanged. New lifecycle state `capMix` in the walk on all four backends. UI: before the repair, the off-side captain gets no Confirm and is not named as the confirmer; a "needs repair" line shows instead (EN/HI). |
| V1412-2 | fixed | **Cause:** on broken GU7/GU11 docs at 10–12 a side, the rules evaluated `validRoster` before the set-up/captain checks and hit the 1000-expression limit. **Change:** `?:` ordering (set-up same → validRoster; else verdict check → captain check → validRoster) and the "interested" fallback skipped when roster keys are present. Refused by the logic now; tested at 10/11/12 a side. The 1.4.12 note is corrected. |
| V1412-3 | fixed | **Cause:** the rules took sides from the participantIds order. **Change:** `sidesOf(r)` from the rosters (bound once with `let`, passed down to stay under the limit). Tests: moving captain B to A and the B reference on a legacy unordered doc are set-up changes. |
| V1412-4 | fixed | teamId change = set-up change on core (`verdictSetupChanged`) and demo; demo refuses an extra captains key and an unknown captain id (captains_required / captain check); core compares captains independent of key order. |
| V1412-5 | fixed | **Cause:** the "Match repaired" flag was component state; the page re-mounted the card when the repaired match arrived, losing it within ~1 s. **Change:** the state is kept per match outside the component and shows ~4 s (EN/HI), test covers a re-mount. |
| V1412-6 | explained + wording fixed | **Cause:** confirming `match_demo_capmix_done` credits all 12 players; Delhi won (POTM Kabir), so Delhi players passed Priya – the drop 4 → 7 is correct. Priya and Vihaan are tied on 53 ranking points; the documented tie order (wins, POTM, points, fewer matches, id) puts Vihaan ahead. The only bug was "0 pts to pass": a tie now reads "Tied on points with Vihaan (#6) – 1 pt to pass" (EN/HI). |
| KNOWN-GAPS | fixed | The rules refuse a repeat captain repair and a repair of a match that isn't broken, even for an admin (`verdictRepairOk` requires broken-before / fixed-after for both repair kinds). |
| V1411-2 (API half) | withdrawn | It was a teamId change; the refusal was correct. |

New tests fail on the 1.4.12 rules (5 rules tests). Still unverified: device keyboard, APK on a device, Firestore concurrency;
consent policy: a stuck abandon request on a captain-mix match (both captains on one side) until repaired.
