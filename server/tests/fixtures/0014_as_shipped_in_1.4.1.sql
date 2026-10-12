-- TEST FIXTURE ONLY (1.4.2, V141-1): migration 0014 exactly as shipped in the 1.4.1 build, used to reproduce
-- a run interrupted between its restoring UPDATE and its final DELETE. Never run by the migration runner.
-- 1.4.0 (QA V139-1, additive): repairs a database that applied the 1.3.8 version of 0013.
--
-- 0013 was corrected in place in 1.3.9, but a database that had already recorded the 1.3.8 0013 never
-- re-runs it, so it kept the 1.3.8 index NULLIF(LOWER(TRIM(email)),'') in the users table's
-- utf8mb4_0900_ai_ci collation – accent- and width-insensitive: josé@ was refused after jose@ – and the
-- addresses 1.3.8 cleared for that reason stayed cleared.
--
-- 1.4.1 (QA V140-1, V140-2, V140-3) – FIXED IN PLACE. 0014 shipped inside the 1.4.0 build's server code
-- but was never deployed to any server (no production database has recorded it), and a NEW migration
-- could not repair it: the 1.4.0 version could fail on every start (see below), and a failing 0014 stops
-- the runner before any 0015 is reached. The 1.4.0 version:
--   * dropped the old index FIRST, then logged and restored addresses; a run interrupted after logging, with
--     someone saving one of those addresses before the rerun (no unique index in that window), restored
--     it anyway – a duplicate, so CREATE UNIQUE INDEX failed on every later start (V140-1);
--   * on a database whose default charset is latin1 the 1.3.8 0013 made email_duplicates_0013 in latin1
--     (addresses outside Latin-1 logged as '?'); 0014 then failed with "COLLATION 'utf8mb4_bin' is not
--     valid for CHARACTER SET 'latin1'" after dropping the index (V140-2);
--   * could give back an NFC address while another account held the same address in decomposed form (NFD),
--     which MySQL can't normalise (V140-3).
-- This version:
--   1. while the 1.3.8 index is still in place, creates the binary index under a temporary name (always
--      possible: 1.3.8's accent-insensitive uniqueness implies byte uniqueness), then swaps them in ONE
--      ALTER TABLE (drop old + rename new). The users table is never without a unique email index;
--   2. a database left without any index by the 1.4.0 version is first cleaned: an address the 1.4.0 run
--      gave back that another account now also holds is cleared again and listed again in
--      email_duplicates_0013 (the other account keeps it); then the index is created;
--   3. restore-log rows that were never applied (the account still has no email) are dropped and worked out
--      again, so a rerun re-checks everything (V140-1);
--   4. gives back an address 1.3.8 cleared only where SAFE: the account still has no email, and no account
--      holds the same address up to case/surrounding spaces (byte comparison, as the index) NOR up to
--      canonical equivalence (utf8mb4_0900_as_cs: josé typed as e + U+0301 = josé; still accent-, width- and
--      case-sensitive after LOWER, so jose@ / ｒ / ß stay distinct). Two cleared addresses that clash: only
--      the oldest account (created_at, then id) gets it. The value given back is trimmed and lower-cased
--      (NFC follows on the account's next save, V139-2). The UPDATE is UPDATE IGNORE with the unique index
--      already in place, so it can never create a byte duplicate – a clash is skipped and stays cleared;
--   5. addresses logged by a latin1 email_duplicates_0013 are read with CONVERT(... USING utf8mb4); one
--      that contains '?' in such a table may have been mangled ('ｒajw@' → '?ajw@') and is never given back
--      (it stays listed for support). The log table is not altered (V140-2);
--   6. each applied restore is kept in email_restored_0014 and removed from email_duplicates_0013.
-- A case-only duplicate stays cleared while another account holds the address; if that account has since
-- removed its address the address is free and goes back to the oldest cleared account (docs/KNOWN-GAPS.md).
--
-- On a correct database (1.3.9+ 0013 applied: the binary index exists, no email_restored_0014) every step is
-- a no-op – no table is created, no row or index changes. Every step is re-runnable: a run stopped at any
-- point is finished by the next one. Needs the one-connection runner (src/db/migrate.ts).
SET @vl0014_old = (SELECT COUNT(*) FROM information_schema.statistics
  WHERE table_schema = DATABASE() AND table_name = 'users' AND index_name = 'ux_users_email_norm'
    AND COALESCE(expression, '') NOT LIKE '%utf8mb4_bin%');
-- ;;
SET @vl0014_tmp = (SELECT COUNT(*) FROM information_schema.statistics
  WHERE table_schema = DATABASE() AND table_name = 'users' AND index_name = 'ux_users_email_bin');
-- ;;
SET @vl0014_missing = (SELECT COUNT(*) = 0 FROM information_schema.statistics
  WHERE table_schema = DATABASE() AND table_name = 'users' AND index_name = 'ux_users_email_norm');
-- ;;
SET @vl0014_dups = (SELECT COUNT(*) FROM information_schema.tables
  WHERE table_schema = DATABASE() AND table_name = 'email_duplicates_0013');
-- ;;
SET @vl0014_logged = (SELECT COUNT(*) FROM information_schema.tables
  WHERE table_schema = DATABASE() AND table_name = 'email_restored_0014');
-- ;;
-- repair needed: the 1.3.8 index is there, a previous repair stopped part-way (temporary index, no index,
-- or the restore log exists), and 1.3.8 listed what it cleared
SET @vl0014_run = (@vl0014_old > 0 OR @vl0014_tmp > 0 OR @vl0014_missing = 1 OR @vl0014_logged > 0) AND @vl0014_dups > 0;
-- ;;
-- the log table's email column is not utf8mb4 (made by the 1.3.8 0013 on a latin1 / other default database)
SET @vl0014_lossy = (SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'email_duplicates_0013' AND column_name = 'email'
    AND COALESCE(character_set_name, '') <> 'utf8mb4');
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
-- Step 2 (only without any index – left by the 1.4.0 version): an address it gave back that another account
-- also holds now is listed again (the other account keeps it) …
SET @vl0014_sql = IF(@vl0014_run AND @vl0014_missing = 1 AND @vl0014_tmp = 0, 'INSERT IGNORE INTO email_duplicates_0013 (user_id, email, kept_user_id, noted_at)
SELECT u.id, u.email, MIN(x.id), NOW(3)
FROM email_restored_0014 r
JOIN users u ON u.id COLLATE utf8mb4_bin = r.user_id COLLATE utf8mb4_bin AND u.email COLLATE utf8mb4_bin = r.email COLLATE utf8mb4_bin
JOIN users x ON x.id COLLATE utf8mb4_bin <> u.id COLLATE utf8mb4_bin AND x.email IS NOT NULL
  AND LOWER(TRIM(x.email)) COLLATE utf8mb4_bin = LOWER(TRIM(u.email)) COLLATE utf8mb4_bin
GROUP BY u.id, u.email', 'DO 0');
-- ;;
PREPARE vl0014_stmt FROM @vl0014_sql;
-- ;;
EXECUTE vl0014_stmt;
-- ;;
DEALLOCATE PREPARE vl0014_stmt;
-- ;;
-- … and cleared again
SET @vl0014_sql = IF(@vl0014_run AND @vl0014_missing = 1 AND @vl0014_tmp = 0, 'UPDATE users u
JOIN email_restored_0014 r ON r.user_id COLLATE utf8mb4_bin = u.id COLLATE utf8mb4_bin
JOIN users x ON x.id COLLATE utf8mb4_bin <> u.id COLLATE utf8mb4_bin AND x.email IS NOT NULL
  AND LOWER(TRIM(x.email)) COLLATE utf8mb4_bin = LOWER(TRIM(u.email)) COLLATE utf8mb4_bin
SET u.email = NULL
WHERE u.email COLLATE utf8mb4_bin = r.email COLLATE utf8mb4_bin', 'DO 0');
-- ;;
PREPARE vl0014_stmt FROM @vl0014_sql;
-- ;;
EXECUTE vl0014_stmt;
-- ;;
DEALLOCATE PREPARE vl0014_stmt;
-- ;;
-- Step 1: the binary index under a temporary name, next to the 1.3.8 one
SET @vl0014_sql = IF(@vl0014_old > 0 AND @vl0014_tmp = 0,
  'CREATE UNIQUE INDEX ux_users_email_bin ON users ((CAST(NULLIF(LOWER(TRIM(email)), '''') AS CHAR(254) CHARACTER SET utf8mb4) COLLATE utf8mb4_bin))',
  'DO 0');
-- ;;
PREPARE vl0014_stmt FROM @vl0014_sql;
-- ;;
EXECUTE vl0014_stmt;
-- ;;
DEALLOCATE PREPARE vl0014_stmt;
-- ;;
SET @vl0014_tmp = (SELECT COUNT(*) FROM information_schema.statistics
  WHERE table_schema = DATABASE() AND table_name = 'users' AND index_name = 'ux_users_email_bin');
-- ;;
-- … then swapped in one statement (old dropped and new renamed together); a leftover temporary index next
-- to a correct one is dropped
SET @vl0014_sql = IF(@vl0014_tmp > 0,
  IF(@vl0014_old > 0, 'ALTER TABLE users DROP INDEX ux_users_email_norm, RENAME INDEX ux_users_email_bin TO ux_users_email_norm',
    IF(@vl0014_missing = 1, 'ALTER TABLE users RENAME INDEX ux_users_email_bin TO ux_users_email_norm', 'DROP INDEX ux_users_email_bin ON users')),
  'DO 0');
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
-- no index at all (an interrupted 1.4.0 run, after step 2's clean-up): created directly
SET @vl0014_sql = IF(@vl0014_has = 0,
  'CREATE UNIQUE INDEX ux_users_email_norm ON users ((CAST(NULLIF(LOWER(TRIM(email)), '''') AS CHAR(254) CHARACTER SET utf8mb4) COLLATE utf8mb4_bin))',
  'DO 0');
-- ;;
PREPARE vl0014_stmt FROM @vl0014_sql;
-- ;;
EXECUTE vl0014_stmt;
-- ;;
DEALLOCATE PREPARE vl0014_stmt;
-- ;;
-- Step 3: restore-log rows never applied (the account still has no email, or is gone) are worked out again
SET @vl0014_sql = IF(@vl0014_run, 'DELETE r FROM email_restored_0014 r
LEFT JOIN users u ON u.id COLLATE utf8mb4_bin = r.user_id COLLATE utf8mb4_bin
WHERE (u.id IS NULL OR u.email IS NULL)
  AND EXISTS (SELECT 1 FROM email_duplicates_0013 d WHERE CONVERT(d.user_id USING utf8mb4) COLLATE utf8mb4_bin = r.user_id COLLATE utf8mb4_bin)', 'DO 0');
-- ;;
PREPARE vl0014_stmt FROM @vl0014_sql;
-- ;;
EXECUTE vl0014_stmt;
-- ;;
DEALLOCATE PREPARE vl0014_stmt;
-- ;;
-- Step 4: what is safe to give back
SET @vl0014_sql = IF(@vl0014_run, 'INSERT IGNORE INTO email_restored_0014 (user_id, email, restored_at)
SELECT c.user_id, c.email, NOW(3) FROM (
  SELECT u.id AS user_id, LOWER(TRIM(CONVERT(d.email USING utf8mb4))) AS email,
    ROW_NUMBER() OVER (PARTITION BY LOWER(TRIM(CONVERT(d.email USING utf8mb4))) COLLATE utf8mb4_0900_as_cs ORDER BY u.created_at, u.id) AS rn
  FROM email_duplicates_0013 d
  JOIN users u ON u.id COLLATE utf8mb4_bin = CONVERT(d.user_id USING utf8mb4) COLLATE utf8mb4_bin
  WHERE u.email IS NULL AND CHAR_LENGTH(TRIM(d.email)) > 0
    AND NOT (@vl0014_lossy > 0 AND LOCATE(''?'', d.email) > 0)
    AND NOT EXISTS (SELECT 1 FROM users x WHERE x.email IS NOT NULL
      AND (LOWER(TRIM(x.email)) COLLATE utf8mb4_bin = LOWER(TRIM(CONVERT(d.email USING utf8mb4))) COLLATE utf8mb4_bin
        OR LOWER(TRIM(x.email)) COLLATE utf8mb4_0900_as_cs = LOWER(TRIM(CONVERT(d.email USING utf8mb4))) COLLATE utf8mb4_0900_as_cs))
) c WHERE c.rn = 1', 'DO 0');
-- ;;
PREPARE vl0014_stmt FROM @vl0014_sql;
-- ;;
EXECUTE vl0014_stmt;
-- ;;
DEALLOCATE PREPARE vl0014_stmt;
-- ;;
-- the unique index is in place: a clash with an address saved meanwhile is skipped (IGNORE), never duplicated
SET @vl0014_sql = IF(@vl0014_run, 'UPDATE IGNORE users u
JOIN email_restored_0014 r ON r.user_id COLLATE utf8mb4_bin = u.id COLLATE utf8mb4_bin
SET u.email = r.email
WHERE u.email IS NULL
  AND EXISTS (SELECT 1 FROM email_duplicates_0013 d WHERE CONVERT(d.user_id USING utf8mb4) COLLATE utf8mb4_bin = r.user_id COLLATE utf8mb4_bin)', 'DO 0');
-- ;;
PREPARE vl0014_stmt FROM @vl0014_sql;
-- ;;
EXECUTE vl0014_stmt;
-- ;;
DEALLOCATE PREPARE vl0014_stmt;
-- ;;
-- skipped ones are not restores
SET @vl0014_sql = IF(@vl0014_run, 'DELETE r FROM email_restored_0014 r
LEFT JOIN users u ON u.id COLLATE utf8mb4_bin = r.user_id COLLATE utf8mb4_bin
WHERE (u.id IS NULL OR u.email IS NULL)
  AND EXISTS (SELECT 1 FROM email_duplicates_0013 d WHERE CONVERT(d.user_id USING utf8mb4) COLLATE utf8mb4_bin = r.user_id COLLATE utf8mb4_bin)', 'DO 0');
-- ;;
PREPARE vl0014_stmt FROM @vl0014_sql;
-- ;;
EXECUTE vl0014_stmt;
-- ;;
DEALLOCATE PREPARE vl0014_stmt;
-- ;;
-- Step 6: email_duplicates_0013 then lists only addresses that are still cleared
SET @vl0014_sql = IF(@vl0014_run, 'DELETE d FROM email_duplicates_0013 d
JOIN email_restored_0014 r ON r.user_id COLLATE utf8mb4_bin = CONVERT(d.user_id USING utf8mb4) COLLATE utf8mb4_bin
JOIN users u ON u.id COLLATE utf8mb4_bin = r.user_id COLLATE utf8mb4_bin AND u.email IS NOT NULL', 'DO 0');
-- ;;
PREPARE vl0014_stmt FROM @vl0014_sql;
-- ;;
EXECUTE vl0014_stmt;
-- ;;
DEALLOCATE PREPARE vl0014_stmt;
