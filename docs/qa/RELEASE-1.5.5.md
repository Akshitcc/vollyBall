# VolleyLive 1.5.5 (versionCode 50)

Fixes for the Tester's "1.5.4 retest" (/workspace/volleylive-qa-report/fixes-retest.md). Same signing cert as 1.5.4 (fac61745…033b9c); no new keys, no accounts, no new migrations, nothing deployed.

## Fixes
- **F154-1 (Medium) – no separator allow-list (src/core/pii.ts).**
  - 10 or more single digits joined by ANY run (1–9 characters) of characters that are neither letters nor digits are phone-shaped. That covers "|", "#", "*", "~", "+", ";", "•", "·", "\", "'", "=", "^", "@", "¤", "¦", Unicode dashes / symbols / spaces, bracketed digits "[9][8]…", "{9}{8}…", "<9><8>…" and any mix ("9–8|7:6#5—4_3/2.1-0"). An optional "+91" / "91" / "0091" / "+" prefix is included, also when it is glued to the first digit ("+916|1|…").
  - Masked everywhere 1.5.4 masked: the POST response question, ask_history and ask_audit questions, GET /ask/history (old rows on read), the optimistic chat bubble (API and demo / local host) and display text including Ask team names. Display: phone-shaped runs; stored copies: any 10+ run; comma-only lists only when phone-shaped. Ids are never masked.
  - Kept: set-score lines, multi-digit scores ("25-23 25-20"), fewer than 10 single digits with any separators, dates, times, versions, IPs and the Tester's keep list.
  - Info: "™" / "℠" between digits turn into the letters "TM" / "SM" under NFKC normalisation, so such a run isn't masked.
- **F154-2 (Low) – five score pairs that spell a phone.** "9-8 7-6 5-4 3-2 1-0" (and the –, : and comma forms) is masked in display and stored copies when:
  - a phone cue comes right before it (number, no., phone, mobile, cell, call, ring, dial, whatsapp, contact, reach, text, sms, nambar / numbar, नंबर, फोन, मोबाइल, कॉल, संपर्क …), or
  - the line can't be a real match: every set but the last must end under one points target (optionally with a point cap) with a 2-point lead, the last set under its own.
  - A reachable line without a cue stays as typed: "sets 8-6 7-5 9-7 6-4 8-6" (eval item f151-4-03 and the Tester's keep list).
- **F154-3 (Low) – score questions.** Set and score words, ordinals and HI / Hinglish fillers (set, सेट, score, स्कोर, ka / ki / kya / tha, का / की / क्या / था, pehle / teesre, पहले / तीसरे …) never become a team name. "set ka score kya tha" and "तीसरे सेट का स्कोर क्या था?" now get the live scores, and "what was the score 25-23 set Holdout Hawks" looks up Holdout Hawks.
- **F154-4 (Low) – captain changes.** Read-only refusal for "appoint / nominate / assign / elect / declare / promote / crown / name / make / pick / choose / select / set X as (the / our / new / team / vice) captain", "appoint / make / elect / promote X (the) captain", Hinglish "X ko (team ka / naya) captain set karo / banao / bana do / chuno" and HI "X को (टीम का) कप्तान चुनो / बनाओ / नियुक्त करो". Questions ("Who is the captain of …?", "captain kaise chunte hain", "name the captain of …") are unchanged.
- **F154-5 (Low) – scripts/mkzip.py hardened.** All name and path checks are case-insensitive.
  - Skipped quietly (never zipped): node_modules, .git, .expo, dist, build, web-build, android, ios, coverage, .firebase, uploads, tmp, .tmp, test-results, playwright-report, __pycache__, .cache, e2e-out (any depth, any case); *.log.
  - Refused (exit 2, no zip written, every match listed):
    1. any symlink (file, directory or dangling)
    2. any .env* or *.env file in any case (.ENV, .Env, prod.env, secrets.env …), except .env.example. These are now refused, not skipped.
    3. backups / editor leftovers: .bak .backup .orig .old .swp .swo .save .rej ~
    4. keys / keystores / packages (*.pem *.key *.p12 *.pfx *.jks *.keystore *.p8 *.mobileprovision, "keystore" in the name, *.apk *.aab)
    5. local databases (*.sqlite *.sqlite3 *.db + -wal / -shm / -journal)
    6. firebase*.json other than ./firebase.json, google-services.json, GoogleService-Info.plist, .firebaserc
       Items 4–6 also match behind extra suffixes (.bak .backup .orig .old .swp .save .copy .tmp ~ .<digits> .gz .zip .tar .tgz .7z .txt): key.pem.bak, app.apk.zip, app.apk.1, local.sqlite.bak, dev.db.gz, server.key.txt, firebase.qa61.json.bak, google-services.json.bak.
    7. QA harness copies: qa-runs/ or qa_*/ folders in any case (empty ones too); code files reading E2E_* or naming the QA probe / report folders; E2E_* assignment lines (E2E_API=…) or E2E_* reads from the process environment in any text file
    8. QA URLs in any text file, after decoding UTF-8, UTF-8 with BOM and UTF-16 LE / BE. That means a QA port (3307 8088 8089 4100 4101 8080) on 127.0.0.0/8 in any inet_aton form (127.0.0.1, 127.1, 127.0.0.2, 2130706433), localhost / *.localhost, 0.0.0.0, host.docker.internal, or an IPv6 loopback ([::1], [0:0:0:0:0:0:0:1], [::ffff:127.0.0.1]). Prose like "the QA port :3307" is not a URL.
    9. secrets by content: PEM private-key blocks, service-account JSON
    10. u_<hex> / dev_<digits> folders and avatars / photos *.meta.json outside uploads/
    11. *.tsbuildinfo, .DS_Store
    12. anything the project's .gitignore files ignore
  - This list matches the script's docstring. scripts/test_mkzip.py works on a scratch copy and always removes it. It covers every case the Tester listed: 98 checks (83 refusal plants, 5 empty folders, 4 symlinks, allowed prose / local URLs / UTF-16 without URLs, quiet skips). It runs in step 4 of finish155.sh before the zip.
- **Blue Jays (wording only).** RELEASE-1.5.4 said "Blue Jays 98765 43210" was "still shown as typed". Corrected: only Ask masks it ("Blue Jays [phone hidden]" in Ask answers / cards); the team screens, GET /teams/:id and the invite labels show team names as typed, pending Akshit's decision. Team-name behaviour is unchanged.

## Migrations
- None in 1.5.5. 0024–0028 are still pending production approval; nothing deployed.

## Verification (each suite alone, scripts/finish155.sh)
- tsc app + server clean
- jest: 2237 passed, 2237 total (167 suites); tz: 5 zones × 2237 pass
- server: pass 513 / tests 513 (incl. new ask155 19)
- rules: 226 passed, 226 total; policy: all suites passed
- Ask eval (docs/qa/ask-eval-1.5.5.jsonl, mock, local :3306): 265/267 (99.3%). New fix155 22/22. New held-out holdout155 12/12 (written and frozen before the first run with separators / wordings not used in the fixes: docs/qa/ask-eval-holdout155.frozen.jsonl, sha256 982d32d2370c21416df56fd75e7ba0b316cac86c4e787b5fa7a20c72ee002c93; not tuned). holdout154 12/12, holdout153 12/12. Misses: holdout151-05 and holdout151-12.
- contrast scan: SUMMARY checked=268 failures=0 skipped=0
- mkzip refusal test (scripts/test_mkzip.py, scratch copy): 98/98
- New in this release: jest pii155 (Tester shapes + property tests over random separator runs, 3 × 10k), intents155, fixes155chat 22; pii152 / 153 / 154 fuzz updated for F154-2; server ask155 19

## Open
- Product call for Akshit: phone-shaped team names ("Blue Jays 98765 43210", "Pipe 9|8|…"). Ask masks them; team screens, GET /teams/:id and the invite labels show them as typed. The Tester recommends refusing phone-shaped names at create / rename.
- Product call: phone-shaped comma lists ("points 6, 7, 8, 9, 6, 7, 8, 9, 6, 7") are masked (1.5.4 behaviour, kept).
- Held-out misses (untuned): holdout151-05 (substitutes → privacy refusal), holdout151-12 (am I playing live → all live matches).
- Info:
  - ™ / ℠ between digits (NFKC → letters);
  - "there is no 9 8 7 6 5 4 3 2 1 rule" is masked ("no" + 9 digits);
  - a phone split across a UUID's first dash ("98123456-7800-…") isn't masked;
  - a reachable five-pair score line without a cue word stays as typed even if it also spells a phone;
  - "Who is the captain of X?" gets the FAQ, not the captain's name;
  - "who won the set 25-20" goes to the standings;
  - a team name made only of set / score words (e.g. "Set Point") loses those words in live-score lookups.
- Carried over:
  - the dev-auth token accepts 9 digits;
  - "N of M" counts all invites;
  - the HMAC audit path is untested (no key, by design);
  - Firestore rules have no current-captain check;
  - the HI copy needs a native-speaker review;
  - real LLM providers are untested live.
- Local harnesses (qa-runs) were not re-run for 1.5.5; API-level checks: server/tests/ask155.test.ts and the eval.
