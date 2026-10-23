# VolleyLive 1.5.1 (versionCode 46)

Fixes for the Tester's "1.5.0 retest" (/workspace/volleylive-qa-report/fixes-retest.md). Same signing cert as 1.5.0; no new keys.

## Fixes
- **F150-1 (Medium) – only the challenged captain's Accept creates/links the match.** New atomic `POST /api/challenges/:id/accept` {match}: locks the challenge row, requires the actor to be the challenged captain and creator, a pending challenge with no match, and matching teams; creates the match and links it (status accepted, match_id) in one transaction. `POST /matches` with a challengeId is always refused (409 `challenge_pending`, or the closed/used/not-captain code). A respond PATCH never links a match (accepting a pending one gives 400 `challenge_accept_match`), so Decline/Cancel can never leave a linked match. Demo backend mirrors this (createMatch checks the challenge first; acceptChallenge is atomic). New db-audit check `challenge.match_accepted` (32 checks; db-audit.sql regenerated; DB-AUDIT-1.4.26 "1.5.1 update"); auditSim reports the challenge scenarios.
  - Compatibility: a 1.5.0 app's two-step accept (create then respond) now gets 409 `challenge_pending` – users must update to 1.5.1 to accept challenges.
  - Firestore rules still do not enforce the link (firebaseBackend keeps create-then-respond) – API only, as V1426-3.
- **F150-4 (Medium) – PII masking.** Shared `src/core/pii.ts` masks every Indian phone format (+91/91/0/0091 prefixes, spaces, dashes, bare 10-digit) and e-mails as [phone hidden]/[email hidden] in the Ask audit (question and tools JSON) and in answers/cards.
- **F150-7 (Medium) – my results.** Ask answers "What are my last results?", "मेरे पिछले नतीजे क्या हैं?" and "mere pichle result kya hain" via my_matches (past). Every result carries its status (confirmed / awaiting confirmation / POTM pending / under admin review / disputed / voided) in the answer and on the fixture card (`ask-fixture-result-*`); a voided or disputed result never reads as plainly "Your last match".
- **F150-2 (Low-Medium)** – teamRecord splits pending into awaiting / review / disputed / POTM pending (EN/HI copy on the team screen); voided and no-winner results are not counted.
- **F150-3 (Low)** – demo: only the invitee can decline their own invite (no-op otherwise).
- **F150-5 (Low)** – "can" no longer triggers a team lookup; deciding-set question → 15-point rule note; minimum-age question → registration FAQ (age 10), not the OTP text.
- **F150-6 (Low)** – confirm / approve / verify / mark-finished requests (EN, HI, roman) get the read-only notice plus a pointer to the right screen.
- **Nits** – a second Join on the API returns an idempotent 200 with the team; Ask `lang` must be en or hi (else 400 `ask_lang`).
- **Known misses** – "show the ranking" → leaderboard; "is my match live" → the viewer's own live matches only ("None of your matches is live right now." otherwise).

## Migrations
- None in 1.5.1. 0024–0027 still pending production approval as before; nothing deployed.

## Verification (each suite alone, scripts/finish151.sh)
- tsc app + server clean
- jest: 1853 passed, 1853 total (153 suites); tz: 5 zones pass
- server: pass 445 / tests 445 (incl. challenge150 7, fixes151 15, dbaudit1426 20, social 9)
- rules: 226 passed, 226 total; policy: all suites passed
- Ask eval (docs/qa/ask-eval-1.5.1.jsonl, mock provider, local :3306): 149/151 (98.7%) – 1.5.0 items 121/121, new fix151 items 16/16, new held-out holdout151 12/14. The old holdout is 16/16, but holdout-05/06 were named in the retest so they are no longer blind; holdout151 was written and frozen before the first run and not tuned afterwards.
- contrast scan: SUMMARY checked=268 failures=0 skipped=0
- New in this release: jest fixes151 core 42, fixes151ui + invites150 F150-3 11, challenge150 demo +2; server fixes151 15, challenge150 rewritten (7)

## Open
- Held-out misses (left untuned): "What's the maximum number of substitutes?" → privacy refusal (the word "number" trips the private-details guard); "am I playing live right now" → all live matches (live_score) instead of the viewer's own.
- "How do I change my phone number?" retrieves the match-edit FAQ – no KB article exists (predates 1.5.1).
- OTP validity is answered as I-don't-know (not in the knowledge base).
- HI texts need a native-speaker review; real LLM providers untested live.
- Firestore rules do not enforce the challenge accept (above).
