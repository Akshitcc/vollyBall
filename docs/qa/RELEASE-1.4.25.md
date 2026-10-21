# VolleyLive 1.4.25 (versionCode 41) — brighter palette

Akshit: "the color is too much dark, make it brighter". Scope (cut): ONLY the Designer bright tokens
(volleylive-design/daynight/bright/tokens-bright.md) plus the fixes the contrast scan and snapshots needed.
V1424 Lows and the deadlock retry were dropped; the started Ask/audit edits were reverted to the 1.4.24 source.

## What changed
- Day: lighter cream bg/surfaces, ink outlines and text softened from #1B1340 to #2A2452 / #6B6590, softer shadow
  `rgba(42,36,82,0.20)`, lighter scrim; the dark Day hero gradient (wallet/rankings/Hero headers) is now a lighter indigo.
- Night: near-black navy → lighter navy/slate (bg #1E2A44, surface #283654, surface2 #33446A), brighter accents.
- New token keys (names unchanged otherwise): `liveText`, `shadowColor`, `tabBarBg`. Live-red text uses `liveText`.
- Deviations from tokens-bright.md, made only to keep AA: Day `ink`/`ink2`/`inkSelected` tuned; Night `teamA`/`teamAText` tuned (see table).
- Scan-driven fixes: Day daily-card attribution uses full text colour (muted was 4.26:1 on the Ball card);
  Night team-member number badges use `teamAText` on `surface` with a teamAText ring (was 3.49:1).
- Tests updated for the new values: themes1421 (bg, sheet scrim), scoreScreen (Day SERVING pill border = `outline`).

## Before / after hex values (from the 1.4.24 source vs 1.4.25 source)

### tokens.day — 12 changed

| Token | Before (1.4.24) | After (1.4.25) |
|---|---|---|
| `bg` | `#FFF4E2` | `#FFFAF3` |
| `surface2` | `#FFF4E2` | `#FFF5E6` |
| `outline` | `#1B1340` | `#6B6590` |
| `text` | `#1B1340` | `#2A2452` |
| `textMuted` | `#584F72` | `#5E5779` |
| `onPrimary` | `#1B1340` | `#2A2452` |
| `tabActive` | `#1B1340` | `#2A2452` |
| `scrim` | `rgba(27,19,64,0.55)` | `rgba(42,36,82,0.45)` |
| `track` | `#EADFCB` | `#F1E8DA` |
| `liveText` | `—` | `#C81E3A` |
| `shadowColor` | `—` | `rgba(42,36,82,0.20)` |
| `tabBarBg` | `—` | `rgba(255,250,243,0.94)` |

### tokens.night — 18 changed

| Token | Before (1.4.24) | After (1.4.25) |
|---|---|---|
| `bg` | `#0A0E1A` | `#1E2A44` |
| `surface` | `#151B2E` | `#283654` |
| `surface2` | `#232C47` | `#33446A` |
| `outline` | `#33406A` | `#7A8BB8` |
| `textMuted` | `#A3AFCB` | `#C3CDE3` |
| `onPrimary` | `#0A0E1A` | `#141C30` |
| `teamA` | `#FF5A5F` | `#FF6B70` |
| `teamAText` | `#FF5A5F` | `#FF8A8E` |
| `onTeamB` | `#0A0E1A` | `#141C30` |
| `live` | `#FF3B5C` | `#FF4D6A` |
| `onLive` | `#0A0E1A` | `#141C30` |
| `scrim` | `rgba(3,5,12,0.72)` | `rgba(10,16,32,0.60)` |
| `pink` | `#232C47` | `#33446A` |
| `track` | `#2B3247` | `#3A4A70` |
| `hero` | `['#1B1446', '#151B2E', '#0E2A35']` | `['#3A3478', '#283654', '#1F4A5A']` |
| `liveText` | `—` | `#FF8A9C` |
| `shadowColor` | `—` | `transparent` |
| `tabBarBg` | `—` | `rgba(30,42,68,0.94)` |

### colors (Day, SUNDAY_COURT) — 14 changed

| Token | Before (1.4.24) | After (1.4.25) |
|---|---|---|
| `onPrimary` | `#1B1340` | `#2A2452` |
| `ink` | `#1B1340` | `#2A2452` |
| `bg` | `#FFF4E2` | `#FFFAF3` |
| `surface` | `#FFF4E2` | `#FFF5E6` |
| `text` | `#1B1340` | `#2A2452` |
| `muted` | `#584F72` | `#5E5779` |
| `border` | `#857C9C` | `#6B6590` |
| `hairline` | `#EADBC2` | `#F1E8DA` |
| `divider` | `#F5EAD7` | `#F8F0E4` |
| `userDot` | `#1B1340` | `#2A2452` |
| `header` | `#FFF4E2` | `#FFFAF3` |
| `onHeader` | `#1B1340` | `#2A2452` |
| `scrim` | `rgba(27,19,64,0.55)` | `rgba(42,36,82,0.45)` |
| `toast` | `rgba(27,19,64,0.94)` | `rgba(42,36,82,0.94)` |

### colors (Night, FLOODLIGHT) — 23 changed

| Token | Before (1.4.24) | After (1.4.25) |
|---|---|---|
| `onPrimary` | `#0A0E1A` | `#141C30` |
| `ink` | `#0F1424` | `#1A2440` |
| `ink2` | `#232C47` | `#33446A` |
| `inkSelected` | `#33406A` | `#45578A` |
| `bg` | `#0A0E1A` | `#1E2A44` |
| `card` | `#151B2E` | `#283654` |
| `surface` | `#232C47` | `#33446A` |
| `muted` | `#A3AFCB` | `#C3CDE3` |
| `border` | `#66739A` | `#7A8BB8` |
| `hairline` | `#2A3352` | `#3A4A70` |
| `divider` | `#1C2338` | `#304064` |
| `tabInactive` | `#A3AFCB` | `#C3CDE3` |
| `court` | `#1B2440` | `#2A3858` |
| `warnBg` | `#1F2A4A` | `#33446A` |
| `selectedBg` | `#1F2A4A` | `#33446A` |
| `tint` | `#1F2A4A` | `#33446A` |
| `disabledBg` | `#232C47` | `#33446A` |
| `mapBg` | `#142028` | `#22344A` |
| `mapRoad` | `#232C47` | `#33446A` |
| `mapRoadMajor` | `#2E3A5C` | `#45578A` |
| `header` | `#0A0E1A` | `#1E2A44` |
| `scrim` | `rgba(3,5,12,0.72)` | `rgba(10,16,32,0.60)` |
| `toast` | `rgba(35,44,71,0.96)` | `rgba(51,68,106,0.96)` |

## Verification
- Suites, one at a time (scripts/finish1425.sh): tsc app, tsc server, jest, test:tz, server, rules, policy: all green.
- Contrast scan on the final web build /tmp/web425final: `SUMMARY checked=268 failures=0 skipped=0`.
  (First run: 32 failures, fixed as above, then the whole pipeline re-ran from the export.)
- Screenshots in /workspace/volleylive-screens/: 425-before-{home,live-scoring}-{DAY,NIGHT}-EN.png (1.4.24 build),
  425-after-{home,live-scoring,live-viewer,profile}-{DAY,NIGHT}-EN.png (final build).

## Artifacts
| Artifact | sha256 | Notes |
|---|---|---|
| APK /workspace/volleylive-latest.apk | fa7e73b6babdef057b2a3983e3785c96a9a3dfe99ff3defe5055ef235e078a5f | vc41 / 1.4.25; arm64-v8a + x86_64; cert fac61745…033b9c (unchanged, no new keys) |
| Zip /workspace/volleylive.zip | bb73d291838e7f52a90e7187bf46b0b2f795b3f28b98121d77c096c80776aaa8 | 553 files; usual exclusions; this note is written after the zip and is not in it |

Backups: volleylive-latest.apk.bak41, volleylive.zip.bak55, backups/volleylive-1.4.24.{apk,zip}, backups/pre1425/.
