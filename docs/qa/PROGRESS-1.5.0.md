# 1.5.0 progress (vc45) – updated after each step
Rules: local :3306 only; no QA ports/folders; no push/deploy/device install; no keys/accounts. Pipeline scripts/finish150.sh (setsid, START=n).
Backups: volleylive-latest.apk.bak45, volleylive.zip.bak59, backups/volleylive-1.4.28.{apk,zip}, backups/volleylive-src.pre150.tar.gz  [x]
Box rebooted before start: node_modules reinstalled (root, server, rules-tests, shots), dev MySQL :3306 restarted.

## A) Tester Lows 1.4.28
- [x] V1428-2 long names in group tables (2 lines / shrink), HI 'आगे' badge gap
- [x] V1428-3 Night team dots ring
- [x] V1428-4 bracket SF cut off at 360 (scroll hint / narrower), champion label on final

## B) Ask VolleyLive agent
- [x] core: guides, chunking, tools (strict ArgSpec schemas → JSON Schema, additionalProperties false) + ToolHost, intents (EN/HI/roman), agent (step limit, wrap-as-data, PII filter), cards
- [x] migrations 0026 (ask_chunks kinds guide/custom, ask_content) + 0027 (ask_history, ask_audit), additive
- [x] server: ServerToolHost (viewer-scoped), chat route, history, audit, rate limit, admin content + reindex
- [x] providers: tool calling over fetch (openai/gemini/anthropic) + mocked-HTTP tests
- [x] app: chat screen (history, suggestions, EN/HI, theme), cards at 360, demo host
- [x] tests: core jest, server node, UI jest
- [x] eval set docs/qa/ask-eval-1.5.0.jsonl (~100) + server/scripts/ask-eval.ts, pass rate
- [x] suites, scan 0, docs (RELEASE-1.5.0.md)  [x] build START=4 (10:33–10:48 UTC-5): APK vc45 1.5.0, cert fac61745…033b9c, zip 615 files, shas in /workspace/volleylive-1.5.0-shas.txt
  A done: src/app/tournament/[id].tsx + src/components/__tests__/tester1428.test.tsx (6 tests)
  B core written: src/core/ask/{guides,cards,tools,intents,agent}.ts, index.ts (kinds guide/custom, chunkText, defang, scrubPii, GUIDE_PENALTY 0.1);
    services/askHost.ts (Backend-based ToolHost), askLocal.ts askChatLocally/history; Backend.askChat/askHistory/clearAskHistory (api/demo/firebase). tsc clean.
  NEXT: server (migrations 0026/0027, host, domain chat/audit/history/admin content, routes, providers tool calling), UI, tests, eval.
  Server written: migrations 0026_ask_content.sql + 0027_ask_history_audit.sql; server/src/ask/host.ts; providers createAskAgent (fn calling);
    domain ask.ts chat/history/clearHistory/writeAudit/admin content+reindex; routes /ask/chat, /ask/history, /admin/ask/content, /admin/ask/reindex.
  Eval: tests/askFixtures.ts (seedDemo + simulateGroups 'Juhu' 8 teams + injection bait) + scripts/ask-eval.ts (DB volleylive_askeval_test on :3306).
  UI: src/app/ask.tsx rewritten, src/components/ask/AskCards.tsx, i18n ask.* EN/HI.
  Tests added: server/tests/ask150.test.ts (20, pass), src/core/__tests__/ask150.test.ts (50, pass), src/components/__tests__/ask150.test.tsx (20, pass);
    ask1420 / fixes1421 updated to the chat API (askChat/askHistory, turn ids n1…). Ask jest group 190/190.
  Eval: 121 items (105 tuned + 16 held out). First run of the first 103: 95/103 (92.2%) → fixes (give me…, where does X live,
    HI delete/phone, 'score of', '### SYSTEM', volleyball court) → 105/105; with holdout 119/121 (98.3%), holdout 14/16 (not tuned).
  Version bumped: app.config.ts 1.5.0 / 45; gradle 45 / "1.5.0" in the pipeline step 5.
  Pipeline: scripts/finish150.sh started START=1 STOP_AFTER_SCAN=1 (export, suites, ask eval, scan), then docs, then START=4.
  [x] Pipeline run 1 failed at jest (2): HI ask.card.potm was English → 'प्लेयर ऑफ़ द मैच'; askLocal now loads AsyncStorage lazily
      (services/fixes1421 imports it without the mock). Both fixed and pass alone. Restarted START=2 STOP_AFTER_SCAN=1.

## Priority (parent steering 09:16 UTC-5): Tester's full E2E 1.4.28 – challenges
- [x] F1428-1 (High) accept → match_no_verdict: matchFactory.acceptChallenge now makes the accepting captain the scorer
      (challenger's captain confirms). Tests: server/tests/challenge150.test.ts (API, 6 v 6: old body → 400 match_no_verdict,
      new body 201, accepted + linked, rally scored) and src/services/__tests__/challenge150.test.ts (demo, via matchFactory).
- [x] F1428-2 (Medium) challenge ↔ match link: shared src/core/challengeLink.ts used by the API (createMatch claims the challenge
      row FOR UPDATE; respondChallenge checks the linked match; challengeId frozen on update) and the demo backend.
      Codes (EN/HI, CODED): challenge_unknown 404, challenge_not_captain 403, challenge_closed 409, challenge_used 409,
      challenge_teams 400, challenge_match_invalid 400, challenge_link_frozen 400. Both Tester repros covered (a: unrelated
      matchId → 400; b: non-captain claiming a declined challenge → 403, a captain → 409). API 4/4, demo 5/5.
      Firestore rules not changed (same documented gap as V1426-3: the API is the production backend).
- [x] full pipeline rerun START=1 STOP_AFTER_SCAN=1 (09:44–10:28 UTC-5): suites ok (jest 1802, server 427, rules 226, policy ok), eval 119/121, scan 268/0
- [x] F1428-3 (Medium) unconfirmed win counted in team stats: core/teamRecord counts only antifraud isEligible results (POTM +
      other captain confirmed / admin approved, not flagged) and reports `pending`; team screen shows "N result(s) waiting for
      the other captain to confirm" (EN/HI). Leaderboard / my_stats / player_stats / Ask already use counted rankings only
      (eval: Juhu viewer 5 matches, 3 counted). Tests: dn1422 teamRecord (2).
- [x] F1428-4 (Low, demo) stray invites: the demo's auto-invite to Delhi Smashers on every sign-up removed; stale invites for
      unregistered numbers cleaned on load; acceptTeamInvite only for the signed-in invited player, idempotent (no double sub);
      Home Join/Decline guarded against double taps. Could one tap add two users? Not reproducible in code (accept adds only `id`),
      but nothing stopped a call for another user – now refused. Tests: src/services/__tests__/invites150.test.ts (4).
- [x] F1428-5 (Low) nameless location blocked New match / Challenge: LocationPicker fills t('location.pinnedName')
      ('Pinned location' / 'पिन की गई जगह') when reverse-geocoding finds no name, with an editable hint; both forms send
      core/geo namedPlace() and no longer stop on nameRequired. Tests: locationPicker, fixes1420, tester1428ui (2).
- [x] F1428-6 (Low) Ask VolleyLive on Home: HomeAskCard (testID home-ask → /ask) after the quick actions, title/text wrap to
      2 lines. Tests: tester1428ui EN/HI × Day/Night, AA contrast walker, placement (5).
- [x] F1428-7 (Low) Profile rank label clipped (EN Day 360 px): RankCard overline wraps to 2 lines (testID profile-rank-label),
      full text kept. Test: tester1428ui (1). dn1422 key check now accepts i18next plural keys.
