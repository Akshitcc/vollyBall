# VolleyLive 1.4.1 (versionCode 17) – fixes for the 1.4.0 QA findings

| # | Status | What changed / where to look |
|---|--------|------------------------------|
| V140-1 | fixed | `server/migrations/0014_email_index_repair.sql` corrected in place (never deployed; header explains). Unapplied restore-log rows are re-worked on every run; stopping after every 3rd statement or after logging gives the same result. Tests: `server/tests/fixes141.test.ts`. |
| V140-2 | fixed | Binary index built beside the old one, swapped in one ALTER (never without an index); latin1 log read with CONVERT, '?' rows never restored. Tested on a latin1 database. |
| V140-3 | fixed | 0014 treats an NFD twin as the same address (utf8mb4_0900_as_cs); API/demo/Firebase never 409 an unchanged address. |
| V140-4 | fixed | `core/registration.ts emailFold`: ς→σ etc.; leftover capitals refused. |
| V140-5 | fixed | Rules: changing/removing an email must release the old claim (`oldClaimReleased`). Rules tests. |
| V140-6 | fixed | Rules refuse any \p{Lu}\p{Lt} and Unicode spaces; KNOWN-GAPS FB-9 rewritten. |
| V140-7 | fixed | Tombstones (`removedAt`, `deleted`; 0015), copy on reactivation, membership from server stamps only; property tests in `src/core/__tests__/fixes141.test.ts`; KNOWN-GAPS "Fact of the day". |
| V140-8 | fixed | Firebase match docs no longer carry a client `createdAt` (rules refuse it); the app uses startedAt/scheduledAt/updatedAt. |
| V140-9 | documented | KNOWN-GAPS 0014 (values lower-cased/trimmed; case-only duplicate returns only once the holder dropped it). |
| V140-10 | fixed | `checkMatchFields`: `time_invalid` for a non-integer scheduledAt on any status (demo). |
| V140-11 | fixed | Pressable cards are role "button" (react-native-web renders a real `<button>`): Enter/Space work; photo tiles are buttons; jsdom keypress test `src/components/__tests__/keyboard141.test.tsx` + browser check. |
| V140-12 | fixed | Result panel shows the captain's stored verdict ("Result confirmed by the opposing captain") whenever the badge says something else – survives reload. |
| V140-13 | documented + fixed | Not a bug in the trigger: 60-day per-user cooldown (QA had been asked earlier). "Reset demo data" now clears the cooldown. KNOWN-GAPS "Review prompt clock". |
| V140-14 | fixed | Result sheet: Close button, Escape/back, backdrop. Inactive web tabs are `inert` (Tab on Profile reaches Edit). Field labels are accessible names. Save on Edit profile → Profile. |
| V140-15 | fixed | Career strip: ✓/✗ icons, legend (EN/HI), read as "Recent form, latest first: Won, Lost, …". |
| Harness | fixed | rules tests: 30 s per test, 120 s setup; run with `--runInBand`, not beside Gradle (KNOWN-GAPS). |

Screenshots: `/workspace/volleylive-screens/41-*-EN.png` / `41-*-HI.png`.
