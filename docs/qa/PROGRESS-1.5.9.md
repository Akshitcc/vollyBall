# PROGRESS 1.5.9 (vc54) – Tester 1.5.8 fixes + steering items F158-7 to F158-13 and the daily quote

Times are IST (Asia/Calcutta, UTC+5:30). Source: /workspace/volleylive-qa-report/fixes-retest.md (1.5.8 section) and the Tester's v66 probe output – both read only.

Backups (never overwritten): backups/volleylive-src.pre159.tar.gz, backups/apk-android.pre159.tar.gz, volleylive-latest.apk.bak54, volleylive.zip.bak68 and the backups/ copies. The 1.5.8 outputs (volleylive-latest.apk bf5ccbb8…, volleylive.zip 27d47316…, volleylive-1.5.8-shas.txt with QA's lines) are untouched: 1.5.9 writes volleylive-1.5.9.apk / .zip / -shas.txt (finish159.sh refuses to overwrite them).

- [x] F158-3 (Medium) Firebase private profile: rules (private/profile, pushTokens, lookups counter 60/h), client, migration script (dry run default, emulator-only unless confirmed) + emulator self-test; DEPLOY section "needs Akshit's approval". Rules tests; migration self-test passed (emulator, 30 Oct ~04:20 IST).
- [x] F158-1 deciding set 5–99 (API + rules). Server fixes159.
- [x] F158-2 invites: same response for registered / unregistered numbers; shared per-user bucket + per-IP backstop; test-only liftNamed for simulations.
- [x] F158-4 RELEASE-1.5.8 correction (glow ~38.5 dp, solid ≤ 33 dp, gradient background).
- [x] F158-5 timeouts FAQ + HI synonyms + rule tags; ask-eval-1.5.9.jsonl (392 items).
- [x] F158-6 mkzip (arith / format / YAML split ports, 04100, .flaskenv); speed-ups; test_mkzip all passed (161 refusal plants).
- [x] V1426-3 documented as not fixable in rules (RELEASE).
- [x] TRUST_PROXY already "1" (render.yaml) – noted.
- [x] F158-7 web boot theme + logo (public/index.html, boot-logo.png, ThemeProvider); Android splash follows the OS (documented). web159 7 tests.
- [x] F158-8 shared Checkbox (Space, activate), Terms uses it. ui159.
- [x] F158-9 New Match steps in browser history (useWebStepHistory). core159 (planStepMove + source checks).
- [x] F158-10 placeLabelT everywhere. core159.
- [x] F158-11 admin review: played only (backends: onAdminReviewList; screen: playedForAdminReview); 409 not_completed. core159, release137, server fixes159.
- [x] F158-12 ≤ 6 starters (API 403, demo, rules startersOf; older teams may shrink only); demo Giants 2 subs; summaryOver EN/HI. server fixes159, rules-tests (+2), ui159, core159.
- [x] F158-13 left as documented (1.4.22 V1421-3) – open product call.
- [x] Daily quote: Day "Tap for next" now works; rotation documented. ui159.
- [x] app.config.ts 1.5.9 / 54; finish159.sh (Node v24.13.0 pin, logs s159, own output names).

Pre-pipeline (each suite alone): core159 21/21; privateProfile159 8/8; ui159 7/7; release137 + core159 35/35; server fixes159 14/14; rules-tests 239/239; migration self-test passed; test_mkzip all passed (178 checks, 1330 s).
Fixed on the way: migrate checkTarget missed --project at argv index 0; the second --apply now prints "migrated 0"; the self-test clears the local emulator first (loopback + demo- only); the admin screen's filter was stricter than the backend's list (it re-checked flags) – now status only.

Pipeline: START=1 STOP_AFTER_SCAN=1 (30 Oct 04:48–13:03 IST): suites all green (jest 2615, tz 5×2615, server 597, rules 239, policy), eval 386/392 (98.5%; same 6 known holdout misses), scan 272/0/0. RELEASE Verification filled (13:36 IST). START=4 (zip, APK, shas) started 13:36 IST.
