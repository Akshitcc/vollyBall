# VolleyLive 1.3.9 – known gaps and limits

These are documented, not bugs to retest. "API" = the MySQL server in `server/` (the planned launch
backend). "Firebase" = the Firestore-only backend (`firestore.rules`). "Demo" = the offline demo build.

## Firebase-only gaps (the API server and the demo enforce these; Firestore rules cannot)

| # | Gap | Why rules can't do it | Mitigation |
|---|-----|------------------------|------------|
| FB-1 | **Photo hash can be forged** (QA R12-03). The app sends the photo's SHA-256 with the upload; rules trust that value. | Storage/Firestore rules can't read file bytes. | API hashes the bytes on the server. On Firebase it would need a Cloud Function (not deployed: no cloud changes). |
| FB-2 | **"On court right now" is not checked for a credited player** (QA R12-02 / D133-5). Rules only check that the player is on the team that won the rally. | Needs the rotation replayed from every event plus set lineups – rules have no loops. | API and demo refuse a bench credit (`not_on_court`); the Firebase scorer UI only offers on-court chips. |
| FB-3 | **No `profile_incomplete` gate on match creation in the rules.** Since 1.3.8 (V137-2) the API (`createMatch`: 403 `profile_incomplete` unless the user row has first/last name, date of birth and pincode – this also catches legacy `profile_complete=1` rows) and the demo refuse to **create** a match for an incomplete profile. Joining/being added to a match is not gated on any backend. Firebase rules don't look up `users/{uid}/private/registration`. | Extra `get()` on every match write would exceed the expression budget (match create is at the 1000 limit). | The app routes incomplete profiles to the registration form before anything else. |
| FB-4 | **No India Post lookup on Firebase.** Since 1.3.8 (V137-5) rules refuse unallocated prefixes (e.g. 100001; same prefix table as the API/core) and a client-written district/state, and the Firebase app no longer stores a district. So a Firebase profile has pincode only, never a district/state (the API stores the looked-up district). | No network calls from rules. | The API server does the lookup server-side. |
| FB-5 | **Feedback rate limit.** API: 5 burst then 1 per 12 min per user; demo: 5 per hour. Rules validate shape (stars 1–5, text ≤ 1000, own uid, server time) and – since 1.3.8 (V137-5) – accepted T&C and no control / zero-width / bidi characters (newline and tab stay allowed, as on the API). They can't rate-limit. | Rules can't count writes over time. | Add Firebase App Check / a Cloud Function before using Firebase in production. |
| FB-6 | **Admin feedback list shows no user name** (only uid). | No joins in Firestore. | API joins `users.name`. |
| FB-7 | **Admin flag is a custom claim** (`admin: true`) set by an operator. The app never creates it. | – | API uses `ADMIN_UIDS`. |
| FB-8 | **In-memory rate limits on the API** (not Firebase, listed for completeness, R12-04): correct for one instance; set `REDIS_URL` when running more than one. | – | `REDIS_URL` support exists. |

## Data migrations in 1.3.8

- **0012_captain_verdict_backfill** (V137-1): matches approved/voided by an admin under 1.3.6 after the
  opposing captain had confirmed got no `captain_verdict` from 0010. 0012 sets `confirmed` where the old
  fields show a captain verdict without a dispute reason, and `rejected` where a dispute reason exists.
  **Ambiguity:** 1.3.6 stored a captain *rejection without a reason* exactly like a confirmation
  (`verified_by` set, `dispute_reason` NULL), so such rows become `confirmed` – which is also how 1.3.6
  counted them. The app/rules apply the same reading to legacy Firebase docs (`verification.by` without
  `captain`). (The request said "0011"; that number was already taken by `0011_feedback_daily_items`.)
- **0013_users_email_unique** (V137-8): unique index on the normalised email
  (`NULLIF(LOWER(TRIM(email)),'')`). Existing duplicates are not deleted: the oldest account keeps the
  address, the others get `email = NULL` and are listed in `email_duplicates_0013` (user id, old email,
  kept user id) for support to follow up. A save that loses the race gets `409 email_taken`.
  **1.3.9 (V138-1, V138-2): fixed in place** – 0013 had never been deployed to a real server. It now pins
  `utf8mb4 / utf8mb4_0900_ai_ci` on its table, compares emails with `utf8mb4_bin` on
  `LOWER(TRIM(email))` (case-insensitive only: `josé@` ≠ `jose@`, `straße@` ≠ `strasse@`), and every step
  is guarded, so it completes from the half-applied state the 1.3.8 file left on a DB whose default
  collation was different, and re-running it changes nothing. A QA database that recorded the 1.3.8 0013 as
  applied keeps the old (accent-insensitive) index: recreate it, or delete its `schema_migrations` row and
  restart (the fixed file replaces the index). The migration runner now runs each file on one connection.

## Legacy captain answers (V138-3)

A 1.3.6 client stored a captain's answer without the `captain` verdict. That shape ("approved/voided +
`by`, no `captain`": no reason = confirmed, a reason = rejected) is trusted **only for answers stamped
before 1.3.7** – `LEGACY_VERDICT_BEFORE` in `src/core/antifraud.ts` (2026-10-11 10:00 UTC, the 1.3.7
build). A newer answer without a verdict reads as unanswered. The rules require the verdict on every new
captain answer (reject with or without a reason) and on an admin approval of an answered match
(`captain == verdictFromOld(old)`), so an outdated (≤ 1.3.7) admin app can't turn a reason-less rejection
into a counted match. If a server stayed on 1.3.6 after that date, set the constant to the day it moved to
1.3.7+ (the API's 0012 backfill already wrote those verdicts).

## Fact of the day (V138-7)

Today's item is `active items ordered by id`, index = IST day number mod n. An item an admin **adds today**
(`createdAt` ≥ today's IST midnight; server time on the API and Firebase, phone time in the demo) joins the
rotation **tomorrow**, so adding a fact never changes today's fact, and every item (old or new) appears
once in any n consecutive days. **Deactivating or deleting** an item applies at once and can change today's
fact – an admin hiding a fact expects it gone. Items without `createdAt` (bundled, or Firebase docs from
1.3.8 admin apps) are always in the rotation.

## Review prompt clock (V137-4)

The 60-day "ask for a review" cooldown uses server time on the API (response `Date` header) and, since
1.3.9, on Firebase (`users/{uid}/private/review`: `checkedAt` / `lastAskedAt` are `serverTimestamp()`s;
rules allow only `request.time` or the unchanged value, owner only). **The demo uses the phone clock**: it
has no server, so changing the phone's date can show the mock review sheet again (nothing is sent).

## Licences (V137-7)

About > Open-source licenses lists the whole **JavaScript production dependency tree** (transitive,
generated offline from `node_modules` at build time, with the licence/notice text each package ships).
Since 1.3.9 (V138-5) every installed package that **ships native code** (an Expo module config, an
`android/build.gradle` or a podspec – e.g. `react-native-gesture-handler`, which is a peer dependency and
was missed before) is included with its own dependencies, even when it is only a peer.
Native libraries added by Gradle (AndroidX, Play services, etc.) are **not** in the list; their notices
would need the Gradle `oss-licenses` plugin or a manual list before store release. Some packages ship no
licence file – the viewer then shows the declared licence id only.

## 32-bit ARM (V137-9)

The APK has no `armeabi-v7a` build, so 32-bit-only phones can't install it. Left unchanged by product
decision (it would also grow the APK).

C130-1 (sock-puppet opposing captain) is **not implemented** by decision – it stays an open item for Akshit.

## Web-only: no offline app shell (F135-3)

The web build has no service worker. A tab that is **already open** keeps scoring offline (rallies are
kept in browser storage and synced later, and the lists show the local score – F135-2), but **opening or
reloading** the site while offline shows the browser's offline page. Android/iOS are not affected (the app
bundle is on the phone). Adding an offline shell (Workbox / `expo-router` static export + service worker)
was not cheap enough for 1.3.7/1.3.8; the web app is a companion, the phone app is the product.

## Substitutions (R136-20)

Substitutions can be made **at the start of a set** (before its first rally) from the scoring screen
("Substitution"): the bench player takes the court player's position in that set's lineup. Mid-set
substitutions would need a new event type replayed by every backend (rules, API, demo) and are not in
1.3.7; pressing Substitution mid-set explains this.

## Demo-only behaviour

- APS / Field Post pincodes (9xxxxx) are refused in the demo (no lookup); the API looks them up.
- The demo stores data on the phone only; demo data does not carry over to the live app.
- "Rate VolleyLive" opens a mock sheet in the demo; real in-app review only works once the app is
  published on Google Play / the App Store.
