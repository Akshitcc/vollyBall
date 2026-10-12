-- 1.3.8 (QA V137-8, additive): one account per email address, enforced by the database too (the app
-- check in domain/users.ts could race: two saves at once could both pass it).
-- Normalised = trimmed and lower-cased, then compared BYTE FOR BYTE (utf8mb4_bin): josé@ ≠ jose@,
-- straße@ ≠ strasse@, fullwidth ｒ ≠ r (1.3.9, V138-2). An empty string counts as no email; NULL is never checked.
--
-- Existing duplicates are handled WITHOUT deleting anyone: the oldest account keeps the address (a
-- created_at tie: the lowest id); on the others the email is cleared (it is optional) and recorded in
-- email_duplicates_0013 for support to follow up. Nothing else on those accounts changes.
--
-- 1.3.9 (QA V138-1) – FIXED IN PLACE. This file shipped in the 1.3.8 demo build but was never deployed
-- to a real server, so it was corrected here instead of adding a new migration. The 1.3.8 version:
--   * created email_duplicates_0013 without a charset/collation, so it took the database default; on a
--     database whose default is not utf8mb4_0900_ai_ci (utf8mb4_unicode_ci, general_ci, upgraded from
--     5.7) the UPDATE failed with "Illegal mix of collations" and, because DDL auto-commits, left a
--     half-applied state (table made and filled, no email cleared, no index, 0013 not recorded);
--   * compared emails accent- and width-insensitively (the users table's 0900_ai_ci).
-- This version pins utf8mb4 / utf8mb4_0900_ai_ci on the table (like every other table), compares with an
-- explicit COLLATE utf8mb4_bin, and every step is re-runnable, so it completes from that half-applied
-- state (or after any other failure) and a second run changes nothing. A database that recorded the
-- 1.3.8 version is repaired by 0014_email_index_repair.sql (1.4.0, QA V139-1) – no need to recreate it.
-- Needs the runner to run a file on one connection (src/db/migrate.ts, 1.3.9) for the guarded steps.
CREATE TABLE IF NOT EXISTS email_duplicates_0013 (
  user_id      VARCHAR(128) NOT NULL PRIMARY KEY,
  email        VARCHAR(254) NOT NULL COMMENT 'the address that was cleared on this account',
  kept_user_id VARCHAR(128) NOT NULL COMMENT 'the (oldest) account that keeps it',
  noted_at     DATETIME(3)  NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
-- ;;
-- A table left by the 1.3.8 version may carry the database default collation: convert it (no-op otherwise).
ALTER TABLE email_duplicates_0013 CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
-- ;;
-- Entries whose address was never actually cleared (left by a run that failed before the UPDATE, and
-- possibly computed accent-insensitively) are worked out again below. Entries for cleared addresses stay.
DELETE d FROM email_duplicates_0013 d
JOIN users u ON u.id COLLATE utf8mb4_bin = d.user_id COLLATE utf8mb4_bin
WHERE u.email COLLATE utf8mb4_bin = d.email COLLATE utf8mb4_bin;
-- ;;
INSERT IGNORE INTO email_duplicates_0013 (user_id, email, kept_user_id, noted_at)
SELECT d.id, d.email, d.kept, NOW(3) FROM (
  SELECT id, email,
    ROW_NUMBER() OVER (PARTITION BY LOWER(TRIM(email)) COLLATE utf8mb4_bin ORDER BY created_at, id) AS rn,
    FIRST_VALUE(id) OVER (PARTITION BY LOWER(TRIM(email)) COLLATE utf8mb4_bin ORDER BY created_at, id) AS kept
  FROM users
  WHERE email IS NOT NULL AND TRIM(email) <> ''
) d
WHERE d.rn > 1;
-- ;;
-- Only clears the exact address that was listed (a later change on that account is left alone).
UPDATE users u
JOIN email_duplicates_0013 d ON d.user_id COLLATE utf8mb4_bin = u.id COLLATE utf8mb4_bin
SET u.email = NULL
WHERE u.email COLLATE utf8mb4_bin = d.email COLLATE utf8mb4_bin;
-- ;;
-- Guarded index steps (MySQL has no CREATE INDEX IF NOT EXISTS): an index of this name that does not
-- compare byte for byte (the 1.3.8 definition) is replaced; a missing one is created; a correct one is kept.
SET @vl0013_old = (SELECT COUNT(*) FROM information_schema.statistics
  WHERE table_schema = DATABASE() AND table_name = 'users' AND index_name = 'ux_users_email_norm'
    AND COALESCE(expression, '') NOT LIKE '%utf8mb4_bin%');
-- ;;
SET @vl0013_sql = IF(@vl0013_old > 0, 'DROP INDEX ux_users_email_norm ON users', 'DO 0');
-- ;;
PREPARE vl0013_stmt FROM @vl0013_sql;
-- ;;
EXECUTE vl0013_stmt;
-- ;;
DEALLOCATE PREPARE vl0013_stmt;
-- ;;
SET @vl0013_has = (SELECT COUNT(*) FROM information_schema.statistics
  WHERE table_schema = DATABASE() AND table_name = 'users' AND index_name = 'ux_users_email_norm');
-- ;;
SET @vl0013_sql = IF(@vl0013_has = 0,
  'CREATE UNIQUE INDEX ux_users_email_norm ON users ((CAST(NULLIF(LOWER(TRIM(email)), '''') AS CHAR(254)) COLLATE utf8mb4_bin))',
  'DO 0');
-- ;;
PREPARE vl0013_stmt FROM @vl0013_sql;
-- ;;
EXECUTE vl0013_stmt;
-- ;;
DEALLOCATE PREPARE vl0013_stmt;
