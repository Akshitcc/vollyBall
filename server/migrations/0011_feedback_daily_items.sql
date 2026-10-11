-- VolleyLive 0011 (build 1.3.7): Profile > Send feedback and the Home "Fact of the day" card.
-- ADDITIVE ONLY: two new tables; no existing row or column is touched.
-- Feedback is never rewarded (no points / badges): it is only stored for admins to read.
-- ;;
CREATE TABLE feedback (
  id           VARCHAR(36)  NOT NULL,
  user_id      VARCHAR(128) NOT NULL COMMENT 'signed-in sender (no FK: kept if the user is removed)',
  stars        TINYINT UNSIGNED NOT NULL COMMENT '1..5',
  text         VARCHAR(1000) NOT NULL DEFAULT '' COMMENT 'plain text, control characters stripped',
  app_version  VARCHAR(40)  NULL,
  created_at   DATETIME(3)  NOT NULL,
  PRIMARY KEY (id),
  KEY ix_feedback_created (created_at),
  KEY ix_feedback_user (user_id, created_at),
  CONSTRAINT ck_feedback_stars CHECK (stars BETWEEN 1 AND 5)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
-- ;;
CREATE TABLE daily_items (
  id           VARCHAR(36)  NOT NULL,
  type         ENUM('fact','quote') NOT NULL,
  text_en      VARCHAR(400) NOT NULL,
  text_hi      VARCHAR(400) NOT NULL,
  attribution  VARCHAR(120) NULL COMMENT 'quotes: the verified author; facts: the source label',
  source_url   VARCHAR(500) NULL COMMENT 'https link that verifies the quote / fact',
  active       TINYINT(1)   NOT NULL DEFAULT 1,
  created_by   VARCHAR(128) NOT NULL COMMENT 'admin uid (ADMIN_UIDS)',
  created_at   DATETIME(3)  NOT NULL,
  updated_at   DATETIME(3)  NOT NULL,
  PRIMARY KEY (id),
  KEY ix_daily_items_active (active, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
