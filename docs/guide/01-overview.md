# 1. Overview

> Documentation for **VolleyLive 1.5.7** (versionCode 52, Android package `com.volleylive.app`).
> Everything here was written from the 1.5.7 source code, the release notes in `docs/qa/` and the design files.
> Where the design and the code differ, the **code wins** and the difference is noted.

## 1.1 What VolleyLive is

VolleyLive is a mobile app (Android first, built with Expo / React Native) for **amateur and club volleyball in India**.
It lets players:

- **score a match live** from the side of the court, one tap per rally,
- let everyone else **follow the score in real time**,
- keep **teams, stats, rankings and match photos**,
- send **challenges** between teams and run small **tournaments**,
- find **courts and games nearby** on a map,
- ask questions in plain English or Hindi through the **Ask VolleyLive** assistant.

The app is bilingual (**English / हिन्दी**) and has two visual themes, **Day ("Sunday Court")** and
**Night ("Floodlight")**, which switch automatically by the time of day.

## 1.2 Who it is for

| Persona | What they do in the app |
|---|---|
| **Player** | Signs in with a mobile number, keeps a profile, joins teams, sees own stats, rank and points wallet. |
| **Captain** | Creates and manages a team, invites players, sends and answers challenges, confirms or rejects results. |
| **Scorer** | The one person who scores a match (normally the match creator). Only the scorer can add or undo rallies. |
| **Spectator / fan** | Follows live scores, reactions and the recent-rallies ticker. |
| **Organiser** | Creates a tournament (knockout, league, or groups + knockout) and manages its fixtures. |
| **Admin** | Reviews flagged matches, manages "Fact / Quote of the day" items, reads feedback and support tickets, edits Ask content. Admins are set by configuration (`ADMIN_UIDS`), never inside the app. |

## 1.3 Main features (1.5.7)

| Area | Feature | Where |
|---|---|---|
| Sign-in | Mobile number + 6-digit OTP; Terms & Conditions acceptance; minimum age check | Login, Terms, Profile setup |
| Profile | Name, role, city / pincode, date of birth, avatar; career stats; recent form; match history; memories | Profile tab |
| Settings | Appearance (Auto / Day / Night + animation switch), Language (EN / HI), Help Center, Ask, Feedback, Rate, About, Licences, Privacy, Terms | Profile → Settings |
| Teams | Create a team (name, colour), add players by mobile number, captain, invites (accept / decline), leave | Teams, Team detail |
| New match | 3-step flow: **Teams → Rules → Start**; registered team or "add players by number"; Exact 6 or Custom 6–12; Indoor / Beach / Custom rules; start now or schedule | Centre "+" button |
| Live scoring | Tap a player = player point + team point; tap a team half = team point only; Undo; timeouts; switch sides; serve & rotation; sets; photos | Match → Score |
| Live following | Real-time scoreboard over WebSocket (API) or Firestore listeners; recent rallies; share. A reaction row is shown but is **UI only** (no reactions backend; nothing is sent or stored) | Match page |
| Results | Opposing captain confirms or rejects; Player of the Match (POTM); anti-fraud limits; admin review | Match page, Admin |
| Rankings & wallet | Ranking points (credited points + 10 per win + 25 per POTM); wallet with +100 bonus every 5 counted wins (no money value) | Rankings, Wallet |
| Challenges | Captain challenges another team with day, time, place and message; accept / decline; accepted challenge becomes a match | Challenge |
| Tournaments | Knockout (byes to top seeds), League (3/2/1 points), Groups + knockout (up to 32 teams, seeded or random draw); table, bracket, fixtures | Tournaments tab |
| Map / courts | Courts and games nearby, distance filters, "Play nearby" list, add a court | Map tab, Courts |
| Home | Time-based greeting, live hero card, Fact / Quote of the day, quick actions, Ask card, rank card, invites, upcoming | Home tab |
| Ask VolleyLive | RAG answers from FAQ / rules / guides + 10 read-only tools over your own data, with cards; EN / HI / romanised Hindi | Ask screen |
| Help & feedback | Help Center (search, topics, FAQ), Contact / support tickets, Feedback, Rate the app, About | Settings |

## 1.4 Backends

The same app can run against four backends, chosen at build time by environment variables (see
[07 – Setup and build](07-setup-and-build.md)):

1. **Demo** – everything on the device, sample data, any number with the demo code `123456`. For testing only.
2. **API server** – Node / Express + MySQL server with OTP sign-in (the production target).
3. **API + dev auth** – the API server with unsigned development tokens. Local testing only; refused in production.
4. **Firebase direct** – Firestore + Storage + Firebase phone auth, protected by `firestore.rules` / `storage.rules`.

## 1.5 Short version history

| Version | versionCode | Highlights |
|---|---|---|
| up to 1.3.x | – | First live scoring, teams, Firebase backend and demo mode; then registered players only, POTM and rankings, anti-fraud limits, Terms, OTP sessions, captain verdict (confirm / reject), feedback and daily items, MySQL API server. |
| 1.4.0 – 1.4.4 | 16 – 20 | Email uniqueness, daily-item tombstones, "once the winning rally exists the match is final", server no longer trusts the stored summary. |
| 1.4.5 – 1.4.18 | 21 – 34 | Abandon flow (policy **'review'**, interim), one lifecycle table (`docs/LIFECYCLE.md`), verdict repair, scorer hand-off, many QA rounds. |
| 1.4.19 | 35 | Tournament admin permissions, **Help Center**, support tickets (migration 0020). |
| 1.4.20 – 1.4.21 | 36 – 37 | **Ask VolleyLive** phase 1 (RAG over FAQ / rules / guides). |
| 1.4.22 | 38 | **Day / Night spec v2** rebuild of the core screens. |
| 1.4.23 – 1.4.24 | 39 – 40 | Night contrast fixes, Hindi Ask, contrast scan. |
| 1.4.25 | 41 | **Brighter palette** ("the colour is too much dark, make it brighter"). |
| 1.4.26 – 1.4.28 | 42 – 44 | Spiker app icon and splash, groups + knockout tournaments (0024), match create claims (0025), bracket fixes. |
| 1.5.0 | 45 | **Ask VolleyLive with read-only tools** and cards, provider adapter, Ask eval set. |
| 1.5.1 – 1.5.6 | 46 – 51 | Ask hardening: PII masking, audit hashes (HMAC, 0028), history, admin content (0026–0027), many Tester retests. |
| **1.5.7** | **52** | PII masking for more number groupings, team look-up ranking, captain intent, packaging rule for env files. **Current build.** |

The detailed notes for every build from 1.4.1 are in `docs/qa/RELEASE-<version>.md`.

## 1.6 Status at 1.5.7

- Verification of 1.5.7: app tests **2514 / 2514** (173 suites, also in 5 time zones), server **560 / 560**,
  Firestore rules **226 / 226**, Ask eval **354 / 358 (98.9 %)**, contrast scan **268 pairs / 0 failures**.
- Nothing is deployed to production yet. Migrations 0024 – 0028 wait for production approval.
- The APK is a debug-signed internal build. A Play release needs an upload key and the checklist in `docs/DEPLOY.md`.
- Open items and decisions are in [10 – Roadmap and open items](10-roadmap-and-open-items.md).
