# VolleyLive 1.4.22 (versionCode 38): Day / Night spec v2 rebuild

This build rebuilds the core screens to match the `day-*` / `night-*` mockups in `volleylive-design/daynight`
(spec `daynight-spec.md`, v2). Auto mode is still time-based (06:00–17:59 is Day). Nothing here deploys anything, adds keys or
accounts, or changes permissions. Migrations: none (no server or schema change).

## What changed
- **Kit (new `components/DNKit.tsx`).** Sticker cards: Day uses a 2px ink border with a hard 4/3 offset shadow drawn as a
  View; Night uses a 1px outline and a volt highlight. Also Display/Over/Body type, KButton, IconBtn, LivePill, ScoreNum
  stickers, KChip, Blob/Glow/Beam decor and GreetArt. Tokens gain `pink`, `track`, `hero`, `font.*` and `shadow.*`.
- **Fonts.** Day uses Baloo 2 ExtraBold for display and Hind for body. Night uses Teko SemiBold for display (UPPERCASE
  Latin) and Mukta for body. Night Hindi uses Mukta 800 in sentence case. All are OFL-1.1 static instances; see
  docs/FONT-LICENSES.md for the sha256 values.
- **Copy.** The late-night greeting is now "Late game, {name}?" in EN and "देर रात का मैच, {name}?" in HI.
- **Demo data.** New demo live match `match_live_set3` ("Monsoon friendly", set 3 at 19–17), so live scoring can be
  shown in both themes.
- **Kit placement.**
  - SegmentedControl: tournament tabs (Table/Bracket + Fixtures).
  - Stepper: New match header, with dots in done/current/todo states.
  - StepDots: login and OTP.
  - ReactionButton ×4: live viewer, **UI only**. No backend exists, so nothing is sent or stored.
- **Hard-coded colours replaced with tokens.**
  - Tab bar and FAB.
  - Live panels and court.
  - Score screen chrome.
  - Banner (info/warn).
  - Viewer hero and its texts.
  - New match stepper.
  - POTM card.
  - Appearance.
  - Login and OTP boxes.

## Per-screen fidelity (app vs mockup; side-by-sides in `volleylive-screens/422-compare-*`)
| # | Screen | Fidelity | Notes |
|---|---|---|---|
| 01 | Home | High | Greeting art, live hero (Day orange sticker / Night gradient with beam), fact card, quick tiles, rank card. 8 tiles instead of 4 (existing features kept). No "128 watching" (no data). A language button replaces the bell (no notifications screen). |
| 02 | Live scoring | High | Side-token panels with tilted score stickers (Day) / neon Teko numerals (Night), serving pill, court card with player tiles, dashed/volt net, Undo/Swap/Stats bar. Team colour shown as a dot. |
| 03 | Team | High | Header sticker, stats from real finished matches (Played/Won/Lost/Win rate), Challenge/Start match, roster rows with captain tag, add-by-mobile. |
| 04 | Tournament | High | Hero sticker/glow, segmented tabs, table/bracket/fixtures stickers, next fixture. Only applicable segments are shown. |
| 05 | Profile | Medium-high | Day pink identity sticker / Night ring avatar, rank card, stat tiles. Extra existing sections (wallet, details, settings) remain below. |
| 06 | Login + keyboard | High | Step dots, display title, number field, Send code. The PhoneInput focus offset shadow is not done. |
| 07 | Win / POTM reward | High | Full-screen: Day confetti and a tilted "We won!" sticker; Night ray burst and "VICTORY!". Score stickers, set lines, POTM card with Points/Spikes/Blocks/Aces, Share the win, See match summary. "+25 rank pts" is not shown; the badge shows real points instead. A non-winner sees "{team} wins". |
| 08 | Appearance | High | NOW SHOWING card, radio cards with live-token thumbnails, RECOMMENDED tag, motion switch. |
| 10 | OTP | High | Step dots, 6 tokenised boxes (Day offset shadow on the current box), Verify + hint. |
| 14 | New match | Low-medium | Stepper restyled to spec dots only; the flow is still 3 steps. |
| 15 | Live viewer | Medium-high | Day panels on the cream page / Night hero gradient, reaction row. Recent rallies list keeps the existing ticker. |

## Spec items not done (gaps)
1. **09 Onboarding, 11 Profile setup, 12 Teams list, 13 Create team, 16 Photos sheet, 17 Tournaments list,
   18/19 Tournament bracket/fixtures as separate screens, 21 Help center, 22 Notifications, 23 Empty, 24 Loading
   skeleton, 25 Error.** These screens are not rebuilt. They pick up the theme tokens where they already used them, but
   not the sticker/glow layout.
2. **New match is not the 4-step flow.** Spec §4 #9 asks for teams → add by shirt number → rules → toss. The app keeps
   its 3 steps; adding players by shirt number with a numeric keypad is a new feature.
3. **Rankings Players/Teams segmented control (mockup 20) is not placed.** No team ranking exists, and a Teams tab
   would be empty or fake.
4. **Reactions are UI only.** No counts are shown and nothing is sent.
5. **No watcher count, bell or notifications screen.** No data or feature exists for them.
6. **No "+25 rank pts" on the POTM card.** No such rule exists.
7. **PhoneInput focus offset shadow (Day) is not done.**
8. **No global default body font.** The kit sets fonts per component; older screens keep the system body font.
9. **Some art colours stay hard-coded.** GreetArt sky colours and the Night half-gradient alpha are art/derived
   colours, not spec tokens.
10. **Hindi copy for the new `dn.*` keys has not had native review.** It was written by the developer:
    - Played/Won/Lost/Win rate, Captain, Add by mobile number, Start match.
    - Table/Bracket/Fixtures, Next fixture, RANK.
    - Login titles/sub, Send code.
    - We won!/Victory!, Full time, "{win} beat {lose}", Share the win, See match summary.
    - Now showing, Theme, Motion.
    - Reduce motion (unused), Step n of N (unused), reactions, Players/Teams.

## Tests
New `src/components/__tests__/dn1422.test.tsx` (26 tests) and `src/services/__tests__/demoLive1422.test.ts` (2). They cover:
- the reward screen in EN/HI × Day/Night;
- reactions being local-only;
- teamRecord;
- the greeting copy;
- EN/HI key parity with placeholders, and every used `dn.*` key existing;
- AA ≥ 4.5 for every spec text pair in both themes;
- layout parts per rebuilt screen.

Updated older tests where the design intentionally changed:
- Score tab is now the FAB with no caption.
- KButton dims instead of using a grey fill.
- Login copy.
- Day score digits are ink on a white sticker.
- Day SERVING pill is Ball.
- The match-over sheet is now RewardScreen.
- The "NEEDS REVIEW" marker is replaced by this list.

360 px with no sideways scroll is checked in the browser: all 44 `422-*` screens report `scrollWidth 360`
(`scripts/logs/cap422.log`).

## Tester's 1.4.21 findings, folded into 1.4.22 (tests: `src/components/__tests__/qa1421fixes.test.tsx`, 34 tests)
| ID | Fix | Regression test | Browser check |
|---|---|---|---|
| V1421-4 (Med) | **Root cause:** `font.h1/h2/h3/body/small` had no colour, so a title without its own colour fell back to the platform default, which is black. **Fix:** every `font.*` now carries the live `colors.text` (a getter), and the tournaments card title sets `color` explicitly. | The Tournaments screen is rendered in Day and Night, and the title's rendered colour is checked for ≥4.5 contrast against the card. The test also checks that `font.*` follows the theme. | `422-17-tournaments-list-NIGHT-EN/HI` |
| V1421-5 (Med) | When the root stack's guard sends a signed-out user to Login, it records the path they asked for (`state/signInReason.ts`). Login then shows a notice: for /ask, the friendly "Sign in to ask VolleyLive…" line (EN/HI); for other screens, "Sign in to continue…". | Unit test of the reason helper; rendered Login in EN and HI shows `login-reason`. | `422-qa-V1421-5-signed-out-ask-EN/HI` |
| V1421-6 (Med) | On web the FAQ item reported its layout before its category, so the scroll target was about 0. `makeFaqScroller` waits until both offsets are known, then scrolls twice (once instantly, once settled). | Rendered Help with `?faq=account-delete` in EN and HI opens expanded; the scroller is tested with the item laid out first. | Direct URL and Ask source link: answer expanded and in view (top ≈ 402–418 px), EN and HI. Shots: `422-qa-V1421-6-*` |
| V1421-7 (Low) | The warn and info Banner now use tokens. Night warn is surface2 with a volt border and `text`. | Rendered Banner contrast ≥4.5 in Day and Night. | `422-01-home-NIGHT-*` |
| V1421-8 (Low) | Placeholder is now "Try “points” or “team”" / "“पॉइंट” या “टीम” आज़माएँ". It contains no "abandon" or "छोड़". | Copy test (≤26 characters, no abandon). | Measured 165 / 160 px of text in a 292 px field |
| V1421-9 (Low) | **Confirmed working on web.** With the clock at 17:59:58 IST in Auto with animation on, the scene shows at 18:00 for 1438 ms and the app ends in Night. A manual choice in Appearance uses the 250 ms fade, as spec §4 #18 says ("selection saves, 250 ms fade"). The full scene plays only at the 06:00/18:00 boundary. | ThemeTransition timeline test (covered at 850 ms, gone by 1400 ms, JS driver only). | `422-qa-V1421-9-scene-web-0..2`, `…-after-scene-night` |
| V1421-10 (Low) | The FIVB disclaimer appears only when an answer cites a rule summary that links to FIVB. App-only answers, and rule notes mapped to an in-app FAQ, carry none. | `needsFivbNote` cases. | "delete my account" in EN/HI shows no disclaimer |
| V1421-1 (Low) | Ranking now adds a topic boost (the share of the question's words found in the source's title or tags) and a first-person boost for app FAQs. Added tags. Added a new own-words rule note, "How high is the net?" (2.43 m men / 2.24 m women). The server re-syncs `ask_chunks` automatically. | 11 questions in EN and HI lead with the right source: scoring → score-how, "how many points do I get" → wallet-points, net height → rule-net-height. Delete-account, libero and set points are unchanged. | — |
| V1421-2 (Low) | **Counting:** a portable grapheme fallback (ZWJ sequences, marks, VS16, skin tones, flags, Devanagari conjuncts) is used where `Intl.Segmenter` is missing. **Storing:** support messages keep a ZWJ inside an emoji or a Devanagari conjunct (`stripHiddenKeepJoiners`). The family emoji counts as 1 and is stored whole. Stray ZWJ and other hidden characters are still removed. | The fallback matches the Segmenter on 10 samples; 1000 family emoji are accepted and stored unchanged. | — |
| V1421-3 (Low) | **Slow read:** a theme read slower than 300 ms gives a provisional Auto. When the read lands, the saved choice is applied, unless the user already changed it. **Writes:** they re-read the device value and change only this account's entry. A signed-in write never touches the device-wide default. | Delayed getItem (500 ms): Night is applied late, and seed2's entry survives a seed1 write. A change made before the late read wins. | — |
| Extra | The Live scoring ⋮ menu has "Switch to Night/Day". It uses the soft Live swap (no remount), and the score is kept. | Source test | `422-qa-live-theme-menu-DAY`, `…-after-NIGHT` (19–17 kept) |

**Still open from these:**
- **Firebase build (V1421-2).** `firestore.rules` still refuses U+200D in a support message, and they count `size()` in UTF-16. So the Firebase backend keeps the old strip, which splits family emoji. Fixing it needs a rules change, and I did not make it: rule changes need your approval. The API server and demo are fixed.
- **Tester's live demo match (match_jpyw2r59cfux).** It was not used.

## Artifacts
- APK `/workspace/volleylive-latest.apk`, sha256 `2d257ab493a54b843b3d6efcf1a4ded7eea6d7dc37150728749a099bd004526d`.
  - Version: versionCode 38 / 1.4.22.
  - ABIs: arm64-v8a and x86_64.
  - Signing: the same debug cert, fac61745…033b9c.
  - Fonts: all 8 are in res/ (checked by sha).
  - No `example.invalid` in the bundle.
- Zip `/workspace/volleylive.zip`, sha256 `413ad3c7ae8f1f2c2757bd542e6c6aecdd0bb4401e347eb485051544589f9516` (542 files). (Corrected in 1.4.24: the earlier 79916d70… / 541 was written before the last file went into the zip.)
- 1.4.21 copies for Tester (unchanged): `/workspace/backups/volleylive-1.4.21.apk` (3593769e…) and `.zip` (a6fe9156…).
- Suites (logs/s1422), each run on its own, never during gradle:

  | Suite | Result |
  |---|---|
  | tsc app | 0 |
  | tsc server | 0 |
  | jest | 1600/1600 |
  | tz ×5 | 1600 each |
  | server | 360/360 (rerun alone after a transient MySQL deadlock in the batch) |
  | rules | 226/226 |
  | policy | exit 0 |
