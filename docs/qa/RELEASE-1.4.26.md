# VolleyLive 1.4.26 (versionCode 42)

APK: /workspace/volleylive-latest.apk, sha256 6a17514908f5d39f45a3a91efeddcb3b0375cd0480905ddbaf19172f838613fb. Badging: com.volleylive.app vc42 / 1.4.26. Signing cert SHA-256 fac61745…033b9c (unchanged debug keystore).
Zip: /workspace/volleylive.zip (sha in PROGRESS-1.4.26.md, regenerated after the docs were written)
Backups: volleylive-latest.apk.bak42, volleylive.zip.bak56, backups/apk-tree.pre1426.tar.gz, backups/apk-android.pre1426.tar.gz, backups/assets.pre1426, backups/app.config.ts.pre1426, backups/tokens|themes.ts.pre1426green

## Contents
- DB audit fixes DB-1..DB-6 + migration 0023 (see DB-AUDIT-1.4.26.md)
- E2E fixes on 1.4.25: E2E-1, -2, -3, -5, -6 (not in scope), -7, -8, -9, -10, and the Info item (no review sheet in the demo)
- 1.4.25 Lows: V1425-1/2 Night tokens. V1425-4 not done: no details found.
- Spiker icon set: launcher + adaptive (bg #0055A4) + monochrome, splash (Day #FFFAF3 / Night #1E2A44) via expo-splash-screen ~57.0.10, notification icon + colour #0055A4, userInterfaceStyle automatic. The native res were regenerated with a non-clean `expo prebuild` in the APK tree. Prebuild reset local.properties and gradle.properties, so both were restored from the backup.
- Fresher greens (greens-update.md)

## Verification
- Suites: tsc app + server clean; jest 1654/1654 (139 suites); tz OK; server 383/383; rules 226/226; policy all passed
- Contrast scan: SUMMARY checked=268 failures=0
- APK contains the new icon (foreground webp byte-identical to the res), the splash logo (Day and Night), splashscreen_background #FFFAF3 / night #1E2A44, iconBackground #0055A4, and drawable/notification_icon (96 px, white) referenced by both default_notification_icon meta-data entries
- Screenshots: volleylive-screens/426-home-DAY-EN.png, 426-home-NIGHT-EN.png, 426-live-scoring-*, 426-splash-day/night.png, 426-icon-masks.png, 426-icon-sizes.png, 426-apk-splash-and-notification.png (extracted from the APK)
