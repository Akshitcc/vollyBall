# Deploying VolleyLive (1.4.19)

Nothing in this repo creates accounts, keys or cloud resources, and nothing is deployed for you. The
builds handed over so far (`volleylive-latest.apk`) are **demo builds, debug-signed** – they must not go
to Google Play (QA R12-07). This page is the path from here to a real launch on the API backend.

Detailed setup: `README.md` (app, EAS), `server/README.md` (API server, Docker), `server/RULES.md`,
`docs/KNOWN-GAPS.md` (what is not enforced where).

---

## Akshit's checklist (only you can do these)

Accounts and keys – create them yourself, keep them out of git and out of chat:

- [ ] **Google Play Console** developer account; create the app `com.volleylive.app`.
- [ ] **Signing:** let EAS generate/hold the upload key (`eas credentials`) or create your own upload
      keystore; enrol in **Play App Signing**. The release must not be `CN=Android Debug` (QA R2-01).
- [ ] **Expo account** + `npx eas-cli@latest init` → put the project id in `EAS_PROJECT_ID`.
- [ ] **Hosting for the API server + MySQL 8** (any Docker host / managed MySQL). Use `DB_SSL=1` for a
      managed database.
- [ ] **Server secrets** (on the host only): `SESSION_SECRET` and `FILE_URL_SECRET` (each
      `openssl rand -hex 32`), `DATABASE_URL`, S3/R2 keys if `STORAGE_DRIVER=s3`.
- [ ] **SMS OTP:** MSG91 account with a **DLT-registered** sender + OTP template → `OTP_PROVIDER=msg91`,
      `MSG91_AUTH_KEY`, `MSG91_TEMPLATE_ID` (or Firebase Phone Auth with `OTP_PROVIDER=firebase`).
- [ ] **Google Maps Android key** restricted to the package + SHA-1 of the Play signing key
      → `GOOGLE_MAPS_ANDROID_API_KEY` (EAS secret).
- [ ] **Push:** `google-services.json` for FCM (EAS file secret `GOOGLE_SERVICES_JSON`).
- [ ] **Admins:** after you and any moderators sign up in the live app, put those user ids in the
      server's `ADMIN_UIDS` (no accounts are created for you).
- [ ] **Support email** → `EXPO_PUBLIC_SUPPORT_EMAIL` (shown on the registration help and feedback).

Before submitting:

- [ ] **Privacy policy:** `docs/privacy-policy-draft.md` (and the in-app Privacy page, marked DRAFT) is a
      draft – have it reviewed (DPDP Act 2023: DOB, pincode, phone, photos, location), publish it at a
      public URL, add the URL to the Play listing and replace the draft text in `src/app/privacy.tsx`
      (then set `PRIVACY_IS_DRAFT = false`).
- [ ] **Data safety form** in Play Console (phone number, name, DOB, pincode, email, photos, approximate
      and precise location, app activity; nothing sold; deletion on request).
- [ ] **Store listing:** say that demo data does not carry over (QA R10-02); content rating; target
      audience (minimum age is 10 – `MIN_AGE` / `EXPO_PUBLIC_MIN_AGE`, keep both equal).
- [ ] **In-app review / "Rate VolleyLive"** only works once the app is **published** on Play (internal
      testing tracks show nothing or a no-op). Keep `EXPO_PUBLIC_REVIEW_PREPROMPT=0` – asking "do you
      like the app?" first and only sending happy users to the store is review gating, which Google Play
      policy forbids. Never offer rewards for reviews.
- [ ] **C130-1** (sock-puppet opposing captain) – decide; not implemented.
- [ ] Device QA on a real phone (QA R1-02, R11-01 pre-launch report).

## Release steps (DEV, in order)

1. `npm ci && npm test && npm run test:tz && npx tsc --noEmit` ; server:
   `cd server && TEST_DATABASE_URL=… npm test` ; rules: `cd rules-tests && npx jest --runInBand`
   against the emulator.
2. `npm run licenses` – regenerates `src/generated/licenses.json` for the About page (metro also runs it
   at bundle time; commit the result).
3. Server: set the env from `server/.env.example` (`NODE_ENV=production`, `AUTH_MODE=otp` or `firebase`,
   never `dev`; `CORS_ORIGINS` https only; `TRUST_PROXY`; `REDIS_URL` if more than one instance).
   Migrations are additive (0001–0016) and re-runnable; the Docker image runs them on start
   (`MIGRATE_ON_DEPLOY=1`). 0013 works on a database whose default collation isn't `utf8mb4_0900_ai_ci`;
   0014 repairs a database that ran the 1.3.8 0013 (no need to recreate it – see KNOWN-GAPS) and changes
   nothing anywhere else. **1.4.1: 0014 was corrected in place** (it shipped in the 1.4.0 build but was never
   deployed): it now keeps a unique email index at every step, can be stopped and re-run at any point, and
   works on a database whose **default charset is `latin1`** (tested). If a 1.4.0 server ever did run the old
   0014 and got stuck ("Duplicate entry" on `ux_users_email_norm` at every start), the 1.4.1 0014 repairs that
   on the next start (a failed migration is not recorded, so it runs again). 0015 (1.4.1) adds
   `daily_items.removed_at` / `deleted` (fact-of-the-day tombstones). **Back up the database first.**
   If this server ran 1.3.6 after 2026-10-11 10:00 UTC, set `LEGACY_VERDICT_BEFORE`
   (`src/core/antifraud.ts`) to the day it moved to 1.3.7+ before building (KNOWN-GAPS "Legacy captain answers").
   Firebase: deploy `firestore.rules` together with the app (1.3.9 adds `users/{uid}/private/review` and
   `dailyItems.createdAt`; 1.4.0 adds the `emails/{address}` claims – a 1.3.9 app can't set a new email
   against the 1.4.0 rules, so ship both together). **1.4.1 rules:** a match create must not carry
   `createdAt` (the 1.4.0 app sent it; 1.4.1 doesn't), changing/removing an email must release the old claim,
   and daily items are never deleted (tombstones) – deploy the 1.4.1 rules together with the 1.4.1 app.
   **1.4.2 rules:** a finished match's events can't grow or shrink and it can't go back to live (a 1.4.1 app's
   undo after the end is refused – ship together); a daily-item create needs `createdAt` = server time; a deleted
   daily item must have blank text (the 1.4.1 admin app's delete is refused – ship together); emails refuse
   invisible characters and more capitals; a newly set `scheduledAt` is at most 2 years ahead.
   **1.4.2 migrations: checksums.** The runner records each file's sha256 in `schema_migrations.checksum` (column
   added on the first 1.4.2 start; existing rows get their current checksum) and **refuses to start** when an
   already-applied file has changed (`MigrationChecksumError`) – never edit a migration after it has been
   applied anywhere; add a new file. The only allowlisted exception is 0014 (its 1.4.0/1.4.1 bodies; never
   deployed – `CHECKSUM_ALLOWLIST` in `server/src/db/migrate.ts`). 0014 was fixed in place again (V141-1: its
   restore step is one transaction with an `applied` mark).
   **1.4.3 rules (ship together with the 1.4.3 app):** once the winning rally is in, a match is final – the
   finishing write (status → finished) must carry the summary that the rallies give (winner with the required
   sets, set scores that follow the rules, win by 2 / cap), and afterwards only the POTM, a credit on one of the
   last 3 rallies and the admin/captain fields can change (no rules, summary, status/abandon, roster, title,
   place, time…). Every rally write while live must carry the exact summary (the 1.4.2 app's writes without it
   are refused). Emails use an allow list (`emailOk`, the same letters as `src/core/emailChars.ts`).
   **Migration checksums (1.4.3, V142-4)** – see the section below.
   **1.4.5 – migration 0016 and rules (ship together with the 1.4.5 app):** `0016_match_abandon.sql` adds
   `matches.max_events`, `was_won`, `abandon_info`, `abandon_request`, `resolution`, `scorer_reassign` (additive,
   guarded, re-runnable; backfills `max_events` from the event count and `was_won` for finished matches). The 1.4.5
   Firestore rules require `maxEvents` on every events write and `wasWon` on the finishing write, so a **1.4.4 app
   can't score or finish against them** – deploy the rules and release the app at the same time. **The abandon policy
   is interim, pending Akshit's decision** ('review'); to switch it edit `src/core/abandonPolicy.ts`, run
   `node scripts/gen-abandon-policy.js`, run the suites and deploy rules + app + API together
   (docs/qa/RELEASE-1.4.5.md).
   **1.4.6 – one lifecycle (docs/LIFECYCLE.md), migration 0017, a new index, rules:** in this order:
   (a) **indexes first** – `firebase deploy --only firestore:indexes` (new composite index `matches`:
   `verification.status` ASC + `finishedServerAt` DESC, used by the rankings' confirmed tier) and wait until it is
   built: a 1.4.6 app without it fails the rankings read loudly instead of silently undercounting;
   (b) **API migration** `0017_match_lifecycle.sql` – adds `matches.reopen_epoch`, `verdict_epoch`,
   `abandon_history`, `abandon_request_count`, `abandon_request_at` (additive, guarded, re-runnable; no backfill
   needed – absent means epoch 0 / no history / no requests); then the 1.4.6 API (new `GET
   /matches/:id/handoff-admins`; setup changes after the first rally are now 409 `match_setup_locked`, deleting a
   played match is 403 `match_delete_forbidden` for everyone, admins included);
   (c) **rules + app together** – the 1.4.6 rules refuse a scorer re-abandon after a reinstate, a scorer verdict,
   a report without a record, unbounded consent requests, and a reopen that doesn't clear the verdict; a 1.4.5
   app's reopen write (no `verification` reset) is refused, so release the 1.4.6 app with the rules.
   `LC_CLIENT_ONLY` in `src/core/lifecycle.ts` lists the two checks only the clients make (the rules can't replay a
   match) – see docs/KNOWN-GAPS.md. The abandon policy is still interim ('review').
   **1.4.7 – no migration, no index; API, then rules + app together:** the 1.4.7 API locks the match row for delete
   (conditional delete in one transaction; a save racing a delete gets 404) and refuses a scorer change to the verdict
   captain's team (`reassign_verdict_captain`, before the first rally `handover_no_verdict`), and a reinstate of a
   `wasWon` match to live. The 1.4.7 rules refuse the same scorer changes (`scorerTargetOk`) and a live reinstate of a
   `wasWon` match, and no longer let a verdict from an earlier epoch block a reopen. A 1.4.6 app offers the other team
   in the handoff list before the first rally; those writes are refused by the 1.4.7 rules, so release the app with
   the rules (docs/qa/RELEASE-1.4.7.md).
   **1.4.8 – migration 0018 (additive), no index; migration + API, then rules + app together:** (a) **API migration**
   `0018_verdict_repair.sql` – adds the nullable JSON column `matches.verdict_repair` (guarded, re-runnable, no
   backfill, no existing row changes; a 1.4.7 API ignores it). (b) **API**: refuses a create or a roster / captain /
   participant edit that leaves nobody to confirm the result, or puts the scorer on the confirming side
   (`400 match_no_verdict`), and adds `POST /api/admin/matches/:id/repair-verdict` (admin outside the match; a valid
   scorer – or confirmer – for a match nobody can confirm; audited in `verdict_repair`). (c) **Rules + 1.4.8 app
   together**: the rules refuse the same creates / roster edits (`setupVerdictOk`) and allow the admin repair
   (`verdictRepairOk`, written only with `verdictRepair`). Existing matches are not changed by the release; an admin
   repairs a broken one from the review list or the match page (docs/qa/RELEASE-1.4.8.md).
   **1.4.9 – migration 0019 (check only), no index; migration + API, then rules + app together:** (a) **API migration**
   `0019_verdict_repair_type.sql` changes nothing; it fails with "0019: matches.verdict_repair must be JSON, found …"
   when the column exists with another type (fix the column by hand, then re-run). (b) **API**: the verdict repair is
   scorer-only (a captain fix answers `400 repair_invalid`). (c) **Rules + 1.4.9 app together**: the rules refuse the
   confirmer repair and count `scorerReassign.from` in the roster-edit check (docs/qa/RELEASE-1.4.9.md).
   **1.4.10 – no migration; API, then rules + app together:** (a) **API**: the runner checks the schema after every
   migrate and the API checks it at every start (read-only): 0018 recorded but `matches.verdict_repair` missing or not
   JSON stops with a readable message (fix the column by hand). The verdict check on roster edits counts the stored
   `scorerReassign.from`. The captain repair is accepted for a side whose captain plays for the other team only.
   (b) **Rules + 1.4.10 app together**: cheaper roster-edit check (12-a-side with scorerReassign) and the same captain
   repair (docs/qa/RELEASE-1.4.10.md).
4. App: `eas build -p android --profile production` (sets `APP_VARIANT=production`,
   `EXPO_PUBLIC_BACKEND=api`, `EXPO_PUBLIC_API_AUTH=otp`, `EXPO_PUBLIC_STRIP_DEMO=1`, empty demo admins).
   Set `EXPO_PUBLIC_API_URL=https://…` (https only) in the EAS "production" environment. The build
   **fails** if the API URL is missing, demo/dev sign-in is on, demo admins are set or the demo strip is
   off (`assertProductionBuild`).
5. Verify the artifact (below), upload to an internal testing track, then production.

## Migration checksums

The runner (`server/src/db/migrate.ts`) keeps a sha256 per applied file in `schema_migrations.checksum` and,
since 1.4.3, a row `checksums_since` in the additive table `schema_migrations_meta` (when the record started).

| Situation at start-up | What happens |
|---|---|
| Every applied file matches its record | normal start |
| An applied file changed | **refuses to start** (`MigrationChecksumError`, file named) – put the change in a new file |
| A record is **NULL** and the meta row exists (e.g. a row inserted by hand) | **refuses to start** ("no checksum recorded") – it is no longer silently re-recorded |
| A record is **NULL** and there is **no meta row** (1.4.4, V143-9: a first start under 1.4.2+ that stopped after `ADD COLUMN` or part-way through recording) | the start is still the bootstrap: the NULL rows are recorded like a database from before 1.4.2 (trust on first use / `unknown` for 0014), with a warning "the checksum record was started but not finished", then the meta row is written |
| The `checksum` column is **missing** but `schema_migrations_meta` says the record had started | **refuses to start** ("column missing") – nothing is re-added behind the error |
| A database from before 1.4.2 (no column, no meta row) | the column is added (additive); each applied file is recorded as it is on disk (**trust on first use**, warning); 0014 – edited in place before it was ever deployed – is recorded as **`unknown`** with a warning, because the version that ran can't be told from the database (its end state is identical) |
| 0014 recorded as its 1.4.0 / 1.4.1 hash or `unknown` | accepted with a warning (1.4.4: **shown once per database** – flag `warned:…` in `schema_migrations_meta`) **only if the 0014 file on disk is exactly the accepted 1.4.2+ version** (`CHECKSUM_ALLOWLIST[…].current`); any other 0014 body fails ("the file differs from its accepted version") |

Recovering (DBA, after a backup): for "no checksum recorded", compare the database with the file, then set the
row to `sha256(file)` (CRLF → LF first; `npm run -s migrate -- --print-checksums` is not provided – use
`node -e "console.log(require('./dist/db/migrate').migrationChecksum(require('fs').readFileSync(F,'utf8')))"`).
For "column missing": restore the column from the backup, or re-add it and fill every row the same way. Never
delete the `schema_migrations_meta` row to get past the check.

**Intentional reset (1.4.4, V143-9).** Deleting the `schema_migrations_meta` row **and** dropping the `checksum`
column (or dropping the meta table and the column) makes the database look like one from before 1.4.2: the next
start re-records every applied file from disk with only the trust-on-first-use warnings. That is by design – it
needs DB write access, the same access that could rewrite the checksums themselves – and it is the documented way
to re-baseline after a DBA has verified the schema by hand. Do it only after a backup and a schema comparison;
never to get past a "file changed" error.

## DEV-owned items from the QA release checklist – 1.3.7 status

| QA id | Item | Status in 1.3.7 |
|-------|------|-----------------|
| R1-01 | Demo-free production bundle | Done in code: `EXPO_PUBLIC_STRIP_DEMO=1` swaps the demo backend, seed and QA tools for stubs (`metro.config.js`, `src/stubs/`); `npm run check:strip` greps an export for demo markers (`Simulate offline`, `DEMO_OTP`, `makeSeed`, …). Run it on the real production export – the handed-over APK is a demo build on purpose. |
| R2-01 | Not debug-signed | Needs Akshit's upload key / Play App Signing (above). Demo APKs stay debug-signed. |
| R2-02 | versionCode/targetSdk | 1.4.0 = versionCode 16, minSdk 24, targetSdk 36, arm64-v8a included (no armeabi-v7a – product decision, V137-9). EAS `autoIncrement` for Play. |
| R2-05 | Permissions | Location (coarse/fine), camera, internet, vibrate, media read/write (legacy). `RECORD_AUDIO` and `SYSTEM_ALERT_WINDOW` are blocked (`blockedPermissions`, `tools:node="remove"`). |
| R5-03 | Secrets out of git/bundle | Only `EXPO_PUBLIC_*` reach the bundle and they hold no secrets; `.env.example` files are placeholders only; `.env` is git-ignored. |
| R5-06 | No cleartext in release | Production build guard requires an `https://` API URL; use https for `PUBLIC_BASE_URL`. |
| R5-07 / R8-03 / R12-04 | Multi-instance rate limits | In-memory by default; set `REDIS_URL` to share them. Auth needs no sticky sessions (stateless signed tokens). |
| R9-01 / R9-02 | Crash reporting + mapping upload | **Not included** (no Sentry/Crashlytics: it needs an account/DSN). Decide with Akshit; Play Console's Android vitals cover crashes/ANRs meanwhile. Minify is off, so no mapping file is needed yet. |
| R10-02 | "Demo data will not carry over" | Put it in the store listing; in-app demo banners already say no online server is connected. |
| R12-02 / R12-03 | Firebase on-court / forged hash | API-first launch; documented in `docs/KNOWN-GAPS.md`. |
| R12-07 | Demo/debug APK must not ship | Use the EAS production profile only. |

## Verifying a build

```sh
apksigner verify --print-certs app.apk      # must not be CN=Android Debug for Play
aapt2 dump badging app.apk | head -3        # versionName / versionCode / sdk
EXPO_PUBLIC_BACKEND=api EXPO_PUBLIC_API_AUTH=otp EXPO_PUBLIC_STRIP_DEMO=1 APP_VARIANT=production \
  EXPO_PUBLIC_API_URL=https://api.example.com npx expo export -p web && npm run check:strip
```

## 1.4.6 – one lifecycle table (QA V145)

- `src/core/lifecycle.ts` is the single table of actions × roles × states × latches; `docs/LIFECYCLE.md` is generated
  from it (`node scripts/gen-lifecycle-doc.js`, `--check` in CI). The API, the demo and the Firebase client call core
  functions built on it; `firestore.rules` mirror it. The walk tests try every action in every state as every role:
  core/demo (`src/services/__tests__/lifecycle146.test.ts`), API (`server/tests/lifecycle.test.ts`), rules
  (`rules-tests`, "1.4.6: lifecycle walk").
- `scripts/run-policy-suites.sh` runs the walks once under each abandon policy and restores 'review'. CI runs only the
  default.
- Deploy order: indexes → migration 0017 + API → rules and the 1.4.6 app together (release step 3 above).

## 1.4.7 – delete vs save, the verdict invariant (QA V146)

- No migration and no new index. Deploy the API, then the rules and the 1.4.7 app together.
- The verdict invariant: the scorer is never the verdict captain or on their team, and there is always a verdict giver
  (core `scorerTargetProblem`, rules `scorerTargetOk`). The walks assert it in every state on core/demo, API and rules.
- `scripts/run-policy-suites.sh` now exits with the suites' real status (strict mode; full log in `$LOG`, default
  `/tmp/policy-suites.log`) and always restores 'review'.

## 1.4.19 – tournament admin permissions + Help Center

**Akshit deploys these – nothing was deployed by the build.**

- **Migration 0020_support_tickets.sql** (additive: one new table `support_tickets`; nothing existing touched). Runs with
  the normal server migrate step. No migration for tournaments (`tournaments.organizer_id` is already NOT NULL).
- **API server**: new routes `POST/GET /api/support/tickets`, `POST /api/support/tickets/:id/screenshot`,
  `GET /api/admin/support/tickets`, `PATCH /api/admin/support/tickets/:id`; tournament PATCH / DELETE and match
  create / patch now answer `403 not_tournament_admin`. Object storage keys gain the `support/` prefix (same bucket).
- **Firebase (if used)**: deploy **firestore.rules**, **storage.rules** and **firestore.indexes.json** together with the
  app: `firebase deploy --only firestore:rules,firestore:indexes,storage` (new `supportTickets` collection + index
  userId/createdAt; `support/{uid}/{file}` storage path; a match's tournamentId / fixtureId are fixed after create).
- **Optional build config**: `EXPO_PUBLIC_SUPPORT_EMAIL` and `EXPO_PUBLIC_SUPPORT_WHATSAPP` (digits with country code).
  Not set = the Help Center hides those links. No contact details are built in.

## 1.4.18 – QA V1417

- No migration. App only (New match reveal, Testing tools heading, add-by-number queue, team_invalid); rules and API unchanged.

## 1.4.17 – QA V1416

- No migration. App only (core/demo create check, Home rankings refresh, New match inputs, Testing tools gap); rules and API unchanged.

## 1.4.16 – QA V1415

- No migration. App only (core/demo roster-size code, web a11y, layout); rules unchanged; the API change is tests only.

## 1.4.15 – QA V1414

- No migration. Rules + app together (wasWon, 13-entry sides).

## 1.4.14 – QA V1413

- No migration. Rules + app together (cheaper roster-edit checks, both-rosters captain); the API change is tests only.

## 1.4.13 – QA V1412

- No migration. API + rules + app together (sides from the rosters; stricter repair; cheaper set-up checks).

## 1.4.12 – QA V1411

- No migration. Rules + app together (rules compare player ids for the set-up skip; no captain re-check on a rename).
  The API change is tests only.

## 1.4.11 – QA V1410

- No migration. API + rules + app together (rename on a broken match, cheaper roster check, stricter captain repair).

## 1.4.10 – QA V149

- No migration; `checkSchema` at start and after migrate. Rules `setupVerdictUpdOk` / `setupVerdictRefOk`
  restructured; `verdictRepairOk` accepts kind 'confirmer' only for a side whose captain is off its side.

## 1.4.9 – QA V148

- Deploy order: migration 0019 + API → rules and the 1.4.9 app together. 0019 is a type check only; the migration
  test lists it after 0018.
- Verdict repair scorer-only on core / demo / API / rules; rules `setupVerdictUpdOk` (updates) counts
  `scorerReassign.from`; walk tests on all four.

## 1.4.8 – verdict invariant at set-up, admin repair (QA V147)

- Deploy order: migration 0018 + API → rules and the 1.4.8 app together. 0018 only adds `matches.verdict_repair`
  (JSON NULL); the migration test lists it after 0017 and checks it is not applied when an earlier file was edited.
- The invariant is checked at create and on every roster / captain / participant edit (core `verdictSetupProblem`,
  API `writeMatch`, rules `setupVerdictOk`, demo and Firebase via `guardCreate` / `guardUpdate`).
- Admin repair: lifecycle action `repairVerdict` (docs/LIFECYCLE.md), walked on core, demo, API and rules.
- `scripts/run-policy-suites.sh`: the rules step fails when its `-t` filter runs 0 tests.
