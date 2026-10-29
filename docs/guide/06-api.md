# 6. API reference (API server)

Base URL: the server's public HTTPS address (`EXPO_PUBLIC_API_URL` in the app). All bodies are JSON.
Source: `server/src/app.ts`, `server/src/routes/auth.ts`, `server/src/routes/api.ts`, `server/src/domain/*`.

## 6.1 Conventions

| Topic | Rule |
|---|---|
| Auth | `Authorization: Bearer <token>` on every `/api` route (except `GET /api/daily-items`). Token = server session from OTP / Firebase exchange; dev tokens only with `AUTH_MODE=dev` (refused in production). |
| Terms | Every **write** requires the **current Terms version** to be accepted (`requireTerms`), otherwise `403` with a terms code. |
| Server-only fields | Fields the server owns (summary, verification, timestamps, lifecycle latches, …) are rejected with `400` if a client sends them. |
| Validation | `zod` schemas (`domain/schemas.ts`); errors are `400 { error, message, field? }`. |
| Body size | JSON limit **1 MB** (`413` above). |
| Errors | `400` bad request, `401` no / bad token, `403` forbidden, `404` not found, `409` conflict (e.g. `match_setup_locked`, stale progress), `413` too large, `429` rate limited (`rate_limited`), `500` internal (no details leaked). |
| Idempotency | `POST /api/matches` accepts an `Idempotency-Key` header; match progress uses a client sequence (`progress_seq`). |
| Headers | `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `X-Powered-By` disabled; CORS only for `CORS_ORIGINS`. |

The Auth column summarises the checks in `server/src/domain/*`; the domain code is authoritative.

**Auth column legend:** *public* = no token · *user* = any signed-in user · *owner* = the resource's owner ·
*captain* / *organiser* / *scorer* / *creator* = that role on the resource · *admin* = a uid in `ADMIN_UIDS`.

## 6.2 Health and files

| Method | Path | Purpose | Auth |
|---|---|---|---|
| GET | `/health` | health with a database ping (2 s timeout) | public |
| GET | `/healthz` | liveness (`{ ok: true }`) | public |
| GET | `/files/<key>?exp=…&sig=…` | photo / screenshot download through an **HMAC-signed, expiring URL** (`FILE_URL_SECRET`, `FILE_URL_TTL_SECONDS`) | signed URL |
| GET | `/api/daily-items` | Fact / Quote of the day items (cached 300 s, per-IP rate limit) | public |
| WS | `/live` | live updates; first message `{"type":"auth","token":…}` | user |

## 6.3 Auth (`/auth`)

| Method | Path | Purpose | Auth |
|---|---|---|---|
| POST | `/auth/otp/request` | send an OTP to a mobile number → `202` (limits per number and per IP, resend gap) | public |
| POST | `/auth/otp/verify` | verify the 6-digit code → session token | public |
| POST | `/auth/firebase` | exchange a Firebase ID token for a server session | public (valid ID token) |
| POST | `/auth/logout` | revoke the current session → `204` | user |
| GET | `/auth/config` | sign-in configuration for the app (mode, lengths) | public |

## 6.4 Me and users

| Method | Path | Purpose | Auth |
|---|---|---|---|
| GET | `/api/me` | own profile, admin flag, terms state | user |
| POST | `/api/me/terms/accept` | accept the current Terms version (rate limit `terms`) | user |
| GET | `/api/me/wallet` | wallet: balance, counted matches / wins, bonus, history | user |
| PUT | `/api/me/push-tokens` | register a push token | user |
| DELETE | `/api/me/push-tokens/:token` | remove a push token | user |
| GET | `/api/users?ids=…` | profiles for given ids (no listing of all users) | user |
| GET | `/api/users/by-phone/:phone` | look up a registered user by number to add them to a team (returns no phone of others) | user |
| GET | `/api/pincode/:pin` | pincode → district / state (rate limits per user and per IP) | user |
| GET | `/api/users/:id` | a profile (private fields only for the owner) | user |
| PUT | `/api/users/:id` | create / update own profile | owner |
| DELETE | `/api/users/:id` | delete own account | owner |
| POST | `/api/users/:id/avatar` | upload own avatar | owner |
| GET | `/api/users/:id/photos` | a user's match photos (memories) | user |

## 6.5 Teams

| Method | Path | Purpose | Auth |
|---|---|---|---|
| GET | `/api/teams` | teams (own and searchable) | user |
| POST | `/api/teams` | create a team (caller becomes captain) | user |
| GET | `/api/teams/:id` | team detail and roster | user |
| PATCH | `/api/teams/:id` | edit name, colour, members, invites | captain |
| POST | `/api/teams/:id/accept` | accept an invite | invited user |
| POST | `/api/teams/:id/decline` | decline an invite | invited user |
| POST | `/api/teams/:id/leave` | leave a team | member |
| DELETE | `/api/teams/:id` | delete a team | captain |

## 6.6 Matches

| Method | Path | Purpose | Auth |
|---|---|---|---|
| GET | `/api/matches` | matches visible to the caller (filters) | user |
| POST | `/api/matches` | create a match (`Idempotency-Key`, rate limit `matchWrite`) | user |
| GET | `/api/matches/:id` | match detail | user |
| PATCH | `/api/matches/:id` | edit set-up before the first rally (`409 match_setup_locked` after) | creator / scorer |
| PUT | `/api/matches/:id/progress` | save rallies (events + sequence); server replays and derives the summary | scorer |
| GET | `/api/matches/:id/handoff-admins` | who scoring can be handed to | scorer |
| POST | `/api/matches/:id/abandon` | abandon (policy-dependent outcome) | scorer |
| POST | `/api/matches/:id/abandon-request` | answer an abandon consent request | captain |
| POST | `/api/matches/:id/abandon-report` | report an abandon | opposing captain |
| PUT | `/api/matches/:id/player-of-match` | set Player of the Match | scorer |
| POST | `/api/matches/:id/confirm` | confirm the result (rate limit `verify`) | opposing captain |
| POST | `/api/matches/:id/reject` | reject the result with a reason (≤ 200 chars) | opposing captain |
| DELETE | `/api/matches/:id` | delete a match that never had a rally | creator / admin |
| GET | `/api/matches/:id/photos` | photos (signed URLs) | user |
| POST | `/api/matches/:id/photos` | upload photos (images ≤ 10 MB, ≤ 50 per match) | participant |
| DELETE | `/api/matches/:id/photos/:photoId` | delete a photo | uploader / admin |

## 6.7 Rankings, challenges, tournaments, courts

| Method | Path | Purpose | Auth |
|---|---|---|---|
| GET | `/api/rankings` | player rankings (counted results only) | user |
| GET | `/api/challenges` | challenges of the caller's teams | user |
| POST | `/api/challenges` | send a challenge | captain |
| PATCH | `/api/challenges/:id` | respond (decline) / cancel | captain |
| POST | `/api/challenges/:id/accept` | accept and create the challenge match atomically | challenged captain |
| DELETE | `/api/challenges/:id` | delete a challenge | sending captain |
| GET | `/api/tournaments` | tournaments | user |
| POST | `/api/tournaments` | create a tournament and its fixtures | user (becomes organiser) |
| GET | `/api/tournaments/:id` | tournament, tables, fixtures | user |
| PATCH | `/api/tournaments/:id` | edit / advance fixtures | organiser / admin |
| DELETE | `/api/tournaments/:id` | delete a tournament | organiser / admin |
| GET | `/api/courts` | courts | user |
| POST | `/api/courts` | add a court | user |
| PATCH | `/api/courts/:id` | edit a court | adder / admin |
| DELETE | `/api/courts/:id` | delete a court | adder / admin |

## 6.8 Feedback and support

| Method | Path | Purpose | Auth |
|---|---|---|---|
| POST | `/api/feedback` | send stars + text (burst 5, 1 per 12 min) | user |
| GET | `/api/admin/feedback` | read feedback | admin |
| POST | `/api/support/tickets` | open a support ticket | user |
| GET | `/api/support/tickets` | own tickets and replies | owner |
| POST | `/api/support/tickets/:id/screenshot` | attach a screenshot | owner |
| GET | `/api/admin/support/tickets` | all tickets | admin |
| PATCH | `/api/admin/support/tickets/:id` | reply / change status | admin |

## 6.9 Ask VolleyLive

| Method | Path | Purpose | Auth |
|---|---|---|---|
| POST | `/api/ask` | RAG-only answer (burst 10, 2 / min) | user |
| POST | `/api/ask/chat` | agent answer with tools and cards, saved to history (burst 20, 6 / min) | user |
| GET | `/api/ask/history` | own history | owner |
| DELETE | `/api/ask/history` | clear own history | owner |
| GET | `/api/admin/ask/content` | list custom content | admin |
| PUT | `/api/admin/ask/content/:id` | add / edit custom content | admin |
| DELETE | `/api/admin/ask/content/:id` | delete custom content | admin |
| POST | `/api/admin/ask/reindex` | rebuild the RAG index | admin |

## 6.10 Admin: daily items and match review

| Method | Path | Purpose | Auth |
|---|---|---|---|
| GET | `/api/admin/daily-items` | list items incl. tombstones | admin |
| POST | `/api/admin/daily-items` | add a Fact / Quote | admin |
| PATCH | `/api/admin/daily-items/:id` | edit | admin |
| DELETE | `/api/admin/daily-items/:id` | tombstone (blank text, never a hard delete) | admin |
| GET | `/api/admin/matches/flagged` | flagged matches to review | admin |
| POST | `/api/admin/matches/:id/review` | approve (clears the flag) / void | admin (not in the match) |
| POST | `/api/admin/matches/:id/scorer` | reassign the scorer | admin |
| POST | `/api/admin/matches/:id/repair-verdict` | repair a match nobody can confirm (audited) | admin |
| POST | `/api/admin/matches/:id/resolve` | reinstate / confirm an abandon, decide a request | admin |

## 6.11 Rate limits (summary)

| Bucket | Burst | Refill |
|---|---|---|
| `terms` | 5 | 5 / min |
| `verify` | 10 | 10 / min |
| `matchWrite` | 120 | 120 / min |
| feedback | 5 | 1 per 12 min |
| pincode | user 10 / IP 40 | 6 / 30 per min |
| daily items (public) | 30 | 30 / min |
| Ask / Ask chat | 10 / 20 | 2 / 6 per min |
| OTP | `OTP_MAX_PER_HOUR` per number, `OTP_IP_PER_HOUR` per IP, `OTP_RESEND_SECONDS` gap, `OTP_MAX_ATTEMPTS` | – |

Limits are token buckets per user (shared via Redis when `REDIS_URL` is set). Over the limit the server answers `429`.
