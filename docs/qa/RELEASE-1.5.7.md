# VolleyLive 1.5.7 (versionCode 52)

Fixes for the Tester's "1.5.6 retest" (/workspace/volleylive-qa-report/fixes-retest.md, read only). Same signing cert as 1.5.6 (fac61745…033b9c); no new keys, no accounts, no new migrations, nothing deployed or pushed.

## Fixes
- **F156-1 (Medium) – one-digit groupings; display = stored (src/core/pii.ts).**
  - A digit run whose groups include a 1-digit group (1-9, 9-1, 1-3-3-3, 1-4-5 …) is a phone candidate with any separator and any prefix (+91, 91, 0, 0091, 091, "(+91) ", "+91-"): "call me 9-876543210", "whatsapp 9-876-543-210", "9.876.543.210", "987654321-0", "+91 9-876543210". A 1-digit group (other than a leading 0 / country code) counts only when the same run also has a group of 3 or more digits, so score lines ("9-7 6-9 …") and number lists stay. "+" counts only at the start of a run.
  - maskPii (display text, chat bubble, POST response, answers / cards) now IS the stored masker (maskPiiStored), so "9 876543210" is masked in the stored copy and on screen alike.
  - Behaviour change: anything the stored masker hid before is now hidden on screen too – e.g. 10 or more single digits separated by spaces ("9 8 7 6 5 4 3 2 1 0"). pii152–155 display-keep expectations were updated to display = stored.
  - Tests: jest pii157 – the Tester's examples and the full matrix of 14 groupings (5+5, 2-3-5, 4-6, 6-4, 3-3-4, 1-9, 9-1, 2×5, 3-4-3, 4-3-3, 2-4-4, 2-2-3-3, 1-3-3-3, 10) × 56 separators (incl. zero-width space, newline, tab, NBSP, emoji, " - ", " | ", a 10-dash run) × 9 prefixes × bare / in a sentence = 14,112 rows, 0 failures; display = stored checks.
- **F156-2 (Medium) – team lookup by name-match quality (src/core/ask/tools.ts pickTeam).** An exact case-insensitive team name wins; otherwise the best fuzzy name score; date (finished, else started, else created) only orders matches of the chosen team. When teams score within 0.05 of the best ("Juhu" → Juhu Herons, Juhu Hornets) Ask lists up to 6 candidates and asks which one ("Several teams match: … Which one do you mean?" / HI) instead of guessing; the same for live matches. Tests: jest intents157, server ask157.
- **F156-3 (Low) – a phone cue overrides the exceptions.** A cue before OR after the run ("call me …", "… is my number") makes a phone-shaped run masked even when it looks like a jersey / seeds list, an IPv4 address, a time list or a date: "Jersey 98 | 76 | 54 | 32 | 10 is my number", "Seeds: 98, 76, 54, 32, 10 … my number", "call me 98.212.143.21", "98.76.54.32 10" and "09:87:65:43:21" after a cue.
- **F156-4 (Low) – trailing cues; mixed runs.** Cues after the digits count (up to 3 words between, within 50 characters; "number one", "number of sets" are not cues). Mixed score-pair + group runs totalling 10 digits in a phone shape are masked ("9-7 6-9 9-5 4321"). "9-7 9-6 6543" has only 8 digits and stays.
- **F156-5 (Low) – window order and direct team lookup (server).** The recent window (latest 200 finished matches) is ordered by COALESCE(finished_at, started_at, created_at) instead of updated_at (there is no ended_at column), so an old match edited recently no longer jumps ahead. A team not in the window is looked up directly: host.teamMatches selects that team's finished matches by side name (read-only SELECT through the same viewer-scoped loader, up to 100). The app (offline / demo) host still uses the viewer's own matches.
- **F156-6 (Low) – captain intent (src/core/ask/intents.ts, agent.ts, guides.ts).**
  - Change requests are refused before the how-to check, also when question-shaped or suggested: "switch captain to Rohan?", "how about you make Meera captain", "why not make Rohan captain right now", "is it possible to make Meera captain now? do it", "when you get a chance, switch captain to Rohan", "Meera = captain", "captain -> Rohan", "do it: Meera captain", "Rohan → captain". The refusal explains how captains work.
  - Questions about who the captain is or how captains change / are picked ("steps to change captain", "change captain how?", "Explain how captaincy transfer works", "how can I transfer captaincy?", "kya main captain badal sakta hoon?", "which screen lets me switch captain?", "captain kaun hai?") are answered from the new guide-captain (EN + HI): the team creator is the captain, there is no transfer screen, match captains are picked in New match before the first rally. "Who is the captain of <team>" → that team's roster (names the captain). Captain questions never get the fair-play FAQ. Sentences that only mention captains ("How does the scorer desk help captains?") stay normal knowledge questions.
- **F156-7 (Low) – scripts/mkzip.py env rule and string joins.**
  - Refused by name (class 2): .env* and *.env (only .env.example ships), and any other name with "env" as a token unless it ends in a source / docs extension (.ts .tsx .js .jsx .mjs .cjs .mts .cts .d.ts .py .kt .java .swift .json .md .mdx .rst). env, ENV, prod_env, env.local, env.production, env.local.txt and prod_env.yml are still refused; env.ts, env.d.ts, vite-env.d.ts, ENV.md, check-env.js, env.test.ts, env-config.ts, app.env.ts, ENV_KEYS.ts, env_hi.json, app-env.json ship. Every file's content is still scanned (an env.ts with a QA URL is refused).
  - The QA-URL scan has one more text variant: adjacent string literals joined (closing quote, optional "+", line breaks or backslash-continuations, opening quote – single, double or backtick quotes, and Python implicit concatenation), so a QA host and port split across two literals on one line or two lines is caught.
  - scripts/test_mkzip.py: 130 refusal plants (config/app-env.json moved to the allowed files; +3 dotenv-style names, +1 env.ts with a QA URL, +6 split-literal URLs), 32 allowed files incl. the Tester's false-positive list and a harmless concatenation. The script docstring matches this list.

## Migrations
- None in 1.5.7. 0024–0028 are still pending production approval; nothing deployed.

## Verification (each suite alone, scripts/finish157.sh)
- tsc app + server clean
- jest: 2514 passed, 2514 total (173 suites); tz: 5 zones × 2514 pass
- server: pass 560 / tests 560 (incl. new ask157 20)
- rules: 226 passed, 226 total; policy: all suites passed
- Ask eval (docs/qa/ask-eval-1.5.7.jsonl, mock, local :3306): 354/358 (98.9%). New fix157 27/27. New held-out holdout157 18/19 (written and frozen before the first run at 02:40 UTC-5 with separators, groupings and wordings not used in the fixes: docs/qa/ask-eval-holdout157.frozen.jsonl, sha256 fae7f99921a9a35b2d9e6c501e099819103c9cbf375a8773c52105cc4c637f07; not tuned; the miss is the malformed 9-digit item holdout157-04). holdout156 19/19, holdout155 11/12, holdout154 12/12, holdout153 12/12, holdout152 12/12, holdout151 12/14, holdout 16/16. One own fix item (f156-4-02) was corrected before the final run: its score line "9-7 9-6 …" is an impossible match that 1.5.6 deliberately masks.
- contrast scan: SUMMARY checked=268 failures=0 skipped=0
- mkzip refusal test (scripts/test_mkzip.py, scratch copy): see step 4 log (130 refusal plants)
- New in this release: jest pii157 48 (incl. the 14,112-row matrix), intents157 42, fixes157chat 30; server ask157 20

## Open
- Product call for Akshit: phone-shaped team names ("Blue Jays 98765 43210", "Pipe 98765|43210"). Ask masks them; team screens, GET /teams/:id and the invite labels show them as typed (unchanged).
- Display = stored (F156-1) hides on screen whatever storage hid, incl. 10+ single digits separated by spaces (e.g. a typed rally sequence); fewer than 10 digits stay.
- holdout157-04 ("87654321~0 show my matches") fails because the frozen item itself is wrong: it has only 9 digits, so it is correctly not masked. Not edited (frozen).
- holdout155-06 (frozen 1.5.5 item, "8-6 7-5 9-7 6-4 8-6") still fails by design (impossible match → masked since 1.5.6).
- Held-out misses (untuned): holdout151-05 (substitutes → privacy refusal), holdout151-12 (am I playing live → all live matches).
- Trade-offs / Info:
  - "9-7 9-6 6543" (8 digits) is not a phone; a phone whose groups contain a full valid date plus extra groups is only caught when the whole run is the phone or cued;
  - the ambiguity gap is 0.05 of the name score; "What does a captain do?" goes to the normal knowledge search (team guide);
  - Tester Info items not in scope and unchanged: .npmrc tokens, AWS credential files, hex-encoded PEM, base64-encoded URLs, ip6-localhost, E2E_API as a JSON key, a QA-report path in a .md file;
  - scripts/test_mkzip.py takes about 11 minutes (one full mkzip run per plant).
- Carried over: the dev-auth token accepts 9 digits; "N of M" counts all invites; the HMAC audit path is untested (no key, by design); Firestore rules have no current-captain check; the HI copy needs a native-speaker review; real LLM providers are untested live.
- Local harnesses (qa-runs) were not re-run for 1.5.7; API-level checks: server/tests/ask157.test.ts and the eval.
