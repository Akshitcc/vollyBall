-- VolleyLive 0029 (build 1.5.8, Tester F157x-1, Medium): a match created / scored by someone on neither team's roster
-- counts only after BOTH captains confirm (core/antifraud.ts needsBothCaptains / verdictStep).
--   first_confirm: the first captain's confirmation {by, at, epoch} while the result stays pending (not counted);
--   the other captain's confirm / reject is the verdict in the existing columns (verified_by, captain_verdict, …).
-- ADDITIVE only: one new nullable column, no backfill, nothing dropped or changed. A 1.5.7 server still serving during
-- a rolling deploy ignores it. Guarded, so it is re-runnable. Production: needs Akshit's approval (docs/qa/RELEASE-1.5.8.md).
-- ;;
SET @vl0029_has = (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'matches' AND column_name = 'first_confirm');
-- ;;
SET @vl0029_sql = IF(@vl0029_has = 0, 'ALTER TABLE matches ADD COLUMN first_confirm JSON NULL COMMENT ''first of two captain confirmations (1.5.8)''', 'DO 0');
-- ;;
PREPARE vl0029_stmt FROM @vl0029_sql;
-- ;;
EXECUTE vl0029_stmt;
-- ;;
DEALLOCATE PREPARE vl0029_stmt;
