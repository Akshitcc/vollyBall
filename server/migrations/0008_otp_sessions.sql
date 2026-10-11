-- VolleyLive 0008 (launch prep). ADDITIVE ONLY: two new tables. No existing table, column or row changes.
-- 1) Server-side SMS OTP (AUTH_MODE=otp, OTP_PROVIDER=msg91|dev). Nothing readable is stored: the phone
--    number and the code are HMAC-SHA256 hashes keyed with a server secret (SESSION_SECRET), so a copy
--    of this table can't be used to read numbers or brute-force codes offline. Rows are short-lived;
--    the server deletes rows older than a day as it goes.
-- ;;
CREATE TABLE IF NOT EXISTS otp_challenges (
  id CHAR(32) NOT NULL PRIMARY KEY,
  phone_hash CHAR(64) NOT NULL,
  code_hash CHAR(64) NOT NULL,
  expires_at DATETIME(3) NOT NULL,
  attempts INT NOT NULL DEFAULT 0,
  consumed_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL,
  KEY idx_otp_phone_created (phone_hash, created_at),
  KEY idx_otp_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
-- ;;
-- 2) Sessions issued after a verified OTP (or a verified Firebase ID token exchange). The token itself
--    is signed and never stored; this row lets sign-out (and an operator) revoke it before it expires.
CREATE TABLE IF NOT EXISTS auth_sessions (
  id CHAR(32) NOT NULL PRIMARY KEY,
  user_id VARCHAR(128) NOT NULL,
  created_at DATETIME(3) NOT NULL,
  expires_at DATETIME(3) NOT NULL,
  revoked_at DATETIME(3) NULL,
  KEY idx_sessions_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
