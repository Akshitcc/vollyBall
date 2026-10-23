# VolleyLive 1.5.2 (versionCode 47)

Fixes for the Tester's "1.5.1 retest" (/workspace/volleylive-qa-report/fixes-retest.md). Same signing cert as 1.5.1; no new keys. No new migrations.

## Fixes
- **F151-4 (Medium) – PII masker rework (src/core/pii.ts).**
  - Matching runs on a normalised copy and is mapped back to the original, so only the PII span changes. The copy applies NFKC (full-width digits, ＋, ＠, NBSP), turns every Unicode decimal digit into ASCII (Devanagari, Bengali, Arabic-Indic, …), removes format characters (zero-width, soft hyphen) and reads spelled-out English digits.
  - Phones are digit groups joined by spaces, dots, dashes (incl. – —), slashes and brackets ("+91 (98123) 45607").
  - Phone-shape rules: 10 digits starting 6-9; that with a 0 / 91 / 091 / 0091 prefix; or + with 8-15 digits. A 1-digit group is only allowed as a leading 0 or +country code, so set scores ("8-6 7-5 9-7 6-4 8-6") and number lists stay. A run glued to ASCII letters or digits (hex ids) is not a phone.
  - E-mails: Unicode / IDN ("राहुल@उदाहरण.भारत"), full-width ＠, quoted local parts, "name [at] domain [dot] com", spaced " @ " / " . ".
  - Display text only: answer text, card display strings, source titles, the audit question and the audit tools JSON (field by field). filterPii never touches id / routing fields (id, uid, *Id, *Ids, *_id, route, href, path, params), so card navigation ids stay intact. Admin FAQ text and team names in answers / cards are covered.
- **F151-6 (Medium) – Ask history masked.** The server stores the masked question in ask_history, the POST /ask/chat response returns it, and GET /ask/history masks on read too (rows from before 1.5.2). The on-device history (demo / Firebase build) stores the masked question as well. Existing rows: `server/scripts/mask-ask-history.ts` (local only: localhost:3306, *_test / *_audit; dry run by default, `--apply` UPDATEs the question only; no schema change, no deletes). Running it on any other database needs separate approval.
- **F151-1 (Low-Medium) – current captain at action time.** Challenge accept (POST /challenges/:id/accept), decline / cancel (PATCH) and the POST /matches claim check the teams' CURRENT captains (team row read FOR SHARE in the transaction), not the ids stored when the challenge was sent. After a transfer the former captain gets 403 challenge_not_captain and the new captain can act. Challenge lists return the current captains (the new captain sees Accept / Decline); an answered challenge records who answered. The demo backend does the same. Firebase build: firestore.rules still check the stored ids (documented gap, as V1426-3).
- **F151-2 (Low) – demo accept atomic.** One accept in flight per challenge: parallel taps by the same captain share it (one match, same id); a decline while an accept is in flight is refused; a later accept → challenge_used.
- **F151-3 (Low) – result copy matches the rules (EN/HI).** New state `reviewAwaiting`: flagged (e.g. under 10 minutes) and the other captain hasn't confirmed – shown as waiting for the other captain AND under admin review (team page line, Ask answer and card). `review` now means flagged + confirmed (counts once an admin approves – true). Disputed: "it doesn't count. An admin can void it." (an admin approve of a rejected result does not make it count).
- **F151-5 (Low) – read-only trigger narrowed.** mark / pick / choose / select / close / set / end / finish / start count as an instruction only as an imperative with an object (the/my/our/this… match / result / score / game / set / winner / toss / challenge / tournament / team …, potm / player of the match) or "VERB <name> as captain / POTM / winner". "Mark Fernandes stats", "Pick Pereira stats", "Close matches near me?", "Set rules for a deciding set?" route normally.
- **F151-7 (Low) – pending-invite remove button** has an accessible label: "Withdraw the invite for the number ending 5678" / HI (last 4 digits only), testID team-invite-withdraw-<last4>.

## Migrations
- None in 1.5.2 (server/migrations unchanged). 0024–0027 still pending production approval as before; nothing deployed.

## Verification (each suite alone, scripts/finish152.sh)
- tsc app + server clean
- jest: 1984 passed, 1984 total (157 suites); tz: 5 zones pass
- server: pass 457 / tests 457 (incl. fixes152 5, ask152 7)
- rules: 226 passed, 226 total; policy: all suites passed
- Ask eval (docs/qa/ask-eval-1.5.2.jsonl, mock, local :3306): 173/175 (98.9%) – 1.5.0 + 1.5.1 items 149/151 (unchanged: holdout151-05 / -12 open, untuned), new fix152 12/12, new held-out holdout152 12/12 (written and frozen before the first run). The scorer's PII check now skips id fields (ids are not display text – F151-4).
- contrast scan: SUMMARY checked=268 failures=0 skipped=0
- New in this release: jest pii152 87 (incl. fuzz: 20k ids, 5k phones in 5 digit scripts, 5k score lines), intents152 31, challenge152 (demo) 6, fixes152ui 7; server fixes152 5, ask152 7

## v58 harnesses on the local build (copies in /workspace/qa-runs; local API :4201, local DB :3306)
- pii58: 47/47 masked (audit path too), 22/22 kept (1.5.1: 13 leaks + 1 false positive).
- otp58: 30/30 (AUTH_MODE=otp OTP_PROVIDER=dev, per-process random session secret).
- ch58: X1 former captain accept 403 / new captain 201 (F151-1). The other 5 FAILs are the same as the Tester's 1.5.1 baseline (F1-M code wish-list; F2 states on harness-speed too_short matches).
- f2_58: "short + unconfirmed" → reviewAwaiting, "rejected → approved" stays disputed. 2 FAILs are the same as baseline (the probe's "approved after reject counts" assumption, which the Tester disproved → F151-3).
- ask58: F4-1 audit masking and F4-2 admin-FAQ masking now PASS. 3 remaining FAILs are as in the baseline (Info: "pichle natije dikhao", "7 players on court"; audit row count includes rate-limited rows).
- ask58b: injection-in-team-names 5/5. Its POTM part depends on the Tester's block data (not runnable locally).
- full58 46/46, db58 18/18, run 47/47 (81 matches), tournaments 4 teams 12/12, 15 teams 42/42 (Bandra Blockers), 32 teams 13/13 (Sion N32); db-audit 32/32 on the harness DB.
- Incident during the harness runs: the ask58b copy hard-codes the QA API :4100 for its chat calls; its first run sent 5 Ask chat requests (dev-auth test numbers) to the QA API before failing, which left ~5 ask_history + ~5 ask_audit rows in the QA test DB. Not cleaned up from here (it would touch QA again). All local copies are now pinned to :4201.

## Open
- Held-out misses from 1.5.1 still open (untuned): "What's the maximum number of substitutes?" → privacy refusal ("number" trips the private-details guard; also "number of …" rules questions and "court address"); "am I playing live right now" → all live matches.
- Info from the retest, not changed: "pichle natije dikhao" (no "my") → idk; "Can a team have 7 players on court?" → team-creation guide; romanised minimum-age question → idk; rate-limited audit rows have provider "-".
- A phone written with 1-digit groups ("9 8 1 2 3 4 5 6 7 8") is not masked by design (indistinguishable from score / number lists); spelled-out digits are masked in English only.
- Firestore rules: no current-captain check for challenges (F151-1) and no challenge-accept link (F150-1) – API / demo only.
- "How do I change my phone number?" retrieves the match-edit FAQ (no KB article); OTP validity → idk.
- HI copy needs a native-speaker review; real LLM providers untested live.
