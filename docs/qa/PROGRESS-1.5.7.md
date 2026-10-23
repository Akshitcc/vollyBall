# PROGRESS 1.5.7 (vc52) – Tester "1.5.6 retest" fixes

Backups: volleylive-latest.apk.bak52, volleylive.zip.bak66, backups/volleylive-1.5.6.{apk,zip} (9febcdb4… / 7975b0d6…), backups/volleylive-src.pre157.tar.gz, scripts/mkzip.py.pre157, scripts/test_mkzip.py.pre157.

- [x] F156-1 (Medium) one-digit groupings masked (src/core/pii.ts windowHits: a 1-digit group only with a 3+ digit group; "+" only at a run start); maskPii = maskPiiStored (display = bubble = response = stored). pii157 matrix 14 groupings × 56 separators × 9 prefixes × bare/sentence = 14,112 rows, 0 failures; older pii suites updated for display = stored.
- [x] F156-2 (Medium) team lookup ranked by name-match quality (pickTeam: exact case-insensitive → best fuzzy score → date tie-break); several equal matches → "which team?" with the candidates (EN + HI). Tests: intents157, server ask157.
- [x] F156-3 (Low) explicit phone cue before OR after overrides jersey / seeds / IP / time exceptions (cuedShape). Tests: pii157, fixes157chat.
- [x] F156-4 (Low) trailing cues ("… is my number"); mixed pair + group runs of 10 digits in a phone shape masked ("9-7 6-9 9-5 4321"). Tests: pii157.
- [x] F156-5 (Low) window ordered by COALESCE(finished_at, started_at, created_at) (there is no ended_at column); team outside the window → host.teamMatches (match_sides name LIKE, read-only SELECT, viewer-scoped loader). Tests: intents157, server ask157.
- [x] F156-6 (Low) captain: change requests refused in question / suggestion / assignment / arrow forms; how-to and "who is captain" questions → new guide-captain (EN + HI); "who is the captain of <team>" → team roster; never the fair-play FAQ. Tests: intents157, server ask157; intents152–156 unchanged and passing.
- [x] F156-7 (Low) mkzip: env rule refuses only dotenv-style names (source / docs extensions ship, content still scanned); adjacent string literals joined before the QA-URL scan. test_mkzip: 130 plants (−config/app-env.json, +10), 32 allowed files incl. the Tester's false-positive list; real-tree dry run clean (679 files).
- [x] fixes157chat bubble test (EN + HI, API + demo host) 30/30.
- [x] app.config.ts 1.5.7 / 52.
- [x] Pipeline START=1 STOP_AFTER_SCAN=1: suites ok (jest 2514/173, server 560, rules 226, policy, tz), eval 354/358, scan 268/0/0. RELEASE-1.5.7 written.
