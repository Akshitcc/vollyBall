-- 1.4.1 (QA V140-7, additive): "Fact of the day" items that are turned off or deleted keep a server-timed
-- tombstone, so the daily rotation (src/core/dailyItems.ts pickDaily) never reshapes cycles that had already
-- started: an item removed on day R keeps its slot in every cycle that started on or before R.
--   removed_at: when it was turned off / deleted (server time, set once, never changed afterwards);
--   deleted:    deleted by an admin – no longer listed for admins; the public list sends only id + timestamps.
-- Turning an item back on creates a new row (a copy with a new created_at); the old row is marked deleted.
-- Items turned off before 1.4.1 have removed_at NULL and are simply in no cycle (as in 1.4.0).
-- New nullable / defaulted columns only: a 1.4.0 server still serving during a rolling deploy keeps working
-- (it ignores them; a row it hard-deletes simply disappears, as before). Guarded, so it is re-runnable.
SET @vl0015_has = (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'daily_items' AND column_name = 'removed_at');
-- ;;
SET @vl0015_sql = IF(@vl0015_has = 0, 'ALTER TABLE daily_items ADD COLUMN removed_at DATETIME(3) NULL COMMENT ''turned off / deleted at (server time, set once)'' AFTER updated_at', 'DO 0');
-- ;;
PREPARE vl0015_stmt FROM @vl0015_sql;
-- ;;
EXECUTE vl0015_stmt;
-- ;;
DEALLOCATE PREPARE vl0015_stmt;
-- ;;
SET @vl0015_has = (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'daily_items' AND column_name = 'deleted');
-- ;;
SET @vl0015_sql = IF(@vl0015_has = 0, 'ALTER TABLE daily_items ADD COLUMN deleted TINYINT(1) NOT NULL DEFAULT 0 COMMENT ''deleted by an admin (tombstone)'' AFTER removed_at', 'DO 0');
-- ;;
PREPARE vl0015_stmt FROM @vl0015_sql;
-- ;;
EXECUTE vl0015_stmt;
-- ;;
DEALLOCATE PREPARE vl0015_stmt;
