# VolleyLive 1.4.24 (versionCode 40)
Fixes the tester's 1.4.23 failures: V1423-3 (Night contrast and the scan), V1423-2 (Hindi Ask) and V1423-1 (docs).

## V1423-3: Night contrast
- **Match detail.** The Timeline tab's set score and rally text now use colors.text. The team dots use TeamDot. In Night, swatchRing gives a light ring to any dot below 3:1 on the card, e.g. navy #001F4D.
- **Text colours.** These now use colors.text:
  - "want to play" names;
  - tournament/new team names;
  - the PhoneVerifier (Firebase) "security check" title. This screen exists only in the Firebase build, so it is checked by test, not by the scan or screenshots.
- **DOB picker.**
  - The selected day, month and year are clearly marked: primary fill, colors.text outline, bold and ✓.
  - Each column scrolls its selected row into the middle when the picker opens.
  - On web, the scrollbar track and thumb take the theme colours.
- **Disabled Next on New match.** The code path the tester hit is ui.Button with DISABLED. Night disabledText is now #C9D2E8 on #232C47 (about 9:1). It is still muted, but readable.
- **Map.**
  - A selected chip with no colour set (e.g. 25 km) uses primary in Night. It used ink, which is the page colour in Night.
  - The "Map preview" label and the "Tap a numbered dot" hint are colors.text on colors.card.
- **Text-colour audit.** core/__tests__/textColourAudit1424.test.ts fails on any <Text> in app/ or components/ without a theme colour. Every hit it found is fixed.
- **scan.js.**
  - Openers fixed:
    - photo sheet: photo-button;
    - who-scored: team-panel-A;
    - DOB picker: profile-dob on /edit-profile;
    - lineup sheet: open-lineup on match_upcoming, before the first rally.
  - New coverage:
    - every match tab, tournament tab and New match step;
    - want-to-play;
    - tournament/new team list;
    - the 25 km chip.
  - Text caught mid-animation is measured again after 900 ms.
  - Rows clipped inside a scrolling column are skipped.
  - When the hit-test misses a painted parent, the scan measures against the parent chain instead (the score toast).
  - An action that can't be opened now counts as a failure.
  - **Final run on the final web build /tmp/web424final2: checked=268, failures=0, skipped=0, exit 0.**

## V1423-2: Hindi Ask
- **Removal questions.** "हटा/डिलीट" now looks at its subject:
  - a team, player or match removal → match edit;
  - a photo removal names no topic (there is no photo FAQ, so the answer is "I don't know");
  - only an account removal, or one with no subject, → account delete.
- **अंक/अंकों → points.** "एक सेट कितने अंकों का होता है" now returns rule-set-points.
- **Romanised Hindi (basic).** Common words such as kitne, jaal, chhuna, khiladi, ghoomte, hatana and khata are mapped to the matching English words. For example, "set kitne point ka hota hai" → set points, "jaal chhuna foul hai kya" → net, and "khiladi kab ghoomte hain" → rotation.
- **Ask index.** It is built at server start (warmAskIndex). If that fails, the first question retries.
- **Tests.** core/__tests__/askHindi1424.test.ts, plus a server test in fixes1420.
- **Known limitation.** English "delete a photo" still returns account-delete. This is an older issue.

## V1423-1: docs
RELEASE-1.4.22 is corrected to 413ad3c7… with 542 files. RELEASE-1.4.23 has the right shas: zip a591669c…, APK 90e4fdfd….

## Tests
The pipeline (scripts/final1424.sh, then scripts/finish1424.sh; logs in scripts/logs/s1424) ran each suite alone:

| Suite | Result |
|---|---|
| tsc app | 0 |
| tsc server | 0 |
| jest | Tests:       1643 passed, 1643 total |
| tz | 0 |
| server | 361/361 |
| rules | Tests:       226 passed, 226 total |
| policy | 0 |

The zip was built only after every suite and the scan had passed. There are no migrations. Server changes: warmAskIndex, called at start.

## Artifacts
These were written after the final zip, so this file is not inside the zip.

| Artifact | sha256 | Details |
|---|---|---|
| Zip /workspace/volleylive.zip | 52ef7a227720b1f8806ef5b7745b552c11bbc34ef4254931477007c5ded1a01b | 551 files |
| APK /workspace/volleylive-latest.apk | 28d0ce0c928f80ec6dea0afdfcf17758552b6f0f959363fa7c4ef7e6370f14c1 | vc40 / 1.4.24; arm64-v8a + x86_64; not debuggable; cert fac61745…033b9c (unchanged, no new keys) |
