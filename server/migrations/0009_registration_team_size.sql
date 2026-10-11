-- 1.3.6 (additive): registration fields on users, team size mode on matches.
-- All columns are NULL-able so existing rows stay valid; the app asks existing users to complete them.
ALTER TABLE users
  ADD COLUMN first_name VARCHAR(40)  NULL AFTER name,
  ADD COLUMN last_name  VARCHAR(40)  NULL AFTER first_name,
  ADD COLUMN dob        DATE         NULL AFTER last_name,
  ADD COLUMN email      VARCHAR(254) NULL AFTER dob,
  ADD COLUMN pincode    CHAR(6)      NULL AFTER email,
  ADD COLUMN district   VARCHAR(60)  NULL AFTER pincode,
  ADD COLUMN state      VARCHAR(60)  NULL AFTER district;
-- ;;
ALTER TABLE matches
  ADD COLUMN team_size_mode VARCHAR(8) NULL COMMENT '1.3.6: exact (6 per side) | custom (6-12); NULL = before 1.3.6 (custom)';
