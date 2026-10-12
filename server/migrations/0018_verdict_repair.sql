-- 1.4.8 (QA V147-2, additive): an admin's repair of a match nobody could confirm (core/verdictRepair.ts).
--   verdict_repair: the last repair record (who, when, scorer / confirmer, what was there before), JSON.
-- A new nullable column only: a 1.4.7 server still serving during a rolling deploy ignores it. No backfill and no
-- data change: existing matches are repaired only by the explicit admin action. Guarded, so it is re-runnable.
-- ;;
SET @vl0018_has = (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'matches' AND column_name = 'verdict_repair');
-- ;;
SET @vl0018_sql = IF(@vl0018_has = 0, 'ALTER TABLE matches ADD COLUMN verdict_repair JSON NULL COMMENT ''admin verdict repair record (1.4.8)''', 'DO 0');
-- ;;
PREPARE vl0018_stmt FROM @vl0018_sql;
-- ;;
EXECUTE vl0018_stmt;
-- ;;
DEALLOCATE PREPARE vl0018_stmt;
