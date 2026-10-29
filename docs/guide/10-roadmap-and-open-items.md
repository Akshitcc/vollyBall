# 10. Roadmap and open items

Status at **1.5.7 (versionCode 52)**. Nothing is deployed to production yet.

## 10.1 Pending decisions (owner: Akshit)

| # | Decision | Context |
|---|---|---|
| D1 | **Approve production migrations 0024 – 0028** | groups + knockout, match create claims, Ask content, Ask history / audit, audit HMAC. All additive; back up first. A rollback for 0024 exists. |
| D2 | **AI provider and key** for Ask | choose `openai`, `gemini` or `anthropic` (or stay on `mock`), set `ASK_PROVIDER` / `ASK_API_KEY` in the server's secret store. Real providers have not been tested live. Also set a real `ASK_AUDIT_HMAC_KEY`. |
| D3 | **Support URL** | `SUPPORT_URL` (`src/services/supportContact.ts`) currently points to a placeholder site unrelated to VolleyLive; needs the real support page. Also set `EXPO_PUBLIC_SUPPORT_EMAIL` / `EXPO_PUBLIC_SUPPORT_WHATSAPP`. |
| D4 | **FIVB rules licence** | 10 own-words rule notes link to the FIVB rules page; confirm the licence / attribution is acceptable. |
| D5 | **Hindi review** | the Hindi copy (app, Help, Ask) needs a native-speaker review; some new strings are marked NEEDS REVIEW. |
| D6 | **Abandon policy** | `ABANDON_POLICY = 'review'` is interim; choose `review`, `flag` or `consent`. |
| D7 | **Two registered teams per player?** | may a player be in two registered teams (long-standing open question). |
| D8 | **Phone-shaped team names** | Ask masks them, but team screens show team names as typed; decide whether to block or mask them at creation. |
| D9 | **Sock-puppet opposing captain (C130-1)** | a fake account acting as the opposing captain to confirm results – not implemented by decision; decide whether to add a defence. |
| D10 | **Greens update** | `daynight/green/greens-update.md` proposes a new Night primary green (`#9BFF3A`) and related tokens – not in 1.5.7. |
| D11 | **Bold Spiker icon** | chosen; the asset kit is ready for build 1.5.8 (file swap + native rebuild). See [11](11-design-system.md#115-logo-history). |

## 10.2 Open Lows and known gaps (from the 1.5.7 release notes)

- **Display = stored masking**: on screen, text hides whatever storage hid, including 10+ single digits separated by
  spaces (e.g. a typed rally sequence).
- **Dev-auth token accepts 9 digits** (dev only).
- **"N of M"** invite counts include all invites.
- **HMAC audit path untested** live (no key, by design).
- **Firestore rules have no current-captain check** (the API and demo enforce it).
- **Ask held-out misses**: substitutes → privacy refusal; "am I playing live" → all live matches.
- **Local harnesses** (browser walks) were not re-run for 1.5.7; API-level checks were.
- Firebase-only gaps, web-only limits (no offline app shell), 32-bit ARM, review-prompt timing: `docs/KNOWN-GAPS.md`.
- Viewer **reactions** are UI only (no backend).
- **No in-app account deletion button** (the API supports it; Play requires a deletion path before launch).
- Spec items not built yet: onboarding swipes, notifications screen, rankings period chips / podium, 4-step new-match
  flow with shirt numbers (see [11](11-design-system.md#118-screen-by-screen-design-notes)).
- **Phone install of 1.5.7**: the last attempt on the test phone was blocked by the phone's USB-install verification
  prompt; enable *Install via USB* and approve the prompt, then retry with `adb install -r`.

## 10.3 Launch checklist (owner items, from `docs/DEPLOY.md`)

- Google Play Console account, app signing / upload key, data-safety form.
- EAS project and production environment (`EXPO_PUBLIC_API_URL`, https).
- Hosting for the API + MySQL (+ Redis for more than one instance), server secrets in the host's secret store.
- SMS provider (MSG91) with **DLT** registration for India.
- Google Maps Android key (restricted), `google-services.json` for push.
- `ADMIN_UIDS`, support email, privacy policy review (DPDP), `MIN_AGE` (10), keep `EXPO_PUBLIC_REVIEW_PREPROMPT=0`.

## 10.4 Next features (candidates)

| Feature | Notes |
|---|---|
| Bold Spiker icon (1.5.8) | asset kit ready |
| Greens update | proposal ready |
| Viewer reactions backend | UI exists |
| Notifications inbox | spec screen 20 |
| Onboarding | spec screen 1 |
| Rankings periods / teams / podium | spec screen 16 |
| Live video / streaming | was out of scope for v1 |
| Live LLM provider | after D2 |
| iOS build | the config has an iOS bundle id; not built or tested |
| Multi-instance scale-out | Redis bus + S3 photos |
