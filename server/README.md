# VolleyLive API server (MySQL)

Node 20 + TypeScript backend that replaces Firestore/Storage/Cloud Functions for VolleyLive.
Firebase stays **only** for phone OTP sign-in (the app sends its Firebase ID token) and the
app's Expo push token; push messages are now sent from this server.

```
app (Expo)  ──REST /api/*──▶  Express ──▶ domain/* (rules) ──▶ Knex ──▶ MySQL 8
     ▲                            │
     └──── WebSocket /live ◀── LiveBus (after commit)       photos ──▶ local disk (/files, signed URLs)
                                  └──▶ Expo push service (was functions/)
```

## Why Express + Knex

* **Plain, inspectable SQL.** The schema lives in hand-written SQL migrations with real foreign
  keys, CHECK constraints, generated columns and composite keys. Knex is a thin query builder
  over that, with no ORM model layer to keep in sync and no code generation step.
* **Row locks where the rules need them.** Every rule check that reads-then-writes (team edits,
  invites, scoring, challenge answers) runs inside a transaction with `SELECT … FOR UPDATE`, so
  two phones can't race each other past a rule.
* **Small and boring.** Express 4 + `ws` is enough for ~20 routes and one socket endpoint, and it
  is easy to host anywhere. The app's scoring/rotation engine (`src/core`) is imported directly,
  so the server derives summaries, sets and rotations with exactly the same code as the app.
* Considered: Prisma (great DX, but generated client + its own migration format and weaker
  support for generated columns/CHECKs), NestJS (too much structure for this size), Fastify
  (fine too; Express was chosen for familiarity and middleware availability).

## Layout

```
server/
  migrations/0001_init.sql   schema (21 tables + schema_migrations)
  migrations/0002_registered_players.sql
                             registered players only: match_players.user_id and
                             tournament_teams.team_id become NOT NULL (legacy guest
                             players / name-only tournament teams are removed)
  src/
    index.ts                 wires config, MySQL, auth, storage, push, WebSocket
    app.ts                   Express app: CORS, /health, /files (signed), /api, error mapping
    config.ts                env parsing (see .env.example)
    auth/                    TokenVerifier (Firebase, dev, static-for-tests) + middleware
    db/                      knex setup, migration runner + CLI, demo seed + CLI
    domain/                  one module per entity; every Firestore rule is enforced here
    live/                    LiveBus (in-process) + WebSocket hub
    push/                    Expo push sender (+ in-memory sender for tests)
    storage/                 PhotoStorage interface + LocalDiskStorage
    routes/                  REST routes
  tests/                     node:test + supertest against a real MySQL
  RULES.md                   firestore.rules / storage.rules → server mapping, line by line
  Dockerfile, docker-compose.yml, .env.example
```

## Setup

### Option A: Homebrew (macOS)

```bash
brew install mysql@8.4 node@20
brew services start mysql@8.4
# create a database and an app user (pick your own password)
mysql -uroot -e "CREATE DATABASE volleylive; CREATE DATABASE volleylive_test;
  CREATE USER 'volleylive'@'localhost' IDENTIFIED BY 'CHANGE_ME';
  GRANT ALL ON volleylive.* TO 'volleylive'@'localhost';
  GRANT ALL ON volleylive_test.* TO 'volleylive'@'localhost';"
cd server
cp .env.example .env        # then edit DATABASE_URL, FIREBASE_PROJECT_ID, FILE_URL_SECRET …
npm install
npm run migrate
npm run seed                # optional: the app's demo data (development only)
npm run dev                 # http://localhost:4000
```

### Option B: Docker Compose

```bash
cd server
cp .env.example .env        # edit; DATABASE_URL is overridden by compose
MYSQL_PASSWORD=choose-one MYSQL_ROOT_PASSWORD=choose-another docker compose up --build
```

Compose starts MySQL 8.4 (also creates `volleylive_test`) and the API on port 4000, and the API
runs migrations on start. Uploaded photos go to the `uploads` volume.

### Point the app at the server

In the app's `.env`:

```
EXPO_PUBLIC_API_URL=http://<your-computer-LAN-IP>:4000
```

With Firebase keys set, the app signs in with Firebase phone auth and uses the API for all
data. Without Firebase, for **local testing only**, run the server with `AUTH_MODE=dev` and set
`EXPO_PUBLIC_API_DEV_AUTH=1` in the app. You then sign in with any number and the code `123456`.
Dev auth accepts unsigned `dev:<phone>` tokens, so anyone can be anyone. The server refuses
`AUTH_MODE=dev` when `NODE_ENV=production`.

Without `EXPO_PUBLIC_API_URL` the app behaves as before: Firestore if Firebase keys are set,
otherwise offline demo mode.

## Scripts

| command | what it does |
|---|---|
| `npm run dev` | watch mode with tsx |
| `npm run build` / `npm start` | compile to `dist/` and run it |
| `npm run migrate` | apply pending migrations (`-- --reset` drops everything first; refused in production) |
| `npm run seed` | load the app's demo data through the rule-checked domain code (refused in production; skipped if users exist) |
| `npm test` | API tests against `TEST_DATABASE_URL` (the database name must end in `_test`, and every table is dropped) |
| `npm run typecheck` | `tsc --noEmit` |

```bash
TEST_DATABASE_URL=mysql://volleylive:CHANGE_ME@127.0.0.1:3306/volleylive_test npm test
```

## Auth

`Authorization: Bearer <token>` on every `/api` request.

* `AUTH_MODE=firebase`: `firebase-admin` verifies the Firebase ID token (signature, project,
  expiry, revocation is not checked). Only `FIREBASE_PROJECT_ID` is needed: no service-account
  key. The token's `phone_number` claim is the user's verified phone, used exactly like
  `request.auth.token.phone_number` in the old rules.
* `AUTH_MODE=dev`: see above.
* The verifier is injectable (`TokenVerifier`); tests use a static map of tokens.

## REST API (all under `/api`, JSON)

| | |
|---|---|
| `GET /me` | `{uid, phone, profile}` |
| `PUT /me/push-tokens` `{token, platform?}` · `DELETE /me/push-tokens/:token` | the caller's Expo push tokens |
| `GET /users?ids=a,b` · `GET /users/:id` · `PUT /users/:id` | profiles (phone only visible to its owner) |
| `GET /users/by-phone/:e164` | exact lookup (no listing) |
| `POST /users/:id/avatar` (raw image body) | → `{url}` |
| `GET /teams?member=uid` / `?invitedPhone=own-e164` / `?q=prefix` | |
| `POST /teams` · `GET/PATCH/DELETE /teams/:id` | PATCH takes the same partial doc the app used to write |
| `POST /teams/:id/accept` · `/decline` · `/leave` | invite flows |
| `GET /matches` (`?status=live,scheduled` · `?participant=` · `?tournament=` · `?public=1`) | |
| `POST /matches` · `GET/PATCH/DELETE /matches/:id` | PATCH: scorer edits (incl. `lineups`), handover, "I want to play" |
| `PUT /matches/:id/progress` `{events, status?, startedAt?, finishedAt?}` | scorer only; summary, status, sets, rotation derived server-side |
| `GET/POST /matches/:id/photos` · `DELETE /matches/:id/photos/:photoId` | |
| `GET /challenges?teams=a,b` · `POST /challenges` · `PATCH /challenges/:id` | |
| `GET/POST /tournaments` · `GET/PATCH/DELETE /tournaments/:id` | |
| `GET/POST /courts` · `PATCH/DELETE /courts/:id` | |

Errors are `{error, message}`. Rule rejections are `403` with the rule id at the end of the
message (e.g. `Only the assigned scorer can change the score [matches.update.scorer]`), so they
can be traced to `RULES.md`. Validation errors are `400` and duplicates are `409`.

Every match response includes the derived `summary` and a `rotation` object (positions per team,
serving side, current server, rotations this set), computed by `src/core/rotation.ts` from the
lineups and the event log.

## Live scoreboard: WebSocket `/live`

```
client → {"type":"auth","token":"<same bearer token>"}     server → {"type":"ready","uid":"…"}
client → {"type":"sub","topic":"match:<id>"}               server → {"type":"doc","topic":"match:<id>","data":{…match…}}
client → {"type":"unsub","topic":"…"}                      server → {"type":"invalidate"|"deleted","topic":"…"}
```

* `match:<id>` pushes the **full match document** after every saved rally (the stream ingest URL
  is removed), so a spectator never needs to poll.
* `matches`, `teams`, `team:<id>`, `profile:<uid>`, `photos:<matchId>`, `challenges`,
  `tournament:<id>`, `tournaments`, `courts` send `invalidate` only, and the client refetches
  over REST. Their content depends on the viewer (phone privacy), so it is not broadcast.
* Unauthenticated sockets are closed after 10 s or on a bad token (code 4401). There are at
  most 200 topics per socket, and a ping is sent every 30 s.

## Photos

`PhotoStorage` is an interface. `LocalDiskStorage` writes under `STORAGE_DIR`, and only images
(JPEG/PNG/WebP/HEIC/GIF) under 10 MB are accepted. The DB stores `storage:<key>`. Responses
contain an HMAC-signed, expiring URL `/files/<key>?exp=…&sig=…`, served with `nosniff`. To move
to S3/GCS later, implement the same interface.

## Push

The old Cloud Functions (`functions/src/index.ts`) are ported into the domain code and fire
after the transaction commits:

| old function | now |
|---|---|
| `onChallengeCreated` | `createChallenge` → challenged captain |
| `onChallengeUpdated` | `respondChallenge` → challenger (accepted/declined, real changes only) |
| `onTeamInvite` | `changeTeam` → newly invited registered users |
| `onMatchCreatedLive` / `onMatchLive` | `createMatch` / `writeMatch` → players except the scorer when a match goes live |

`ExpoPushSender` batches 100 per request and deletes tokens that Expo reports as
`DeviceNotRegistered`. Set `PUSH_ENABLED=0` to turn it off.

## Scaling notes

* `LiveBus` is in-process, so run **one** API instance, or replace the bus with Redis pub/sub
  (same `publish/subscribe` interface) before scaling out.
* Photos on local disk need a shared volume (or the S3 adapter) for multiple instances.
