# VolleyLive 1.5.3 (versionCode 48)

Fixes for the Tester's "1.5.2 retest" (/workspace/volleylive-qa-report/fixes-retest.md). Same signing cert as 1.5.2; no new keys, no accounts, no real ASK_AUDIT_HMAC_KEY (placeholder only). One new migration, additive / relaxing only (0028).

## Fixes
- **F152-1 (Medium) – spaced single-digit phones (src/core/pii.ts).**
  - New digit-TOKEN runs: whitespace-separated single digits, a leading "+" / "+ 9 1" / 0 / 91 prefix, and digit words. Hyphens, commas and colons end a run, so set scores ("8-6 7-5") and comma lists are never one run.
  - Display text (answers, card strings incl. team names, source titles) – `maskPii`: phone-SHAPED runs only (10 digits starting 6-9, optionally 0 / 91 / +91 in front). "Club 9 8 7 6 5 4 3 2 1 0" → "Club [phone hidden]".
  - Stored / returned copies – new `maskPiiStored`: also EVERY run of 10+ spaced single digits or digit words, phone-shaped or not. Used for ask_history (chat + the POST response question), GET /ask/history (on read, so old rows too), ask_audit.question and the audit tools JSON, the on-device history (demo / Firebase), and mask-ask-history.ts.
  - Id fields are never masked (filterPii ID_KEY unchanged). Also fixed while running the Tester's fuzz59 locally: an all-digit UUID whose middle groups read as 91 + a mobile was masked in display text in 1.5.2 (≈1 in 50k) – UUID-shaped tokens are now never masked.
  - Trade-off (documented): "points 6 7 8 9 6 7 8 9 6 7" is phone-shaped under the rule and is now masked (it was a keep item in pii58 / pii59). Comma lists, fewer than 10 digits, dashed set scores and multi-digit score runs ("25 23 25 20") stay.
- **F152-2 (Low) – masker gaps + audit hash.**
  - "plus91…" / "plus 91 …" glued or spaced reads as "+"; digits mixed with words ("98 one two three 45678"); "double / triple X"; English, Hindi (शून्य … नौ) and Hinglish (shunya … nau) digit words. Display: phone-shaped runs; stored history / audit: any run of 10+ digits (best effort).
  - ask_audit.question_sha = HMAC-SHA256(ASK_AUDIT_HMAC_KEY, question). No key → NULL (never an unsalted hash). The .env.example value is a placeholder: it counts as empty, is refused in production, and keys under 32 characters are refused. Never logged.
  - Migration 0028_ask_audit_hmac.sql: question_sha becomes NULLable (same CHAR(64)). Old unsalted rows: `server/scripts/null-ask-audit-sha.ts` (local only: localhost:3306 *_test / *_audit; dry run by default, `--apply`, `--before=<go-live>`; only sets question_sha to NULL) + docs/DEPLOY.md "1.5.3" section. Running it on any real database needs separate approval.
  - Not changed (Info): the punycode TLD fragment after an IDN e-mail mask.
- **F152-3 (Low) – disputed copy.** helpFaq "Flagged for review" (EN/HI) no longer lists disputed as approvable; new FAQ "Does a disputed result count if an admin approves it?" (EN/HI: no – it doesn't count even if a flag on it is approved; an admin can void it); the "confirm" FAQ (rejected → disputed, doesn't count, admin can void); terms.fairPlayBody EN/HI; the Ask confirm/reject how-to (EN/HI). The Ask index re-syncs changed rows by content hash at start (tested). TERMS_VERSION not bumped: the terms are draft text and the rule itself didn't change – your call if re-acceptance is wanted.
- **F152-4 (Info).**
  - The leftover avatar (server/uploads/avatars/dev_919000001200/…, written by my local full58 run) is removed from the source and the zip. Checking the 1.5.2 zip against the project's .gitignore files: those 2 files were the only ignored / upload entries. scripts/mkzip.py now skips uploads/, tmp/, test-results/ … and refuses to write the zip if any entry is .gitignore-d or looks like a dev / test upload. Local harness APIs now run with STORAGE_DIR outside the source tree.
  - PATCH decline / cancel of a pending challenge by anyone but the current captain of that side (former captain, member, the other side) → 403 challenge_not_captain, same as accept. Closed challenges keep their errors.
  - "Choose a team colour tips" (and "… ideas / advice …", "a team colour / name / kit …" without a "to / as" target) is no longer refused as a change; "set the team name to X" still is.
  - Invites ending in the same 4 digits: "Withdraw invite 2 of 3, for the number ending 5678" (EN/HI), testID team-invite-withdraw-5678-2; unique ones unchanged.
- **F152-5 (Low, Tester's 1.5.2 UI pass) – optimistic chat bubble.** Right after sending, the user's bubble showed a typed number until a reload. Now the optimistic bubble is masked at once (same mask as the stored copy) and is replaced with the host's stored question when the reply arrives: the server's masked text (API), or askChatLocally's (demo / Firebase build). On an error the masked bubble stays. The rest of the Tester's 1.5.2 UI pass was PASS.

## Migrations
- 0028_ask_audit_hmac.sql (new): `ALTER TABLE ask_audit MODIFY COLUMN question_sha CHAR(64) NULL` – relaxing only, same type, re-run safe; 1.5.2 servers keep working against it. 0024–0028 pending production approval; nothing deployed.

## Verification (each suite alone, scripts/finish153.sh)
- tsc app + server clean
- jest: 2042 passed, 2042 total (160 suites); tz: 5 zones × 2042 pass
- server: pass 478 / tests 478 (incl. new ask153 16, fixes153 5; ask150 audit test updated for the HMAC / NULL hash; fixes142 lists 0028)
- rules: 226 passed, 226 total; policy: all suites passed
- Ask eval (docs/qa/ask-eval-1.5.3.jsonl, mock, local :3306): 202/205 (98.5%). 1.5.0–1.5.2 items 173/175 (unchanged); new fix153 18/18; new held-out holdout153 11/12, written and frozen before the first run (docs/qa/ask-eval-holdout153.frozen.jsonl, sha256 fda6526dba02033b4c3217b4852af14e1d5b37e26d41495d5cfbb256326f0c60), not tuned. Misses: holdout151-05, holdout151-12, and the new held-out miss **holdout153-10** "pick Aarav as the team captain" (not refused as a change: the "VERB <name> as captain" pattern doesn't allow "the team captain"; it answers with the create-team guide, writes nothing – left open, untuned). The scorer now also runs the app's masker over the display text and checks the stored ask_history / ask_audit copies (expect.stored).
- contrast scan: SUMMARY checked=268 failures=0 skipped=0
- New in this release: jest pii153 (fixed cases + seeded fuzz both directions: 6k phones as spaced digits / EN / HI / Hinglish words, 3k stored-only runs, 5k score lines / lists, 5k non-phone-shaped lists, 20k all-digit UUIDs, 20k ids), pii152 updated for the rule, fixes153ui 4, fixes153chat 6 (F152-5); server ask153 16, fixes153 5

## Local harness runs (Tester's v59 harnesses, fresh copies in /workspace/qa-runs/h153; API :4201, DB local :3306)
- Every copy has a guard (E2E_API = http://127.0.0.1:4201/api, E2E_OTP_API = http://127.0.0.1:4201, E2E_DB = volleylive_(e2e|otp)153_test); mysql 3307 → 3306, the v58 q.cjs → a local copy, requires from /workspace/volleylive. Grepped for QA ports / folders before running.
- run 47/47, full59 46/46, db59 18/18, tournaments 4 teams 12/12, 15 teams 42/42, 32 teams 13/13 (block 20), ch59 16/16, f3_59 11/11, ask59b 6/6, ask59c 16/16, ask59d 7/7 (2541 card ids, 0 corrupted).
- ask59 85 pass / 18 FAIL: 12 are its "question_sha = unsalted sha256" check (the intended F152-2 change – NULL without a key) and 6 are commands answered 429 (per-user Ask rate limit at harness speed); the same commands are refused in ask59c 16/16.
- ask59a 13/15 and f2_59 7/9: baseline items (Info "pichle natije dikhao" / "7 players on court"; the probe's "rejected then approved counts" assumption, disproved by the Tester).
- pii59 40 masked (all F152 leaks now masked), 18 kept, 1 flagged = "points 6 7 8 9 6 7 8 9 6 7" (masked by rule). pii58on59 47 / 21 / the same 1. fuzz59 0 UUIDs corrupted after the UUID fix (dev_91… uids in display text are masked, as accepted in 1.5.2).
- otp59 30/30 (AUTH_MODE=otp OTP_PROVIDER=dev, per-process random session secret, no secret in the log). db-audit 32/32 on both harness DBs; harness DB: 1451 audit rows, 0 with a question hash, 0 phone runs stored.

## Open
- Held-out misses (untuned): holdout151-05 (substitutes → privacy refusal), holdout151-12 (am I playing live → all live matches), and new **holdout153-10** "pick Aarav as the team captain" not refused as a change (the "as captain" pattern doesn't allow "the team captain"; Ask can't write, it shows the create-team guide).
- "my number is …, what are my teams?" goes to the own-number guide instead of my teams (routing unchanged since 1.5.2; the number is masked everywhere).
- Info carried over: rate-limited audit rows have provider "-"; punycode TLD fragment after an IDN e-mail mask; Firestore rules have no current-captain / challenge-accept check (API / demo only).
- HI copy needs a native-speaker review; real LLM providers untested live.
