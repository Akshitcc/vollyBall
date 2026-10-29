# VolleyLive documentation

<img src="assets/logo-concept-7-spiker.png" width="96" alt="VolleyLive Spiker icon">

Full product and technical documentation for **VolleyLive 1.5.7** (versionCode 52) – live volleyball scoring,
teams, challenges, tournaments and the Ask VolleyLive assistant, in English and Hindi, with Day and Night themes.

Written from the 1.5.7 source code, the release notes in [`docs/qa/`](../qa/) and the design files. Where the design
and the code differ, the code wins and the difference is noted. No secrets, keys, tokens, real phone numbers or
personal data appear here – environment variables are listed by **name only**, and all screenshots use sample data.

## Contents

| # | Document | What's inside |
|---|---|---|
| 1 | [Overview](01-overview.md) | what VolleyLive is, personas, main features, backends, version history, status |
| 2 | [User guide](02-user-guide.md) | sign-up / OTP, profile and settings (themes, language, wallet), teams, new match and live scoring, Undo, challenges, tournaments, Home and map, Ask, help / feedback / rate / about |
| 3 | [Architecture](03-architecture.md) | stack, folder layout, backend selection, app → server → DB / Firebase flows, live updates (mermaid diagrams) |
| 4 | [Ask VolleyLive chatbot](04-chatbot.md) | RAG, read-only tools, permissions, injection defence and PII masking, provider adapter, env var names, mock mode, rate limits, eval |
| 5 | [Database](05-database.md) | MySQL tables, relationships (ER diagram), migrations 0001 – 0028, Firestore collections |
| 6 | [API reference](06-api.md) | every endpoint with method, path, purpose and auth; errors; rate limits |
| 7 | [Setup and build](07-setup-and-build.md) | local dev (app, server), env vars by name, APK / AAB builds, verify and install, release checklist |
| 8 | [Testing and QA](08-testing.md) | test suites and how to run them, latest results, QA process |
| 9 | [Security and privacy](09-security-privacy.md) | auth modes, authorisation rules, rate limits, privacy and masking, hardening, no-secrets policy |
| 10 | [Roadmap and open items](10-roadmap-and-open-items.md) | pending decisions, open Lows and gaps, launch checklist, next features |
| 11 | [Design system](11-design-system.md) | colour palette (hex, Day and Night), typography, spacing, components, day / night logic and greeting, screen notes, logo history, icon specs |
| 12 | [Glossary](12-glossary.md) | terms used across the app and these docs |
| 13 | [FAQ](13-faq.md) | questions from players, captains, Ask users and developers |
| 14 | [Acceptance checklist](14-acceptance-checklist.md) | feature-by-feature pass / fail checks for accepting a build |

A combined PDF of all chapters is in [`VolleyLive-Documentation.pdf`](VolleyLive-Documentation.pdf) (diagrams rendered;
GitHub also renders the mermaid diagrams in the Markdown files).

Images are in [`assets/`](assets/).

## Other docs in this repo

| File | Purpose |
|---|---|
| [`../DEPLOY.md`](../DEPLOY.md) | detailed deploy steps and per-release migration notes |
| [`../KNOWN-GAPS.md`](../KNOWN-GAPS.md) | known gaps and limits by release |
| [`../LIFECYCLE.md`](../LIFECYCLE.md) | the match lifecycle table (generated) |
| [`../db-schema.mmd`](../db-schema.mmd) / [`../db-schema.png`](../db-schema.png) | generated base schema ER diagram |
| [`../FONT-LICENSES.md`](../FONT-LICENSES.md) | font licences |
| [`../privacy-policy-draft.md`](../privacy-policy-draft.md) | privacy policy (draft) |
| [`../qa/`](../qa/) | release notes, progress logs and the Ask eval sets |
