# VolleyLive 1.4.12 (versionCode 28) – fixes for the 1.4.11 QA findings (V1411-1..5, demo seed, Hindi keyboard check)

> **Abandon policy: still INTERIM ('review').** **Open decision for Akshit:** may a player be in two registered teams
> (unchanged: allowed; refused only when both teams meet in one match).

| # | Status | Cause → change |
|---|--------|----------------|
| V1411-1 | fixed | **Cause:** the rules' "set-up unchanged" skip compared whole player entries (`d.teamA.players == r.teamA.players`), so a display-name / extra-field change on a broken GU11 or GU7 doc fell into the verdict check and was refused. **Change:** `verdictSetupSame(d, r)` compares side sizes, participantIds, captains and each side's teamId – `validRoster(d)` (and the stored doc) tie the participantIds prefix to the player ids in order, so this is "same player ids in order" (core `verdictSetupChanged`) at a constant cost. Rules test at 12-a-side: name change passes on GU11 / GU7 / captain mix, a reorder and a captain change are refused with a plain deny (asserted: no expression-limit error). The test fails on the 1.4.11 rules. |
| V1411-2 | fixed | **Behaviour chosen:** an edit that keeps the verdict set-up is allowed everywhere. **Cause:** the rules re-ran `captainsOk` on every roster write, so a captain-mix doc (captain B on team A) could not be renamed on Firebase. **Change:** rules run `captainsOk` + `setupVerdictUpdOk` only when the set-up changes. Core and demo already allowed it. API: the captain check already runs only when the player ids, a side's team or the captains change; QA's 400 was not reproduced on the current API with a plain rename, a display-name change or a resend of the same captains (either key order) – new server tests pin the behaviour. KNOWN-GAPS corrected (1.4.11 entry) and a 1.4.12 entry added. |
| V1411-3 | fixed (demo) | **Cause:** the demo's `updateMatch` never checked `captains` or `createdBy`. **Change:** after `guardUpdate` (so frozen / lock codes still win), a creator change → `forbidden`, `captains: null` or a half-set pair → `captains_required`; an older doc already without captains may keep null (as the rules). Tests in `demo1412`. |
| V1411-4 | fixed | **Cause:** the card's local `done` flag kept it on screen (old title + "Match repaired") until the screen was left, even after the watched match came back repaired. **Change:** after a confirmed repair the card switches at once to a "Match repaired" state (no old title, no stale chips), then goes after 4 s; it stays only while the match still needs a repair. Admin review reloads its list as before. UI test with fake timers (EN/HI). |
| V1411-5 | fixed | Title: EN "Nobody could confirm this match", HI "इस मैच की पुष्टि कोई नहीं कर पाया" (was "…this result" / "इस नतीजे की…"). |
| Demo seed | added | `match_demo_capmix_done`: finished, pending, team B's captain is a team-A player. Admin repairs B's captain, then that captain confirms (demo test + screenshots 412-06…10). Demo only (`demoSeed.ts` stubbed in production); `check-strip.js` also fails on the new id. |
| Hindi keyboard | checked | Login (phone, OTP), New match (team name, add player) and team invite (mobile) with the keyboard open, EN and HI: 412-01…05. |

## Tests (all green, run one at a time)

- App: tsc clean; jest 1304 / 1304 (109 suites); test:tz 1304 × 5 zones.
- Server: tsc clean; 318 / 318.
- Rules: 199 / 199; policy suites (review / flag / consent) passed, policy restored to 'review'.

## Screenshots (/workspace/qa_1412, EN and HI, 360×640, simulated keyboard 280 px)

- `412-01`…`05`: login phone / OTP, New match team name / add player, team invite mobile – focused field above the keyboard (measured in view in EN and HI).
- `412-06`: finished captain-mix match, card titled "Nobody could confirm this match"; `07`: right after the confirmed repair, "Match repaired" (no reload); `08`: 5 s later the card is gone (no reload); `09`/`10`: the repaired team-B captain sees Confirm and confirms (verification confirmed by seed7).
- Strip: a production web export (STRIP_DEMO=1) passes `check-strip.js` with the new id in the list.

> **Correction (1.4.13, QA V1412-2):** the V1411-1 line above ("refused with a plain deny, no expression-limit error")
> held only at the sizes the 1.4.12 test used. At 10–12 a side, set-up-changing edits (captain change, reorder, teamId
> change) on broken GU7 / GU11 docs were refused by the 1000-expression limit, not by the logic. 1.4.13 fixes that
> (see RELEASE-1.4.13.md) and tests it at 10, 11 and 12 a side.
