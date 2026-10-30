# VolleyLive 1.5.8 (versionCode 53)

New app icon (Bold Spiker), cheap Lows from the Tester's "1.5.7 retest results", two Mediums and two Lows from the Tester's "1.5.7 full from-scratch E2E (29 Oct)" and cheap Lows from the 360px UI pass (/workspace/volleylive-qa-report/fixes-retest.md, read only). Same signing cert as 1.5.7 (fac61745…033b9c); no new keys, no accounts; ONE new additive migration (0029, applied only to the local test database, needs Akshit's approval for production); nothing deployed, pushed or uploaded (no Play Console). Times are IST (UTC+5:30).

## Icon: Bold Spiker
- Source: /workspace/volleylive-design/logo/v2/final-bold-spiker (read only, copied per its INTEGRATION.md).
  - assets/icon.png – 1024, RGB, no alpha (legacy / iOS icon)
  - assets/android-icon-foreground.png (transparent) + android-icon-background.png (gradient) – adaptive layers; backgroundColor #0055A4
  - assets/android-icon-monochrome.png – white on transparent (Android 13 themed icon)
  - assets/splash-icon.png – transparent badge; splash background #FFFAF3 (Day) / #1E2A44 (Night)
  - assets/notification-icon.png – 96, white on transparent; colour #0055A4
  - assets/favicon.png (48) and public/favicon.ico (16/32/48) for web
  - assets/brand/ (new): logo-badge, logo-mark-day, logo-mark-night – 120 px with @2x / @3x
  - docs/store/play-store-512.png – the Play listing icon (512, opaque); not used by the build, not uploaded
- app.config.ts: icon, adaptiveIcon (foregroundImage, backgroundImage, backgroundColor #0055A4, monochromeImage), web.favicon, expo-notifications (icon, #0055A4), expo-splash-screen (image, #FFFAF3, dark #1E2A44) and userInterfaceStyle 'automatic' already pointed at these names and colours – only the version changed.
- Native res: regenerated with `expo prebuild` in the APK tree (it cleared and recreated android/; backup backups/apk-android.pre158.tar.gz). gradle.properties, local.properties and package.json were restored from the backup; debug.keystore is unchanged; build.gradle differs only in versionCode / versionName. Checked after prebuild: mipmap-anydpi-v26/ic_launcher(.xml, _round) have background, foreground and monochrome layers; drawable-{m,h,xh,xxh,xxxh}dpi/notification_icon.png are white on transparent; values/colors splashscreen_background #FFFAF3, values-night #1E2A44; notification_icon_color #0055A4.
- In-app logo: src/components/BrandLogo – variant 'mark' picks logo-mark-day / logo-mark-night through useTheme, variant 'badge' is the same on both themes.
  - About (was assets/icon.png with rounded corners): mark, 88 px, labelled.
  - Login brand row (next to the step dots): badge, 36 px (28 px on short screens), decorative.
  - Splash is native (above). Home / onboarding / headers had no logo before and have none now.
  - Contrast: the Day mark's ink outline is ~16:1 on #FFFAF3 (the yellow fill is low by design, see the design README); the Night mark is ≥ 3:1 on 86% of its pixels on #1E2A44; the badge's yellow ring separates it on both themes. Contrast scan: see Verification.
- Previews for Tester: /workspace/volleylive-1.5.8-icon-previews/ (from the built APK; see that folder's README).

> **Correction (1.5.9, Tester F158-4, Info):** PROGRESS-1.5.8 (APK icon checks) said the foreground glow "reaches 35.4 dp". The
> faint glow (alpha ≤ 33) actually reaches about **38.5 dp** from the centre – past the 36 dp mask radius, so about 581
> px of it are clipped by a circular launcher mask; they are near-transparent and invisible. The solid art stays within
> 33 dp (no visible clipping). Also, the adaptive **background is not a flat colour**: android-icon-background.png is a
> radial gradient around brand blue #0055A4 (about #2384E3 in the centre to #0047A0 in the corners); #0055A4 itself is
> only the adaptiveIcon backgroundColor setting. Nothing in the 1.5.8 build changes; this corrects the notes only.

## Fixes
- **F157-1 (Low) – direct team lookup (server).** Side names of finished matches are looked up first – exact (case-insensitive), then prefix, then all words (any length, so "Filler F3" keeps "F3"), then any word of 3+ characters – and each name's latest 10 finished matches are loaded through the same viewer-scoped loader (up to 12 names). An exact name crowded by 100+ newer matches sharing a word ("Powai Pelicans" vs 120 "Powai P…") is found.
- **F157-2 (Low) – "which team?" everywhere.** Candidates come from match sides AND registered teams (teams with no matches count). Exact name first, else every team within the ambiguity gap. Now also for: "X last result", "last result of X", "how did X do", "is X playing", "show X", "tell me about X team", "about X team", "X team ke baare mein", and a bare team name ("Juhu") when nothing else is found. "how is <name> doing" stays a player question.
- **F157-3 (Low) – captain help; dispute regression.** "What does a captain do?", responsibilities / duties / powers / role, "need to be a member?", "changed after a match starts?", "how do I step down", "can the captain confirm the score?" → the captain guide (extended: the other team's captain confirms the result; no step-down button). A result dispute that mentions the other captain ("Other captain rejected our result, can admin make it count?") gets the dispute / admin answer again, unless someone is explicitly made captain. "step me down and make Meera captain" is refused.
- **F157-5 (Low) – corrections to the 1.5.7 notes** (the behaviour is unchanged; the notes were wrong):
  - A phone cue does NOT override a full valid date inside a run: "call 987 12-10-2026 0" stays as typed (only a whole run that is a phone, or a run without a valid date, is masked after a cue).
  - Mixed score-pair + group runs are masked only when the non-pair part is one group that completes a 10-digit phone shape ("9-7 6-9 9-5 4321"); split tails ("… 43 21", "then 54 32 10") stay.
  - Cue distance: up to 6 words between a cue BEFORE the digits and the digits (within 60 characters), up to 3 words for a cue AFTER them (within 50 characters).
- **F157-6 (Low) – scripts/mkzip.py.**
  - The QA-URL scan has a code-normalised variant: comments removed (also between the pieces and after a "+" at a line end), simple constants substituted into template placeholders, Python f-string fields and "+ NAME", literal template placeholders unwrapped, String(n) and numeric ports after "+", .concat() and array .join(separator) evaluated, then adjacent literals joined.
  - Files whose name has an "env" token but a source / docs extension (env.production.json, prod.env.json, env.local.md, env.prod.py, secrets.env.ts) are refused when their content has a secret-named KEY = value (dotenv, JSON / YAML or code) that is not an environment reference, or 3+ plain dotenv lines. .env.example is still the one allowed dotenv file.
  - scripts/test_mkzip.py: 145 refusal plants (+9 split forms, +6 dotenv-content files), 35 allowed files (+ a non-QA port in a template, env references, prose about variables). The docstring matches.
- F157-4 accepted as is (the user's own typed rally / point sequences are hidden in the Ask bubble and history).

## Fixes from the 1.5.7 full from-scratch E2E (29 Oct)
- **F157x-1 (Medium) – a neutral creator needs BOTH captains.** When the match's creator and scorer play for neither team (core/antifraud verdictCaptains returns both captains), the result counts only after both current captains confirm.
  - The first confirmation is kept as `verification.first` {by, at, epoch}; the status stays pending, no captain verdict, nothing counts. The other captain then confirms (counts, `first` kept) or rejects (200, disputed, never counts) – the Tester's Z-1 step (B confirms, then A's reject was 409 already_reviewed) now works.
  - The first confirmer can't answer again (409 already_reviewed, confirm or reject); a reject straight away by either captain still works. A creator / scorer on one team: unchanged (the opposing captain alone confirms).
  - Info: a repeated answer by the same captain is 409 already_reviewed (was an idempotent 200, AF-45; server tests antifraud / fixes138 updated).
  - Everywhere: server (verifyResult; POTM notification goes to both captains), demo backend, Firebase backend (firstConfirmDoc) and firestore.rules (firstConfirmOk / secondCaptainOk; the sides are computed once to stay inside the 1000-expression budget; an admin review keeps `first`).
  - Not counted while waiting: core/resultStatus 'awaitingSecond' ("one captain confirmed, waiting for the other"); teamRecord counts it under pending (not played); rankings, leaderboard and wallet only count a captain verdict, so they never count it. Team page line, Ask result wording, match result panel ("Both captains confirm…", "X confirmed · waiting for Y", the confirm toast) in EN and HI. Help/FAQ "Why does the other captain have to confirm?", the captain guide and the Fair play text explain it in EN and HI.
  - Tests: server/tests/fixes158.test.ts replays X-1 and Z-1 (5 tests); rules-tests (2 tests: first confirm, the other captain's reject / confirm, review keeps `first`, the one-team flow unchanged).
- **F157x-3 (Medium) – GET /api/users/by-phone.** Rate limited per user (burst 30, then 10 a minute) plus a per-IP backstop (burst 100, then 40 a minute), 429 rate_limited with Retry-After – like the pincode lookup. The response is only {id, name, photoURL} – what the two call sites use (TeamBuilder's player card, the team invite); no phone, position, city or other profile fields. Demo and Firebase backends return the same shape. Tests: minimal fields; a 300-number sweep gets 429 right after the 30-lookup burst; five users from one address are stopped by the IP limit.
- **F157x-2 (Low) – absurd match rules.** The API refuses (400) points per set below 5, win by other than 1 or 2, best of other than 1 / 3 / 5; firestore.rules rulesOk matches (5..99, win by 1 or 2). Indoor (25 / win by 2 / best of 5), beach (21 / 2 / 3), the editor's custom options (11–25, 1–2) and the app's quick rules (5 / 1 / 1) still pass. The client-side core check is unchanged (demo / test quick rules).
- **F157x-4 (Low) – not-found screen.** src/app/+not-found.tsx: EN / HI title and text, theme tokens (Day / Night), one "Go to Home" button, no sitemap link. Added to the contrast scan routes (an unknown route).
- **V1426-3 – fixture list cap.** firestore.rules and the API cap a tournament's fixtures at 496 (was 2000) – the app's real maximum: a 32-team league is 32·31/2 = 496 (knockout 31, groups + knockout at most 243; computed with the app's generators). MAX_TOURNAMENT_FIXTURES in src/core/limits.ts. One literal in the rules (no extra expressions); rules test: 496 accepted, 497 refused.

## Fixes from the 360px UI pass
- **F157u-1 – support link.** The placeholder support website is gone. The Help Center link comes from EXPO_PUBLIC_SUPPORT_URL (https only; placeholders such as the old built-in address are refused). Unset: no external link, a Feedback button next to Contact us. .env.example documents it. Tests: supportUrl158 (incl. no placeholder URL anywhere in src) and help1419.
- **F157u-2 – Home loading skeleton in Night.** The skeleton block uses the theme's raised surface (surface2) in Night; Day keeps the soft grey.
- **F157u-3 – Ask source titles in Hindi.** A source is shown with its title in the UI language (core/ask localSourceTitle: FAQ, rule note and guide sources by id), also when search returned the English text. Test: every built-in source has a Devanagari HI title; admin-edited (custom) entries keep their own title.
- **F157u-4 – Feedback stars.** A focused star is picked with Space as well as Enter (web) and through the accessibility "activate" action (src/components/starKeys.ts; test starKeys158).
- **F157u-5 – Memories > Add photo dates.** The match list uses the shared formatter ("29 Oct 2026", HI locale-aware) instead of the device's 10/29/2026.
- **Offline indicator on Home.** The match page's offline pill ("⚠ Offline – showing what is saved on this phone", EN / HI) now shows on Home while offline, e.g. with Simulate offline.
- Not built (pending Akshit): owner edit / delete and leave-team screens.

## Migrations
- **0029_first_captain_confirm.sql (new, additive): NEEDS AKSHIT'S APPROVAL FOR PRODUCTION.** One nullable JSON column matches.first_confirm (the first of two captain confirmations, F157x-1). No backfill, nothing dropped or changed; guarded (re-runnable, information_schema check like 0018); a 1.5.7 server keeps working against it. Applied only to the local test database by the test harness. Production without it: a 1.5.8 server can't store the first confirmation, so don't deploy the 1.5.8 server before 0029.
- 0024–0028 are still pending production approval; nothing deployed.

## Verification (each suite alone, scripts/finish158.sh)
- Toolchain: **Node v24.13.0** (official nodejs.org/dist build, tarball sha256 checked against its SHASUMS256.txt; ICU 77.1, **Unicode 16.0**, ABI modules 137; npm 11.6.2) in /home/box/tools/node-v24.13.0-linux-x64. scripts/finish158.sh puts it first on PATH and stops unless `process.versions.unicode` is 16.0 (pipeline.log: "node v24.13.0 (unicode 16.0)"). v24.13.0 is the newest 24.x with Unicode 16.0 (24.13.1+ = ICU 78.2 / Unicode 17.0). Native modules rebuilt under it (npm rebuild: app, server, rules-tests, scripts/shots). The system node (v24.22.1) is unchanged. See docs/DEPLOY.md "Build toolchain".
- Email allow lists: src/core/emailChars.ts, src/core/emailCharsWide.ts and the firestore.rules email-letters block are byte-identical to backups/volleylive-src.pre158.tar.gz (Unicode 16.0), before and after the run; jest fixes143 (8/8, incl. "the generated file is up to date") and rules-tests V143-6 (4/4, incl. "the generator is up to date") pass under the pinned Node without rewriting anything.
- tsc app + server clean
- jest: 2572 passed, 2572 total (178 suites); tz: 5 zones × 2572 pass
- server: pass 583 / tests 583 (179 suites; incl. new fixes158: F157x-1, F157x-3, F157x-2; ask158)
- rules: 228 passed, 228 total; policy: all suites passed (abandon policy in sync)
- Ask eval (mock, local :3306): 380/386 (98.4%). fix158 16/16, holdout158 10/12 (frozen, untuned; misses 158-03, 158-07), holdout157 18/19, holdout156 19/19, holdout155 11/12, holdout154 12/12, holdout153 12/12, holdout152 12/12, holdout151 12/14, holdout 16/16; all fix151–fix157 and the base groups full. The 6 misses are the known ones listed under Open.
- contrast scan: SUMMARY checked=272 failures=0 skipped=0 (incl. the new not-found screen, /no-such-page-158, Day/Night × EN/HI)
- mkzip refusal test (scripts/test_mkzip.py, scratch copy): see step 4 log
- New in this release: jest intents158 46, brandLogo158 5, supportUrl158 / askSourceHi158 / starKeys158 / help1419 (66 with intents158 + brandLogo158); server ask158 14, fixes158; rules-tests +2 (two-captain confirm)

## Open
- **Node / Unicode drift (Akshit):** Node 24.13.1 and later (incl. the box's 24.22.x) have Unicode 17.0; the shipped email allow lists are Unicode 16.0. 1.5.8 is built on a pinned Node v24.13.0 so they are unchanged. Anyone building or running the suites on a newer Node gets the two freshness failures (jest fixes143, rules-tests V143-6), and the jest one rewrites the lists. Moving to Unicode 17 (a small widening of the accepted email letters, rules + app together) is a separate decision; until then CI / EAS must use a Unicode-16 Node (≤ 24.13.0 on the 24 line). Also changed for the new ICU: the datesTz test helper (-0 vs 0 for UTC; test-only).
- Product call for Akshit: phone-shaped team names ("Blue Jays 98765 43210") – Ask masks them, team screens show them as typed (unchanged).
- Held-out misses (untuned): holdout158-03 ("Juhu team ke baare mein batao" → create-team help, the Hinglish "batao" form isn't routed), holdout158-07 ("captain ki zimmedari kya hai?" – romanised "zimmedari" isn't a role word; answered from the guide text by search, not the guide route); holdout151-05, holdout151-12; holdout155-06 and holdout157-04 fail by design (frozen items).
- F157-2 residuals: a Hindi (Devanagari) query against Latin team names finds nothing; "X last result" for a single team with no matches says "not playing live right now" (no "no matches yet" wording).
- F157-6 residuals: dotenv content is checked only in env-named files (a secrets.json or config.md with KEY=VALUE secrets ships unless it holds a PEM / service-account key); split URLs built through function calls other than String / concat / join, or constants from another file, are not followed. Tester Info items unchanged (.npmrc tokens, AWS credential files, hex PEM, base64 URLs, ip6-localhost, E2E_API as a JSON key, a QA-report path in .md).
- scripts/make-icons.py (the old "Navy Live" generator) still writes into ./assets if someone runs it; it is not used by the build.
- The expo prebuild note "userInterfaceStyle: Install expo-system-ui" is printed for Android; the Night splash comes from values-night (checked), the in-app theme from the app's own Day / Night setting.
- Carried over: the dev-auth token accepts 9 digits; "N of M" counts all invites; the HMAC audit path is untested (no key, by design); Firestore rules have no current-captain check; the HI copy needs a native-speaker review; real LLM providers are untested live; scripts/test_mkzip.py takes ~12 minutes.
- Local harnesses (qa-runs) were not re-run; API-level checks: server/tests/ask158.test.ts, fixes158.test.ts and the eval.
- F157x-1: matches created by a neutral person before 1.5.8 that one captain already confirmed stay counted (no backfill / re-open of past results); a product call for Akshit whether to review them.
- F157x-3: like every rate limit, the counts are per server process unless REDIS_URL is set (shared store; server/src/rateStore.ts).
