# VolleyLive 1.4.27 (versionCode 43)

APK: /workspace/volleylive-latest.apk · Zip: /workspace/volleylive.zip. The sha256 of both are written AFTER the build to
/workspace/volleylive-1.4.27-shas.txt (this file is inside the zip, so it can't carry the zip's own sha).
Backups: volleylive-latest.apk.bak43 and volleylive.zip.bak57 (= 1.4.26), backups/volleylive-1.4.26.{apk,zip}, backups/volleylive-src.pre1427.tar.gz.

## Contents
- E2E-4 (Akshit): tournaments up to 32 teams (app, API, demo, Firestore rules) and the new "Groups + knockout" format:
  balanced seeded/random groups, plan choice (e.g. 15 teams = 4 groups 4/4/4/3, top 2 -> QF), group tables with the
  existing tiebreaks + name, automatic cross-group advancement (A1 v B2) into a power-of-2 bracket with byes; 17 teams:
  groups 5/4/4/4 or a knockout with a play-in. Owner-only edits, played fixtures locked (API + demo). EN/HI UI.
  Migration 0024 (additive). Match counts: 15 teams = 21 group + 7 KO = 28 (the brief's 23 was wrong); 17 = 35 (groups)
  or 16 (play-in).
- V1426-1 (Medium): concurrent retries with one Idempotency-Key all get the first 201 body – key claimed atomically
  before the fixture lock (migration 0025 match_create_claims, additive).
- V1426-2 (Medium): scorer handoff with a clock behind loses no rallies – sequence reset on every scorer change; the app
  uses a counter (not the clock), rebases on progress_stale and re-sends; a refused save shows an error and retries.
- V1426-4 (Low): db-audit no longer flags matches abandoned before the first rally.
- V1426-5 (Low): same key + different body = 422 idempotency_mismatch; a save without seq after sequenced saves = 409
  progress_seq_required; demo = API on an unlink of a played fixture (claim kept).
- V1426-3 (Low, documented as is): firestore.rules does not enforce the fixture lock / fixture_taken / not_ready / teams
  / claim checks – adding them exceeds the rules' 1000-expression budget. Enforced in the API (the production backend)
  and the demo. The rules also read only the first 10 teams of a tournament (10 get() per request); teams 11–32 are
  id- and duplicate-checked.
- E2E-10: POTM Spikes/Blocks/Aces show '–' on matches without detailed stats (detected from the data: no rally has a
  point kind), incl. existing tap-a-player matches such as match_5mc8xbgv9y0x.
- V1425-4: Devanagari tops on the HI photo-card labels (line box 1.4 em + padding), EN labels larger; 'ट्रॉफी' and
  'ट्रॉफ़ी' both checked.
- Web: a hard reload paints the splash colour (Day #FFFAF3 / Night #1E2A44) instead of white; the native splash is
  native-only, so the blank page itself was expected.
- **Colour revert (Akshit via Dream):** the in-app colour tokens are back to the values before the 1.4.26 "fresher
  greens" (Day success/successFill/successStrong/successBg, Night primary/primaryText/success/tabActive/glow/userDot/
  progress, DNKit + ThemeTransition accents: #9BFF3A -> #C6FF1A etc.). Kept: the Spiker logo, app icon, splash and
  notification icon (icon background #0055A4, splash backgrounds), every 1.4.26 functional fix. Reference: the 1.4.26
  pre-greens backups (backups/tokens.ts.pre1426green, themes.ts.pre1426green) – /workspace/backups/volleylive-1.4.25.zip
  named in the request is not on the box; those backups are the 1.4.25 tokens plus the 1.4.26 V1425-1/2 Night contrast fixes.

## Migrations (need production approval before they are applied there; nothing deployed)
0024_tournament_groups.sql, 0025_match_create_claims.sql – both additive and re-runnable.

## Verification
- tsc app + server clean; jest 1704/1704 (144 suites, after the revert); tz 5 zones OK; server 399/399 (full suite, once);
  rules 226/226; policy all suites passed
- Contrast scan (after the revert, fresh web export): SUMMARY checked=268 failures=0 skipped=0
- API runs on local :3306: 15-team groups, 17-team groups and play-in, every match scored, champion declared, db-audit 31/31
