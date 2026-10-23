# VolleyLive 1.5.6 (versionCode 51)

Fixes for the Tester's "1.5.5 retest" (/workspace/volleylive-qa-report/fixes-retest.md). Same signing cert as 1.5.5 (fac61745…033b9c); no new keys, no accounts, no new migrations, nothing deployed.

## Fixes
- **F155-1 (Medium) – one grouped-phone detector (src/core/pii.ts).**
  - Digit groups joined by ANY run of characters that are neither letters nor digits (any length, any mix) are one candidate: "call 98765|43210", "+91|98765|43210", "987#654#3210", "98765 • 43210", "+91·98765·43210", "98|76|54|32|10", "9876*543*210", "98765~43210". The separators are stripped and the total is checked against the phone shape: 10 digits starting 6–9, any grouping, optional 0 / 91 / 091 / 0091 / + prefix. Single digits keep their own pass (same separator rule).
  - Before detection, valid dates, times, IPv4 addresses (octets ≤ 255) and UUIDs are blanked, so "06:30, 07:45, 09:00", "09/10/2026, 07/11/2026", "10.0.0.1:8080" and uuid lists stay. This also fixes the Tester's Info: an IPv4 list such as "0.0.0.0 | 64.120.64.128" is no longer masked. A whole run that is exactly one phone is still masked even if a part of it looks like a time ("9876 12:34 98").
  - Score / time pair lines ("25-23, 25-20", "8-6 5-7 …") and labelled lists of numbers up to 2 digits with spaced separators ("Jersey 66 | 77 | 88 | 99 | 10", "Seeds 7, 8, 9, 10, 11", players / courts / rallies / rounds / pools / groups / ranks / lineup / roster) stay unless a phone cue comes right before them. Team names are not a list label ("Team 65 86 32 34 45" is masked).
  - Masked everywhere maskPii / maskPiiStored are used: the POST response question, ask_history and ask_audit, GET /ask/history (old rows on read), the optimistic chat bubble (API and demo / local host), Ask answers / cards incl. team names. Ids are never masked.
  - Tests: jest pii156 – the Tester's shapes; property test over 20 000 phones with random groupings (5+5, 3-3-4, 4-3-3, 3-4-3, 2×5, 4-6, 6-4, 2-4-4, 4-4-2, 2-3-2-3, 3-3-2-2, 10) × random separator runs of 1–12 characters from a pool of ASCII / Unicode punctuation, symbols and spaces × optional +91 / 0 / 91 prefix; keep fuzz (5 000 each) for time lists, date lists, IPv4 lists, UUID lists, realistic score lines, big-score lines, seed lists, bracket pairings, jersey lists, versions, short lists; the Tester's keep list.
- **F155-2 (Low) – score lines, cues, long runs.**
  - reachableScoreLine follows the match: it tracks who wins each set and treats a line as impossible once the match would already be over, with best-of-3 / best-of-5 and a separate decider-set target. The rules are configurable (SCORE_LINE_RULES: bestOf [3, 5], maxTarget 9, winBy 2, point cap allowed). "9-7 9-6 6-9 9-5 5-3" is masked; "9-7 6-9 9-5 7-9 5-3" (2-2 then the decider) stays unless cued.
  - Behaviour change: the old example "8-6 7-5 9-7 6-4 8-6" has one side winning three straight sets and then two more sets, so it is now an impossible match and is masked. Tests (pii152–155, server ask154 / ask155) and the eval world text / items f151-4-03 and f154-2-03 use the realistic "8-6 5-7 9-7 6-8 8-6" instead. The frozen held-out item holdout155-06 still expects the old line to stay and was not edited – it fails by design (see Open).
  - New cues: ph, tel, DM, msg / message, ping (incl. "msg me", "ping me on") and HI / Hinglish forms (फ़ोन, डीएम, मैसेज, पिंग, msg karo, ping karna), plus up to 6 filler words between the cue and the digits ("call me later, the score was …", "My contact is below" + newline).
  - Separator runs between single digits may be any length (10 or more characters are masked too).
- **F155-3 (Low) – set-type words.** tie-break, tiebreak(er), golden, decider, deciding, final, last, super, silver, sudden death (+ HI टाई ब्रेक, गोल्डन, फ़ाइनल, निर्णायक, आख़िरी, अंतिम) never become a team name. "<type> set" is a set, not a tournament final: "what was the final set score of Juhu Spikers" → live_score for "juhu spikers". When a named team is not live, live_score now returns its latest finished match ("… is not playing live right now. Latest match: A 2–1 B (25-23, 20-25, 15-13; final set 15-13), confirmed.") with its scoreboard card. New optional ToolHost.recentMatches: on the server it is the same viewer-scoped match loader as liveMatches with status finished (latest 200); the app host falls back to the viewer's own matches. "Golden Eagles" stays a team name.
- **F155-4 (Low) – captain changes, intent-based.** A captain-family word (captain, captaincy, skipper, armband, kaptaan, कप्तान, कप्तानी, कैप्टन …) plus any change verb (hand over, switch, swap, replace, change, transfer, give, pass, assign, appoint, make, set, update, let … be, should be, de do, saunp do, bana do, badal do, सौंप दो, बदल दो, दे दो, बना दो …) or an assignment ("CAPTAIN = Meera", "set captain: Rohan") → read-only refusal, no tools. Questions are not refused: a question word at the start (who / what / how / when / which / is / does / can … / kaun / kya / kaise / कौन / क्या / कैसे), "sakte / सकते", or a trailing "?" without a polite lead-in ("can you … / please …" are still requests). Every Tester negative routes as in 1.5.5.
- **F155-5 (Low) – scripts/mkzip.py hardened.**
  - Names and paths are NFKC-normalised, zero-width / format characters removed, Unicode dashes turned into "-", Cyrillic / Greek look-alike letters folded to Latin, then lower-cased before every check (".еnv", "．env", "app.аpk", "local.sqlitе", "firebase.qa62.jsоn", "qa‐runs/", "QА-RUNS/").
  - Refused (exit 2, no zip written, every match listed):
    1. any symlink (file, directory or dangling); any hard link – a file with more than one link (nlink > 1), wherever the other link is
    2. any name with "env" as a token (split on anything that is not a letter or digit: .env*, *.env, env, prod_env, app-env.json …), except .env.example
    3. backups / editor leftovers: .bak .backup .orig .old .swp .swo .save .rej ~
    4. keys / keystores / packages (*.pem *.key *.p12 *.pfx *.jks *.keystore *.p8 *.mobileprovision, "keystore" in the name, *.apk *.aab)
    5. local databases (*.sqlite *.sqlite3 *.db + -wal / -shm / -journal)
    6. firebase*.json other than ./firebase.json, google-services.json, GoogleService-Info.plist, .firebaserc
       Items 4–6 also match behind extra suffixes (.bak .backup .orig .old .swp .save .copy .tmp ~ .<digits> .gz .zip .tar .tgz .7z .txt).
    7. QA harness copies: qa-runs/ or qa_*/ folders in any case (empty ones too); code files reading E2E_* or naming the QA probe / report folders; E2E_* assignment lines, now also with spaces around "=", or E2E_* reads from the process environment in any text file
    8. QA URLs in any text file, after decoding UTF-8, UTF-8 with BOM, UTF-16 and UTF-32 LE / BE (BOM or NUL pattern): a QA port (3307 8088 8089 4100 4101 8080) on 127.0.0.0/8 in any inet_aton form, localhost / *.localhost, 0.0.0.0, host.docker.internal or an IPv6 loopback. The text is scanned as written, then after URL-decoding (repeated), HTML-entity decoding, zero-width removal, NFKC (full-width letters / digits) and look-alike folding, and once more with line breaks and backslash-newline continuations removed (a host and port split across lines, a host name split across lines, a shell continuation inside the port). Prose like "the QA port :3307" is not a URL.
    9. secrets by content: PEM private-key blocks, PGP private key blocks, service-account JSON – and any of these base64-encoded (long base64 runs, also wrapped over lines, are decoded and checked)
    10. u_<hex> / dev_<digits> folders and avatars / photos *.meta.json outside uploads/
    11. *.tsbuildinfo, .DS_Store
    12. anything the project's .gitignore files ignore
  - This list matches the script's docstring. scripts/test_mkzip.py works on a scratch copy and always removes it: 121 refusal plants (every evasion the Tester listed, created as real files – look-alike names, env tokens, PGP / base64 keys, split / encoded / full-width / zero-width / UTF-32 URLs, spaced E2E_ lines), 5 empty folders, 4 symlinks, 2 hard links (to a file outside the tree, two names inside it), allowed look-alikes (environment.md, envelope.ts, an encoded local URL, harmless base64, UTF-32 prose, E2E_ prose) and quiet skips. It runs in step 4 of finish156.sh before the zip.

## Migrations
- None in 1.5.6. 0024–0028 are still pending production approval; nothing deployed.

## Verification (each suite alone, scripts/finish156.sh)
- tsc app + server clean
- jest: 2394 passed, 2394 total (170 suites); tz: 5 zones × 2394 pass
- server: pass 540 / tests 540 (incl. new ask156 27)
- rules: 226 passed, 226 total; policy: all suites passed
- Ask eval (docs/qa/ask-eval-1.5.6.jsonl, mock, local :3306): 309/312 (99.0%). New fix156 26/26. New held-out holdout156 19/19 (written and frozen before the first run with separators, groupings and wordings not used in the fixes: docs/qa/ask-eval-holdout156.frozen.jsonl, sha256 160cd6c1944b213331756c5406e110ee01fcb24f4240250b53ec3e940c96f8c5; not tuned). holdout155 11/12, holdout154 12/12, holdout153 12/12. Misses: holdout151-05, holdout151-12 (old, untuned), holdout155-06 (by design, see Open).
- contrast scan: SUMMARY checked=268 failures=0 skipped=0
- mkzip refusal test (scripts/test_mkzip.py, scratch copy): all checks pass (121 refusal plants), see step 4 log
- New in this release: jest pii156 (72: Tester shapes, 20k random grouping × separator property test, 11 × 5k keep fuzz, progression / cues / long runs), intents156 57, fixes156chat 28; pii152–155 expectations moved to the realistic score line; server ask156 27

## Open
- Product call for Akshit: phone-shaped team names ("Blue Jays 98765 43210", "Pipe 98765|43210"). Ask masks them; team screens, GET /teams/:id and the invite labels show them as typed (unchanged).
- holdout155-06 (frozen 1.5.5 held-out item, "we won 8-6 7-5 9-7 6-4 8-6") fails by design: under F155-2 that line is an impossible match and is masked. Not edited, because frozen items are never changed.
- Held-out misses (untuned): holdout151-05 (substitutes → privacy refusal), holdout151-12 (am I playing live → all live matches).
- Trade-offs / Info:
  - a labelled list of up to 2-digit numbers ("Jersey 98 | 76 | 54 | 32 | 10", "Players 98, 76, 54, 32, 10") is kept without a cue (the Tester's jersey-list keep); with a cue it is masked;
  - a phone glued to letters ("98765 43210abc") or with an id prefix ("u_9876543210", masked as before) follows the 1.5.5 behaviour;
  - a phone whose groups contain a full valid date plus extra groups ("987 12-10-2026 …") is only caught when the whole run is the phone;
  - live_score's latest-match fallback on the server looks at the latest 200 finished matches; the app (offline / demo) host uses the viewer's own matches only;
  - ™ / ℠ between digits (NFKC → letters); keycap / Roman-numeral stray characters (pre-existing Info);
  - scripts/test_mkzip.py now takes about 10 minutes (one full mkzip run per plant).
- Carried over: the dev-auth token accepts 9 digits; "N of M" counts all invites; the HMAC audit path is untested (no key, by design); Firestore rules have no current-captain check; the HI copy needs a native-speaker review; real LLM providers are untested live.
- Local harnesses (qa-runs) were not re-run for 1.5.6; API-level checks: server/tests/ask156.test.ts and the eval.
