# VolleyLive 1.5.0 (versionCode 45)

APK: /workspace/volleylive-latest.apk · Zip: /workspace/volleylive.zip – sha256 of both in /workspace/volleylive-1.5.0-shas.txt (written after the build). Same debug signing cert (fac61745…033b9c), no new keys or accounts.
Backups: volleylive-latest.apk.bak45, volleylive.zip.bak59, backups/volleylive-1.4.28.{apk,zip}, backups/volleylive-src.pre150.tar.gz.

## A) Tester Lows (1.4.28)
- V1428-2: long team names in group tables wrap to 2 lines / shrink; HI 'आगे' badge gap fixed.
- V1428-3: Night team dots get a ring.
- V1428-4: bracket SF no longer cut off at 360 px (scroll hint / narrower columns); champion label on the final.

## B) Ask VolleyLive (read-only assistant)
- Core (src/core/ask): guides + FAQ chunking/RAG, strict tool schemas (JSON Schema, additionalProperties false), intents EN/HI/romanised, agent with a 5-call step limit, tool output wrapped as data, PII scrubbing, prompt-injection guard, cards (match, standings, leaderboard, player, team, list).
- Read only: no tool writes; write requests ("delete my match", "score a point", HI equivalents) are refused with a pointer to the right screen.
- Server: viewer-scoped ServerToolHost, POST /ask/chat, GET/DELETE /ask/history (owner only), audit (no phone/key stored), rate limit 429, admin content + reindex (admin only).
- Provider adapter: tool calling over fetch for openai / gemini / anthropic (mocked HTTP in tests; not exercised live – no keys used).
- App: chat screen (history, suggestions, clear, EN/HI, Day/Night), cards at 360 px, demo host; Home entry card (F1428-6).
- Eval: docs/qa/ask-eval-1.5.0.jsonl (121 items: 105 tuned + 16 held out), runner server/scripts/ask-eval.ts on local DB volleylive_askeval_test, report docs/qa/ask-eval-1.5.0-report.json.
  - First run (first 103 items): 95/103 = 92.2%.
  - After fixes: tuned 105/105; overall 119/121 = 98.3%; held-out 14/16 = 87.5% (not tuned against).
  - Held-out misses: holdout-05 "show the ranking" → RAG answer instead of the leaderboard card; holdout-06 "is my match live" → live_score instead of my_matches.

## Fixes (Tester's full E2E 1.4.28)
- F1428-1 (High): accepting a challenge gave 400 match_no_verdict. The accepting captain is now the scorer (the challenger's captain confirms) – demo and API create a playable match and the challenge stays accepted + linked. Tests: API 6 v 6 and demo.
- F1428-2 (Medium): challenge ↔ match link validated (shared src/core/challengeLink.ts, API + demo): the match must be between the two challenge teams, only those two captains may link it, declined/cancelled/used challenges refused, challengeId frozen after create. Codes (EN/HI): challenge_unknown 404, challenge_not_captain 403, challenge_closed 409, challenge_used 409, challenge_teams 400, challenge_match_invalid 400, challenge_link_frozen 400. Both repros tested (unrelated matchId on accept → 400; non-captain claiming a declined challenge → 403). Firestore rules unchanged (same documented gap as V1426-3; the API is the production backend).
- F1428-3 (Medium): unconfirmed results no longer count in team stats (team screen via core/teamRecord, leaderboard and Ask tools use counted results only); the team screen shows "N result(s) waiting for the other captain".
- F1428-4 (Low, demo): stray Delhi Smashers invites came from the demo's auto-invite on every sign-up (also half-registered numbers) – removed; stale invites for unregistered numbers cleaned on load. Accepting an invite only works for the signed-in invited player and is idempotent; Join/Decline guarded against double taps. A one-tap double add could not be reproduced in code, but the call for another user is now refused.
- F1428-5 (Low): a pin with no place name no longer blocks New match / Challenge – reverse-geocoded name, otherwise 'Pinned location' / 'पिन की गई जगह' (editable).
- F1428-6 (Low): Ask VolleyLive card on Home (Day/Night, 360 px, EN/HI).
- F1428-7 (Low): Profile rank label wraps to 2 lines instead of clipping ('YOUR RANK · ALL PLAYERS · O…').

## Migrations
- 0026_ask_content.sql (ask chunk kinds guide/custom, ask_content) and 0027_ask_history_audit.sql (ask_history, ask_audit): additive. Need production approval; nothing deployed. 0024 / 0025 still pending approval as before.

## Verification (each suite alone, scripts/finish150.sh)
- tsc app + server clean
- jest: 1802 passed, 1802 total (151 suites); tz: 5 zones pass
- server: pass 427 / tests 427 (incl. ask150 20, challenge150 4)
- rules: 226 passed, 226 total; policy: all suites passed
- Ask eval: 119/121 (98.3%), held-out 14/16
- contrast scan: SUMMARY checked=268 failures=0 skipped=0
- New in this release: jest ask150 core 50 + UI 20, tester1428 6, tester1428ui 8, challenge150 demo 5, invites150 4

## Open
- HI guide texts need a native-speaker review; Devanagari spellings of transliterated names are not matched by Ask.
- Real LLM providers untested live (adapter covered by mocked HTTP only).
- Firestore rules do not enforce the challenge link (F1428-2) – API only, as V1426-3.
- Ask held-out misses holdout-05 / holdout-06 (above).
