# VolleyLive 1.4.7 (versionCode 23) – fixes for the 1.4.6 QA findings (V146-1..12)

> **Abandon policy: still INTERIM, PENDING DECISION ('review').** The walks ran once under all three policies
> (`scripts/run-policy-suites.sh`, which now exits with the suites' real status).

## V146-1: delete vs save, the concurrency test

`server/tests/concurrency147.test.ts` races a save against a delete on 120 freshly created scheduled matches (batches of
8, 0–9 ms jitter, alternating order), then checks the database:

| build | save won | delete won | both "won" | neither |
|-------|----------|------------|------------|---------|
| 1.4.6 `matches.ts` (baseline) | 78 | 0 | **42** | 0 |
| 1.4.7 | 60 | 60 | **0** | 0 |

Each pair has exactly one winner, and the state matches it. If the save wins, the row is there with `max_events = 2`
and 2 points, and the delete gets 403/409. If the delete wins, there is no row, no points and no participants, and
the save gets 404. Also run: reinstate vs confirm abandon (30 pairs, exactly one succeeds each time), save vs abandon
(30 pairs, the record's events equal the stored log), and verdict vs void (20 pairs). A source audit checks that every
exported mutating match function locks the row (`forUpdate` / `loadForAction`) inside a transaction.

## Items

| # | Status | Cause → change |
|---|--------|----------------|
| V146-1 | fixed | **Cause:** `deleteMatch` checked deletability on a read without a lock, then deleted in a separate step, so a save that committed in between was deleted along with the match (or wrote child rows for a match that was being removed). **Change:** the delete runs in one transaction. It locks the row (`SELECT … FOR UPDATE`), re-checks `deleteProblem`, then runs a conditional `DELETE` (no `max_events`, no abandon record or request, no resolution, no points) and requires exactly 1 affected row (otherwise 409). Child rows go with it (FK cascade), photos are removed after the commit. Saves lock the row first, so a save that comes after a delete gets 404. A photo upload for a deleted match now gets 404 instead of an FK error. `txRetry` retries the whole transaction on an InnoDB deadlock (errno 1213) in every match and photo transaction. Audit: abandon, reinstate, reopen, verdict, approve, void, handover and POTM already lock via `loadForAction`. |
| V146-2 | fixed | **Cause:** the reassign check refused only the verdict captain, not their team. **Change:** a single invariant, `scorerTargetProblem` in core and `scorerTargetOk` in the rules, evaluated on the state after the change. There must still be a verdict captain, and the scorer may not be that captain or on their team (`reassign_verdict_captain`, EN/HI "…or to anyone on their team"). Enforced in core, demo, API (`reassignScorer`, `patchMatch`) and rules. The admin reassign chips and the API/demo handoff-admin list are filtered with the same check. |
| V146-3 / V146-10 | fixed | **Cause:** before the first rally any participant could be handed scoring, the opposing captain included (46_04), which left nobody to give the verdict. **Change:** the same invariant applies at every stage. Handing scoring to the other team is refused with `handover_no_verdict` ("Scoring can’t go to that player: then nobody could confirm the result", EN/HI). The chips leave the other team out, and before the first rally a hint explains why. LIFECYCLE.md describes the roles this way and has a "Verdict invariant" paragraph. Walk tests on core, demo, API and rules check that every state has a verdict captain and that every scorer change a backend accepts keeps one, off the scorer's side. |
| V146-4 | fixed | **Cause:** in Firebase mode, `listFlagged` ran 3 extra queries (100 docs each) outside the read budget and turned errors into empty results (`.catch(() => null)`). `markUnknownPlayers` read profiles without a budget and swallowed errors. **Change:** `src/services/backend/readBudget.ts` (pure, unit-tested). The extra queries are paged within the same 24 MiB budget (a 'flagged' share of 15 %, ≤ 100 each). Profile lookups come from a 2 MiB reserve in chunks of 30 (≤ 16 KiB each). Errors now fail the call. Ids the budget can't check count as unknown (fail closed). |
| V146-5 | fixed | **Cause:** an abandoned match with `wasWon` could be reinstated to live. **Change:** core guard `wonBackToFinished`: a `wasWon` match is reinstated to finished only, and only while its log still has a winner. The API and demo use the same guard. The rules refuse a live reinstate when `wasWon` is set. A won log without the latch (an older document) can't be checked by the rules; this is listed in `LC_CLIENT_ONLY` (3 entries now) and KNOWN-GAPS. LIFECYCLE.md "Admin paths" lists every admin action per state. New walk state `abWonLog` (14 states). |
| V146-6 | fixed | **Cause:** on the web the keyboard overlays the page, so only `visualViewport` shrinks. The reveal measured against the layout viewport, which doesn't change. **Change:** on the web, `reveal()` and the focused-input reveal measure the node on screen (`getBoundingClientRect`) against the visible area: the visual viewport clipped to the scroll view. They scroll by the difference, and while the keyboard is open the content gets the hidden height as extra bottom padding. Native code is unchanged (layout-based, with KeyboardAvoidingView). |
| V146-7 | fixed | **Cause:** the admin card printed the sets won as the score and the set points as "sets" ("Abandoned at 0–0 · sets 2-8"). **Change:** "Abandoned at 2–8 in set 1 · sets 0–0" (completed sets in brackets, e.g. "· sets 1–0 (25-20)", and "Abandoned after set 2 …" between sets). EN and HI. The same score text is used in the panel and in the reinstate / confirm dialogs ("2–8 in set 1, sets 0–0"). Unit-tested formatter (`abandonedLineOf`). |
| V146-8 | explained + labelled | **Cause:** stored times are epoch ms (API DATETIME read as UTC, knex `timezone: 'Z'`; Firestore Timestamps) and are shown in the device's zone. The browser-pass Chrome on the box runs in **UTC** (noted in the QA report), so 07:49 IST was correctly shown as 2:19 am UTC. **Change:** the admin card now shows the zone ("7:49 am IST" / "2:19 am UTC"), so a device in another zone is obvious. test:tz checks the same instant in UTC, Kolkata, Los Angeles and Kiritimati. An API test checks that an abandon's `finishedAt` and `abandon.at` are the instant. |
| V146-9 | fixed | **Cause:** the demo counted the demo admin account as an admin only while that phone had admin mode switched on, so on the scorer's phone the after-first-rally list had no admin, although the hint promised one. **Change:** for the handoff (the list and the handover check) the demo admin account counts as an admin, the same way API `ADMIN_UIDS` does. |
| V146-11 | fixed | HI: the admin button is "मैच छोड़ें", the dialog asks "मैच छोड़ें? …" and the review state reads "एडमिन ने मैच छोड़ा गया माना". "छोड़ना पक्का" is gone. |
| V146-12 | fixed | **Cause:** the found-player card appeared below the visible part of the scroll view (sticky footer underneath) and nothing scrolled it into view. **Change:** TeamBuilder reveals the card when a player is found. On the web the reveal clips to the scroll view (the footer sits outside it) and to the visual viewport (keyboard). Checked in EN and HI at 360×640, with and without the simulated keyboard. |
| Confirm abandon dialog | verified | The admin's Confirm abandon asks first (since 1.4.6, V145-16), with the score in the new format. "Cancel" does nothing. Screenshot 47-08. |
| Tooling | fixed | `scripts/run-policy-suites.sh`: `set -euo pipefail`. Each suite's own exit status is recorded (no grep), the output is tee'd to `$LOG`, any failure makes the script exit 1, and 'review' is always restored and checked. |
| Minor (rules) | fixed | A verdict from an earlier epoch no longer blocks a reopen (`finishedResolvableOk` compares `verification.epoch` with `reopenEpoch`), the same as core. |

## Compatibility / deploy

No migration and no index. Deploy the API, then the rules and the app together. A 1.4.6 app's handoff to the other team
is refused by the 1.4.7 rules (docs/DEPLOY.md).

## Screenshots

`/workspace/scripts/shots/cap47.js en|hi` (demo web build, 360×640, IST; the web keyboard is simulated with a fake `visualViewport` plus a grey block): 47-01 … 47-09, each `-EN.png` and `-HI.png`.

## Tests

App jest 1243/1243 (99 suites), `test:tz` 1243 in each of UTC, Asia/Kolkata, America/Los_Angeles and Pacific/Kiritimati, tsc 0; server 296/296, tsc 0; rules 189/189 (emulator); policy suites review/flag/consent all exit 0.
