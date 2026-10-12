# VolleyLive 1.4.6 (versionCode 22) – fixes for the 1.4.5 QA findings (V145-1..17)

> **Abandon policy: still INTERIM, PENDING DECISION ('review').** Nothing here chooses the policy; every walk below
> was run once under all three policies (`scripts/run-policy-suites.sh`), CI runs the default only.

## One lifecycle

`src/core/lifecycle.ts` is the single table: for every action (delete, unschedule, editSetup, score, potm, handover,
abandon, report, confirmAbandon, reinstate, reopen, adminAbandon, void, approve, verdict) the roles that may take it
(creator, scorer, verdictCaptain, reporter, non-participant admin, participant, other), the statuses it starts from,
the ordered state/latch requirements with their error codes, and the resulting state. Latches never go back:
`maxEvents > 0` (played), `wasWon`, the abandon record and its review (older records in `abandonHistory`), the verdict
of the current `reopenEpoch`, approved / voided. `docs/LIFECYCLE.md` is generated from it (`--check` in CI).

Conformance: core (`lifecycleProblem`), the API, the demo and the Firebase client all use it; `firestore.rules` mirror
it. **Walk tests** try every action of `LC_WALK` (11) in every state of `LC_STATES` (13: scheduled, live 0/3 rallies,
undone to 0, 4–4, won pending / confirmed, finished without a winner, abandoned direct / pending / confirmed / legacy,
reinstated) as every walker (scorer, opposing captain, teammate, non-participant admin, stranger) and require the
backend's answer to equal the table's: core/demo (`src/services/__tests__/lifecycle146.test.ts`, 645 cells, the demo
has no delete), API (`server/tests/lifecycle.test.ts`, 710 cells, real MySQL), rules (`rules-tests` "1.4.6: lifecycle
walk", 710 cells, emulator). Not walked: `LC_CLIENT_ONLY` (2 checks the rules can't make – replay needed) and no-op
cells (`walkSkip`: unschedule of a scheduled match; the API's idempotent verdict replay is checked to write nothing).

| # | Status | Cause → change |
|---|--------|----------------|
| V145-1 | fixed | **Cause:** delete looked at the current log/status, so undo to 0 or a move back to scheduled reopened it, and admins could delete played matches. **Change:** `deleteProblem` – only if `maxEvents == 0` and there is no abandon record / request / admin re-open; creator or a non-participant admin. API 403 `match_delete_forbidden` (admins too), rules `deleteOk`. |
| V145-2 | fixed | **Cause:** a won or confirmed match could be reopened / abandoned by an admin, and a reopen left the old verdict, POTM and confirmed state. **Change:** reopen / admin abandon of a finished match only when the log is shorter than the shortest win, no POTM and no verdict of this epoch (void only otherwise). A reopen clears verdict, POTM and confirmation and bumps `reopenEpoch`; a verdict counts only with `epoch == reopenEpoch` (API `verdict_epoch`, Firebase `verification.epoch`, written only when > 0 for compatibility). |
| V145-3 | fixed | **Cause:** the setup lock was UI-only in the demo and partial on API/rules (roster/captains 403s, rules first serve). **Change:** one `match_setup_locked` (409) once `maxEvents > 0` for teams, participants, captains, team size, rules, first serve – core, demo, API (`SETUP_FIELDS`), rules. |
| V145-4 | fixed | **Cause:** the abandon record's score / `behind` were trusted as written. **Change:** rules `abandonRecOk` validates keys, a 4-int score map and `behind` bool (null for admin); the app replays score and "behind" from the events up to the record (`abandonFacts`) in the panel and the admin card. |
| V145-5 | fixed | **Cause:** after a reinstate the scorer could abandon again, overwriting the record. **Change:** the scorer can't abandon while any record exists; an admin abandon appends the previous record to `abandonHistory` (append-only; rules `historyOk`, API column `abandon_history`). |
| V145-6 | fixed | **Cause:** an admin could hand scoring to the verdict captain, who then confirmed their own scoring. **Change:** `verdictCaptains` (all eligible captains, as the rules' `verdictCapt`); reassign to one is refused (`reassign_verdict_captain`, EN/HI), and whoever scores now can't give the verdict (core `confirmProblem`, rules `confirmOk`). The admin reassign chips leave the verdict captain out. |
| V145-7 | fixed | **Cause:** some demo write paths dropped `maxEvents` / `wasWon`. **Change:** demo `updateMatch` stamps both on every write (`nextMaxEvents`, wasWon latch). |
| V145-8 | fixed | **Cause:** the Firebase rankings / wallet read had soft caps, swallowed errors, and the approved query missed confirmed matches. **Change:** a hard 24 MiB budget shared by tiers (own → approved → confirmed (new query + index `verification.status` + `finishedServerAt`) → finished); page size `min(50, ⌊left / 512 KiB⌋)`; errors surface. **Worst case:** ≤ 24 MiB with rules-bounded docs; a legacy ~1 MiB doc could at most double one page, ≤ ~48 MiB total (KNOWN-GAPS). |
| V145-9 | fixed | Policy-parametrised tests (`describe.each(ABANDON_POLICIES)`), the walks use the current policy; `scripts/run-policy-suites.sh` ran them once under review / flag / consent and restored 'review' (`gen-abandon-policy --check`). |
| V145-10 | fixed | **Cause:** reinstating a match whose log has a winner went to finished without `wasWon`. **Change:** reinstate → finished sets `wasWon` (core, API, Firebase `resolveDoc`, rules require it). Also fixed: Firebase reinstate to live wrote `finishedServerAt: null` where none existed, which the rules refused. |
| V145-11 | fixed | **Cause:** a legacy abandoned match without a record (or with 0 rallies) could be reported. **Change:** a report needs the record and `maxEvents > 0` (core, API, rules `reportOk` – legacy branch removed). |
| V145-12 | fixed | **Cause:** consent requests were unbounded. **Change:** at most 3 per match, 2 min apart (`abandon_rate_limited`, EN/HI; counters `abandonRequests` / `abandonRequestAt`, rules `abandonRequestOk`, API columns); one notification per request. |
| V145-13 | fixed | **Cause:** in New match step 1 the Team B team-search results sat under the sticky "Next: Rules" footer. **Change:** `KeyboardAwareScreen hideFooterOnKeyboard` hides the footer while the keyboard is open (native keyboard events; web: visual viewport shrinking) and the search results scroll into view when they appear under the focused field (`ScrollRevealContext`). |
| V145-14 | fixed | **Cause:** the admin card used the summary ("Final 0–0 · sets ") and the fraud flags ("no recorded start/finish time") for abandoned matches. **Change:** "Abandoned at <sets> · sets <set scores>" replayed from the events (or "Abandoned before the first rally") and the reason: who abandoned it (while which team was behind), an admin's abandon, an older app's abandon, plus the opposing captain's report – EN and HI. |
| V145-15 | fixed | HI: abandon is always छोड़ें / मैच छोड़ें (score menu, dialog, status "छोड़ा गया", failure text); reinstate is "मैच बहाल करें". Tests pinning the old strings updated (`scoreScreen`, `fix204`). |
| V145-16 | fixed | Reinstate and Confirm abandon now ask first, saying what will happen and the score (EN/HI); "no" does nothing. |
| V145-17 | fixed | After the first rally the handoff chips offer the scorer's own side plus the eligible admins (API `GET /matches/:id/handoff-admins`, demo; never the scorer or a verdict captain). Firebase can't hand to an admin, so it offers "Ask an admin to take over" (opens a message to the support address, or the share sheet; nothing is sent automatically). Before the first rally every participant is offered, as before. |

## Compatibility / deploy

See docs/DEPLOY.md (1.4.6): indexes first, then migration `0017_match_lifecycle.sql` (additive) + API, then rules and
the app together. A 1.4.5 app's reopen write is refused by the 1.4.6 rules.

## Screenshots

`/workspace/scripts/shots/cap46.js en|hi` (demo web build, 360×640), each `-EN.png` and `-HI.png` – see the final report
for the list.
