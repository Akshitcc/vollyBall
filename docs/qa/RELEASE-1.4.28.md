# VolleyLive 1.4.28 (versionCode 44)

APK: /workspace/volleylive-latest.apk · Zip: /workspace/volleylive.zip – sha256 of both in /workspace/volleylive-1.4.28-shas.txt (written after the build). Same debug signing cert (fac61745…033b9c), no new keys.
Backups: volleylive-latest.apk.bak44, volleylive.zip.bak58, backups/volleylive-1.4.27.{apk,zip}, backups/volleylive-src.pre1428.tar.gz.

## Fixes (Tester's 1.4.27 E2E, fixes-retest.md 'E2E scenario 1.4.27')
- V1427-1 (High): a full tie on the qualifying line is broken by team NAME everywhere through one shared function, core/groups `tiebreakNames` (used by groupTables / resolveGroupsKnockout / resolveFixtures). The API (fixtureTeamsNow → fixture_teams at match start, and the bracket after a match), the demo (fixtureStartProblem) and the app screen now agree. Tester's repro (15 teams, 4 groups, top 2, 3-way tie Goregaon / Thane / Vashi with ids in the opposite order): A2 = Goregaon Giants on every path; starting the QF with Thane → 400 fixture_teams, with Goregaon → 201.
- V1427-2 (Low): API/demo refuse groups the app can't build: fewer than 4 teams → 400 groups_too_few; a group not bigger than `advance` → 400 groups_too_small (EN/HI messages).
- V1427-3 (Info): rules-tests package-lock resynced (npm ci works). Migration 0024 down step server/src/db/rollback/rollback0024.ts: refuses with a clear message while groups data exists (nothing changed), otherwise reverts guarded and re-runnably; migrations stay additive; documented in docs/DEPLOY.md.
- V1426-3 Firestore rules gap: still documented as is (API = production backend enforces).

## Migrations
No new migration. 0024 / 0025 (1.4.27) still need production approval. Nothing deployed.

## Verification (each suite alone, scripts/finish1428.sh)
- tsc app + server clean
- jest: 1708 passed, 1708 total (145 passed, 145 total); tz: 5 zones pass (one earlier tz run hit a known-flaky timing test in teamBuilder1421, unrelated; it passed 3/3 alone and in the rerun)
- server: pass 403 / tests 403
- rules: 226 passed, 226 total; policy: all suites passed
- contrast scan: SUMMARY checked=268 failures=0 skipped=0
