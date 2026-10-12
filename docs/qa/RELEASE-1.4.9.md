# VolleyLive 1.4.9 (versionCode 25) – fixes for the 1.4.8 QA findings (V148-1..8, H10)

> **Abandon policy: still INTERIM, PENDING DECISION ('review').** The policy script exits 1 overall when a step exits
> 99 (intended).
>
> **Open decision for Akshit:** may a player be a member of two registered teams? Unchanged (allowed); New match now
> catches such a player when both teams meet in one match, and the match-level check still refuses it.

## Items

| # | Status | Cause → change |
|---|--------|----------------|
| V148-5 | fixed | **Cause:** Void (AdminReviewButtons on the match page and the admin review list) ran at once; the abandon panel's Void only asked "Void result?". **Change:** `AdminReviewButtons` asks first (`verify.voidAsk`: never counts, can't be undone) everywhere it is used; the panel's Void asks `abandon.confirm.void` with the score. EN/HI. |
| V148-6 | fixed | **Cause:** the both-teams check only ran for players added by number (TeamBuilder) and at match level; two registered teams sharing a player passed team selection. The summaries showed `team.memberIds.length` (7/8) instead of the Exact-6 pick. **Change:** new.tsx computes each side's playing ids (roster, or the 6 picked, or built players); a player in both → inline error under Team B (`both-teams-error`, `newMatch.inBothTeams`, kept in view), Next disabled with `newMatch.nextRulesBoth` and the reason as hint. Summary (step 3) and the collapsed side summary count the playing players. Match-level block unchanged. |
| V148-7 | fixed | **Cause:** only the found card was revealed (once, at 60 ms); the keyboard's own reveal of the focused input ran after it and the refusal line / step-3 error stayed off-screen. **Change:** `RevealOnShow` (KeyboardAwareScreen.tsx) reveals a message when it appears or changes, again at 400 ms; used for the refusal (`-problem`), `-lookup-error`, `-not-registered`, `new-match-error` and `both-teams-error`. |
| V148-8 | fixed | HI admin action "छोड़ना स्वीकार करें" (dialog "छोड़ना स्वीकार करें? …"); the scorer keeps "मैच छोड़ें". No क्का. |
| V148-1 | fixed | `fixes144.test.ts`: AsyncStorage cleared before/after each test; every backend's 300 ms save timer and sim timer cleared; real timers restored. |
| V148-2 | fixed | **Decision: verdict repair is scorer-only everywhere.** **Cause:** RP9 – core allowed a captain fix the rules refused (captain B a team-A player); GU11 – rules `setupVerdictOk` ignored `scorerReassign.from`. **Change:** core `repairProblem` refuses any captain fix (`repair_invalid`; demo/API via core), `repairOptions` has no confirmers, rules `verdictRepairOk` accepts kind 'scorer' only; rules `setupVerdictUpdOk` (roster edits) also checks the reference (`setupVerdictRefOk`) – creates keep the cheap check (budget). KNOWN-GAPS corrected. Walk tests: core `verdict149`, demo148, server fixes149, rules "V148-2 (RP9)" / "(GU11)" (GU11 fails against the 1.4.8 rules). |
| V148-3 | fixed | `abandon.repairHint` EN/HI names only the scorer choice. |
| V148-4 | fixed | `zoneLabel` maps legacy IANA ids (`LEGACY_ZONES`: Asia/Katmandu→Kathmandu, Asia/Calcutta→Kolkata, Europe/Kiev→Kyiv, …) before labelling. |
| H10 | fixed | New `0019_verdict_repair_type.sql` (check only; 0018 untouched): stops with "0019: matches.verdict_repair must be JSON, found text …" when the column has another type. Migration lists in `fixes142.test.ts` updated. |

## Tests (all green, run one at a time)

- App: `tsc` clean; jest 1284 / 1284 (104 suites); `test:tz` 1284 × 5 zones.
- Server: `tsc` clean; 304 / 304 (new `fixes149.test.ts`).
- Rules: 194 / 194; policy suites (review / flag / consent) all passed.
- New tests: `src/core/__tests__/verdict149.test.ts`, `src/components/__tests__/ui149.test.tsx`, `server/tests/fixes149.test.ts`, rules "V148-2 *", additions in `fixes144`, `demo148`.

## Screenshots

`49-01`…`49-06`, EN and HI, 360×640, IST.
