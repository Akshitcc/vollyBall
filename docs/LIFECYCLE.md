# VolleyLive match lifecycle (generated – do not edit)

Generated from `src/core/lifecycle.ts` by `node scripts/gen-lifecycle-doc.js`. One table for every backend: the API
server, the demo and the Firebase client call core functions built on it; `firestore.rules` mirror it and the
lifecycle walk tests (core/demo, API, rules) try every action in every state as every role on each backend.

**Roles:** creator, scorer (current), verdictCaptain (a captain who is not the creator or the scorer as at the first
rally, and plays on neither one's side; never the current scorer), reporter (a captain of the side the abandoner does
not play on), admin (an admin who is NOT part of the match – an admin in the match is just a participant), participant,
other.

**Verdict invariant (V146-2/3):** a match with captains always has at least one verdict captain, and the scorer is
never a verdict captain or on one's team. Every scorer change keeps it (`scorerTargetProblem`, rules
`scorerTargetOk`): before the first rally the creator / scorer cannot hand scoring to the opposing captain or their team
(nobody would be left to confirm); after it handoffs stay on the scorer's side (or go to an admin on API / demo), and
an admin reassigns only to a participant off the verdict captain's team. The walk tests assert it in every state.

**Admin paths:** confirmAbandon / reinstate (abandoned, record pending or an older record-less abandon with rallies);
reinstate goes back to live only when the log has no winner and wasWon was never set, else to finished + wasWon
(V146-5; rules: live only when wasWon is not set – a won log without the latch is a client-only check); reopen /
adminAbandon of a finished match only below the shortest win, without POTM and without a verdict of this epoch (an
earlier epoch's verdict does not block); void / approve of a finished match; reassign the scorer (live / scheduled).

**Latches** (never go back): maxEvents > 0 ("played"), wasWon, the abandon record and its review (older records
kept in abandonHistory), the captain verdict of the current re-open epoch, approved / voided, reopenEpoch.

| Action | Who | From | Requires (in order) | Leads to |
|---|---|---|---|---|
| **delete** – delete the match | creator, admin | scheduled, abandoned | never had a rally (maxEvents == 0 – undo to 0 does not reopen delete) (`match_delete_forbidden`)<br>no abandon record, request or admin re-open (`match_delete_forbidden`) | gone |
| **unschedule** – move a live match back to scheduled | scorer | live | never had a rally (`match_status_move`) | scheduled |
| **editSetup** – change teams, participants, captains, team size, rules or first serve | scorer | scheduled, live | never had a rally (match_setup_locked, also after undo to 0) (`match_setup_locked`) | same status |
| **score** – add / undo a rally | scorer | scheduled, live | no consent request pending (`abandon_pending`)<br>the events have no winner yet (`match_finished`) | live (finished by the winning rally) |
| **potm** – pick the Player of the Match | scorer | finished | the events have a winner (`potm_not_finished`)<br>not picked yet (`potm_already_set`) | finished + POTM |
| **handover** – hand scoring to someone else (targets: before the first rally anyone who leaves a verdict captain – never the opposing captain or their team; after it the scorer's own side or an admin; never the verdict captain's team – core/scorerHandoff.ts, V146-2/3) | creator, scorer | scheduled, live | – | same status, new scorer |
| **abandon** – the scorer's ⋮ Abandon | scorer | scheduled, live | never won (wasWon latch) (`match_finished`)<br>no consent request pending (`abandon_pending`)<br>the log never reached the shortest possible win (`abandon_needs_admin`)<br>no abandon record yet (after a reinstate only an admin abandons – V145-5) (`abandon_needs_admin`)<br>consent policy after the first rally: live, at most 3 requests per match, 2 min apart (`abandon_not_allowed`)<br>(consent) request limit (`abandon_rate_limited`)<br>(consent) request cooldown (`abandon_rate_limited`) | abandoned (no rally: directly; review/flag: record pending review; consent: a request, still live) |
| **report** – the opposing captain's Report | reporter | abandoned | an abandon record exists and the match had a rally (V145-11) (`abandon_not_allowed`)<br>not an admin's or an agreed (consent) abandon (`abandon_not_allowed`)<br>not reported or decided yet, not reinstated (`abandon_not_allowed`) | abandoned, record pending + reportedBy |
| **confirmAbandon** – admin confirms the abandon | admin | abandoned | record pending review, or an older abandoned match with rallies and no record (`resolve_not_allowed`) | abandoned, record confirmed |
| **reinstate** – admin reinstates an abandoned match | admin | abandoned | record pending review, or an older abandoned match with rallies and no record (`resolve_not_allowed`)<br>wasWon: back to finished only – the log must still have its winner (V146-5) (`resolve_not_allowed`) | live when the log has no winner and wasWon was never set; otherwise finished + wasWon (V145-10, V146-5); record reinstated |
| **reopen** – admin re-opens a finished match without a winner | admin | finished | log shorter than the shortest possible win (so no winner – rules can check it) (`resolve_not_allowed`)<br>no Player of the Match (`resolve_not_allowed`)<br>no captain verdict in this epoch, not approved / voided (`resolve_not_allowed`) | live; verdict / POTM / confirmed state cleared, reopenEpoch + 1 (V145-2) |
| **adminAbandon** – admin abandons | admin | scheduled, live, finished | never won (scheduled / live) (`resolve_not_allowed`)<br>finished: log shorter than the shortest possible win (so no winner – rules can check it) (`resolve_not_allowed`)<br>finished: no Player of the Match (`resolve_not_allowed`)<br>finished: no captain verdict in this epoch, not approved / voided (`resolve_not_allowed`) | abandoned, admin record (an earlier record moves to abandonHistory – V145-5) |
| **void** – admin voids the result | admin | finished | completed (POTM) or without a winner (`not_completed`)<br>not approved / voided yet (`already_reviewed`) | finished, voided (never counts) |
| **approve** – admin clears the fraud flag | admin | finished | completed (winner + POTM) (`not_completed`)<br>not approved / voided yet (`already_reviewed`) | finished, approved |
| **verdict** – the opposing captain confirms / rejects | verdictCaptain | finished | completed (winner + POTM) (`not_completed`)<br>no verdict yet in this epoch (or approved without one) (`already_reviewed`) | finished, confirmed / disputed (epoch = reopenEpoch) |
| **reassign** – admin moves scoring (never to the verdict captain – V145-6) | admin | scheduled, live | – | same status, new scorer (recorded after the first rally) |
| **repairVerdict** – admin repairs a match nobody can confirm: sets a valid scorer, or (1.4.10, V149-3) a captain for a side whose captain plays for the other team (V147-2, core/verdictRepair.ts) | admin | scheduled, live, finished, abandoned | nobody can confirm it now (no verdict captain, or the scorer on the verdict side) (`repair_not_needed`)<br>no captain verdict in this epoch, not approved / voided (`repair_not_needed`) | same status; a valid scorer (verdict reference reset) or the side’s new captain; recorded in verdictRepair |

## Walk states

| State | Meaning |
|---|---|
| sched0 | scheduled, never played |
| live0 | live, no rally yet |
| live3 | live, 3 rallies |
| undo0 | live, undone to 0 after 3 rallies |
| long8 | live, 4–4 (log past the shortest win, no winner) |
| wonPending | finished, won, POTM, verdict pending |
| wonConfirmed | finished, won, POTM, confirmed by the opposing captain |
| nowin3 | stored as finished after 3 rallies (no winner) |
| abDirect | abandoned before the first rally |
| abPending | abandoned after 3 rallies, review pending |
| abConfirmed | abandoned, an admin confirmed it |
| abLegacy | abandoned after 3 rallies by an older app (no record) |
| reinstated | live again after an admin reinstated it |
| abWonLog | abandoned with a won log (wasWon), review pending |
| noConfirm | finished, won, POTM, nobody can confirm (scorer on B, creator on A – older data) |
| noConfirmLive | live, 3 rallies, nobody can confirm (older data) |

Walked actions: delete, unschedule, editSetup, abandon, report, confirmAbandon, reinstate, reopen, adminAbandon, void, verdict, repairVerdict. Walkers: scorer, oppCaptain, teammate, admin, stranger.

## Client-only checks (rules cannot replay a match)

- reinstate to live of an abandoned match whose log has a winner but no wasWon latch (older docs; rules: live allowed unless wasWon)
- adminAbandon of a live match whose events already have a winner (rules: allowed unless wasWon)
- void of a won finished match before its POTM (rules: allowed)
