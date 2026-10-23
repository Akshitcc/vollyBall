-- VolleyLive 0026 (build 1.5.0): Ask VolleyLive knowledge base – how-to guides and admin-edited content.
-- ADDITIVE ONLY and re-run safe: ask_chunks.kind gains two values at the END of its ENUM ('guide' = the how-to guides
-- in src/core/ask/guides.ts, 'custom' = rows of the new ask_content table); existing rows and values are unchanged.
-- ask_content holds help entries written by app admins (ADMIN_UIDS) in the app's own words; editing one re-indexes.
-- ;;
ALTER TABLE ask_chunks MODIFY kind ENUM('faq','rules','guide','custom') NOT NULL
-- ;;
CREATE TABLE IF NOT EXISTS ask_content (
  id          VARCHAR(64)   NOT NULL COMMENT 'admin-chosen slug, [a-z0-9-]',
  lang        CHAR(2)       NOT NULL COMMENT 'en | hi',
  title       VARCHAR(120)  NOT NULL,
  body        TEXT          NOT NULL COMMENT 'max 4000 characters (src/core/ask ASK_CONTENT_TEXT_MAX)',
  url         VARCHAR(500)  NULL COMMENT 'https:// or volleylive:// link; NULL = Help Center',
  updated_by  VARCHAR(128)  NOT NULL COMMENT 'admin uid',
  updated_at  DATETIME(3)   NOT NULL,
  PRIMARY KEY (id, lang)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
