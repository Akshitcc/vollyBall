# 12. Glossary

| Term | Meaning |
|---|---|
| **Abandon** | ending a match without a result. With no rally it is immediate; after the first rally the interim policy **'review'** records it for review. See `docs/LIFECYCLE.md`. |
| **Abandon policy** | `review` (current, interim), `flag` or `consent` – set in `src/core/abandonPolicy.ts`. |
| **Admin** | a user id listed in `ADMIN_UIDS` on the server (or the demo admin in demo builds). Reviews flagged matches, manages daily items, feedback, support and Ask content. |
| **Anti-fraud limits** | rules that stop a result from counting: shorter than 10 minutes (flagged), more than 3 counted matches per player per IST day, more than 2 per team pair per IST week. |
| **API backend** | the app talking to the Node / Express / MySQL server. |
| **Ask VolleyLive** | the read-only in-app assistant (RAG + read-only tools). |
| **Audit (Ask)** | `ask_audit` rows: outcome, tools, HMAC hash of the question. |
| **Bold Spiker** | the chosen v2 app icon, planned for build 1.5.8. |
| **Captain** | the team's leader; edits the team, sends / answers challenges, confirms or rejects results. |
| **Captain verdict** | the opposing captain's confirm / reject of a finished match. |
| **Card (Ask)** | a structured result (match, standings, leaderboard, player, team, list) built only from tool data. |
| **Challenge** | a captain's invitation to another team to play at a day, time and place. |
| **Counted** | a result that is confirmed by the opposing captain and not flagged / voided; only counted results feed rankings and the wallet. |
| **Credit** | the player a team point is attributed to (with an optional shot type: spike, block, ace, tip). |
| **Day / "Sunday Court"** | the light theme (Court orange, Ball yellow, ink). |
| **Defang** | neutralising instruction-like text inside data before it reaches the model. |
| **Demo backend / demo mode** | data only on the phone; any number, code `123456`. |
| **Deciding set** | the last possible set (5th in Indoor, 3rd in Beach), usually to 15. |
| **Dev auth** | unsigned development tokens; local testing only. |
| **DLT** | India's SMS sender registration required for OTP messages. |
| **DPDP** | India's Digital Personal Data Protection Act. |
| **EAS** | Expo Application Services (cloud builds). |
| **Epoch (reopen / verdict)** | lifecycle counters that make an admin re-open invalidate older verdicts. |
| **Fact / Quote of the day** | daily items on Home; admin-managed; tombstoned instead of deleted. |
| **FIVB** | the international volleyball federation; VolleyLive's rule notes are its own words with a link to the FIVB rules. |
| **Fixture** | a scheduled tournament match between two tournament teams. |
| **Flagged** | a result held for admin review (e.g. too short). |
| **Floodlight / Night** | the dark theme (navy, Volt green, Ultra violet). |
| **Groups + knockout** | tournament format: round robin in groups A – H, then a knockout bracket. |
| **Held-out (eval)** | Ask eval questions frozen before the first run and never tuned against. |
| **HMAC** | keyed hash (SHA-256 with `ASK_AUDIT_HMAC_KEY`) used for the Ask audit. |
| **IST** | India Standard Time, UTC+05:30 – used for daily / weekly limits. |
| **Knockout** | tournament format: lose and you are out; byes to top seeds. |
| **League** | round robin; 3-0 / 3-1 = 3 pts, 3-2 = 2 pts, 2-3 loss = 1 pt. |
| **LiveBus** | the server's in-process publish / subscribe for live updates (Redis for scale-out). |
| **Masking (PII)** | replacing phone numbers and e-mails in Ask output and stored text. |
| **Mock provider** | the default, deterministic Ask answer step with no network or key. |
| **OTP** | one-time password: the 6-digit sign-in code. |
| **Participant** | anyone attached to a match (players, creator, scorer). |
| **POTM** | Player of the Match – auto-picked by most credited points, confirmable by the scorer; +25 ranking points. |
| **Progress (save)** | the scorer's rally save (`PUT /matches/:id/progress`) with a client sequence number. |
| **RAG** | retrieval-augmented generation: answer from retrieved VolleyLive content with sources. |
| **Rally** | one point played; each rally adds one event to the match log. |
| **Ranking points** | credited points + 10 per win + 25 per POTM, over finished counted matches; 3 matches needed to be ranked. |
| **Registered player / team** | a VolleyLive user / a saved team with accepted members. |
| **Rotation** | the order of the six positions; advances on side-out. |
| **Rule set** | Indoor, Beach or Custom match rules. |
| **Scorer** | the only person allowed to score a match. |
| **Scorer hand-off** | passing the scorer role to another eligible person. |
| **Seed** | a team's ranking position for draws and byes. |
| **Side-out** | the receiving team wins the rally and gains the serve. |
| **Spiker** | the v1 app icon (concept 7) that ships in 1.5.7. |
| **Terms gate** | every write requires the current Terms version to be accepted. |
| **Tombstone** | a deleted daily item kept as a blank, deleted row. |
| **Tool (Ask)** | one of 10 read-only data functions the assistant may call. |
| **Undo** | removes the last rally while the match is live. |
| **Viewer** | the read-only live scoreboard for everyone except the scorer. |
| **Viewer-scoped** | running with the signed-in user's own permissions. |
| **Volt** | Night primary green `#C6FF1A`. |
| **Wallet** | in-app points (no money value): match points + bonus (+100 every 5 counted wins). |
