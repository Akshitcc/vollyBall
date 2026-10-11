# Deploying VolleyLive (1.3.9)

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
   Migrations are additive (0001–0013) and re-runnable; the Docker image runs them on start
   (`MIGRATE_ON_DEPLOY=1`). 0013 was fixed in place in 1.3.9 (never deployed; see KNOWN-GAPS) and works on a
   database whose default collation isn't `utf8mb4_0900_ai_ci`. **Back up the database first.**
   If this server ran 1.3.6 after 2026-10-11 10:00 UTC, set `LEGACY_VERDICT_BEFORE`
   (`src/core/antifraud.ts`) to the day it moved to 1.3.7+ before building (KNOWN-GAPS "Legacy captain answers").
   Firebase: deploy `firestore.rules` together with the app (1.3.9 adds `users/{uid}/private/review` and
   `dailyItems.createdAt`).
4. App: `eas build -p android --profile production` (sets `APP_VARIANT=production`,
   `EXPO_PUBLIC_BACKEND=api`, `EXPO_PUBLIC_API_AUTH=otp`, `EXPO_PUBLIC_STRIP_DEMO=1`, empty demo admins).
   Set `EXPO_PUBLIC_API_URL=https://…` (https only) in the EAS "production" environment. The build
   **fails** if the API URL is missing, demo/dev sign-in is on, demo admins are set or the demo strip is
   off (`assertProductionBuild`).
5. Verify the artifact (below), upload to an internal testing track, then production.

## DEV-owned items from the QA release checklist – 1.3.7 status

| QA id | Item | Status in 1.3.7 |
|-------|------|-----------------|
| R1-01 | Demo-free production bundle | Done in code: `EXPO_PUBLIC_STRIP_DEMO=1` swaps the demo backend, seed and QA tools for stubs (`metro.config.js`, `src/stubs/`); `npm run check:strip` greps an export for demo markers (`Simulate offline`, `DEMO_OTP`, `makeSeed`, …). Run it on the real production export – the handed-over APK is a demo build on purpose. |
| R2-01 | Not debug-signed | Needs Akshit's upload key / Play App Signing (above). Demo APKs stay debug-signed. |
| R2-02 | versionCode/targetSdk | 1.3.9 = versionCode 15, minSdk 24, targetSdk 36, arm64-v8a included (no armeabi-v7a – product decision, V137-9). EAS `autoIncrement` for Play. |
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
