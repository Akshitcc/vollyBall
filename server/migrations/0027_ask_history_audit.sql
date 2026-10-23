-- VolleyLive 0027 (build 1.5.0): Ask VolleyLive chat history (per user) and the assistant audit log.
-- ADDITIVE ONLY and re-run safe (IF NOT EXISTS): two new tables, nothing existing is touched.
-- ask_history: a user's own chat turns (only that user can read or clear them; the server keeps the newest 100).
-- ask_audit: one row per chat turn for operators – user, SHA-256 of the question plus a PII-masked copy, the tools
-- called with their validated arguments, provider, steps, latency and outcome. NEVER keys, tokens or answers.
-- ;;
CREATE TABLE IF NOT EXISTS ask_history (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id     VARCHAR(128)  NOT NULL,
  lang        CHAR(2)       NOT NULL,
  question    VARCHAR(2000) NOT NULL,
  payload     MEDIUMTEXT    NOT NULL COMMENT 'JSON: answer, sources, idk, cards, outcome, refusal',
  created_at  DATETIME(3)   NOT NULL,
  PRIMARY KEY (id),
  KEY ix_ask_history_user (user_id, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
-- ;;
CREATE TABLE IF NOT EXISTS ask_audit (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id       VARCHAR(128)  NOT NULL,
  question_sha  CHAR(64)      NOT NULL COMMENT 'sha256 of the question as asked',
  question      VARCHAR(600)  NOT NULL COMMENT 'PII-masked (phones / e-mails hidden), max 500 characters',
  lang          CHAR(2)       NOT NULL,
  provider      VARCHAR(20)   NOT NULL,
  tools         TEXT          NOT NULL COMMENT 'JSON [{name,args,ok,ms,error?}] – validated args only',
  steps         TINYINT UNSIGNED NOT NULL,
  latency_ms    INT UNSIGNED  NOT NULL,
  outcome       VARCHAR(16)   NOT NULL COMMENT 'answer | idk | refused | limited | error | rate_limited',
  refusal       VARCHAR(16)   NULL COMMENT 'private | write | injection',
  injection     TINYINT(1)    NOT NULL DEFAULT 0 COMMENT 'instruction-like text seen in the question, content or tool data',
  created_at    DATETIME(3)   NOT NULL,
  PRIMARY KEY (id),
  KEY ix_ask_audit_user (user_id, created_at),
  KEY ix_ask_audit_time (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
