# 1.5.1 progress (vc46) – updated after each step
Rules: local :3306 only; no QA ports/folders; no push/deploy/device install; no keys/accounts; additive migrations only. Pipeline scripts/finish151.sh (setsid, START=n).
Source: Tester '1.5.0 retest' (fixes-retest.md).
- [x] Backups: volleylive-latest.apk.bak46, volleylive.zip.bak60, backups/volleylive-1.5.0.{apk,zip}, backups/volleylive-src.pre151.tar.gz
- [x] Version: app.config.ts 1.5.1 / 46

## Medium
- [x] F150-1 challenge claim only through the challenged captain's Accept; decline never leaves a linked match (API + demo, tests, db-audit rule, DB-AUDIT docs, simulate test)
      API: POST /challenges/:id/accept {match} = accept + create in one transaction (challenge row locked, pending, accepting captain = creator, two teams, team size);
      POST /matches with a challengeId always refused (409 challenge_pending / 409 challenge_closed / 409 challenge_used / 403 challenge_not_captain / 404 unknown);
      PATCH never links a match, accept without match → 400 challenge_accept_match (new codes EN/HI). Demo: acceptChallenge (same rules); Firebase: legacy 2 steps (rules gap).
      matchFactory.acceptChallenge → backend.acceptChallenge. db-audit check challenge.match_accepted (32 checks), db-audit.sql regenerated, DB-AUDIT doc,
      auditSim plays early-create/accept/decline/cancel. Tests: server challenge150 7/7, social 9/9, dbaudit1426 20/20; demo challenge150 7/7.
      Note: a 1.5.0 app's two-step Accept now gets 409 challenge_pending (the app must be 1.5.1).
- [x] F150-4 PII masking: all phone formats + e-mails in audit and answers (tests + eval item)
      core/pii.ts maskPii (one pattern for +91 compact / spaced / dashed / dotted, 0091, (+91), 91…, bare 10 digits, 0-prefixed, any
      grouping, other +CC numbers; e-mails incl. spaced) used by scrubPii (audit question + answers) and filterPii (tool data); the audit's
      tool args are masked too. Tests: core fixes151 (11 formats × 3 maskers, no false positives), server fixes151 (8 formats → ask_audit).
- [x] F150-7 'my last results' EN/HI/roman → my_matches; status per result; voided/disputed never plain 'Your last match'
      intents RESULTS words (results/नतीजे/result/natije…) with first person → my_matches past; core/resultStatus (counted / awaiting / potm /
      review / disputed / voided) on every my_matches row + card (ask.card.result.* EN/HI), answers "Your last N results: … (state)";
      "Your last match" wording removed. Tests: core fixes151, UI fixes151ui (EN/HI × Day/Night, contrast), server fixes151 (voided/disputed/pending).

## Low-Medium
- [x] F150-2 teamRecord pending split: awaiting / under review / disputed; voided not counted (EN/HI)
      teamRecord → awaiting / review / disputed / potm (+ pending total); team page one line per state (dn.reviewResults / disputedResults /
      potmResults EN/HI); voided not counted. Tests: core fixes151 (all 3 Tester repros incl. UI-A), dn1422 updated, fixes151ui.

## Low
- [x] F150-3 demo declineTeamInvite invitee only (signed-in phone must match; captain/others refused; idempotent). Test: invites150 (+1).
- [x] F150-5 misroutes ('can' team, deciding set 15, minimum age ≠ OTP)
      modal/limit stopwords (can/have/max/हो सकते/चाहिए…) → no team 'can'/'हो सकते' → team-size FAQ; new rule note rule-deciding-set (EN/HI);
      reg-profile tags (minimum age, how old, sign up, उम्र) → "aged 10 and over". OTP validity stays idk (not in the knowledge base).
- [x] F150-6 confirm/approve/mark finished → read-only notice + screen
      WRITE_START + confirm/approve/verify/mark/void/dispute/resolve/abandon/undo/…; WRITE_ASK ("I want you to …", "mark … as finished");
      HI/roman (कन्फ़र्म करो, पुष्टि करो, confirm kar do…); answer names the screen (Confirm result / Profile > Admin: Review flagged / scoring screen).
- [x] Nits: API second Join → idempotent 200 (also 6 in parallel, member once; non-invited still 403); Ask lang en|hi|absent else 400 ask_lang (EN/HI). Tests: server fixes151, fixes1420 updated.
- [x] Known misses: 'show the ranking' → leaderboard; 'is my match live' → my_matches when 'live' (own live matches only; new enum value).
- [x] Eval: new items for each Ask fix, held-out kept honest, pass rate
  - docs/qa/ask-eval-1.5.1.jsonl = the 121 1.5.0 items unchanged + 16 `fix151` items (Tester repro phrasings: F150-4 ×2, F150-5 ×4, F150-6 ×3, F150-7 ×5, known misses ×2) + 14 new `holdout151` items written and frozen (sha256 dd717679…) BEFORE the first run, not tuned afterwards.
  - Eval world: Aarav's two latest (already under-review, uncounted) results set voided / disputed so F150-7 is exercised.
  - Result (local :3306, mock): 149/151 = 98.7%; 1.5.0 items 121/121 (old holdout 16/16 – note holdout-05/06 were named in the retest, so they are no longer blind), fix151 16/16, holdout151 12/14.
  - Holdout misses left OPEN (not tuned): holdout151-05 "What's the maximum number of substitutes?" → privacy refusal (the word "number" trips the private-details guard); holdout151-12 "am I playing live right now" → live_score (all live matches) instead of my_matches.

## Release
- [x] pipeline START=1 STOP_AFTER_SCAN=1 (suites, eval, scan 0) – tsc ok; jest 1853/1853; tz 5 zones; server 445/445; rules 226/226; policy all passed; eval 149/151; scan checked=268 failures=0
- [x] RELEASE-1.5.1, then START=4 (zip, apk 46/1.5.1, shas → /workspace/volleylive-1.5.1-shas.txt) – cert fac61745…3b9c, badging 46/1.5.1, zip 624 files clean
