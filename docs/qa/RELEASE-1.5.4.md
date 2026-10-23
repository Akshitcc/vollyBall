# VolleyLive 1.5.4 (versionCode 49)

Fixes for the Tester's "1.5.3 retest" (/workspace/volleylive-qa-report/fixes-retest.md). Same signing cert as 1.5.3 (fac61745…033b9c); no new keys, no accounts, no new migrations, nothing deployed.

## Fixes
- **F153-1 (Medium) – single digits joined by any separator (src/core/pii.ts).**
  - New separator-run pass: 10+ single digits joined by 1–3 of space, - – — −, ".", "/", "_", "(" ")", "," or ":" in any mix, with an optional "+91-" / "+91 " / "91-" / "0091" / "+" prefix. "9-8-7-6-5-4-3-2-1-0", "9.8.7…", "9/8/7…", "9_8_7…", "(9)(8)(7)…", "9 8-7.6 5 4 3-2.1 0", "9 8 7 6 5-4 3 2 1 0", "+91-9-8-…", "9,8,7,…" (and full-width / Devanagari digits) → "[phone hidden]".
  - Display text (answers, card strings incl. team names): phone-shaped runs. Stored / returned copies (POST response question, ask_history, ask_audit question, GET /ask/history incl. old rows, on-device history, the optimistic bubble): any 10+ digit run with these separators; comma-only runs only when phone-shaped.
  - Kept: set-score lines that strictly alternate a score sign (- – : /) and a gap (space / comma), up to 5 sets ("8-6 7-5 9-7 6-4 8-6", "8-6, 7-5, …", "8:6 7:5 …"); multi-digit scores ("25-23 25-20"); dates, times, versions, IP addresses; fewer than 10 digits; the Tester's keep list (jersey list, "won 9 lost 8 drew 7", "5 4 3 2 1 0 countdown", pincode, UUIDs, OTP uids).
  - Comma-joined digits (asked for in this round): a phone-shaped comma run is masked, e.g. "points 6, 7, 8, 9, 6, 7, 8, 9, 6, 7". This was a keep item in F151-4 and a documented Info in the 1.5.3 retest; non-phone-shaped comma lists stay.
  - A phone in a UUID-shaped DISPLAY token (first four groups zero, last group 00 / 91 + a mobile, e.g. 00000000-0000-0000-0000-009812345678) is masked in display text. Real UUIDs (including all-digit ones) are untouched, and id / route fields are never masked (filterPii ID_KEY unchanged).
- **F153-2 (Low) – Hinglish digit words.** "ath" (8), "chah" (6), "chār" (4); "no" counts as 9 only inside a digit-word run (next to a digit or digit word), so "nau ath ek do teen char paanch chhe saat aath" and "no ath ek …" are masked while "no thanks" / "say no to 9 8 7" stay.
- **F153-3 (Low) – scripts/mkzip.py refuses, not skips.** If any file in the zippable tree matches, it prints every match and exits 2 without writing the zip:
  1. keys / keystores / signing material (*.pem *.key *.p12 *.pfx *.jks *.keystore *.p8 *.mobileprovision, any name containing "keystore") and app packages (*.apk *.aab)
  2. local databases (*.sqlite *.sqlite3 *.db and their -wal / -shm / -journal files)
  3. firebase*.json other than ./firebase.json, google-services.json, GoogleService-Info.plist, .firebaserc (.firebaserc.example is fine)
  4. QA harness copies: anything under qa-runs/ or qa_*/ (empty folders too), and code files (.ts .tsx .js .jsx .mjs .cjs .mts .cts .sh .py) that read E2E_API / E2E_OTP_API / E2E_DB or name /home/box/qa-probes or volleylive-qa-report
  5. any text file containing a QA host:port URL (ports 3307 8088 8089 4100 4101 8080 on 127.0.0.1 / localhost / 0.0.0.0 / [::1] / host.docker.internal, with or without a scheme). Plain prose like "the QA port :3307" and the emulator setting "port": 8080 are not URLs.
  6. user avatars / uploads outside uploads/: u_<8+ hex> and dev_<digits> folders, *.meta.json under avatars/ or photos/
  7. *.tsbuildinfo, .DS_Store
  8. anything the project's .gitignore files ignore
  - Still skipped quietly (never zipped): node_modules, .git, .expo, dist, build, web-build, android, ios, coverage, .firebase, uploads, tmp, .tmp, test-results, playwright-report, __pycache__, .cache, e2e-out (any depth); *.log; .env* except .env.example. This list matches the script's docstring.
  - MKZIP_SRC overrides the source (for tests). scripts/test_mkzip.py runs on a scratch copy and is step 4 of finish154.sh, before the zip: 36/36 (28 refusal plants, 3 empty-folder refusals, allowed prose / emulator port / local URL, quiet skips not zipped).
  - Three old docs contained QA URLs: docs/qa/PROGRESS-1.5.2.md (incident note) and docs/qa/b110/b110-api-b217edge-rerun.txt / b110-api-new-probes.txt (old probe output). The host:port is now "<QA API>"; the originals are in the pre-1.5.4 source backup.
- **F153-4 (Low).** "pick / set / choose / select X as (the / our / my / a) (new / team / next / vice / official) captain (of …)" → the read-only refusal, e.g. "pick Aarav as the team captain", "set Rohan as team captain", "Pick Meera as the new captain of Holdout Hawks". "Who is the captain of …" and "how do I pick a new captain" are unchanged.
- **F153-5 (Low).** "what was the score 25-23 set" → live scores without looking for a team called "set": score pairs are removed before the team name is taken, and a name made only of set / generic / ordinal words ("set", "3rd set", "deciding set") is not a team.
- **F153-6 (Low, a11y).** On the invitee's Home screen, "Join team" / "Decline" read as "Join Fresh Falcons" / "Decline Fresh Falcons" (HI: "Fresh Falcons में शामिल हों" / "Fresh Falcons का न्योता ठुकराएँ"). The visible titles are unchanged. Button gained an optional accessibilityLabel.
- **Disputed paraphrases (optional item).** "If the admin approves my rejected match, will it count?" and "What happens after I reject a result?" now get the "disputed" FAQ answer instead of my matches / results.
- Not changed (as asked): "Blue Jays 98765 43210" (product call for Akshit); the dev-auth token stays dev only.

## Migrations
- None in 1.5.4. 0024–0028 are still pending production approval; nothing deployed.

## Verification (each suite alone, scripts/finish154.sh)
- tsc app + server clean
- jest: 2138 passed, 2138 total (164 suites); tz: 5 zones × 2138 pass
- server: pass 494 / tests 494 (incl. new ask154 16)
- rules: 226 passed, 226 total; policy: all suites passed
- Ask eval (docs/qa/ask-eval-1.5.4.jsonl, mock, local :3306): 231/233 (99.1%). New fix154 16/16. New held-out holdout154 12/12 (written and frozen before the first run: docs/qa/ask-eval-holdout154.frozen.jsonl, sha256 d7c21bd587f425eb2c1c647beabea813723af6c37f8d4de5bf7e8e596a7762fe; not tuned). holdout153 12/12. Misses: holdout151-05 and holdout151-12.
- contrast scan: SUMMARY checked=268 failures=0 skipped=0
- mkzip refusal test (scripts/test_mkzip.py, scratch copy): 36/36
- New in this release: jest pii154 55, intents154, invite154 3, fixes154chat 18; pii152 / pii153 updated for comma lists; server ask154 16

## Open
- Held-out misses (untuned, unchanged): holdout151-05 (substitutes → privacy refusal), holdout151-12 (am I playing live → all live matches). holdout153-10 is fixed by F153-4.
- Product call for Akshit: "Blue Jays 98765 43210" (a team name with a spaced 5+5 phone). Only Ask masks it ("Blue Jays [phone hidden]" in Ask answers / cards); the team screens, GET /teams/:id and the invite labels show team names as typed, pending Akshit's decision. (Wording corrected in 1.5.5; team-name behaviour unchanged.)
- Trade-offs: phone-shaped comma lists are masked (above). "9-8 7-6 5-4 3-2 1-0", written as five score pairs, is kept as a score line.
- Local harnesses (qa-runs) were not re-run for 1.5.4; the API-level checks are server/tests/ask154.test.ts and the eval.
- Info carried over: the "N of M" invite label counts all invites; rate-limited audit rows have provider "-"; punycode TLD fragment after an IDN e-mail mask; Firestore rules have no current-captain / challenge-accept check (API / demo only); HI copy needs a native-speaker review; real LLM providers untested live.
