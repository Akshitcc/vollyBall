-- 1.4.6 (QA V145-2/5/12, additive): one match lifecycle (src/core/lifecycle.ts).
--   reopen_epoch:          bumped by every admin re-open; the re-open also clears the captain verdict / review;
--   verdict_epoch:         the reopen_epoch the stored captain verdict belongs to (wallet / rankings count a verdict
--                          only when it equals reopen_epoch – older rows: NULL = epoch 0);
--   abandon_history:       earlier abandon records (an admin abandon after a reinstate keeps the old one), never
--                          overwritten;
--   abandon_request_count / abandon_request_at: consent-policy rate limit (3 per match, 2 min apart).
-- New defaulted / nullable columns only: a 1.4.5 server still serving during a rolling deploy ignores them.
-- Guarded, so it is re-runnable. No backfill needed (defaults are the 1.4.5 meaning).
-- ;;
SET @vl0017_has = (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'matches' AND column_name = 'reopen_epoch');
-- ;;
SET @vl0017_sql = IF(@vl0017_has = 0, 'ALTER TABLE matches ADD COLUMN reopen_epoch INT NOT NULL DEFAULT 0 COMMENT ''admin re-opens so far; a captain verdict counts only in the current epoch (1.4.6)'' AFTER scorer_reassign', 'DO 0');
-- ;;
PREPARE vl0017_stmt FROM @vl0017_sql;
-- ;;
EXECUTE vl0017_stmt;
-- ;;
DEALLOCATE PREPARE vl0017_stmt;
-- ;;
SET @vl0017_has = (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'matches' AND column_name = 'verdict_epoch');
-- ;;
SET @vl0017_sql = IF(@vl0017_has = 0, 'ALTER TABLE matches ADD COLUMN verdict_epoch INT NULL COMMENT ''reopen_epoch when the captain verdict was given (1.4.6)'' AFTER reopen_epoch', 'DO 0');
-- ;;
PREPARE vl0017_stmt FROM @vl0017_sql;
-- ;;
EXECUTE vl0017_stmt;
-- ;;
DEALLOCATE PREPARE vl0017_stmt;
-- ;;
SET @vl0017_has = (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'matches' AND column_name = 'abandon_history');
-- ;;
SET @vl0017_sql = IF(@vl0017_has = 0, 'ALTER TABLE matches ADD COLUMN abandon_history JSON NULL COMMENT ''earlier abandon records, append-only (1.4.6)'' AFTER verdict_epoch', 'DO 0');
-- ;;
PREPARE vl0017_stmt FROM @vl0017_sql;
-- ;;
EXECUTE vl0017_stmt;
-- ;;
DEALLOCATE PREPARE vl0017_stmt;
-- ;;
SET @vl0017_has = (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'matches' AND column_name = 'abandon_request_count');
-- ;;
SET @vl0017_sql = IF(@vl0017_has = 0, 'ALTER TABLE matches ADD COLUMN abandon_request_count INT NOT NULL DEFAULT 0 COMMENT ''abandon requests made, consent policy rate limit (1.4.6)'' AFTER abandon_history', 'DO 0');
-- ;;
PREPARE vl0017_stmt FROM @vl0017_sql;
-- ;;
EXECUTE vl0017_stmt;
-- ;;
DEALLOCATE PREPARE vl0017_stmt;
-- ;;
SET @vl0017_has = (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'matches' AND column_name = 'abandon_request_at');
-- ;;
SET @vl0017_sql = IF(@vl0017_has = 0, 'ALTER TABLE matches ADD COLUMN abandon_request_at BIGINT NULL COMMENT ''epoch ms of the last abandon request (1.4.6)'' AFTER abandon_request_count', 'DO 0');
-- ;;
PREPARE vl0017_stmt FROM @vl0017_sql;
-- ;;
EXECUTE vl0017_stmt;
-- ;;
DEALLOCATE PREPARE vl0017_stmt;
