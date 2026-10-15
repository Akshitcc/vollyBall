# 1.4.23 (versionCode 39) progress – updated after each step
Scope cut at 11:56 PM IST: only V1422-6, V1422-4, V1422-7 and the release-note shas. The Lows (V1422-1/-2/-3/-8/-9/-10), the mockups, the New match 4-step flow and the rules work are deferred (none were started).
- [x] Backups: volleylive-latest.apk.bak39 (2d257ab4…), volleylive.zip.bak53 (413ad3c7…), backups/volleylive-1.4.22.{apk,zip}, backups/pre1423/ (src tar + apk build.gradle)
- [x] V1422-6 DialogHost uses theme tokens (+ map callout/sheet on colors.card); test components/__tests__/night1423.test.tsx
- [x] V1422-4 fixes: player points names/totals, team-colour stats (teamText lightens in Night), LanguageSwitch (Profile + Login HI chip), map distances/labels/hint, Privacy DRAFT banner, disabled KButton, Ask question bubble; scanner scripts/contrast/scan.js
- [x] V1422-7 Hindi query synonyms + stop words; EMBED_VERSION in server hash; test core/__tests__/askHindi1423.test.ts
- [x] Version 1.4.23 / 39 in app.config.ts
- [x] Contrast scan (web423b, Day/Night × EN/HI, 200 views): 24 hits left, all fixed after the scan (ink icons/text → colors.text in about, wallet, empty states, Add photo, photo/camera sheets, map hint) except a transient score toast caught mid-fade (scanner artefact). 4 actions skipped (lineup, photo sheet, who-scored, DOB picker: openers not found).
- [x] Further ink→text fixes; Photo delete dialog button on colors.live
- [x] Screenshots 423-* (36: 9 views × Day/Night × EN/HI) from web423c
- [x] Suites: tsc app 0, tsc server 0, jest 1622/1622, tz 0, server 360/360, rules 226/226, policy 0, emulator stop 0
- [x] zip (546 files) + APK tree synced, npm ci 0, build.gradle 39/1.4.23
- [x] gradle BUILD SUCCESSFUL (build35.log)
- [x] APK verified (vc39, ABIs, cert); RELEASE-1.4.23.md written after the final zip
