# PROGRESS 1.5.8 (vc53) – Bold Spiker icon + cheap Lows from the Tester's "1.5.7 retest results"

Times are IST (Asia/Calcutta, UTC+5:30).

Backups (never overwritten): volleylive-latest.apk.bak53, volleylive.zip.bak67, backups/volleylive-1.5.7.{apk,zip} (4f7414c9… / 0981678b…), backups/volleylive-src.pre158.tar.gz, backups/assets.pre158/ (old icon PNGs), backups/apk-android.pre158.tar.gz (APK tree android/ before prebuild), scripts/mkzip.py.pre158, scripts/test_mkzip.py.pre158.

- [x] Icons copied from volleylive-design/logo/v2/final-bold-spiker (read only) per its INTEGRATION.md: assets/icon.png (1024 RGB, no alpha), android-icon-foreground / -background / -monochrome, splash-icon, favicon (48), notification-icon (96, white on transparent); logos (badge, mark-day, mark-night × 1x/@2x/@3x) → assets/brand/; play-store-512 → docs/store/ (not uploaded anywhere); favicon.ico → public/.
- [x] app.config.ts checked: icon, adaptiveIcon foreground / background image / backgroundColor #0055A4 / monochrome, favicon, expo-notifications icon + #0055A4, expo-splash-screen #FFFAF3 / dark #1E2A44, userInterfaceStyle automatic – all already correct, nothing changed except the version.
- [x] APK tree: expo prebuild (it cleared and regenerated android/), then gradle.properties / local.properties / package.json restored; debug.keystore sha unchanged; build.gradle differs only in versionCode / versionName. Native res verified: mipmap-anydpi-v26 background / foreground / monochrome; drawable-*/notification_icon white on transparent (5 densities); splashscreen_background #FFFAF3 (values) / #1E2A44 (values-night); notification colour #0055A4.
- [x] In-app logo: new src/components/BrandLogo (mark-day / mark-night through useTheme, or badge); About (was assets/icon.png) → mark 88; Login brand row → badge 36 (28 compact). Logo contrast checked (Day mark ink outline ~16:1 on #FFFAF3; Night mark ≥3:1 on 86% of its pixels on #1E2A44; badge ring on both).
- [x] F157-1 direct team lookup: side names first – exact → prefix → all words (any length, "Filler F3") → any word; each name's latest 10 matches.
- [x] F157-2 "which team?" for every team phrasing and for teams with no matches (registered teams count); bare team name looked up when nothing else is found.
- [x] F157-3 captain help paraphrases → captain guide (guide extended: confirming results, no step-down button); the dispute regression fixed ("Other captain rejected our result, can admin make it count?" → dispute / admin answer).
- [x] F157-5 release notes corrected (RELEASE-1.5.8 "Corrections to the 1.5.7 notes").
- [x] F157-6 mkzip: code-normalised split-URL variant; dotenv-style secret content in env-named source / docs files refused. test_mkzip 145 plants / 35 allowed files.
- [x] Tests: jest intents158 46, brandLogo158 5; server ask158 14.
- [x] app.config.ts 1.5.8 / 53.

Scope addition (parent, 22:55 IST) – the Tester's 1.5.7 full from-scratch E2E:
- [x] F157x-1 (Medium): neutral creator / scorer → both captains confirm; first confirm kept (verification.first), stays pending and not counted; the other captain can still reject; a repeated answer → 409. Server, demo, Firebase backend + firestore.rules, result panel / team page / Ask / FAQ / guide / Fair play EN+HI. Migration 0029 (additive, local only, needs Akshit's production approval). Tests: server fixes158 (X-1 / Z-1 replays), rules-tests +2.
- [x] F157x-3 (Medium): by-phone lookup rate limited per user + per IP (429); response {id, name, photoURL} only; tests incl. the 300-lookup sweep.
- [x] F157x-2 (Low): rules 400 for points per set < 5, win by ∉ {1, 2}, best of ∉ {1, 3, 5} (API + firestore.rules); presets pass.
- [x] F157x-4 (Low): src/app/+not-found.tsx (EN/HI, theme tokens, Home button, no sitemap); in the contrast scan.
- [x] V1426-3: fixture lists capped at 496 (rules + API).

Scope addition (parent, 23:10 IST) – the Tester's 360px UI pass:
- [x] F157u-1 support link from EXPO_PUBLIC_SUPPORT_URL; unset → no external link, Feedback button; placeholder removed.
- [x] F157u-2 Home skeleton uses surface2 in Night.
- [x] F157u-3 Ask source titles in the UI language; every built-in source has a HI title (test).
- [x] F157u-4 Feedback stars: Space / Enter (web) + accessibility activate.
- [x] F157u-5 Memories > Add photo dates via formatDateT.
- [x] Home shows the offline pill while offline (Simulate offline).

Environment (box restore, about 23:10 IST): the workspace files were restored from a snapshot and every node_modules folder was missing; the dev MySQL on the local test port was down. Restarted the dev MySQL (scripts/mysql-dev.sh), reinstalled with npm ci from the lockfiles (app, server, rules-tests, scripts/shots), redid the edits the snapshot missed (FAQ / guide / Fair play copy, two server test updates, server/tests/fixes158.test.ts). Node is now v24.22.1 with Unicode 17.0; the generated email-letter lists were made with Unicode 16.0, so the rules-tests freshness check "V143-6 … the generator is up to date" fails (the lists themselves, and so app / server / rules behaviour, are unchanged). Not regenerated and no other Node installed – waiting for a decision. The pipeline has not been re-run.

Pre-pipeline results (each suite alone, 29–30 Oct IST): tsc app + server clean; jest 176 suites / 2557 tests pass with fixes143 excluded (its "generated file is up to date" check fails on Unicode 17 and REWRITES src/core/emailChars*.ts and the firestore.rules email block – that happened once, at 23:41 IST; all three were restored from backups/volleylive-src.pre158.tar.gz, Unicode 16.0, checksum-verified); server 583 tests (the one failure – the migration list in fixes142 – fixed, file re-run 14/14; fixes158 9/9); rules-tests 227/228 (only V143-6, the same Unicode freshness check); ask eval 380/386 (98.4%; fix158 16/16, holdout158 10/12). Also fixed for the new ICU: the datesTz test helper (-0 vs 0 for UTC).

Decision (parent, 29 Oct ~23:59 IST): keep the Unicode-16 lists, pin the pipeline's Node.
- [x] Official Node v24.13.0 (nodejs.org/dist, sha256 OK vs SHASUMS256.txt) → /home/box/tools/node-v24.13.0-linux-x64; Unicode 16.0 / ICU 77.1 / modules 137. Probed: 24.11.1, 24.12.0, 24.13.0 = 16.0; 24.13.1, 24.14.0, 24.15.0 = 17.0. System node untouched.
- [x] finish158.sh: PATH pin + start-up assert (negative test with the 24.15.0 binary: "FAILED at step 0: node pin: unicode is '17.0'").
- [x] npm rebuild under it (app, server, rules-tests, scripts/shots; re2 loads).
- [x] Allow-list files + rules block byte-identical to pre158 (before and after); fixes143 8/8 and V143-6 4/4 pass, nothing rewritten.
- [x] Pipeline START=1 STOP_AFTER_SCAN=1 (00:01–00:40 IST): suites all green (jest 2572, server 583, rules 228, policy), eval 380/386, scan 272/0/0.
- [x] RELEASE Verification + Open, DEPLOY.md "Build toolchain" (Node pin).
- [x] START=4 (00:50–01:31 IST): test_mkzip all passed (145 refusal plants); zip 712 files (refusal / .gitignore checks clean); APK versionCode 53 / 1.5.8. Shas (verified by parent and QA, files untouched since): APK bf5ccbb850716d8bde25d9c44b00ad91574910983259fde1e115eb44783db2f1, zip 27d47316b0db4dadae6d121aa02f3bab15ec0333a77ea4c0435495d95da71566.
- [x] Icon previews from the built APK (aapt2 mapping + Pillow; scripts/icon-previews158.py) → /workspace/volleylive-1.5.8-icon-previews/ (launcher circle / squircle / rounded / square, legacy, themed light / dark, notification dark / light / accent, splash day / night, in-app Login + About Day / Night, web favicon; README with checks and extracted-file sha256).
- [x] APK icon checks: mipmap-anydpi-v26 ic_launcher + _round = background / foreground / monochrome; notification_icon white on transparent at all 5 densities; splashscreen_background #FFFAF3 / night #1E2A44. Foreground glow (alpha < ~60) reaches 35.4 dp, opaque art within 33.2 dp – no clipping issue.
