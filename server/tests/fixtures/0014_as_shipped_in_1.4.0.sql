-- TEST FIXTURE ONLY (1.4.1, V140-1): migration 0014 exactly as shipped in the 1.4.0 build, used to reproduce
-- its interrupted / stuck states. Never run by the migration runner.
-- 1.4.0 (QA V139-1, additive): repairs a database that applied the 1.3.8 version of 0013.
--
-- 0013 was corrected in place in 1.3.9, but a database that had already recorded the 1.3.8 0013 never
-- re-runs it, so it kept the 1.3.8 index NULLIF(LOWER(TRIM(email)),'') in the users table's
-- utf8mb4_0900_ai_ci collation – accent- and width-insensitive: josé@ was refused after jose@ – and the
-- addresses 1.3.8 cleared for that reason stayed cleared. This migration:
--   1. drops that index (any ux_users_email_norm whose expression is not compared utf8mb4_bin);
--   2. gives back every address 1.3.8 cleared (listed in email_duplicates_0013) where it is SAFE: the
--      account still has no email, and no account holds the same address up to case/surrounding spaces
--      (byte comparison on LOWER(TRIM(email))); if two cleared addresses clash with each other, only the
--      oldest account (created_at, then id) gets it. Each restore is logged in email_restored_0014 and
--      removed from email_duplicates_0013 (which then lists only addresses that are still cleared);
--   3. creates the binary (case-insensitive only) index, as 0013 does.
--
-- On a correct database (1.3.9+ 0013 applied: the binary index exists) every step is a no-op – no table
-- is created, no row or index changes. If a run is interrupted (index already dropped), the next run
-- finds the index missing and finishes the repair. Needs the one-connection runner (src/db/migrate.ts).
-- MySQL can't NFC-normalise: emails saved before 1.4.0 in decomposed form (NFD) are normalised by the app
-- on the account's next save (V139-2, docs/KNOWN-GAPS.md).
SET @vl0014_old = (SELECT COUNT(*) FROM information_schema.statistics
  WHERE table_schema = DATABASE() AND table_name = 'users' AND index_name = 'ux_users_email_norm'
    AND COALESCE(expression, '') NOT LIKE '%utf8mb4_bin%');
-- ;;
SET @vl0014_missing = (SELECT COUNT(*) = 0 FROM information_schema.statistics
  WHERE table_schema = DATABASE() AND table_name = 'users' AND index_name = 'ux_users_email_norm');
-- ;;
SET @vl0014_dups = (SELECT COUNT(*) FROM information_schema.tables
  WHERE table_schema = DATABASE() AND table_name = 'email_duplicates_0013');
-- ;;
-- repair needed: the 1.3.8 index is there, or a previous repair stopped after dropping it
SET @vl0014_run = (@vl0014_old > 0 OR @vl0014_missing = 1) AND @vl0014_dups > 0;
-- ;;
SET @vl0014_sql = IF(@vl0014_old > 0, 'DROP INDEX ux_users_email_norm ON users', 'DO 0');
-- ;;
PREPARE vl0014_stmt FROM @vl0014_sql;
-- ;;
EXECUTE vl0014_stmt;
-- ;;
DEALLOCATE PREPARE vl0014_stmt;
-- ;;
SET @vl0014_sql = IF(@vl0014_run, 'CREATE TABLE IF NOT EXISTS email_restored_0014 (
  user_id     VARCHAR(128) NOT NULL PRIMARY KEY,
  email       VARCHAR(254) NOT NULL COMMENT ''the address given back (it was cleared by the 1.3.8 0013)'',
  restored_at DATETIME(3)  NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci', 'DO 0');
-- ;;
PREPARE vl0014_stmt FROM @vl0014_sql;
-- ;;
EXECUTE vl0014_stmt;
-- ;;
DEALLOCATE PREPARE vl0014_stmt;
-- ;;
SET @vl0014_sql = IF(@vl0014_run, 'INSERT IGNORE INTO email_restored_0014 (user_id, email, restored_at)
SELECT c.user_id, c.email, NOW(3) FROM (
  SELECT d.user_id, d.email,
    ROW_NUMBER() OVER (PARTITION BY LOWER(TRIM(d.email)) COLLATE utf8mb4_bin ORDER BY u.created_at, u.id) AS rn
  FROM email_duplicates_0013 d
  JOIN users u ON u.id COLLATE utf8mb4_bin = d.user_id COLLATE utf8mb4_bin
  WHERE u.email IS NULL AND CHAR_LENGTH(TRIM(d.email)) > 0
    AND NOT EXISTS (SELECT 1 FROM users x WHERE x.email IS NOT NULL
      AND LOWER(TRIM(x.email)) COLLATE utf8mb4_bin = LOWER(TRIM(d.email)) COLLATE utf8mb4_bin)
) c WHERE c.rn = 1', 'DO 0');
-- ;;
PREPARE vl0014_stmt FROM @vl0014_sql;
-- ;;
EXECUTE vl0014_stmt;
-- ;;
DEALLOCATE PREPARE vl0014_stmt;
-- ;;
SET @vl0014_sql = IF(@vl0014_run, 'UPDATE users u
JOIN email_restored_0014 r ON r.user_id COLLATE utf8mb4_bin = u.id COLLATE utf8mb4_bin
SET u.email = r.email
WHERE u.email IS NULL', 'DO 0');
-- ;;
PREPARE vl0014_stmt FROM @vl0014_sql;
-- ;;
EXECUTE vl0014_stmt;
-- ;;
DEALLOCATE PREPARE vl0014_stmt;
-- ;;
SET @vl0014_sql = IF(@vl0014_run, 'DELETE d FROM email_duplicates_0013 d
JOIN email_restored_0014 r ON r.user_id COLLATE utf8mb4_bin = d.user_id COLLATE utf8mb4_bin', 'DO 0');
-- ;;
PREPARE vl0014_stmt FROM @vl0014_sql;
-- ;;
EXECUTE vl0014_stmt;
-- ;;
DEALLOCATE PREPARE vl0014_stmt;
-- ;;
SET @vl0014_has = (SELECT COUNT(*) FROM information_schema.statistics
  WHERE table_schema = DATABASE() AND table_name = 'users' AND index_name = 'ux_users_email_norm');
-- ;;
SET @vl0014_sql = IF(@vl0014_has = 0,
  'CREATE UNIQUE INDEX ux_users_email_norm ON users ((CAST(NULLIF(LOWER(TRIM(email)), '''') AS CHAR(254)) COLLATE utf8mb4_bin))',
  'DO 0');
-- ;;
PREPARE vl0014_stmt FROM @vl0014_sql;
-- ;;
EXECUTE vl0014_stmt;
-- ;;
DEALLOCATE PREPARE vl0014_stmt;
