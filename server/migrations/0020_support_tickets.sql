-- VolleyLive 0020 (build 1.4.19): Help Center > Contact us – support tickets.
-- ADDITIVE ONLY: one new table; no existing row or column is touched.
-- A user creates tickets and reads only their own; app admins (ADMIN_UIDS) read all and set the status.
-- ;;
CREATE TABLE support_tickets (
  id              VARCHAR(36)   NOT NULL,
  user_id         VARCHAR(128)  NOT NULL COMMENT 'signed-in sender (no FK: kept if the user is removed)',
  topic           VARCHAR(20)   NOT NULL COMMENT 'src/core/support.ts SUPPORT_TOPICS',
  message         VARCHAR(2000) NOT NULL COMMENT 'plain text 10..2000 characters, hidden characters stripped',
  app_version     VARCHAR(40)   NULL,
  status          ENUM('open','replied','closed') NOT NULL DEFAULT 'open',
  screenshot_key  VARCHAR(300)  NULL COMMENT 'storage key (support/<uid>/<id>.<ext>), served by signed URL',
  created_at      DATETIME(3)   NOT NULL,
  updated_at      DATETIME(3)   NOT NULL,
  PRIMARY KEY (id),
  KEY ix_support_user (user_id, created_at),
  KEY ix_support_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
