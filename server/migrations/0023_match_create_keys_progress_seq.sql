-- 1.4.26 (DB integrity audit, additive and re-runnable):
-- 1) DB-1: POST /matches retry dedupe. The app sends an Idempotency-Key per "Create match" tap; a retry or double
--    tap with the same key (same creator) returns the match already created instead of a second one.
-- 2) DB-4: matches.progress_seq – the highest client save sequence the score was written from. A save that arrives
--    with a lower sequence (an older state delivered late, e.g. a timed-out request landing after its retry) is
--    refused with 409 progress_stale instead of silently undoing newer rallies. NULL = no sequenced save yet.
CREATE TABLE IF NOT EXISTS match_create_keys (
  user_id    VARCHAR(128) NOT NULL COMMENT 'creator (the key is per user)',
  idem_key   VARCHAR(64)  NOT NULL COMMENT 'Idempotency-Key header, 8-64 of [A-Za-z0-9_-]',
  match_id   VARCHAR(64)  NOT NULL,
  created_at DATETIME(3)  NOT NULL,
  PRIMARY KEY (user_id, idem_key),
  KEY ix_match_create_keys_match (match_id),
  CONSTRAINT fk_match_create_keys_match FOREIGN KEY (match_id) REFERENCES matches (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
-- ;;
SET @vl0023_has = (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'matches' AND column_name = 'progress_seq');
-- ;;
SET @vl0023_sql = IF(@vl0023_has = 0, 'ALTER TABLE matches ADD COLUMN progress_seq BIGINT UNSIGNED NULL COMMENT ''highest client save sequence written (1.4.26)'' AFTER max_events', 'DO 0');
-- ;;
PREPARE vl0023_stmt FROM @vl0023_sql;
-- ;;
EXECUTE vl0023_stmt;
-- ;;
DEALLOCATE PREPARE vl0023_stmt;
