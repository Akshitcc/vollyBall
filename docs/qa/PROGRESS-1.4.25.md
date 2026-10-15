# 1.4.25 (versionCode 41) progress – updated after each step
Scope (cut 1:36 PM IST): ONLY the Designer bright tokens + fixes the scan/snapshots need. V1424 Lows and deadlock retry dropped; the started Ask/audit edits were reverted from backups/pre1425.
- [x] Backups: volleylive-latest.apk.bak41 (28d0ce0c…), volleylive.zip.bak55 (52ef7a22…), backups/volleylive-1.4.24.{apk,zip}, backups/pre1425/
- [x] BEFORE screenshots (1.4.24 build /tmp/web424final2): 425-before-{home,live-scoring}-{DAY,NIGHT}-EN
- [x] Palette: Designer bright tokens (volleylive-design/daynight/bright/tokens-bright.md §3 tokens.ts, §4 themes.ts) applied; new tokens liveText/shadowColor/tabBarBg; Day shadow 3 3 0 rgba(42,36,82,0.20); Day hero gradient (wallet/rankings/Hero headers) #1B1340… → #3A3283/#433A93/#4C43A0; live text uses liveText; tests updated (themes1421 bg, sheet scrim)
- [x] Version 1.4.25 / 41 (app.config.ts). RELEASE-1.4.25.md written after the final zip (V1424-3 dropped with the scope cut)
- [~] Pipeline run 1: scan 32 failures (Day daily-attribution muted ink on Ball 4.26; Night team member numbers teamA on surface2 3.49) → fixed in DailyCard.tsx and team/[id].tsx; restarted START=1
- [ ] AFTER screenshots 425-after-*
