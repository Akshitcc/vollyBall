# 9. Security and privacy

## 9.1 Authentication

| Mode | How it works | Where allowed |
|---|---|---|
| **OTP (API)** | `POST /auth/otp/request` sends a 6-digit code by SMS; the code is stored **hashed** in `otp_challenges` with an expiry and an attempt counter; `POST /auth/otp/verify` issues a **server session** (`auth_sessions`, signed with `SESSION_SECRET`, lifetime `SESSION_TTL_SECONDS`). Limits per number, per IP, per hour and a resend gap. | production |
| **Firebase (API)** | the app signs in with Firebase phone auth; `firebase-admin` verifies the ID token (only `FIREBASE_PROJECT_ID` is needed, **no service-account key**) and `POST /auth/firebase` exchanges it for a session | production |
| **Firebase direct** | Firebase phone auth on the device; Firestore / Storage rules use `request.auth` | Firebase builds |
| **Dev** | unsigned `dev:<number>` tokens – anyone can be anyone | **local testing only**; the server refuses `AUTH_MODE=dev` with `NODE_ENV=production`, the production app build refuses `EXPO_PUBLIC_API_DEV_AUTH` |
| **Demo** | everything on the phone, demo code | demo builds only; production bundles strip demo code (`EXPO_PUBLIC_STRIP_DEMO=1`, `check:strip`) |

- **Admins** are configured server-side (`ADMIN_UIDS`); the app cannot make anyone an admin. Demo admins must be empty in production.
- **Sign-out** revokes the server session. Unauthenticated WebSockets are closed after 10 s.
- **Minimum age** (`MIN_AGE`, default 10) is checked at profile creation.
- **Terms gate**: every write requires the current Terms version to be accepted.

## 9.2 Authorisation rules

The same rules are enforced in three places – the **API domain code**, the **Firestore rules** and the **demo
backend** – and shared tests prove they agree.

- **Scorer only** scores, undoes and finishes a match; setup is locked after the first rally.
- **Final after the winning rally**: afterwards only POTM, a credit on one of the last 3 rallies and captain / admin
  fields can change. The server and the rules **re-derive the summary from the rally log** and never trust a stored one.
- **Captain verdict**: only the opposing captain confirms or rejects; the scorer and creator cannot confirm for the
  other side. Admin approval only clears a fraud flag (`ADMIN_APPROVAL.COUNTS_WITHOUT_CAPTAIN = false`).
- **Anti-fraud**: matches shorter than 10 minutes are flagged; at most 3 counted matches per player per IST day and 2
  per team pair per IST week; an admin cannot review a match they played in, scored or created.
- **Teams / challenges / tournaments**: only captains edit teams and send / answer challenges; only the organiser (or
  an admin) changes a tournament; a challenge links only to a match between its two teams.
- **Delete**: a match that ever had a rally cannot be deleted by anyone (admins included).
- **Server-only fields** are rejected with 400.
- **Row locks** (`SELECT … FOR UPDATE`) make every read-check-write atomic, so two phones cannot race past a rule.
- **Firebase-only gaps** (the rules cannot replay a whole match or check the current captain) are listed in
  `docs/KNOWN-GAPS.md` and `LC_CLIENT_ONLY`.

## 9.3 Rate limiting and abuse

Token buckets per user and per IP (shared through Redis when configured): terms, verify, match writes, feedback,
pincode, public daily items, Ask, Ask chat, and the OTP limits. See [06 – API](06-api.md#611-rate-limits-summary).
Feedback is never rewarded, so there is no incentive to spam it.

## 9.4 Privacy and personal data

| Data | Who can see it |
|---|---|
| Mobile number | only the user (and the server for sign-in); others can **add** you by number but never **see** your number |
| Email, date of birth, pincode, wallet | only the user (`users/{uid}/private` in Firebase; owner-only fields in the API) |
| Name, role, city, avatar, public stats | signed-in users |
| Match location | only when the user shares it |
| Photos | served through signed, expiring URLs (`/files/…?exp=…&sig=…`) with `nosniff`; images only, ≤ 10 MB |
| Ask history | owner only; questions are masked before they are stored |
| Ask audit | outcome, tools and an **HMAC** hash of the question – never the phone number or a key |

- **PII masking** (`src/core/pii.ts`): phone numbers and e-mails are masked in Ask answers, cards, stored history and
  the audit, across digit scripts and separators. Ask tool data is filtered of private keys before any model sees it.
- **Account deletion**: `DELETE /api/users/:id` (owner) on the server; there is **no in-app button yet** (open item).
- **Privacy policy**: `docs/privacy-policy-draft.md` is a **draft** and must be reviewed for India's DPDP Act before launch.
- **Points** have no money value (stated in the Terms and the wallet).

## 9.5 Transport and server hardening

- HTTPS only in production (`EXPO_PUBLIC_API_URL` must be https; `CORS_ORIGINS` https only).
- Security headers: `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `X-Powered-By` off.
- JSON body limit 1 MB; uploads checked by type and size; content hashes for photos.
- 500 errors return no internal details; tokens, keys and OTP codes are kept out of logs and messages (only variable names appear in config errors).
- Optional TLS to MySQL (`DB_SSL*`).
- Config validation refuses unsafe production settings at start-up.

## 9.6 No-secrets policy

1. **Never commit secrets.** `.env`, `.env.*` (except `.env.example`), `env.*.json`, `*.pem`, `*.key`, `*.p12`,
   `*.jks`, `*.keystore`, databases and backups are excluded from the repo.
2. `.env.example` files contain **placeholders only**.
3. Real values live in the EAS environment, the host's secret store or a local git-ignored `.env`.
4. Documentation lists variables **by name only**.
5. Before every push a scan checks file names and content for private keys and common token formats (GitHub, AWS,
   Google, Slack, Stripe, OpenAI, Anthropic, xAI), password assignments, signing passwords, staged symlinks and
   placeholder lengths in `.env.example`. Any hit stops the push.
6. The Ask provider key (`ASK_API_KEY`) is never sent to the app and never logged.
7. Test vectors that look like keys (e.g. AWS's public documentation example key used in a unit test) are not secrets.
8. No real phone numbers or personal data in docs, tests, screenshots or the eval set – sample data only.
