# VolleyLive 1.4.15 (versionCode 31) – fixes for the 1.4.14 QA findings (V1414-1..6, web clicks, 13-entry sides)

> **Abandon policy: still INTERIM ('review').** **Open decision for Akshit:** may a player be in two registered teams
> (unchanged: allowed). No migration.

| # | Status | Cause → change |
|---|--------|----------------|
| V1414-1 (web a11y) | fixed | **Cause:** react-native-web renders neither accessibilityState nor accessibilityHint, and its press responder only treats Space as a press on role=button. **Change:** the switch row (now `ToolRow.tsx`) adds on web `aria-checked`, `aria-describedby` → the hint text, and a Space key handler. Test + browser probe (aria-checked/aria-describedby present, Space toggles twice). |
| V1414-2 | fixed | **Cause:** the rules' general update path let wasWon "latch" to true on any scorer write. **Change:** only the finishing write (`finishingWriteOk`) may change wasWon; elsewhere `!ks.hasAny(['wasWon'])` (cheaper than before). Rules test CThwon (alone and with a title change; control passes). |
| V1414-3 | fixed | **Cause:** the 4 s ran from when the repair call returned; if the card mounted later (the page reloading the match on a slower machine) it showed only what was left (~2.4 s). **Change:** the 4 s run from when the "repaired" state is first painted (kept up to 15 s until then). Test: re-mount 1.6 s after the call returned → still ~4 s. Browser: 4.0 s. |
| V1414-4 | fixed | The profile rank card and the rankings screen used `rankings.toNext` ("0 pts to #6 …"); both now use `toPassText` like Home (tie → "Tied on points … 1 pt to pass"); `toNext` removed from EN/HI. Test. |
| V1414-5 | fixed | The pill now depends on the viewer: the captain who can confirm sees "Your turn: confirm or dispute the result" (HI "आपकी बारी: …"); a match without captains says "Result not confirmed yet" (HI "नतीजे की पुष्टि अभी नहीं हुई"); needs-repair as in 1.4.14. Tests EN/HI. |
| V1414-6 | fixed | The footer titles end with a non-breaking space before "→", so the arrow wraps with the last word. |
| Web clicks | fixed | **Cause:** PressableScale shrank the press target (scale 0.96) while pressed; react-native-web cancels a press when the pointer leaves the element's box, so a click near an edge with a 1 px wiggle was lost (probe: 3/12 mouse edge clicks missed; touch 12/12). **Change:** on web the press feedback is the opacity dip (as with Reduce Motion); native unchanged. Probe after: 12/12 mouse and touch. Test. |
| 13-entry sides | fixed | Rules `verdictCaptS` and core `confirmProblem` / `verdictCaptains`: a stored (invalid, older) doc with more than 12 on a side gives no verdict (the rules read 12 ids per side). Rules test with b0 13th on A. |

New rules tests fail on the 1.4.14 rules (2 tests). Still unverified: real-device keyboard, APK on a device, Firestore concurrency.
