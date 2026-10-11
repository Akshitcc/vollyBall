-- TEST FIXTURE ONLY (1.3.9, V138-1): migration 0013 exactly as shipped in the 1.3.8 demo build, used to
-- reproduce its half-applied state on a non-0900_ai_ci database. Never run by the migration runner.
-- 1.3.8 (QA V137-8, additive): one account per email address, enforced by the database too (the app
-- check in domain/users.ts could race: two saves at once could both pass it).
-- Normalised = trimmed and lower-cased; an empty string counts as no email (NULL is never unique-checked).
--
-- Existing duplicates are handled WITHOUT deleting anyone: the oldest account keeps the address; on the
-- others the email is cleared (it is optional) and recorded in email_duplicates_0013 for support to
-- follow up. Nothing else on those accounts changes.
CREATE TABLE IF NOT EXISTS email_duplicates_0013 (
  user_id      VARCHAR(128) NOT NULL PRIMARY KEY,
  email        VARCHAR(254) NOT NULL COMMENT 'the address that was cleared on this account',
  kept_user_id VARCHAR(128) NOT NULL COMMENT 'the (oldest) account that keeps it',
  noted_at     DATETIME(3)  NOT NULL
) ENGINE=InnoDB;
-- ;;
INSERT IGNORE INTO email_duplicates_0013 (user_id, email, kept_user_id, noted_at)
SELECT d.id, d.email, d.kept, NOW(3) FROM (
  SELECT id, email,
    ROW_NUMBER() OVER (PARTITION BY LOWER(TRIM(email)) ORDER BY created_at, id) AS rn,
    FIRST_VALUE(id) OVER (PARTITION BY LOWER(TRIM(email)) ORDER BY created_at, id) AS kept
  FROM users
  WHERE email IS NOT NULL AND TRIM(email) <> ''
) d
WHERE d.rn > 1;
-- ;;
UPDATE users SET email = NULL WHERE id IN (SELECT user_id FROM email_duplicates_0013) AND email IS NOT NULL;
-- ;;
CREATE UNIQUE INDEX ux_users_email_norm ON users ((NULLIF(LOWER(TRIM(email)), '')));
