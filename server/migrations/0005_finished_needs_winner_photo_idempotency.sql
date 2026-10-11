-- VolleyLive 0005 (build 1.2.1). ADDITIVE ONLY: one new nullable column + unique key, and the
-- ranking view redefined. No row or column is changed or removed.
-- 1) QA NB-R2: a match counts towards rankings only when it is finished WITH a winner (the summary
--    cache, rebuilt from the event log on every write, has winner 'A' or 'B'). A match whose
--    status was set to 'finished' without a winner (possible before 1.2.1) no longer counts, and
--    "won" is taken from that winner.
-- ;;
CREATE OR REPLACE VIEW player_finished_matches AS
SELECT
  mp.match_id,
  mp.user_id,
  mp.side,
  CASE WHEN JSON_UNQUOTE(JSON_EXTRACT(m.summary, '$.winner')) = mp.side THEN 1 ELSE 0 END AS won,
  (SELECT COUNT(*) FROM points p WHERE p.match_id = mp.match_id AND p.player_key = mp.player_key) AS credited_points,
  CASE WHEN m.player_of_match_id = mp.player_key THEN 1 ELSE 0 END AS potm
FROM match_players mp
JOIN matches m ON m.id = mp.match_id
WHERE m.status = 'finished'
  AND JSON_UNQUOTE(JSON_EXTRACT(m.summary, '$.winner')) IN ('A', 'B')
  AND mp.user_id IS NOT NULL;
-- ;;
-- 2) QA NB-P2: retry dedupe. The app sends an Idempotency-Key per queued photo; a retry with the
--    same key (same uploader) returns the photo already stored instead of adding a duplicate.
ALTER TABLE match_photos
  ADD COLUMN idempotency_key VARCHAR(64) NULL COMMENT 'client key per queued photo (retry dedupe)' AFTER size_bytes,
  ADD UNIQUE KEY ux_match_photos_idem (uploaded_by, idempotency_key);
