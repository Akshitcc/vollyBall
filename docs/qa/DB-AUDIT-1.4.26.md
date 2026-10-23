# VolleyLive DB integrity audit (1.4.26)

Scope: MySQL schema + migrations 0001–0023, run on a LOCAL scratch DB only (`volleylive_audit` / `volleylive_test` on dev MySQL 127.0.0.1:3306, existing root dev login). Not touched: production, QA :3307, qa_* resources. Nothing was deployed. No users or grants were created.

## How to re-run
- Read-only checks on any DB: `server/scripts/db-audit.sql` (32 SELECTs as of 1.5.1, each one returns the offending rows; empty = PASS). Or run `npx tsx scripts/db-audit.ts` with DATABASE_URL.
- Full local simulation: `npx tsx scripts/db-audit.ts --simulate` (refuses to run unless host is localhost:3306 and the DB name ends in _audit/_test; drops and re-migrates).
- Tests: `server/tests/dbaudit1426.test.ts` (20), `server/tests/e2e1426.test.ts` (2), `src/services/__tests__/dbaudit1426.test.ts` (2), `src/core/__tests__/e2e1426.test.ts` (9).

## Simulation (through the API)
2-team friendly, best of 3: rally-by-rally, 3 Undos, offline catch-up, saves, POTM, opposing captain confirms. Abandoned match. 15 teams registered. A 15-team tournament is refused with 400 (MAX_TOURNAMENT_TEAMS = 10; see E2E-4). Instead: 10-team knockout (9 matches + 6 byes) and 10-team league (45 matches). Plus 4 support tickets and 4 feedback items.
Final counts: users 103, teams 17, members 102, matches 56, sets 148, points 4017, timeouts 148, tournaments 2, fixtures 60, player-match rows 660. **29/29 checks PASS.**

## Results
| Area | Result |
|---|---|
| Users: required fields, unique phone/email, phone/pincode/DOB format | PASS |
| Teams: captain is a member, no orphan members | PASS |
| Matches: two sides, no orphan sets/points/timeouts/lineups, rule set present | PASS |
| Points: player on the scoring side, set exists | PASS |
| POTM is a player of the match | PASS |
| Finished: winner, sets = summary, points = sets, event count, players, ranking view | PASS |
| Abandoned/void: recorded, no winner, excluded from rankings/wallet | PASS |
| Live: no finish time | PASS |
| Tournaments: fixture↔match, one match per fixture, teams registered, no unclaimed matches | PASS (after DB-2/3/6 fixes) |
| FK cascade/restrict (team→members, match→children, tournament delete) | PASS (after DB-5) |
| Offline sync / Undo / app killed and resumed | PASS |
| Concurrent scorers / out-of-order saves | FAIL→fixed (DB-4) |
| Idempotent match create | FAIL→fixed (DB-1) |
| Migrations re-run (0012+), 0023 rollback and roll-forward | PASS (0001–0011 are not re-runnable: Info) |

## Bugs (fixed in source, each with tests)
- DB-1 Medium: a retried POST /matches created two matches. Fix: Idempotency-Key header, table `match_create_keys` (0023), and the client sends a stable key.
- DB-2 Medium: a fixture could be started twice, or with an unknown fixture key. Fix: claimFixture row lock + atomic claim (409 fixture_taken / 400 fixture_unknown / 409 fixture_not_ready / 400 fixture_teams).
- DB-3 Medium: an organizer could claim any match into a fixture. Fix: the match's tournament and fixture must match (400 fixture_match_mismatch).
- DB-4 Medium: a stale or out-of-order progress save overwrote newer rallies. Fix: client `seq` + `matches.progress_seq` (0023), 409 progress_stale.
- DB-5 Low: deleting a tournament left a dangling matches.fixture_key. Fix: cleared on delete.
- DB-6 Medium/Low: a stale fixtures PATCH dropped existing match claims. Fix: stored claims are kept.
- Info: no down-migrations (0023 rollback = drop the table and column). support/feedback/sessions/terms have no user FK by design. Account deletion is not in the app.

## Needs Akshit
1. Approve deploying migration **0023** to production (additive: new table + nullable column). Not done.
2. Review this cleanup SQL. **Not run anywhere.** Run db-audit.sql read-only on prod first:
   - `UPDATE matches SET fixture_key = NULL WHERE tournament_id IS NULL AND fixture_key IS NOT NULL;` (DB-5 leftovers)
   - delete orphan rule_sets that no match references (only if the audit lists any)
   - duplicate fixture matches / mismatched claims: report only, to be decided case by case
3. E2E-4 (more than 10 teams / groups) is waiting on your decision.
4. Firebase rules for the E2E-2 fixture lock: not done (not cheap). API + demo enforce it.

## 1.5.1 update (Tester F150-1)
- New check **challenge.match_accepted** (area relations): a match with a `challenge_id` must belong to an existing, **accepted** challenge whose `match_id` points back at it (an abandoned match may stay tagged); and a challenge that is pending / declined / cancelled has no `match_id`. `server/scripts/db-audit.sql` regenerated (32 checks).
- Why: in 1.5.0 the challenger could create the match of a still-pending challenge, which then blocked the Accept and stayed linked after a Decline. Since 1.5.1 the only way to create a challenge match is the challenged captain's Accept (`POST /api/challenges/:id/accept`, accept + create in one transaction); POST /matches with a challengeId is refused (409 challenge_pending / challenge_closed / challenge_used), and PATCH never links a match.
- The API simulation (`scripts/auditSim.ts`, used by `--simulate` and `tests/dbaudit1426.test.ts`) now also plays three challenges: the challenger's early create (refused 409), one accepted with its match, one declined and one cancelled (no match). All 32 checks pass on the simulated data.
- Run read-only on production before deploying 1.5.1 to list any 1.5.0 leftovers (a match linked to a declined challenge). Cleanup is a case-by-case decision for Akshit; nothing was run anywhere but the local :3306 test DB.
