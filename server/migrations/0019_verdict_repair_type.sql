-- 1.4.9 (QA H10, additive – changes nothing): 0018 only checked the column NAME, so a pre-existing `verdict_repair`
-- of another type (e.g. TEXT from a hand-made patch) was accepted silently. This check stops the migration with a
-- clear error when matches.verdict_repair exists and is not JSON; the operator fixes the column by hand (no data is
-- touched here). 0018 is left unchanged (its checksum is already recorded).
-- ;;
SET @vl0019_type = (SELECT LOWER(DATA_TYPE) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'matches' AND column_name = 'verdict_repair');
-- ;;
SET @vl0019_sql = IF(@vl0019_type IS NULL OR @vl0019_type = 'json', 'DO 0',
  CONCAT('SELECT `0019: matches.verdict_repair must be JSON, found ', REPLACE(@vl0019_type, '`', ''), ' - fix the column by hand` FROM matches LIMIT 0'));
-- ;;
PREPARE vl0019_stmt FROM @vl0019_sql;
-- ;;
EXECUTE vl0019_stmt;
-- ;;
DEALLOCATE PREPARE vl0019_stmt;
