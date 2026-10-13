# VolleyLive 1.4.14 (versionCode 30) – fixes for the 1.4.13 QA findings (V1413-1..7)

> **Abandon policy: still INTERIM ('review').** **Open decision for Akshit:** may a player be in two registered teams
> (unchanged: allowed). No migration.

| # | Status | Cause → change |
|---|--------|----------------|
| V1413-1 (Medium) | fixed | **Cause:** 1.4.13's set-up check required the stored doc's participantIds to follow its rosters, so on an older out-of-order doc a valid swap (LX3) counted as a set-up change and paid for the verdict check + captainsOk (profile exists() reads) + validRoster, over the 1000-expression limit. **Change:** `rosterEditOk`: a cheap key comparison first; with the same participants, captains, sizes and team sources the ids are compared from both docs' rosters (let-bound once). Players only moved between the sides → verdict check, rosters in participantIds order, captains on their sides, registered-team membership (one read per side) – no profile reads (nobody new joined). Other changes → verdict check → captainsOk → validRoster as before. Rules test: LX3 at 6..12 a side (by number and registered teams), a non-member move and a captain move refused by the logic. |
| V1413-2 (Low) | fixed | `home.toPass_one` / `_other` (EN "1 pt" / "2 pts"; HI "अंक" both). Tests EN + HI. |
| V1413-3 (Low) | fixed | Same cause as V1413-1: a plain rename / display-name change on an out-of-order older doc fell into the set-up branch and validRoster refused the stored order. Now a kept set-up checks only the entries (`keptRosterOk`). Tests LX2, LX8 at 6..12. |
| V1413-4 (Low) | fixed | **Cause:** rules `verdictCaptS` checked only the captained side's roster; core took the first roster found. **Change:** core `confirmProblem` / `verdictCaptains` (new `playsFor`) and rules: a player on both rosters gives no verdict (either slot); scorer / creator side checks per roster like the rules. Demo uses core (test). API: match_players has one row per player, so a player can't be on both sides (test). |
| V1413-5 (Low) | fixed | The New match "Search team name" field now scrolls clear of the sticky footer when focused (also without a keyboard event) and again after the keyboard opens. Checked in the web build at 360x640 with a simulated keyboard (414-05/06). |
| V1413-6 (Low) | fixed | The status pill says "Needs an admin fix before anyone can confirm" / "पुष्टि से पहले एडमिन को मैच ठीक करना होगा" while nobody can confirm; tests EN + HI. |
| V1413-7 (Low) | fixed | Testing-tool rows (Demo admin, Simulate offline) are one Pressable with role switch, label, hint and checked state; tapping the label flips the switch. Test. |

New rules tests fail on the 1.4.13 rules (2 tests). Still unverified: real-device keyboard, APK on a device, Firestore concurrency.
