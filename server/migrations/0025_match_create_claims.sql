-- 1.4.27 (QA V1426-1 / V1426-5): match create Idempotency-Key claims. The claim row is the FIRST write of the create
-- transaction, so concurrent retries with one key queue on its primary key until the first commits (then they all
-- answer with that match) or rolls back (then the next one creates it) – the key is decided before the fixture lock.
-- body_hash: SHA-256 of the canonical request body; the same key with another body is refused (422 idempotency_mismatch).
-- No foreign key (the match does not exist yet when the claim is written). Additive and re-runnable.
CREATE TABLE IF NOT EXISTS match_create_claims (
  user_id    VARCHAR(128) NOT NULL COMMENT 'creator (the key is per user)',
  idem_key   VARCHAR(64)  NOT NULL COMMENT 'Idempotency-Key header',
  body_hash  CHAR(64)     NOT NULL COMMENT 'sha256 of the canonical create body (1.4.27)',
  created_at DATETIME(3)  NOT NULL,
  PRIMARY KEY (user_id, idem_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
