# VolleyLive 1.4.8 (versionCode 24) – fixes for the 1.4.7 QA findings (V147-1..6)

> **Abandon policy: still INTERIM, PENDING DECISION ('review').** The walks ran once under all three policies
> (`scripts/run-policy-suites.sh`; its rules step now fails when the `-t` filter runs 0 tests).

## Items

| # | Status | Cause → change |
|---|--------|----------------|
| V147-1 | fixed | **Cause:** 1.4.7 checked the verdict invariant only on scorer changes (handoff / reassign); a create, or a roster / captain edit before the first rally (e.g. the scorer moving himself to team B while the creator stays on A), could still leave nobody able to confirm. **Change:** core `verdictSetupProblem` (antifraud.ts: someone can confirm, the scorer is not on that side) checked by `guardCreate` and, on any change to teamA / teamB / participantIds / captains / teamSizeMode / createdBy, by `guardUpdate` (demo and Firebase go through these), by the API `writeMatch` (create + roster edits; seeds excepted) and by the rules (`setupVerdictOk` in `createAllowed` and in the scorer's roster branch – a cheap form of `scorerTargetOk`, so the 12-a-side create stays within the expression budget). Refusal `match_no_verdict` (EN/HI). Moving scorer and creator together to B stays allowed (A's captain then confirms). |
| V147-2 | fixed | **Cause:** older matches (or ones made before V147-1) where nobody can confirm had no way out. **Change:** lifecycle action `repairVerdict` (admin outside the match; guard: nobody can confirm now – new fact `noConfirmer` – and no captain verdict / review yet), core `src/core/verdictRepair.ts` (`repairProblem` / `repairPatch` / `repairOptions`): the admin sets a valid scorer (any participant; the verdict reference is reset – `scorerReassign` cleared) or a confirmer (a side's captain); the result must pass the invariant (`repair_invalid`), otherwise `repair_not_needed`. Audited in `verdictRepair` {by, at (server time), kind, to, side, prevScorer, prevFrom, prevCaptainA, prevCaptainB}. API: migration `0018_verdict_repair.sql` (additive JSON column), `POST /api/admin/matches/:id/repair-verdict`. Rules: `verdictRepairOk` (first branch of `updateAllowed`; checks the audit record against the stored doc). Firebase: `repairDoc` (firebaseActionDocs). Demo: `repairVerdict`. UI: `VerdictRepairCard` on the admin review list (such matches are included by `needsAdminAction`) and on the match page – chips for the valid choices, confirm first, EN/HI. Two new walk states (`noConfirm`, `noConfirmLive`; 16 states, 12 actions), walked on core, demo, API and rules. No existing data is changed. |
| V147-3 | fixed | **Cause:** the panel / admin confirm used a second formatter (`scoreText`: current-set points only, no finished sets), so between sets it said "at 0–0 in set 2"; the scorer's dialog had no score. **Change:** one formatter (`abandonScoreParts` / `abandonScoreOf` in AbandonPanel.tsx) for the card line, panel, admin confirm and the scorer's abandon dialog: "at 1–2 in set 2 · sets 1–0 (25‑3)" / "after set 1 · sets 1–0 (25‑3)", EN/HI. Shared formatter test in `ui148.test.tsx`. |
| V147-4 | fixed | **Cause:** at keyboard-open the reveal ran before the keyboard inset (`webInset`) had lengthened the scroll range, so the scroll was clamped; the next keystroke re-ran it. **Change:** reveal again once the inset is laid out, and on web fall back to the DOM's focused input (`webFocusedInput`). |
| V147-5 | fixed | HI Void is now "अमान्य करें" (review button, panel action "नतीजा अमान्य करें", "अमान्य: नहीं गिना जाएगा"); Cancel stays "रद्द करें". |
| V147-6 | fixed | `zoneLabel` uses the device zone (`Intl`): "IST" only for Asia/Kolkata, else the zone's abbreviation (PDT…), else "UTC+5:30 (Colombo)". `test:tz` now also runs Asia/Colombo. |
| Tooling | fixed | `run-policy-suites.sh`: `NEED_TESTS=1` on the rules step – a step whose output has no "N passed" fails (exit 99). |
| Optional | fixed | The scorer's ⋮ menu hides Abandon once the match has an abandon record (after a reinstate only an admin abandons – the lifecycle already refused it). |

## Tests (all green, run one at a time)

- App: `tsc` clean; jest 1269 / 1269 (102 suites); `test:tz` 1269 × 5 zones (UTC, Kolkata, Colombo, Los Angeles, Kiritimati).
- Server: `tsc` clean; 301 / 301 (new `fixes148.test.ts`; `antifraud` updated – a scorer-on-B match can no longer be created).
- Rules: 192 / 192 (new V147-1 create + roster, V147-2 repair; walk includes `repairVerdict`).
- Policy suites (review / flag / consent): all passed; the rules step ran 16 tests each time.
- New tests: `src/core/__tests__/verdict148.test.ts`, `src/components/__tests__/ui148.test.tsx`, `src/services/__tests__/demo148.test.ts`, `server/tests/fixes148.test.ts`, rules "V147-*".

## Screenshots

`48-01`…`48-10` (10 per language), EN and HI, 360×640, IST (48-10 in Asia/Colombo).
