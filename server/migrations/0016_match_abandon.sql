-- 1.4.5 (QA V144-1/V144-2, additive): abandon and admin resolution (src/core/abandon.ts).
--   max_events:      the most events the log ever had – undo never lowers it, so abandon eligibility can't be reset;
--   was_won:         latch, set when the match is finished (never cleared by a scorer; an admin's re-open of a match
--                    finished WITHOUT a winner clears it);
--   abandon_info:    who abandoned, when (server time), the event count and score then, the mode (flag / consent /
--                    admin / legacy) and the admin review (pending / confirmed / reinstated);
--   abandon_request: a pending abandon request (consent policy) – scoring is paused while it is set on a live match;
--   resolution:      an admin re-opened a match stored as finished whose events have no winner;
--   scorer_reassign: an admin moved scoring after the first rally (QA V144-8) – the verdict keeps following `from`.
-- New defaulted / nullable columns only: a 1.4.4 server still serving during a rolling deploy ignores them. Backfill:
-- max_events = event_count, was_won = 1 for finished matches. Guarded, so it is re-runnable.
SET @vl0016_has = (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'matches' AND column_name = 'max_events');
-- ;;
SET @vl0016_sql = IF(@vl0016_has = 0, 'ALTER TABLE matches ADD COLUMN max_events INT NOT NULL DEFAULT 0 COMMENT ''most events the log ever had (1.4.5, only grows)'' AFTER event_count', 'DO 0');
-- ;;
PREPARE vl0016_stmt FROM @vl0016_sql;
-- ;;
EXECUTE vl0016_stmt;
-- ;;
DEALLOCATE PREPARE vl0016_stmt;
-- ;;
SET @vl0016_has = (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'matches' AND column_name = 'was_won');
-- ;;
SET @vl0016_sql = IF(@vl0016_has = 0, 'ALTER TABLE matches ADD COLUMN was_won TINYINT(1) NOT NULL DEFAULT 0 COMMENT ''the match was finished at some point (1.4.5 latch)'' AFTER max_events', 'DO 0');
-- ;;
PREPARE vl0016_stmt FROM @vl0016_sql;
-- ;;
EXECUTE vl0016_stmt;
-- ;;
DEALLOCATE PREPARE vl0016_stmt;
-- ;;
SET @vl0016_has = (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'matches' AND column_name = 'abandon_info');
-- ;;
SET @vl0016_sql = IF(@vl0016_has = 0, 'ALTER TABLE matches ADD COLUMN abandon_info JSON NULL COMMENT ''who abandoned, when, score, admin review (1.4.5)'' AFTER was_won', 'DO 0');
-- ;;
PREPARE vl0016_stmt FROM @vl0016_sql;
-- ;;
EXECUTE vl0016_stmt;
-- ;;
DEALLOCATE PREPARE vl0016_stmt;
-- ;;
SET @vl0016_has = (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'matches' AND column_name = 'abandon_request');
-- ;;
SET @vl0016_sql = IF(@vl0016_has = 0, 'ALTER TABLE matches ADD COLUMN abandon_request JSON NULL COMMENT ''pending abandon request, consent policy (1.4.5)'' AFTER abandon_info', 'DO 0');
-- ;;
PREPARE vl0016_stmt FROM @vl0016_sql;
-- ;;
EXECUTE vl0016_stmt;
-- ;;
DEALLOCATE PREPARE vl0016_stmt;
-- ;;
SET @vl0016_has = (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'matches' AND column_name = 'resolution');
-- ;;
SET @vl0016_sql = IF(@vl0016_has = 0, 'ALTER TABLE matches ADD COLUMN resolution JSON NULL COMMENT ''admin re-opened a finished match without a winner (1.4.5)'' AFTER abandon_request', 'DO 0');
-- ;;
PREPARE vl0016_stmt FROM @vl0016_sql;
-- ;;
EXECUTE vl0016_stmt;
-- ;;
DEALLOCATE PREPARE vl0016_stmt;
-- ;;
SET @vl0016_has = (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'matches' AND column_name = 'scorer_reassign');
-- ;;
SET @vl0016_sql = IF(@vl0016_has = 0, 'ALTER TABLE matches ADD COLUMN scorer_reassign JSON NULL COMMENT ''admin moved scoring after the first rally: from/to/by/at (1.4.5)'' AFTER resolution', 'DO 0');
-- ;;
PREPARE vl0016_stmt FROM @vl0016_sql;
-- ;;
EXECUTE vl0016_stmt;
-- ;;
DEALLOCATE PREPARE vl0016_stmt;
-- ;;
UPDATE matches SET max_events = event_count WHERE max_events < event_count;
-- ;;
UPDATE matches SET was_won = 1 WHERE status = 'finished' AND was_won = 0;
