# 1.4.27 progress (E2E-4 groups + knockout, V1425-4)
Rules: source only; volleylive-latest.apk / volleylive.zip NOT replaced (Tester on 1.4.26). Backups: backups/volleylive-1.4.26.{apk,zip}, backups/volleylive-src.pre1427.tar.gz.
- [x] backups
- [x] MAX_TOURNAMENT_TEAMS 32 (core limits → app, API zod, demo via validate; Firestore rules: 32, reads for the first 10, ids + duplicates for all 32)
- [x] core/groups.ts: plans, balanced seeded/random draw, generator, cross-group seeding, group tables, resolver, validation; play-in maths
- [x] migration 0024 (additive, re-runnable): format 'groups', tournaments.advance, tournament_teams.group_key, fixtures.group_key/home_seed/away_seed
- [x] API: schema + load/save + groupsProblem + resolver for fixture readiness; lock keys include group/seeds
- [x] demo: groupsProblem on create/update (owner-only + lock already)
- [x] rules + rules test (32 teams, groups format, advance)
- [x] UI new.tsx (format, plan, draw, preview, play-in hint) + [id].tsx (Groups tab, seeded bracket) + i18n EN/HI
- [x] unit tests groups1427 (39)
- [x] V1425-4 photo-card Devanagari clipping
- [x] API runs: 15 teams, 17 teams (groups + play-in), db-audit
- [x] UI tests; fix old tests asserting 10; full suites

## Status update (2026-10-16, source + tests DONE; APK/zip NOT built, per instruction)
- [x] V1425-4 fixed (caption band 1.4× font + padding, EN 56 / HI 44). Verified in a fresh web export at 360px: volleylive-screens/1427-after-photos-{HI,EN}.png
- [x] API runs on local :3306: 15-team groups, 17-team groups, 17-team play-in (server/tests/groups1427.test.ts 7/7), db-audit --simulate 31/31 PASS
- [x] UI jest: src/components/__tests__/groups1427.test.tsx (6, EN/HI); old 10-team asserts moved to 32
- [x] Card now forwards testID/accessibilityLabel when not pressable (was being dropped)
- [x] tsc app + server clean; jest 141 suites / 1699; test:tz 5 zones; server 390 (the one failure, the V141-1 migration list, fixed for 0024 and re-run green); rules 226; policy suites pass
- [x] APK + zip: go given with the 1.4.26 E2E fixes (below); built by scripts/finish1427.sh

## Tester's 1.4.26 E2E rerun fixes + build (vc43)
Backups: volleylive-latest.apk.bak43 (= 1.4.26 apk 6a175149…), volleylive.zip.bak57 (= 1.4.26 zip).
- [x] V1426-1 (Medium): Idempotency-Key claimed atomically before the fixture lock – migration 0025 match_create_claims, first write of the create transaction (concurrent retries wait on the primary key, then all get the first 201 {id}). server/tests/fixes1427.test.ts: 4 runs × 8 concurrent retries on a fixture match = 8×201, same id, 1 match.
- [x] V1426-2 (Medium): progress_seq reset to NULL on any scorer change (PATCH handoff, admin reassign); client seq is a per-match counter (no device clock) rebased on the server's seq on 409 progress_stale and re-sent; refused again -> rejected, score screen shows score.saveRefused (EN/HI), keeps the log cached, retries in 5 s. Tests: fixes1427 handoff with clock 2 min behind (12/12 rallies), src/services/__tests__/dbaudit1426.test.ts (rebase + counter).
- [x] V1426-4 (Low): db-audit abandoned.record ignores direct abandons (no rally); still flags an abandon after a rally without a record. db-audit.sql regenerated.
- [x] V1426-5 (Low): same key + different body -> 422 idempotency_mismatch (matchId of the first); save without seq after a sequenced save -> 409 progress_seq_required (older apps on matches never sequenced keep LWW); demo keeps the claim on an unlink of a played fixture like the API (demoParity1427.test.ts).
- [x] V1426-3 (Low): documented as is in RELEASE-1.4.27 (Firestore rules over the expression budget; API/demo enforce).
- [x] E2E-10 (browser pass): POTM Spikes/Blocks/Aces show '–' when the match has no point kinds at all (core/stats hasDetailedStats, from the data) – old tap-a-player matches like match_5mc8xbgv9y0x. potm1427.test.tsx.
- [x] V1425-4: 'ट्रॉफी' (no nukta) measured in Chromium at the HI caption size: same ascent (41 px) as 'ट्रॉफ़ी', top 83 px inside the band 64–150 – covered.
- [x] Web splash: blank page on a hard reload was expected (expo-splash-screen is native-only); public/index.html now paints the splash colours (Day #FFFAF3 / Night #1E2A44 by prefers-color-scheme) + theme-color. web1427.test.ts.
- [x] Colour revert (Akshit via Dream): in-app tokens back to the pre-'fresher greens' values (backups/tokens.ts.pre1426green, themes.ts.pre1426green; DNKit/ThemeTransition #9BFF3A -> #C6FF1A). Logo/icon/splash/notification icon kept. NOTE: /workspace/backups/volleylive-1.4.25.zip does not exist on the box; reference used = the 1.4.26 pre-greens backups (1.4.25 tokens + the V1425-1/2 Night contrast fixes).
- [x] Suites: tsc app + server clean; jest 144 suites / 1704 (after the revert); tz 5 zones; server 399/399 (full, once); rules 226/226; policy all passed
- [x] Contrast scan after the revert: checked=268 failures=0
- [x] RELEASE-1.4.27.md written before the zip; shas in /workspace/volleylive-1.4.27-shas.txt after the build
