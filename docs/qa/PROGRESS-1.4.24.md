# 1.4.24 (versionCode 40) progress – updated after each step
Scope: V1423-3 (Night contrast + scan.js), V1423-2 (Hindi Ask), V1423-1 (docs). Zip only after ALL suites (incl. rules + policy) finish.
- [x] Backups: volleylive-latest.apk.bak40 (90e4fdfd…), volleylive.zip.bak54 (a591669c…), backups/volleylive-1.4.23.{apk,zip}, backups/pre1424/
- [x] V1423-3 fixes: timeline text+dots (TeamDot ring in Night), want-to-play names, tournament/new team names, PhoneVerifier title, DOB picker (marked, scrolled into view, themed scrollbars), Night disabledText #C9D2E8 (ui.Button path used by next-rules), default selected chip = primary in Night (25 km), map preview label; Text colour audit test core/__tests__/textColourAudit1424.test.ts
- [x] scan.js: openers fixed (photo-button, team-panel-A, /edit-profile profile-dob, lineup on match_upcoming pre-rally), tabs (match, tournament, new-match steps), want-to-play, tournament/new teams, 25 km; settle re-measure; clipped-row skip; skipped action = failure. Ancestor-chain fallback when the hit-test skips a painted ancestor (score toast). Final run on /tmp/web424final: checked=268 failures=0 skipped=0, exit 0 (log /tmp/scan424final2.log)
- [x] V1423-2 Ask: subject-aware हटा, अंक→points, romanised Hindi, warmAskIndex at server start; tests askHindi1424.test.ts + server fixes1420
- [x] V1423-1 docs: RELEASE-1.4.22 corrected (413ad3c7…, 542); RELEASE-1.4.23 present with 90e4fdfd… / a591669c… (it was written after the 1.4.23 zip, so not inside it)
- [x] version 1.4.24 / 40; screenshots 424-* (36: timeline, player points/team-B stats, tournament/new teams, DOB picker, New match Next, map 25 km + preview, 2 Ask, abandon dialog × Day/Night × EN/HI; want-to-play skipped: no demo interest data)
- [x] first suites run: tsc app 2 / tsc server 2 (DobPicker dataSet type, warmAskIndex logger type) → fixed (type-only), run stopped during server (our pids, verified)
- [~] re-export web (/tmp/web424final2) → full suites (s1424) → re-scan on that final build: running in that order
- [ ] zip (after ALL suites), APK, RELEASE-1.4.24.md
