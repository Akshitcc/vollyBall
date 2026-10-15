# VolleyLive 1.4.21 (versionCode 37) – QA 1.4.20 fixes

Nothing deployed. Backups: `backups/volleylive-latest.apk.bak37`, `backups/volleylive.zip.bak51`, `backups/pre1421/volleylive-src-pre1421.tar`.

| Item | Fix | Regression tests |
|---|---|---|
| V1420-5 | New match → by number (`TeamBuilder`, the component `/match/new` renders): every number taken with Enter is listed – "checking…" while the lookup runs, then removed when added or kept as **refused with its reason and a Dismiss button**. Enter during a running lookup queues the number (field clears for the next one, the number stays visible). Enter on an already not-registered number keeps the field and lists it once (no duplicate inline line). | `components/__tests__/teamBuilder1421.test.tsx` (rendered), `fixes1420.test.ts` updated; screenshots 421-01…03 on the real `/match/new` |
| V1420-6 | `/help?faq=<id>` expands the FAQ and scrolls to it, also when Help is already open (param change clears the search) and when the item was laid out before the param arrived (web). Rule notes can map to an FAQ (`RuleNote.faq`); libero → new FAQ `team-positions`, so its source opens the in-app FAQ in EN and HI. Only rule-only notes open the FIVB page. | `components/__tests__/fixes1421.test.tsx`, `services/__tests__/fixes1421.test.ts`, `server/tests/fixes1421.test.ts`; 421-04…06 |
| V1420-1 | New FAQ `account-delete` (EN + HI: no delete button yet → Contact us, topic Account and sign-in). "delete account" tag removed from the privacy FAQ. Weak extra hits (< 50 % of best) dropped, so the tournament FAQ is never cited. | core + server tests; 421-08 |
| V1420-2 | Retrieval scores a source by its best EN-or-HI match, independent of UI language, and returns that source's chunk in the UI language → EN and HI give the same sources, each answer in its own language (English question in HI app → Hindi answer). | parity tests (8 questions, core + API); 421-09 |
| V1420-3 | DEPLOY.md "Rollback and the 0020 checksum": which databases are affected, the check query, and two fixes (keep 1.4.20+ server, or set the recorded checksum back to `5a5ae455…`). | doc test |
| V1420-4 | Counter, cut and server check all count **visible characters** (graphemes): `clampVisible` + `visibleLength`; `checkSupportTicket` uses `visibleLength` (≤ 2000) with an 8000-code-point storage backstop. Additive migration **0022** widens `support_tickets.message` to VARCHAR(8000). | core, rendered (Hindi counter shows 2000/2000 with the cut notice) and API tests; 421-10 |
| Cosmetic | Ask while signed out → coded `ask_sign_in`: "Sign in to ask VolleyLive – it only takes your phone number." / HI. | core + rendered tests |
| cap420 | 07/08 now scroll the error text into view before the shot. | 420-07/08 re-shot EN + HI |

Screenshots (`volleylive-screens/`, EN + HI): 421-01-bynumber-checking, 421-02-bynumber-refused-dismiss, 421-03-bynumber-after-dismiss, 421-04-help-faq-scrolled, 421-05-ask-libero-source, 421-06-libero-opens-inapp-faq, 421-07-ask-signed-out (route guard shows sign-in), 421-08-ask-delete-account, 421-09-ask-other-language-question, 421-10-contact-hindi-cut-counter.

Deploy order: server (runs 0022) before the app.

## Added in 1.4.21: automatic Day/Night themes (Designer spec v2, `volleylive-design/daynight/daynight-spec.md`)

| Area | What was built | Tests |
|---|---|---|
| Logic | `src/theme/resolve.ts`: the spec's `timeTheme`, `resolveTheme`, `msToNextBoundary`, `greeting` (plus `firstName`, `msToNextMinute`). Day is 06:00–17:59 local; 18:00:00 is Night, 06:00:00 is Day. | spec cases 05:59/06:00/17:59/18:00, the exact seconds, greeting 04:59…21:00, msToNextBoundary, timezone (test:tz runs them in 5 zones) |
| Tokens | `src/theme/tokens.ts`: spec §2 tokens for both themes, including `scrim`, radius, border and fonts, read via `useTheme().t`. The app's existing `colors` map now follows the theme (`themes.ts`, aligned with the spec), and module-level StyleSheets re-create on a switch (`themed()`). | AA: every spec text pair, plus ~30 app text pairs and the control borders, in both themes |
| Provider | `src/theme/ThemeProvider.tsx`: setting stored in AsyncStorage `volleylive.theme.v1` as `{ setting, animate, users: { <uid>: … } }` (per user). Cold start: resolved before first paint (300 ms max), no animation. Boundary timer → scene. Back to the foreground → no animation. Appearance change → 250 ms fade. Reduce Motion or animation off → 250 ms fade. | provider tests for each mode |
| Transition | `ThemeTransition.tsx`: the 1.4 s "Sunset → Floodlight" scene (sky day→dusk→night, sinking sun, lamp flicker, beams; tokens swap under full cover at 850 ms, 550 ms for sunrise). Fade 250 ms; Live 400 ms. Overlay hidden from screen readers; the switch is announced. | jest + frames 421-X1…X6 (EN, HI) |
| Live scoring | `useLiveThemeHold`: the switch waits for the rally to end (600 ms after a point or undo), then a 400 ms fade only, never the scene. The score screen is re-rendered, not remounted, so rally state is kept. The full refresh happens on leaving the screen. | provider "live scoring" test |
| Appearance | New `/appearance` screen (Profile → Appearance): Auto / Day / Night radio cards plus the animation switch. | 360 px EN+HI, both themes |
| Greeting | Home "Good morning/afternoon/evening/night, {first name}", EN + HI (spec strings), live every minute. | 11:59→12:00 live test, EN + HI |
| Fonts | OFL only: Mukta (Night + Hindi body, headings and buttons; spec v2 §4.2) and Teko (Night score numerals, also in Hindi). Licences: `assets/fonts/*/OFL.txt`, `docs/FONT-LICENSES.md`, and the in-app Licences screen. | licence text = bundled file; only OFL files in assets/fonts |
| Kit (spec v2 §3) | `DayNightKit.tsx`: SegmentedControl, StepDots, ReactionButton, SheetScrim. The photo-sheet scrim now uses the per-theme token. | both themes, AA on segmented selection |
| Header / status bar | Day: light header on `#FFF4E2` with dark status bar. Night: dark header with light status bar. | screenshots |

### FLAGS for Akshit
1. **Auto is time-only (your call).** Spec v1/v2 say "in Auto, OS dark mode wins". That rule is left out: Auto = Day 06:00–17:59, else Night, whatever the phone's dark setting. The Appearance copy has no "phone dark mode" sentence, which differs from the spec's HI `autoDesc`.
2. **Re-skin depth.** The spec has a mockup for every screen. This build themes the whole app through tokens: colours, header, status bar, buttons, sheet scrim, Night/Hindi fonts. It does **not** rebuild each screen to the mockups' layouts and decor (stickers, hard ink shadows, glow, blobs, beam decor, greeting art SVGs, the 4-step new-match flow, viewer reactions, notifications/onboarding/OTP screens that the app doesn't have yet). Hard-coded colours remain in places (team gradients, medal colours, map) and are listed as a gap. The new kit components exist and are tested, but are not yet placed on screens: tournament tabs, viewer reactions and the backend for reactions don't exist yet.
3. **Fonts not bundled:** Baloo 2 and Hind (Day display/body, both OFL) and Teko for Latin headings. Only Mukta and Teko numerals are bundled, as asked. The Day theme uses the system font.
4. **Team colours.** Saved team colours are user data, so the default Team A/B colours didn't change. The spec's teamA/teamB tokens are available for new UI.
5. **Greeting copy (spec NEEDS REVIEW):** HI afternoon "नमस्ते" (spec choice); EN night "Good night" (spec suggests "Late game, {name}?" as an alternative).
6. **Not done from the spec:** `expo-system-ui` (a new native module; the root view is painted with `bg` instead), haptics on lamp flick, `volleylive.theme.lastAnim` (we guard one animation per switch in memory instead), Reanimated worklets (RN Animated used; same timeline).
7. **New dependency:** `expo-asset ~57.0.19` added top-level. `expo-font` needs it to load the bundled fonts; before this it was only nested under `expo`.
8. **Environment note:** at about 18:21 IST the box restarted and /workspace was restored from a snapshot. All node_modules were gone, and a few files written in the minutes before were lost and re-done. Dependencies were reinstalled with `npm ci`. Services that ran before (dev MySQL :3306, emulators, QA processes) may not be running. I didn't start or touch any QA process.

## Build
- APK `volleylive-latest.apk`: com.volleylive.app 1.4.21 (37), ABIs arm64-v8a + x86_64, same debug cert (SHA-256 fac61745…033b9c), `example.invalid` count 0, all 4 fonts byte-identical in res/.
- Font sha256: Mukta-Regular 2958e4af…de9688 · Mukta-Bold 7d22891c…820a12 · Mukta-ExtraBold 328eeebf…73e004 · Teko d1321889…13c1ae · mukta/OFL.txt 2ee5e8e4…6ca98 · teko/OFL.txt 4a193c54…f065
- Tests: tsc app+server clean · jest 1538/1538 (129 suites) · test:tz 1538 × 5 zones · server 360/360 · rules 226/226 · policy suites pass.
