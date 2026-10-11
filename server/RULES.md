# Security rules → server enforcement

Every line of `firestore.rules` and `storage.rules` maps to a check in `src/domain/*`. A rejected
request returns **403** with the rule id in brackets at the end of the message (for example
`… [teams.update.captain]`). Requests without a valid token get **401** before any route runs,
which covers `signedIn()` everywhere. Input shapes (types, lengths, enums, E.164 phones) are
validated with zod (`src/domain/schemas.ts`) and return **400**. The schema adds a second layer
of CHECK, FK and UNIQUE constraints in MySQL. Tests: `tests/*.test.ts`.

Legend: ✅ same as the rule · ➕ tightened compared with Firestore · ⚙️ different mechanism

## Helpers

| rule | server |
|---|---|
| `signedIn()` | `requireAuth` middleware on `/api/*` and the `/live` auth handshake → 401 / close 4401 ✅ |
| `uid()` | `Identity.uid` from the verified token ✅ |
| `myPhone()` = `request.auth.token.phone_number` | `Identity.phone` from the verified token (null if none) ✅ |
| `changed()` = `diff(...).affectedKeys()` | `changedKeys(before, after, keys)` in `domain/util.ts` (deep compare of canonical JSON) ✅ |

## users / phoneIndex / pushTokens (`domain/users.ts`)

| rule line | server | id |
|---|---|---|
| `users read: signedIn()` | `GET /users/:id`, `GET /users?ids=` (ids required, no full listing) ✅ ➕ the `phone` field is only returned to its owner, or to a caller who looked the user up by that phone | — |
| `users create, update: uid() == userId` | `saveProfile`: `viewer.uid === p.id` | `users.write` |
| `… && phone == myPhone()` | `p.phone === viewer.phone` (no phone on the token = refused) | `users.write` |
| `… && name is string && 0 < size <= 60` | zod `profileSchema` + DB CHECK `chk_users_name` | 400 |
| `users delete: false` | `DELETE /users/:id` always refused | `users.delete` |
| `pushTokens read, write: uid() == userId` | `PUT/DELETE /me/push-tokens` only act on the caller; tokens are never returned by any route ➕ | — |
| `phoneIndex get: signedIn()` | `GET /users/by-phone/:e164` (exact match) ✅ | — |
| `phoneIndex list: false` | no listing route; `GET /users` without `ids` → 400 ✅ | — |
| `phoneIndex create, update: phone == myPhone() && uid == uid()` | ⚙️ no separate index: `users.phone` is UNIQUE and only settable to your own verified phone, so a number can't be claimed twice (409) | `users.write` |
| `phoneIndex delete: false` | no route ✅ | — |

## teams (`domain/teams.ts` → `decideTeamUpdate`, `createTeam`, `deleteTeam`)

| rule line | server | id |
|---|---|---|
| `read: signedIn()` | `GET /teams/:id`, `GET /teams?member=` / `?q=` ✅ ➕ `pendingPhones` shown in full only to the captain, others see only their own number; `?invitedPhone=` only for your own number | `teams.read.invites` |
| `create: captainId == uid()` | `createTeam` | `teams.create` |
| `… && memberIds == [uid()]` | `memberIds` must be exactly `[uid]` | `teams.create` |
| `… && pendingPhones.size() == 0` | ✅ | `teams.create` |
| `… && name is string && size <= 40` | zod + DB CHECK | 400 |
| `update: isCaptain() && captainId in memberIds` | captain branch | `teams.update.captain` |
| `… && memberIds.size() <= 12 && pendingPhones.size() <= 12` | ✅ ➕ also `members + pending ≤ 12`, `subs ⊆ members`, `subs ≤ 6`, and the captain cannot add members directly (players join by accepting) | `teams.update.captain` |
| `… && invitesOnlyRegistered()` | every newly added number must belong to a registered user ⚙️ (Firestore could only check one appended number per write; SQL checks them all) | `teams.update.invitesOnlyRegistered` |
| `acceptingInvite()`: `myPhone() in pendingPhones`, only `memberIds/pendingPhones/subIds` change, `memberIds == old ∪ {uid}`, `pendingPhones == old − {myPhone}`, new subs ⊆ `{uid}` | same set algebra, also exposed as `POST /teams/:id/accept`, which computes the change itself ➕ can't remove others from subs; joins as a sub when 6 starters exist; team-full and 6-sub limits | `teams.update.acceptingInvite` |
| `decliningInvite()` | same; `POST /teams/:id/decline`; the invite row is kept with status `declined` | `teams.update` |
| `leaving()`: member, not captain, removes only self from `memberIds`/`subIds` | same; `POST /teams/:id/leave` | `teams.update` |
| (no branch matched) | 403 | `teams.update` |
| `delete: isCaptain()` | `deleteTeam` | `teams.delete` |

The team document is reassembled from `teams`, `team_members` (role starter/sub) and
`team_invites` (status pending/accepted/declined/revoked) under a `FOR UPDATE` lock. The
proposed document is checked with the same branch logic as the rules, and only the difference is
written.

## matches (`domain/matches.ts` → `decideMatchUpdate`, `createMatch`, `saveProgress`, `deleteMatch`)

| rule line | server | id |
|---|---|---|
| `read: signedIn()` | `GET /matches…`, WS `match:<id>` ✅ ➕ `stream.ingestUrl` only for the creator/scorer, never on the socket | — |
| `create: createdBy == uid()` | ✅ | `matches.create` |
| `… && scorerId is string` | zod; the scorer must be a registered user (FK) | 400 |
| `… && uid() in participantIds` | ✅ | `matches.create` |
| `participantsOk()` + `playersOk()`: participantIds = team A's players, team B's players, then only the creator/scorer | ✅ checked as a set (`participantsMatchRoster` in `src/core/roster.ts`), on create and whenever teams or participants change; then **stored and returned in the rules' order** (`canonicalParticipants`: team A, team B, creator/scorer), whatever order the client sent. `match_participants` has no order column, so reads rebuild that order too. The app's Firebase and demo backends normalise the same way before writing, so all three agree and the rules can stay an exact comparison | 400 `Participants must be the players of both teams (plus the creator or scorer)` |
| `update: isScorer() && scorerId unchanged && createdBy unchanged` | scorer branch: the only branch that may change `events`, `status`, `lineups` and the other match fields | `matches.update.scorer` |
| ↳ (summary/status written by the client) | ⚙️ the server ignores the client's `summary` and derives summary, status (`live`/`finished`), `sets`, per-point server and rotation from the events with `src/core` ➕ events after the end of the match, timeouts over the per-set limit, and credits for a player not on the scoring team (QA bug A) are rejected (400) | 400 |
| ↳ **lineups** (rotation feature) | scorer only ✅; validated: set numbers within best-of, 6 slots per team, players must be on that team's roster, no duplicates | `matches.update.scorer` / 400 |
| `PUT /matches/:id/progress` | same scorer check | `matches.update.scorer` |
| `(createdBy == uid() \|\| isScorer()) && changed().hasOnly(['scorerId','updatedAt'])` | handover branch (new scorer must be a registered user) | `matches.update` |
| `interestedToggle()`: only `interestedIds` changes, symmetric difference ⊆ `{uid}` | ✅ (stored in `play_requests`) | `matches.update` |
| (no field changed) | allowed as a no-op, like Firestore | — |
| `delete: createdBy == uid() && status != 'live'` | ✅ (also deletes its photos from disk) | `matches.delete` |
| `validRoster()`: player ids are user ids (no typed names/guests), ≤ 12 per team, nobody twice, nobody on both teams | ✅ ➕ **every** player must exist in `users` (Firestore can only check the id format for by-number sides: 10 reads per request); names and photos are copied from `users`, not taken from the client | 400 `Every player must be a registered VolleyLive user` / `A team can have at most 12 players` / `A player can only appear once in a match` |
| `teamMembersOk()`: a side with `teamId` lists only that team's members | ✅ (team must exist; `team_members` checked) | 400 |
| `enoughPlayers()`: `MIN_PLAYERS` (6, `src/core/roster.ts`) per team once `status == 'live'` or a rally is recorded | ✅ (scheduled matches may have fewer while a team is recruiting); part of the scorer branch only, as in the rules (handover / "I want to play" don't re-check it) | `matches.roster.minPlayers` |
| `abandonOnly()`: a match short of players (legacy data, or players removed by 0002) may still be set to `abandoned` by its scorer when only `status`/`finishedAt` change | ✅ (`isAbandonOnly`); it still can't be scored | — |
| scorer branch: `teamA`/`teamB`/`participantIds` change only while `events` is empty | ✅ (players can be updated before the first rally, never after) | `matches.roster.locked` |

### matches/{id}/photos + storage `matches/{matchId}/{userId}/{file}` (`domain/photos.ts`)

| rule line | server | id |
|---|---|---|
| `photos read: signedIn()` / storage `read: signedIn()` | list requires auth; the file itself is served from `/files/…` with an HMAC signature that expires ⚙️ (unguessable and time-limited, instead of a Firebase download token) | — |
| `photos create: uploadedBy == uid()` | the server sets `uploadedBy` from the token ➕ | — |
| `… && uid() in match.participantIds` (both rule files) | ✅ | `photos.create` |
| storage `request.auth.uid == userId` | the storage key is built from the token uid ✅ | — |
| storage `isImage()`: `contentType image/*` | allow-list of JPEG/PNG/WebP/HEIC/GIF ➕ (no SVG/HTML), DB CHECK on content type | `photos.create` |
| storage `isImage()`: `size < 10 MB` | ✅ (413), DB CHECK on size | 413 |
| `photos delete` / storage `delete`: `uploadedBy == uid()` | ✅ (the row and the file are deleted together) | `photos.delete` |
| storage `avatars/{userId}`: `write: auth.uid == userId && isImage()` | `POST /users/:id/avatar` | `storage.avatars.write` |
| storage `/{allPaths=**}: false` | nothing else is writable; `/files/` rejects keys outside the storage root | — |

## challenges (`domain/challenges.ts`)

| rule line | server | id |
|---|---|---|
| `read: signedIn()` | `GET /challenges?teams=` ✅ | — |
| `create: fromCaptainId == uid()` | ✅ | `challenges.create` |
| `… && status == 'pending'` | ✅ (missing status = pending) | `challenges.create` |
| `… && teams[fromTeamId].captainId == uid()` | ✅ (row read in the transaction) | `challenges.create` |
| `… && teams[toTeamId].captainId == toCaptainId` | ✅ ➕ team names are taken from the DB, not the client | `challenges.create` |
| `update: toCaptainId == uid() && status == 'pending' && only status/matchId && status in [accepted, declined]` | respond branch (matchId must exist) | `challenges.update` |
| `… \|\| fromCaptainId == uid() && pending && only status && status == 'cancelled'` | cancel branch | `challenges.update` |
| `delete: false` | always refused | `challenges.delete` |
| `teamCanPlay()`: both teams have ≥ `MIN_PLAYERS` members on create and on accept | ✅ | `challenges.create.teamSize` / `challenges.accept.teamSize` |

## tournaments (`domain/tournaments.ts`)

| rule line | server | id |
|---|---|---|
| `read: signedIn()` | ✅ | — |
| `create: organizerId == uid()` | ✅ ➕ fixture team keys, fixture ids and match ids are validated (FKs) | `tournaments.create` |
| `update: organizerId == uid() (before and after)` | ✅ | `tournaments.update` |
| `delete: organizerId == uid()` | ✅ | `tournaments.delete` |
| `tournamentTeamsOk()`: teams are registered teams with ≥ `MIN_PLAYERS` members (create, and updates that change `teams`) | ✅ every team (the rules check the first 10: one read each; the app checks all) | 400 `Tournament teams must be registered teams` / `A team needs at least 6 players to play` |
| deleting a team that is in a tournament | ➕ refused (`tournament_teams.team_id` is required since 0002) | 409 |

## courts (`domain/courts.ts`)

| rule line | server | id |
|---|---|---|
| `read: signedIn()` | ✅ | — |
| `create: addedBy == uid()` | ✅ | `courts.create` |
| `update, delete: resource.addedBy == uid()` | ✅ ➕ `addedBy` can't be reassigned | `courts.update` / `courts.delete` |

## Migrations and legacy data

- `0002_registered_players.sql` removed guest / typed-name players and name-only tournament teams.
- `0003_uncredit_removed_players.sql` clears point credits (`points.player_key`, `points.server_key`)
  that still named a removed player, and the fixture key of matches whose tournament 0002 deleted.
  Rallies are kept (deleting them would change scores). It only touches rows that are still
  invalid, so it is safe on databases where 0002 ran long ago and on fresh ones, and a re-run
  changes nothing (`tests/matches.test.ts` runs it twice).
- A live match left with fewer than 6 players can't be scored; its scorer can abandon it, or, before
  the first rally, add players or set it back to `scheduled`.

