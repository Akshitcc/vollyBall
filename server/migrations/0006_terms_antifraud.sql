-- VolleyLive 0006 (build 1.3.0): T&C acceptance + anti-fraud. ADDITIVE ONLY: one new table and new
-- nullable/defaulted columns on matches. No existing row or column is changed or removed.
-- No money, no ID numbers: points stay in-app and are DERIVED (src/core/antifraud.ts); nothing here
-- stores points, a bonus or a wallet balance.
-- 1) T&C acceptance, one row per uid (written only by POST /api/me/terms/accept with the server's
--    time). No FK to users: the T&C is accepted BEFORE the profile is created.
-- ;;
CREATE TABLE terms_acceptances (
  user_id      VARCHAR(128) NOT NULL,
  version      VARCHAR(40)  NOT NULL COMMENT 'src/core/terms.ts TERMS_VERSION at acceptance',
  accepted_at  DATETIME(3)  NOT NULL COMMENT 'server time',
  PRIMARY KEY (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
-- ;;
-- 2) Matches: captains (fixed at creation), server start time, result verification.
--    Existing matches get verification_status 'pending' and no captains / server start time, so they
--    stop counting until an admin approves them (they are flagged 'no_server_times').
ALTER TABLE matches
  ADD COLUMN captain_a VARCHAR(128) NULL COMMENT 'captain of side A at creation' AFTER player_of_match_id,
  ADD COLUMN captain_b VARCHAR(128) NULL COMMENT 'captain of side B at creation' AFTER captain_a,
  ADD COLUMN started_server_at DATETIME(3) NULL COMMENT 'server time when the match went live' AFTER captain_b,
  ADD COLUMN verification_status ENUM('pending','confirmed','disputed','approved','voided') NOT NULL DEFAULT 'pending' AFTER started_server_at,
  ADD COLUMN verified_by VARCHAR(128) NULL COMMENT 'opposing captain who confirmed/rejected' AFTER verification_status,
  ADD COLUMN verified_at DATETIME(3) NULL AFTER verified_by,
  ADD COLUMN dispute_reason VARCHAR(200) NULL AFTER verified_at,
  ADD COLUMN reviewed_by VARCHAR(128) NULL COMMENT 'admin (ADMIN_UIDS) who approved/voided' AFTER dispute_reason,
  ADD COLUMN reviewed_at DATETIME(3) NULL AFTER reviewed_by,
  ADD KEY ix_matches_verification (verification_status, finished_at);
