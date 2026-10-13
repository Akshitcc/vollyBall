# VolleyLive 1.4.19 (versionCode 35) – tournament admin permissions, Help Center, 1.4.18 browser findings

> **Abandon policy: still INTERIM ('review').** Migration **0020_support_tickets.sql** (additive). Firestore rules,
> storage rules, Firestore indexes and the API change – **Akshit deploys them** (docs/DEPLOY.md); nothing was deployed.

## 1. Tournament admin permissions
- **Rule:** the creator (`organizerId`) is the tournament's owner and only admin. Only the owner edits it (teams /
  rosters, fixtures / bracket, format, rules, dates, venue, status) or deletes it. Everyone else – including app
  admins – is read-only. One shared helper: `src/core/tournamentAdmin.ts` (`isTournamentAdmin`,
  `assertTournamentAdmin`, `guardTournamentEdit`, `tournamentLinkProblem`, `claimedTournamentMatches`).
- **API:** PATCH / DELETE `/tournaments/:id` → `403 not_tournament_admin` (was `permission_denied`). Match create with
  a tournamentId / fixtureId needs the owner; a scheduled / live match's link can't change (403 not_tournament_admin).
  No migration (organizer_id already NOT NULL).
- **Firebase:** tournament rules were already owner-only for update / delete (no admin path). Added: a match's
  tournamentId / fixtureId are fixed on update. The create rule has no expression budget left for an owner check (the
  12-a-side create is at 1000 – the budget test failed when tried), so standings count only matches the owner claimed
  in a fixture (`claimedTournamentMatches`). The client pre-checks and throws the coded error; new `deleteTournament`.
- **Demo:** same helper; refuses also when signed out (was skipped); new deleteTournament; match link checks.
- **UI:** non-owners see a **View only** pill (EN "View only" / HI "केवल देखने के लिए") and hint, no start / delete
  controls; the owner gets **Delete tournament** with a confirm dialog. New error text `not_tournament_admin` EN/HI.
- **Admin finding:** no app-admin tournament edit exists anywhere (rules, API, demo). App admins' match powers still
  touch tournament matches: delete of a scheduled 0-rally match (firestore.rules match deleteOk, API/demo
  deleteProblem), resolve / abandon / void / approve / reassign / repairVerdict (core/lifecycle admin paths). Not removed.
- **Edge cases:** an owner-less older doc → nobody is admin (view-only for all, can't be deleted). Scoring and captain
  confirmation inside a tournament are unchanged (tests: the scorer still scores a tournament match on API / rules).

## 2. Help Center (Profile > Help Center)
- FAQs: `src/core/helpFaq.ts` – structured (id, category, EN/HI question + answer, tags), 20 entries over 11
  categories (registration, teams, new match, scoring, POTM, wallet, confirm / flagged, abandon – interim review,
  tournaments incl. owner-only editing, rating / feedback, privacy). Plain search (all words, EN + HI + tags). Numbers
  are tested against core constants; a test fails if the abandon policy switch changes.
- Contact: support website link **SUPPORT_URL = https://www.contact.com** (one constant, `src/services/supportContact.ts`).
  Email / WhatsApp come only from EXPO_PUBLIC_SUPPORT_EMAIL / EXPO_PUBLIC_SUPPORT_WHATSAPP and are hidden when unset.
- **Contact us** form: topic (8), message 10–2000 characters (hidden characters stripped), optional gallery screenshot
  (JPEG/PNG/WebP, < 5 MB). Saved with user id + app version. My messages listed in the Help Center.
- **Backends:** API (migration 0020, routes, magic-byte check, signed URLs), Firestore `supportTickets` + storage
  `support/{uid}/…` rules, demo. Users create and read only their own; only app admins read all and set status.
- **Admin inbox:** Admin: Feedback screen now starts with the support inbox – list, open a ticket (message,
  screenshot), set Open / Replied / Closed.

## 3. 1.4.18 browser findings
Measured on the demo web build (360x640, Chrome DevTools touch emulation via CDP, scripts/shots/probe419.js and probe419c.js, EN and HI). "Before" is the tester's 1.4.18 result (qa_1418_tester).

| ID | Fix | 1.4.18 (tester) | 1.4.19 measured EN / HI |
|---|---|---|---|
| V1416-3 | TeamBuilder reveals the +91 field on mount / when it appears (60, 400, 900 ms) | +91 not visible on first open (FAIL) | Field 451–498 / 446–493, footer top 534 / 529: clear by 36 px at +100, 500, 1000, 1500 ms, no scroll |
| V1418-2 | Re-reveal after every add and when the "N more" line / spacer / player count changes | Field behind footer after the 6th add (FAIL) | Clear after each of adds 1–11 (37–89 px above the footer), focus stays on +91; full at 12/12 |
| V1417-3 | Add snapshots the number, clears the field once in the same step, never writes it later; Enter presses queue | Burst …11–…14 added only …11, field showed '1290000000' (FAIL) | Burst of 4 typed+Enter with 0 ms delay: field '' after each Enter, 4/12 added, field '' at the end |
| V1416-5 | Heading gap is the heading's own padding (a do-nothing tap target), not a margin | Tap at y=134 EN / 137 HI turned Demo admin ON (FAIL) | Heading 117–145 EN / 117–147 HI, row starts at 145 / 147 (no gap). Taps at every y from 133 / 135 to the row edge (incl. 134 / 137): no flip. Only a tap on the row itself (145 / 147) flips it, as intended |
| V1418-3 | Both-teams card scrolls into view only when a new clash appears | Removing a player jumped to the card each time (FAIL) | 3 clashing, remove 2 non-clashing players: scrollTop 654→654→654 (EN), 655→655→655 (HI), card stays off-screen |
| V1418-1 | core teamShapeProblem in guardCreate/guardUpdate | TypeError on null players | team_invalid (fixes1419 tests) |

Header count: with 9 listed and 3 in both teams the side header says '6 players' (and '4 players' after removing 2). This is intended since 1.4.11 (QA V1410-4): in Custom mode playCount excludes players who are in both teams, so it counts who will actually play.

## 4. Suites (run one at a time)
app tsc clean; jest 1402/1402 (121 suites); test:tz 1402/1402; server tsc clean, npm test 338/338; rules 224/224; policy suites passed; check-strip OK. APK 1.4.19 (35).
