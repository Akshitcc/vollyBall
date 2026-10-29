# 7. Setup and build

> **No secrets in the repo.** This page lists environment variables **by name only**. Real values live in local
> `.env` files (git-ignored), the EAS environment, or the hosting provider's secret store. The `.env.example` files
> contain placeholders only.

## 7.1 Prerequisites

| Tool | Version / note |
|---|---|
| Node.js | 20 or newer (server requires ≥ 20) |
| npm | comes with Node |
| MySQL | 8.x (8.4 used in Docker Compose) – only for the API server |
| Docker (optional) | to run MySQL + API with `docker compose` |
| Android SDK + JDK (17 or newer) | for local APK builds (`expo prebuild` + Gradle) |
| EAS CLI (optional) | `npm i -g eas-cli` for cloud builds |
| Firebase CLI (optional) | for the rules tests (emulator) and Firebase deploys |
| A phone or emulator | Android phone with USB debugging for `adb install` (the minimum SDK comes from Expo SDK 57 defaults) |

## 7.2 Run the app in demo mode (fastest)

```bash
npm ci
npx expo start            # press "a" for Android, or scan the QR code with a dev build
```

With no backend variables set the app runs the **demo backend**: sample data on the phone, any mobile number and the
demo code `123456`. Web: `npx expo start --web`.

## 7.3 Run the API server locally

```bash
cd server
cp .env.example .env      # fill in your own local values; never commit .env
npm install
npm run migrate           # apply migrations 0001…0028
npm run seed              # optional: demo data (refused in production)
npm run dev               # http://localhost:4000
```

or with Docker Compose (MySQL 8.4 + API, migrations on start; choose your own passwords at the prompt / in your shell):

```bash
cd server && cp .env.example .env && docker compose up --build
```

Point the app at it in the app's `.env`: `EXPO_PUBLIC_API_URL=http://<your-computer-LAN-IP>:4000`.
For local testing without SMS, run the server with `AUTH_MODE=dev` and set `EXPO_PUBLIC_API_DEV_AUTH=1` in the app –
**dev auth lets anyone be anyone and is refused when `NODE_ENV=production`.**

## 7.4 App environment variables (names only)

| Variable | Purpose |
|---|---|
| `EXPO_PUBLIC_BACKEND` | force `demo`, `api` or `firebase` |
| `EXPO_PUBLIC_DEMO_MODE` | `1` forces the demo backend |
| `EXPO_PUBLIC_API_URL` | API base URL (https only in production) |
| `EXPO_PUBLIC_API_AUTH` | `otp`, `firebase` or `dev` – how API builds sign in |
| `EXPO_PUBLIC_API_DEV_AUTH` | `1` = local dev tokens (never in production) |
| `EXPO_PUBLIC_STRIP_DEMO` | `1` strips demo code from production bundles (checked by `npm run check:strip`) |
| `EXPO_PUBLIC_DEMO_ADMIN_UIDS` | demo admin accounts (must be empty in production) |
| `EXPO_PUBLIC_MIN_AGE` | minimum sign-up age (default 10) |
| `EXPO_PUBLIC_SUPPORT_EMAIL` / `EXPO_PUBLIC_SUPPORT_WHATSAPP` | support contacts shown in Help (only when set) |
| `EXPO_PUBLIC_REVIEW_PREPROMPT` | `1` shows the "Enjoying VolleyLive?" pre-prompt (keep `0`) |
| `EXPO_PUBLIC_FIREBASE_API_KEY`, `…_AUTH_DOMAIN`, `…_PROJECT_ID`, `…_STORAGE_BUCKET`, `…_MESSAGING_SENDER_ID`, `…_APP_ID` | Firebase web config (Firebase builds) |
| `GOOGLE_MAPS_ANDROID_API_KEY` | Maps SDK key (build time, restricted to the app's package and certificate) |
| `GOOGLE_SERVICES_JSON` | path to `google-services.json` (FCM push) |
| `EAS_PROJECT_ID` | EAS project |
| `APP_VARIANT` | `production` enables `assertProductionBuild` |
| `ANDROID_PACKAGE`, `IOS_BUNDLE_ID` | identifiers (default `com.volleylive.app`) |

## 7.5 Server environment variables (names only)

| Group | Variables |
|---|---|
| Runtime | `NODE_ENV`, `PORT`, `LOG_LEVEL`, `TRUST_PROXY`, `CORS_ORIGINS`, `APP_VERSION` |
| Database | `DATABASE_URL`, `TEST_DATABASE_URL`, `MIGRATE_ON_START`, `MIGRATE_ON_DEPLOY`, `DB_SSL`, `DB_SSL_CA`, `DB_SSL_CA_FILE`, `DB_SSL_REJECT_UNAUTHORIZED` |
| Auth | `AUTH_MODE` (`otp`, `firebase`, `dev`), `FIREBASE_PROJECT_ID`, `SESSION_SECRET`, `SESSION_TTL_SECONDS`, `ADMIN_UIDS`, `MIN_AGE` |
| OTP | `OTP_PROVIDER`, `OTP_TTL_SECONDS`, `OTP_MAX_ATTEMPTS`, `OTP_RESEND_SECONDS`, `OTP_MAX_PER_HOUR`, `OTP_IP_PER_HOUR`, `MSG91_AUTH_KEY`, `MSG91_TEMPLATE_ID`, `MSG91_OTP_VAR` |
| Files | `STORAGE_DRIVER` (local / s3), `STORAGE_DIR`, `PUBLIC_BASE_URL`, `FILE_URL_SECRET`, `FILE_URL_TTL_SECONDS`, `S3_BUCKET`, `S3_REGION`, `S3_ENDPOINT`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_FORCE_PATH_STYLE`, `S3_PRESIGN_SECONDS`, `S3_REDIRECT` |
| Scale | `REDIS_URL` (shared rate limits and live bus for more than one instance) |
| Push | `PUSH_ENABLED`, `EXPO_ACCESS_TOKEN` |
| Pincode | `PINCODE_LOOKUP` |
| Ask | `ASK_PROVIDER`, `ASK_API_KEY`, `ASK_MODEL`, `ASK_TIMEOUT_MS`, `ASK_AUDIT_HMAC_KEY` |

`server/src/config.ts` validates them and **refuses unsafe production settings** (dev auth, missing secrets, a real
Ask provider without a key, non-https CORS, …).

## 7.6 Build an APK

### Local (what the internal test builds use)

```bash
npx expo prebuild --platform android      # generates android/ from app.config.ts
cd android && ./gradlew assembleRelease    # app/build/outputs/apk/release/app-release.apk
```

Bump `version` and `versionCode` in `app.config.ts` for every build (Android refuses a lower versionCode over an
installed app). Internal builds are signed with the local debug certificate and are **not** for the Play Store.

### EAS (cloud)

| Profile | Output | Use |
|---|---|---|
| `development` | dev client | development |
| `preview` | **APK** (internal distribution) | testers |
| `production` | **AAB** | Google Play; sets `APP_VARIANT=production`, `EXPO_PUBLIC_BACKEND=api`, `EXPO_PUBLIC_API_AUTH=otp`, `EXPO_PUBLIC_STRIP_DEMO=1`, no demo admins |

```bash
eas build -p android --profile preview
eas build -p android --profile production
```

The production build **fails** if the API URL is missing, demo / dev sign-in is on, demo admins are set or the demo
strip is off (`assertProductionBuild`).

### Verify a build

```bash
apksigner verify --print-certs app.apk     # must not be the debug certificate for Play
aapt2 dump badging app.apk | head -3       # package, versionName, versionCode, sdk
```

### Install on a phone

```bash
adb devices
adb -s <serial> install -r app.apk         # -r keeps app data; never uninstall to "fix" an install
adb -s <serial> shell monkey -p com.volleylive.app -c android.intent.category.LAUNCHER 1
```

On Realme / ColorOS phones enable **Developer options → Install via USB** and approve the on-screen prompt, otherwise
the install fails with `INSTALL_FAILED_VERIFICATION_FAILURE`.

## 7.7 Release checklist (summary of `docs/DEPLOY.md`)

1. All suites green (see [08 – Testing](08-testing.md)); `npm run licenses`.
2. Server env from `server/.env.example` with real values in the host's secret store; `NODE_ENV=production`;
   `AUTH_MODE=otp` or `firebase` (never `dev`); https-only `CORS_ORIGINS`; `TRUST_PROXY`; `REDIS_URL` for > 1 instance.
3. **Back up the database**, then migrate (additive, checksummed).
4. Firebase builds: deploy indexes first, then rules together with the matching app.
5. `eas build -p android --profile production`, verify the artifact, internal testing track, then production.

Owner-only items (Akshit): Play Console account and app signing, hosting, SMS provider DLT registration, Maps key,
`google-services.json`, `ADMIN_UIDS`, support email, privacy policy review (DPDP), Play data-safety form.
