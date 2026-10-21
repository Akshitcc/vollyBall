# DB integrity audit (ships in 1.4.26) – progress, updated after each step
Scope: local scratch DB only (volleylive_audit / volleylive_test on dev MySQL :3306). No production, no :3307 / qa_*, nothing deployed, no APK/zip (Tester E2E on 1.4.25 running).
- [x] Schema + FK/cascade map from migrations 0001–0022 (information_schema on volleylive_audit)
- [x] Read-only checks: server/src/ops/dbAudit.ts (29 checks) → server/scripts/db-audit.sql (generated), CLI server/scripts/db-audit.ts
- [x] API simulation server/scripts/auditSim.ts: 103 users, 2-team friendly (undo, offline catch-up, POTM, confirm), abandoned match, support/feedback, 15 teams registered → 15-team tournament refused (limit 10), 10-team knockout (9 matches + 6 byes), 10-team league (45 matches)
- [x] Probes found DB-1..DB-6; fixed in source with tests; additive migration 0023
- [x] server tests/dbaudit1426.test.ts (20 tests) + app src/services/__tests__/dbaudit1426.test.ts (2 tests) green
- [x] CLI on volleylive_audit: 29/29 PASS
- [x] Full suites one at a time (scripts/suites1426.sh) – done in the 1.4.26 pipeline (ticked in 1.4.27 after QA Docs Low)
- [x] docs/qa/DB-AUDIT-1.4.26.md
