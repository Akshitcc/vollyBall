-- VolleyLive 0028 (build 1.5.3, Tester F152-2): ask_audit.question_sha now holds an HMAC-SHA256 of the question keyed
-- with the server-side ASK_AUDIT_HMAC_KEY, or NULL when that key isn't set (no unsalted hash is stored any more).
-- ADDITIVE / relaxing only: the column becomes NULLable with the same type. Nothing is dropped or shortened, every stored
-- row stays valid, and 1.5.2 servers keep working against it. Re-run safe (MODIFY to the same definition is a no-op).
-- Existing unsalted rows: see docs/DEPLOY.md "Ask audit hashes (1.5.3)" and server/scripts/null-ask-audit-sha.ts.
-- ;;
ALTER TABLE ask_audit MODIFY COLUMN question_sha CHAR(64) NULL COMMENT 'HMAC-SHA256 of the question (ASK_AUDIT_HMAC_KEY), NULL without a key'
