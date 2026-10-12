# VolleyLive 1.4.5 (versionCode 21) – fixes for the 1.4.4 QA findings

> **Abandon policy: INTERIM, PENDING DECISION.** Akshit hasn't chosen how an abandon after the first rally should
> work. 1.4.5 ships a neutral interim default – **'review'**: every such abandon goes to admin review, recording who
> abandoned it and the score at that moment, with a "side behind" marker that is **information only**; the admin
> reinstates the match or confirms the abandon. Two alternatives are fully implemented and tested behind one switch
> (`ABANDON_POLICY`, see "Switching the abandon policy"). Nothing here should be read as the chosen policy.

| # | Status | Cause → what changed / where to look |
|---|--------|------------------------------|
| V144-1 | fixed (interim policy) | **Cause:** 1.4.4 compared the *current* log length with the shortest possible win, so undoing below it re-opened the scorer's abandon (Tester's bo1 0:24 / undo bypass), and an abandon after rallies left no trace. **Change, on every backend:** (1) `maxEvents` – the most events the log ever had; every events write must state it (Firebase `maxEvOk`, API column `max_events`, demo), undo never lowers it, and abandon eligibility uses it; (2) `wasWon` – latched by the finishing write, a match that was ever won is never abandoned by its scorer; (3) the abandon record `{by, at (server time), events, mode, review, score, behind}`; (4) admin review of abandoned and winner-less matches (`src/core/abandon.ts`, `firestore.rules` `scorerAbandonOk` / `abandonRecOk` / `adminResolveOk` / `reportOk`, API `POST /matches/:id/abandon`, `/abandon-request`, `/abandon-report`, `POST /admin/matches/:id/resolve`). The opposing captain gets **Report** (EN "Report to admin" / HI) on an abandoned match, which sends it back to admin review (once; not after an admin decided or a 'consent' abandon they agreed to). Older apps' `PATCH {status:'abandoned'}` is routed to the same action. While a 'consent' request is pending scoring is frozen on every backend (`abandon_pending`). |
| V144-2 | fixed | **Cause:** a match stored as finished whose events have no winner had no admin path. Now it is listed in admin review ("Finished without a winner") with **Reopen as live** (status live, POTM cleared, `wasWon` false, `resolution {action:'reopened', by, at}`), **Mark abandoned** (admin record) and **Void** (the existing review, now allowed for a finished match without POTM) – API, demo and Firebase rules. |
| V144-3 | fixed | Every admin action (resolve, reassign, review) refuses an admin who is the creator, scorer, a participant or a captain of the match (`ownMatchReview`; rules `ownMatch` / `reviewOk`; API 403 `own_match`). Tests: rules "participant admin", server `fixes145`, UI panel. |
| V144-4 | fixed | **Cause:** the API and demo let rules / first serve change mid-match. Now `match_setup_locked` (409) on every backend once a rally **ever** existed (`maxEvents`, also in the rules: undoing to 0 and raising bestOf would otherwise lift the shortest win above `maxEvents` and re-open the scorer's abandon). |
| V144-5 | plan + bounded read | **Cause:** the Firebase rankings/wallet read every finished/approved match. Chosen: a documented plan plus a paged, byte-budgeted read now (`firebaseBackend.countableMatches`: pages of 50, at most 500 finished + 200 approved docs, stops at ~24 MiB estimated – `RANKING_READ`). A client-written aggregate was rejected: the rules can't tie it to the events, so anyone could inflate it. **Plan:** move counting to a trusted writer (a Cloud Function on match finish/verify, or the API backend, which already counts server-side) that keeps per-player aggregates; that needs a deploy and a cloud account, so it isn't done here. |
| PRD gap | fixed | Rules: the captain of a side built by number must have a profile (also outside the first 3 players; one extra `exists()` only then); a lineup set is a subset of the participants, one set per write. Unknown players: completed matches naming ids without a profile are flagged `unknown_players` (EN/HI) and those ids never get credit (`countMatches`). |
| V144-6 | fixed | **Cause:** the match header of an abandoned match showed the sets (0–0) instead of the replayed score. `LiveScoreboard showCurrent` on abandoned matches (`match/[id]/index.tsx`). |
| V144-7 | fixed | **Cause:** the Serving badge sits inside the scorer's team panel, so tapping it scored a point. On the scoring panel the badge is wrapped in a no-op, non-accessible Pressable (`serving-guard-A/B`) that catches the press (innermost responder). Test: `fixes145.test.tsx`; browser check in the 45-* screenshots. |
| V144-8 | fixed (**interim**) | Scorer handoff after the first rally: only to a participant on the current scorer's side (a neutral scorer: another neutral participant), or to an admin (API/demo); an admin who isn't part of the match can reassign to any participant (`POST /admin/matches/:id/scorer`, recorded as `scorerReassign {from, to, by, at}`). A handoff never resets `maxEvents`, `wasWon`, the abandon state or the verdict: the verdict always comes from the captain opposing the scorer at match start (`scorerReassign.from`; rules `confirmOk`). Firebase: the rules can't see another user's admin claim, so "hand to an admin" is the admin's own reassignment there. The scorer picker only offers allowed players after the first rally (EN/HI hint). |
| V144-9 | fixed | HI zero-points text reworded ("अगर किसी खिलाड़ी के अंक हैं, तो 0 अंक वाले खिलाड़ी प्लेयर ऑफ़ द मैच नहीं बन सकते।", EN "If any player has points, players with 0 points can’t be Player of the Match."). "Aarav पक्का करें": one save per tap – a ref guard (two taps in the same frame both saw `saving = false`), the button's loading state disables it, and the result sheet's ScrollView now has `keyboardShouldPersistTaps="handled"` so the first tap isn't swallowed while the keyboard is up. |

## Switching the abandon policy

The policy lives in **`src/core/abandonPolicy.ts`** (`ABANDON_POLICY = 'review' | 'flag' | 'consent'`):

- **'review'** (shipped, interim): an abandon after the first rally is recorded and waits for admin review; "side
  behind" is shown as information. Admin: reinstate / confirm.
- **'flag'**: the same, but the panel shows "abandoned while behind" as the reason.
- **'consent'**: the scorer *asks*; the opposing captain (both captains for a neutral scorer) must agree, or an admin
  decides (abandon / reject). Scoring is frozen while the request is pending; the requester can withdraw it.

In every mode: before the first rally the scorer abandons directly; once the log ever reached the shortest possible
win (`maxEvents`) or the match was ever won (`wasWon`) only an admin can abandon it.

To switch: (1) edit `ABANDON_POLICY` in `src/core/abandonPolicy.ts`; (2) run `node scripts/gen-abandon-policy.js`
(rewrites `abandonPolicy()` in `firestore.rules`; `--check` fails when they differ, and a rules test checks it);
(3) run the app, server and rules suites; (4) ship the rules together with the app and API build. The API and demo
read the constant directly.

## Compatibility

- **Firebase rules and app ship together:** the 1.4.5 rules require `maxEvents` on every events write and `wasWon` on
  the finishing write, so a 1.4.4 app can't score or finish against them.
- **API:** migration `0016_match_abandon.sql` (additive, guarded, re-runnable; backfills `max_events` from the event
  count and `was_won` for finished matches). Older apps' `PATCH {status:'abandoned'}` keeps working (routed to the
  abandon action). `{status:'abandoned'}` together with other changes is now 409 `match_status_move` (was 403).

## Rules budget

Measured with the headroom test's padding: the worst create (12 a side by number, title + place) passes with 15
pad steps (≈ 75 spare expressions; the test requires 10), the worst updates at 3,000 events with 42 (≈ 210; the
test requires 30). Document reads stay ≤ 10 (a by-number create: 2 × (3 + 1) + terms).

## Tests and builds

See the final report (counts, sha256s, screenshot names).

Screenshots (`/workspace/scripts/shots/cap45.js en|hi`, demo web build, 360×640), each as `-EN.png` and `-HI.png`:
45-01-serving-badge-tapped-no-point, 45-02-abandon-dialog-admin-review, 45-03-abandoned-header-replayed-score,
45-04-abandon-record-review-pending, 45-05-opposing-captain-report-button, 45-06-reported-to-admin,
45-07-admin-review-abandoned-reinstate-confirm, 45-08-admin-review-finished-no-winner-reopen-abandon-void,
45-09-scorer-handoff-own-team-only, 45-10a-potm-all-players-scored-no-zero-text, 45-10-potm-zero-points-text,
45-11-potm-confirmed-one-tap. 45-08 uses an injected finished-without-winner fixture (`match_nowin`); 45-10/11 use
an injected copy of the just-finished match in which one player's credited points were turned into team points
(`match_zero`), because in the seeded match every player scored, so the zero-points line correctly doesn't show (45-10a).
