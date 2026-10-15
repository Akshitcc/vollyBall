# VolleyLive 1.4.23 (versionCode 39)
Scope was cut down at Akshit's request: V1422-6, V1422-4 and V1422-7 only, plus correct shas (V1422-5). Deferred and not started: V1422-1 (rules), -2, -3, -8, -9, -10, the Ask rally-point link, mockups 09/11–13/16–19/21–25, and the 4-step New match flow.

## Fixes
- **V1422-6 (High) dialogs in Night.** DialogHost (the in-app dialog on web, e.g. Abandon match) now takes its card, text and buttons from the theme tokens. Before, it was a hard-coded white card with Night's light text. Also fixed: the map callout and list sheet (hard-coded white → colors.card), and the Photo delete dialog (title and cancel in colors.text; the delete button on colors.live). Native uses the system Alert, which the OS draws.
- **V1422-4 (Medium) Night contrast.** Fixed:
  - Player points names and totals now use colors.text.
  - teamText follows the theme. On the Night card it lightens a team colour that is too dark (e.g. the navy #001F4D).
  - LanguageSwitch uses its on-dark colours in Night (Profile Language, and the Login HI chip).
  - Map distances use colors.text; map labels are fixed dark on white; the map hint is on colors.card.
  - Privacy DRAFT banner uses ink text in Night.
  - A disabled KButton (New match Next) uses solid muted colours instead of 45% opacity.
  - The Ask question bubble uses onPrimary.
  - Icons and text that used ink as a foreground now use colors.text (about rows, wallet history, empty states, Add photo, camera/photo sheets).
- **Contrast check.** scripts/contrast/scan.js (Playwright, web build) covers 41 routes plus Login/OTP and 10 modal/menu/dialog states, in Day/Night × EN/HI. It measures the painted background with elementsFromPoint and fails (exit 1) on text below AA. Last full run: 200 views, 24 hits, all fixed afterwards except one transient score toast caught mid-fade. 4 actions were skipped because their openers weren't found (lineup, photo sheet, who-scored, DOB picker).
- **V1422-7 (Medium) Hindi Ask.**
  - New Hindi/Hinglish query synonyms: डिलीट/हटा → delete, अकाउंट/खाता → account, स्कोर → score, लॉगिन/पासवर्ड → sign in, छोड़ → abandon.
  - More Hindi stop words.
  - EMBED_VERSION is now part of the server's ask_chunks hash, so the stored vectors re-embed on start.
  - Test set src/core/__tests__/askHindi1423.test.ts has 13 HI questions, checked in both the EN and HI app.

## Tests
New: components/__tests__/night1423.test.tsx (6) and core/__tests__/askHindi1423.test.ts (16).
Suites (one at a time, logs in scripts/logs/s1423): tsc app 0, tsc server 0, jest 1622/1622, tz 0, server 360/360, rules 226/226, policy 0. No migrations; the server change is limited to the ask hash.

## Artifacts (written after the final zip; this file is not inside the zip)
- Zip /workspace/volleylive.zip: sha256 a591669cb2c175867f9ec3e2147af5244b4ec27bc8a55106fee761ddfeeb754e, 546 files
- APK /workspace/volleylive-latest.apk: sha256 90e4fdfdbc958c88a6baa0507a585c24480c1eb9e4f20368490fb34502103ab7. vc39 / 1.4.23, arm64-v8a + x86_64, not debuggable, cert fac61745…033b9c (unchanged)
- Correction (V1422-5): the 1.4.22 zip was 413ad3c7…9516 with 542 files, not 79916d70… / 541.
