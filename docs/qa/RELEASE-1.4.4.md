# VolleyLive 1.4.4 (versionCode 20) – fixes for the 1.4.3 QA findings

Core change (Firebase): **the stored summary is no longer trusted.** Rules stop doing per-rally summary arithmetic;
every result the app shows or counts is the replay of the events under rules that are frozen once the first rally
exists. Details and the trusted/derived split: KNOWN-GAPS "1.4.4 – Firebase: the result comes from the events".

| # | Status | Cause → what changed / where to look |
|---|--------|------------------------------|
| V143-1 | fixed (redesign) | Cause: the rules tied each write's summary to the previous one, but a set-ending rally written as a plain +1, a re-opened set or a forged final (52:50 while the events say B 25:0 25:0) still passed, and the arithmetic used most of the rules budget. Now: rules check the event step only (append one well-formed rally / remove the last), the summary only for shape; the app replays the events (`src/core/replay.ts`, `firebaseBackend.matchFrom`) and a disagreeing summary or a winner-less `finished` is flagged (`resultCheck`, `result_mismatch`, badge "flagged") and never counts. Tests: rules-tests "1.4.4: V143-1..5" (S, W, L probes; W shows **B** as the winner), `src/core/__tests__/replay144.test.ts`. |
| V143-2 | fixed | Abandon: the scorer may abandon only while the log is shorter than the shortest possible win (`minWinEvents = (bestOf+1)/2 × pointsPerSet`); beyond that an admin abandons (status/finishedAt/updatedAt only). Chosen as the simplest sound option: rules can't replay, but "fewer events than any win" proves no winner. Finishing needs ≥ `minWinEvents` events; a premature finish shows flagged. App message `abandon_needs_admin` (EN/HI) via `firebaseUpdateProblem`. |
| V143-3 | fixed | Cause: rules/firstServe/rosters could change mid-match, changing the replay. Now frozen once the first rally exists (rules, firstServe, teamA/B, participantIds, captains, teamSizeMode); lineups add-only (set 2+ lineups are set during the match). App message `match_setup_locked` (EN/HI). |
| V143-4 | fixed (cheap checks) | Summary shape only: `null` or a map with known keys, numbers in range (a sum fails unless all four are numbers), `A/B/null`, ≤ 5 set scores. |
| V143-5 | fixed | Cause: the create itself was over budget (not the update rule). Restructured: create has its own key list and checks (`matchCreateOk`), never the update path; one roster slice comparison with `concat`; merged side/captain checks; by-number sides check the first 3 players' profiles (was 4; documented). Every real create shape built with the app's own builders (`rules-tests/appSource.js` loads `src/core/buildMatch.ts` / `firebaseMatchDoc.ts`) passes; a headroom test re-runs them with +10 pads (create) and the worst updates at 3,000 events with 28-char uids with +30 pads. |
| V143-6 | fixed (save) / wide list prepared, **inactive** | Cause: the save re-checked the stored address with the stricter 1.4.3 list. Now the account's own unchanged stored email always passes on every backend (core `checkRegistrationUpdate` + `registrationFieldErrors`, API, demo, rules `d.email == oldEmail`); a new or changed one gets every check. **The 1.4.3 list stays the active one.** See "Wider email list" below. Tests: `src/core/__tests__/emailWide144.test.ts`, `server/tests/fixes144.test.ts`, `src/services/__tests__/fixes144.test.ts`, rules-tests "1.4.4: V143-6". |
| V143-7 | fixed | Cause: the finishing write on a live-with-winner row was frozen like any edit, and void needed a completed match. Now the finishing write repairs it (status finished, server time; core `finishedFreezeProblem` allows status+finishedAt for that case), and admin void closes it as finished + voided. Undo/abandon/edits stay 409. Tests: `server/tests/fixes144.test.ts`. |
| V143-8 | fixed | Demo now: `guardProgress` uses `matchOver` (no undo of the winning rally, no abandon), `finished` without a winner keeps the match live, and a rules/first-serve change that would end a live match → `match_rules_end` (the API answers 400 with the same code; EN/HI). Tests: `src/services/__tests__/fixes144.test.ts`, server test. |
| V143-9 | fixed | Bootstrap is crash-safe: with no meta row the start is still the bootstrap and fills NULL checksums (warning); with the meta row a NULL is refused. Deleting meta row + column = documented intentional reset (DEPLOY.md). The 0014 "unknown" warning is shown once per database (`warned:` flag in `schema_migrations_meta`, additive). Tests: `server/tests/fixes144.test.ts`. |
| V143-10 | fixed | Rules `emailPartsOk`: local part ≤ 64, no leading/trailing/double dot, no domain label starting/ending with `-` (core gained the same label check). NFC/NFD twins (U+0929 vs U+0928+U+093C) documented in FB-9 (b); the wrong `e`+U+0301 example replaced. |
| V143-11 | fixed | Edit profile: a successful lookup of a typed pincode updates the city when it is empty or still a lookup name; a city the user typed is kept until they answer the inline "This pincode is in Mumbai. Use Mumbai as your city?" (Use it / Keep …; HI: "यह पिनकोड मुंबई का है। शहर में मुंबई लिखें?"). `src/core/citySuggest.ts`, `ProfileForm.tsx`; test `ui144.test.ts`. |
| V143-12 | fixed | The "Tap · team +1" hint is hidden on both scoring panels once the match is over (`ViewerParts.tsx`). |
| Info: event cap | raised | `MAX_EVENTS` 2000 → 3000 on all backends (rules `ns <= 3000`); rules memory/budget measured at 3,000 events (worst-case test). |

## Wider email list (prepared, inactive)

Akshit hasn't decided yet, so 1.4.4 keeps the 1.4.3 list active (`src/core/emailPolicy.ts EMAIL_WIDE_ACTIVE = false`).
The wider list is generated and tested so it can be switched on in one step:

- adds **Ol Chiki** (Santali; U+1C50–1C7D letters/digits, not the punctuation), **Meetei Mayek** (Manipuri; U+ABC0–ABFF
  and U+AAE0–AAFF letters/marks/digits, no punctuation), **Arabic for Urdu and Kashmiri** (Arabic-block letters
  without tatweel or Quranic signs, vowel marks U+064B–065F/U+0670, Extended Arabic-Indic digits U+06F0–06F9 only –
  the look-alike U+0660–0669 are left out) – 304 more code points (1,731 in all);
- **ZWNJ/ZWJ (U+200C/U+200D) only between two letters/marks of the same Indic script** (e.g. क्‍ष), never at an edge,
  next to ASCII, between scripts or doubled – one regex (`EMAIL_JOIN_RE`, rules `emailJoinOk`).
- Files: `scripts/emailLists.js` (definition), `src/core/emailCharsWide.ts` (generated), the generated
  `<email-letters>` block of `firestore.rules`. Tests: `emailWide144.test.ts` (wide behaviour via `checkEmail(…, true)`),
  rules-tests "V143-6: the prepared WIDE rules …" (the wide block swapped into a second emulator project gives the same
  answers as the app for 30 probes; regex < 4,096 characters).

**Switching it on:** set `EMAIL_WIDE_ACTIVE = true` in `src/core/emailPolicy.ts`, run `node scripts/gen-email-chars.js`
(rewrites the rules block), run the app/server/rules suites (the 1.4.3 tests that expect these scripts to be refused
must then be updated), and deploy the rules together with the app/API release. `node scripts/gen-email-chars.js --check`
fails when the rules block is out of date.

## What Firebase trusts and what it derives

| Trusted (rules enforce) | Derived by the app (replay) |
|---|---|
| one event step per write; well-formed rallies; credit to the rally winner's player; ≤ 3,000 events | score, sets, set scores, winner, serving side |
| rules, firstServe, teams, participants, captains, team size frozen after the first rally; lineups add-only | "finished" badge, result page, captain confirm, POTM eligibility, wallet, leaderboard |
| abandon (scorer) only below the shortest win; admin otherwise | flags: `summary_mismatch`, `finished_without_winner` → admin review, never counted |
| finish only past the shortest win; finished = frozen | |
| summary shape only (display hint) | |

## Tests and builds

See the final report (counts, sha256s, screenshot names).
