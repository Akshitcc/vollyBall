# 🏐 VolleyLive

VolleyLive is a volleyball app for Android and iOS. You can score real matches live, track player stats, run teams and tournaments, and find games near you.

Built with **React Native + Expo (SDK 57) + TypeScript**. The backend is either the **VolleyLive API server** (`server/`: Node + Express + MySQL, with a WebSocket live scoreboard; Firebase is used only for phone OTP) or **Firebase** directly (Phone Auth, Firestore, Storage, Cloud Functions for push). See [Backends](#backends).

> **Try it right away (no setup):** if Firebase keys are not set, the app runs in **Demo mode**. It uses sample teams, a live match and a tournament, all stored on your phone. Sign in with any number. The OTP code is **123456**.

---

## Quick start: run the app + local server (MySQL)

**Version:** 1.3.1 (Android versionCode 7). Docs: [`docs/PRD.md`](docs/PRD.md) (also `docs/PRD.pdf`), design spec [`docs/design/design-spec.md`](docs/design/design-spec.md), DB schema `docs/db-schema.png`.

Requirements: Node.js 20+, npm, MySQL 8.x (e.g. `brew install mysql && brew services start mysql`), and Expo Go or an Android device/emulator.

**1. Database (once)**

```sql
-- in the mysql shell (mysql -u root -p)
CREATE DATABASE volleylive CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE DATABASE volleylive_test CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;  -- only for npm test
CREATE USER 'volleylive'@'localhost' IDENTIFIED BY '<choose-a-password>';
GRANT ALL ON volleylive.* TO 'volleylive'@'localhost';
GRANT ALL ON volleylive_test.* TO 'volleylive'@'localhost';
```

**2. API server**

```bash
cd server
cp .env.example .env          # then edit .env: DATABASE_URL with your password, AUTH_MODE=dev for local testing
npm install
npm run migrate               # create / update tables
npm run seed                  # optional sample data
npm run dev                   # http://localhost:<PORT from .env>
npm test                      # optional; uses TEST_DATABASE_URL (database name must end in _test)
```

**3. Mobile app**

```bash
cd ..                         # repo root
cp .env.example .env          # set EXPO_PUBLIC_API_URL=http://<your-computer-LAN-IP>:<PORT> and EXPO_PUBLIC_API_DEV_AUTH=1
npm install
npx expo start                # scan the QR code with Expo Go, or press a for Android
```

Sign in with any 10-digit Indian mobile number (+91, starts with 6-9). The demo/dev **OTP is `123456`**.
With no `.env` at all the app runs in **Demo mode** (sample data on the phone, OTP `123456`).

To build an Android APK locally: `npx expo prebuild -p android && cd android && ./gradlew assembleRelease` (the generated `android/` and `ios/` folders are not committed; use your own signing key, never commit it).

`.env` files, keystores, `google-services.json`, service-account keys, `node_modules`, build outputs and uploaded photos are git-ignored. Never commit real secrets.

## Features

| Area | What you get |
|---|---|
| **Accounts** | Sign up with a mobile number and SMS OTP (+91 by default). Your profile has a name, photo, position and city. |
| **Teams** | The captain creates a team and adds players by mobile number. **Only players who have already registered themselves with that number can be added.** They get an in-app invite (plus a push notification) to accept or decline. If the number isn't registered, the app says "This number isn't on VolleyLive yet. Ask them to register first." and nothing is added. The team has 6 starters plus up to 6 subs. Members can leave the team. |
| **Live scoring** | Split screen: tap the half of the team that won the rally. The app handles serve, set point and match point, and set and match wins. Undo, timeouts, side swap and side-switch reminders are built in. Indoor, Beach and Custom rules are supported (best of 1/3/5, points per set, deciding set, win by 1 or 2, timeouts). An optional player strip lets you credit each point as a spike, block, ace or tip. Only **one assigned scorer** can change the score. Points are saved on the phone first, so scoring keeps working offline. |
| **Court rotation** | When the teams have named players, a mini court in each half of the scoring screen shows who stands in positions 1–6. The front row (4-3-2) is next to the net and the back row (5-6-1) is at the outside, mirrored for each side, and the current server is highlighted. On a side-out the team that wins the serve rotates clockwise and its new position 1 serves. A point won by the serving team doesn't rotate anyone. Undo reverses rotations exactly, because positions are worked out from the point log. Before the first rally of each set the scorer can set the starting lineup ("Set lineup" button, or ⋮ → Lineup). The default is the first six listed players, and later sets reuse the previous set's lineup. The lineup is saved on the match as `lineups[setNumber]`. Followers see the same mini court on the match page. The mini court never blocks the tap-to-score areas. |
| **New match** | Each side is either one of the registered teams (at least 6 members) or a side you build for this match by adding registered players one at a time by mobile number. The app looks the number up and shows the player's name and photo with an **Add** button. Unregistered numbers get "This number isn't on VolleyLive yet. Ask them to register first." Free-typed names aren't accepted. Each team needs at least 6 players before scoring can start (12 max, no one on both teams). Players can be updated from the teams only before the first rally. |
| **Live following** | Everyone else sees the scoreboard update in real time. The Home screen lists live and upcoming matches. |
| **Stats & history** | Set-by-set scores, a point-by-point timeline, team stats, the longest scoring run, player points per match, and career totals with win %. |
| **Match photos** | Players in a match can add photos from the gallery or camera. They appear as an album on the match page. |
| **Challenges** | A captain challenges another team, picking the day, time, place and rules. The other captain gets a push notification and accepts or declines. Both teams need at least 6 members. Accepted challenges become scheduled matches. |
| **Tournaments** | Registered teams with at least 6 members only. Knockout format (seeded bracket with automatic byes) or league format (round robin, with 3/2/1/0 table points and tie-breakers). Fixtures are generated automatically. Brackets and tables update from match results, and the champion is detected. |
| **Map** | Every match, challenge and tournament has a location. A Nearby map shows games, tournaments and courts within 5 km, 25 km, 100 km or anywhere. Users can add courts. Tap "I want to play" to ask to join a game. |
| **Languages** | English (default) and Hindi (हिन्दी). Switch on the login screen or in Profile; the whole app changes instantly and the choice is remembered on the device. |
| **Live video** | *Deferred.* The data model has `Match.stream` and the UI shows a "coming soon" placeholder. |

### Project layout

```
src/
  core/            Pure TypeScript logic: scoring engine, court rotation, rules, stats, tournaments, phone, geo (+ Jest tests)
  services/
    backend/       Backend interface + ApiBackend (REST + WebSocket) + FirebaseBackend + DemoBackend (sample data)
    firebase.ts    Firebase init (config from env vars)
    notifications.ts, location.ts, matchFactory.ts
  components/      UI kit, maps (native + web fallback), reCAPTCHA verifier, forms
  app/             Expo Router screens (tabs: Home, Map, Score, Tournaments, Profile)
  i18n/            i18next setup, en/hi strings (locales/), translated display helpers (+ Jest tests)
server/            API server: Express + Knex + MySQL, WebSocket live scoreboard, push, photo storage (see server/README.md)
firestore.rules, storage.rules, firestore.indexes.json, firebase.json   (Firebase-direct mode; ported to server/RULES.md)
functions/         Cloud Functions that send push notifications (Firebase-direct mode; ported into server/)
rules-tests/       Security-rules tests (Firebase emulator)
```

### Backends

The app picks its backend from env vars at build time (`src/services/config.ts`):

| env | backend |
|---|---|
| nothing set, or `EXPO_PUBLIC_DEMO_MODE=1` | **Demo mode**: sample data on the device, OTP `123456` |
| `EXPO_PUBLIC_API_URL` + Firebase keys | **API server** (`server/`, MySQL). Firebase phone auth signs you in, and the ID token is sent to the API |
| `EXPO_PUBLIC_API_URL` + `EXPO_PUBLIC_API_DEV_AUTH=1` (no Firebase) | **API server with dev sign-in** (any number, OTP `123456`). Local testing only; the server must run with `AUTH_MODE=dev` |
| Firebase keys only | **Firebase direct** (Firestore + Storage + Cloud Functions) |

`EXPO_PUBLIC_*` values are inlined when the bundle is built, so after changing them restart with
`npx expo start --clear` (or `npx expo export --clear`).

The scoring, rotation and stats engine in `src/core` is shared: the API server imports it to
derive summaries, sets and rotations, so every backend computes the same results. Server setup
(Homebrew or Docker), the API, the WebSocket protocol and the rule mapping are documented in
[`server/README.md`](server/README.md) and [`server/RULES.md`](server/RULES.md). The database
diagram is in `docs/db-schema.png` (source: `docs/db-schema.mmd`).

---

## 1. Requirements

- Node.js 20.19+ (or 22 LTS) and npm
- The **Expo Go** app on your phone (for the quickest test), or Android Studio / Xcode for emulators
- A Google account for Firebase, and a free Expo account for EAS builds

```bash
npm install
npm test          # scoring, stats and tournament unit tests
npm run typecheck # TypeScript
npx expo start    # then scan the QR code with Expo Go (Android) or the Camera app (iOS)
```

With no `.env` file the app starts in **Demo mode**.

---

## 2. Firebase setup (step by step)

1. Go to <https://console.firebase.google.com>, click **Add project**, and name it (e.g. `volleylive`). Analytics is optional.
2. **Authentication → Get started → Sign-in method → Phone → Enable → Save.**
   - Under **Settings → Authorized domains**, make sure `<project-id>.firebaseapp.com` is listed (it is by default).
   - *Optional, for testing without real SMS:* under Phone → **Phone numbers for testing**, add e.g. `+91 99999 00000` with code `123456`.
   - Note: SMS sign-in may need billing enabled (Blaze plan) once you go beyond the free quota and testing numbers.
3. **Firestore Database → Create database →** choose a location (e.g. `asia-south1` Mumbai) and start in **production mode**.
4. **Storage → Get started →** use the same location.
5. **Project settings (⚙) → General → Your apps → Add app → Web (`</>`)**. Register it (no hosting needed) and copy the `firebaseConfig` values.
6. Add the **Android** app: package `com.volleylive.app`, or your own (set `ANDROID_PACKAGE`). Download `google-services.json` into the project root. It's only needed for push notifications in Android builds. Set `GOOGLE_SERVICES_JSON=./google-services.json`.
7. Add the **iOS** app: bundle ID `com.volleylive.app`, or your own (set `IOS_BUNDLE_ID`).
8. Create your env file:
   ```bash
   cp .env.example .env
   # fill EXPO_PUBLIC_FIREBASE_* from step 5
   ```
   These web config values are identifiers, not passwords. Your data is protected by the security rules. **Never commit `.env`** (it's git-ignored).
9. Deploy the security rules, indexes and (optionally) the push functions:
   ```bash
   npm install -g firebase-tools
   firebase login
   cp .firebaserc.example .firebaserc   # put your project id in it
   firebase deploy --only firestore:rules,firestore:indexes,storage
   # Push notifications (needs the Blaze plan):
   cd functions && npm install && cd .. && firebase deploy --only functions
   ```
10. Restart the app with `npx expo start -c`. The Demo banner disappears and you're live.

### Security rules (summary)
- **Matches:** only `scorerId` can change the score. Players are registered users; `participantIds` must be exactly both teams' players (plus the creator/scorer), stored in one canonical order (team A, team B, creator/scorer): every backend normalises to it before writing, so the rules can compare it exactly. Rules may read only 10 documents per request, so a registered team side is checked against the team's members, but for a side built by mobile number only the first 4 players' profiles are checked in the rules (all ids are format-checked); the app checks every player before writing and the API server checks all of them. A legacy match left short of players can still be abandoned by its scorer.
- **Tournaments:** the organiser only; teams must be registered teams with at least 6 members (the rules check the first 10 teams, the app and API server check all). The creator or the scorer can hand scoring to someone else (that field only). Anyone can add or remove only *themselves* under "I want to play". Only participants can add photos.
- **Teams:** only the captain can edit, and the captain can only invite numbers that are already registered (they must exist in `phoneIndex`, one new number per write). An invited player can accept or decline *only their own* invite, checked against the verified phone number in their auth token. Members can leave.
- **Users:** you can only write your own profile and claim your own verified number. Phone lookup allows a direct get only, never a list. Push tokens are private.
- **Storage:** images only, under 10 MB, written only under your own uid. Match photos are limited to match participants.

Run the rules tests (Java 11+ required for the emulator):
```bash
cd rules-tests && npm ci && npm test   # 43 tests (package-lock.json is committed)
```

---

## 3. Phone sign-in: how it works (Expo Go vs dev build)

The app uses the **Firebase JS SDK**. Firebase requires a reCAPTCHA check before it sends an SMS. VolleyLive handles this the same way the old `expo-firebase-recaptcha` did: a small **WebView served from your Firebase `authDomain`** runs an invisible reCAPTCHA and hands the token to the SDK (`src/components/PhoneVerifier.tsx`). On web it uses Firebase's built-in `RecaptchaVerifier`.

- This works in **Expo Go**, in development builds and in store builds. No native Firebase SDK is needed.
- Occasionally a "pick the images" challenge appears in that sheet. That's normal.
- Use Firebase **test phone numbers** during development to avoid SMS costs and limits.

> If you later want Play Integrity / silent APNs verification (no reCAPTCHA at all), you can switch auth to `@react-native-firebase/auth`. That requires a development build.

---

## 4. Running the app

### On your phone with Expo Go (fastest)
```bash
npx expo start
```
Scan the QR code. Phone auth, Firestore, Storage, maps, location and camera all work in Expo Go.
**Push notifications do not work in Expo Go on Android.** Use a development build for those.

### Development build (recommended for push and for final testing)
```bash
npm install -g eas-cli         # or use npx eas-cli@latest
eas login
eas init                       # creates the EAS project; put the id in .env as EAS_PROJECT_ID
eas build --profile development --platform android   # installs like a normal APK
eas build --profile development --platform ios       # needs an Apple Developer account
npx expo start --dev-client
```

### Android emulator / iOS simulator
- Android: install Android Studio, create a virtual device, start it, then `npx expo start` and press **a** (or `npx expo run:android` for a local native build).
- iOS (macOS only): install Xcode, then `npx expo start` and press **i** (or `npx expo run:ios`).
- Emulators can't receive real SMS. Use a Firebase test phone number.

### Web preview
`npx expo start --web`. Handy for a quick look. Maps show a simple key-less preview map on web (tap to drop a pin exactly where you tap; labels that would overlap are hidden).

**Place names.** On phones the place name comes from the phone's own geocoder (no API key). Browsers have none and the app doesn't send your location to a third-party geocoding service, so on web (or when the phone can't name a spot) the name field stays empty with a hint showing the coordinates. Type a name: matches, challenges, tournaments and courts need one. "Use my current location" gives up after 10 seconds (for example while a browser permission prompt is left open) and says so.

### Maps API key (Android builds only)
Expo Go needs no key. For Android dev and store builds, create a **Maps SDK for Android** key in Google Cloud and set `GOOGLE_MAPS_ANDROID_API_KEY` in `.env`. iOS uses Apple Maps, so no key is needed. An Android build made **without** the key doesn't crash: it shows the same preview map as the web build (`extra.hasGoogleMapsKey` in `app.config.ts` records only whether a key was set, never the key).

---

## 5. Publishing with EAS Build

1. Set the store identifiers in `.env` (`ANDROID_PACKAGE`, `IOS_BUNDLE_ID`). Replace `assets/icon.png` and the adaptive icon images with your artwork.
2. Add your env values to EAS so cloud builds can see them: `eas env:create` (or keep `.env`; `.easignore` makes sure it's uploaded).
3. **Google Play:**
   ```bash
   eas build --platform android --profile production   # produces an .aab
   eas submit --platform android                       # needs a Google Play developer account ($25 once)
   ```
   After the first upload, copy the **App signing SHA-1** from Play Console into your Maps API key restriction and into Firebase (Android app → SHA certificate fingerprints).
4. **App Store:**
   ```bash
   eas build --platform ios --profile production       # EAS manages certificates for you
   eas submit --platform ios                           # needs an Apple Developer account ($99/yr)
   ```
   For iOS push, let EAS create the APNs key when prompted (or upload one), then run `eas credentials`.
5. Install a test build quickly with `eas build --profile preview --platform android`, which produces an APK.

---

## 6. Push notifications

The device registers an **Expo push token** (stored privately in `pushTokens/{uid}`). Cloud Functions in `functions/src/index.ts` send pushes through the Expo Push API, which delivers via FCM and APNs, when:
- a captain invites you (registered users only) to their team,
- your team is challenged, or your challenge is accepted or declined,
- a match you're in goes live.

With the API server, the token is stored in MySQL (`device_tokens`) and the server sends the same pushes itself, so `functions/` is not needed.

Tapping a notification opens the right screen. Requirements: `EAS_PROJECT_ID` is set, you're running a development or store build, and the functions are deployed (Blaze plan). Without these, the app still shows invites and challenges in real time on the Home screen.

---

### Translations (English / हिन्दी)
- Strings live in `src/i18n/locales/en.ts` and `src/i18n/locales/hi.ts`. `hi.ts` is typed from `en.ts`, so a missing Hindi key is a TypeScript error, and `src/i18n/__tests__/keys.test.ts` checks keys and `{{placeholders}}` match.
- Use `const { t } = useTranslation()` in components and add every new string to **both** files.
- The app always opens in English unless the user picked Hindi (stored under `volleylive.language` in AsyncStorage).
- Push notification texts sent by `functions/` and `server/` are still English (the server doesn't know each user's language yet).

## 7. Notes & limitations (v1)

- Live **video streaming** isn't built yet. `Match.stream` and the placeholder UI are ready for an RTMP/WebRTC provider.
- "Nearby" filters on the phone (it downloads up to 200 live or upcoming matches). Add geohash queries when you have many users.
- Firestore's memory cache queues offline writes. The scorer also keeps a copy of every point on the phone and re-sends it on reconnect. Followers need a connection to see updates.
- Every player is a registered user. Teams are registered teams, or for a one-off match a side built by adding registered players by mobile number (not saved as a team). Each team needs at least 6 players (`MIN_PLAYERS` in `src/core/roster.ts`) before scoring can start, and at most 12. Tournaments take registered teams with at least 6 members.
- Demo data lives only on the device. Use **Profile → Reset demo data** to start over.
