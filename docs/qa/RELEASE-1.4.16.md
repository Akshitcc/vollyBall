# VolleyLive 1.4.16 (versionCode 32) – fixes for the 1.4.15 QA findings (V1415-1..4)

> **Abandon policy: still INTERIM ('review').** **Open decision for Akshit:** may a player be in two registered teams
> (unchanged: allowed). No migration. Firestore/storage rules unchanged (only a new rules test case).

| # | Status | Cause → change |
|---|--------|----------------|
| V1415-1 | fixed | **Cause:** core `guardUpdate` had no roster-size check, so a side with 13+ players only fell through to the verdict check (`match_no_verdict`), and with no captains nothing refused it. The API already refused with its own "at most 12" message. **Change:** `guardUpdate` refuses with the new code `team_too_large` when a changed teamA/teamB has more than `MAX_PLAYERS` (12), before the verdict check, with or without captains (demo uses core). EN "A team can have at most 12 players." / HI "एक टीम में ज़्यादा से ज़्यादा 12 खिलाड़ी हो सकते हैं।" Tests: core with/without captains + 12 control, demo updateMatch, EN/HI messages, API PATCH 13 → 400 and nothing stored. |
| V1415-2 (web a11y) | fixed | **Cause:** on web the inner `<input role=switch>` stayed focusable and in the a11y tree, so the row was two Tab stops with a duplicate control. **Change:** on web the Switch is wrapped in an `aria-hidden`, `pointerEvents:'none'` view and its input gets `tabIndex=-1` (`hideFromWeb`). The row keeps role switch, name, aria-checked, aria-describedby hint and Space/Enter toggle. Native unchanged. Test. |
| V1415-3 | fixed | **Cause:** the points and unit were separate words in a shrinkable Text, so a narrow card wrapped "pts". **Change:** `rankPts` uses a non-breaking space (`{{pts}} pts` / `{{pts}} अंक`), the points Text doesn't shrink and is one line; the "to pass" text takes the remaining width. Test. |
| V1415-4 | fixed | **Cause:** the ToolRow had no horizontal padding, so the focus ring sat on the longer HI label. **Change:** the row has 8 px horizontal padding (with −8 margin so the layout doesn't move) and rounded corners. |
| Optional: wasWon:false on a scheduled match | already refused | The 1.4.15 `!ks.hasAny(['wasWon'])` refuses any write that has the key, false included. Rules test case added (field absent, captain write → permission-denied). |

Still unverified: real-device keyboard, APK on a device, Firestore concurrency.
