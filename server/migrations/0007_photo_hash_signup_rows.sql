-- VolleyLive 0007 (build 1.3.4). ADDITIVE ONLY: two new columns and one new unique key. No existing
-- row or column is changed or removed.
-- 1) Photo de-duplication per match (QA D133-3): sha256 (hex) of the stored bytes. Rows created before
--    this migration keep NULL (MySQL allows any number of NULLs in a unique key), so old photos never
--    block anything; a re-upload of the same image to the same match hits the unique key.
-- ;;
ALTER TABLE match_photos
  ADD COLUMN content_hash CHAR(64) NULL COMMENT 'sha256 hex of the image bytes (1.3.4+)' AFTER size_bytes,
  ADD UNIQUE KEY uq_match_photos_hash (match_id, content_hash);
-- ;;
-- 2) Sign-up rows (1.3.4 hardening c): the first authenticated GET /api/me creates a minimal users row
--    (id + verified E.164 phone) so a sign-up shows in `users` before the profile is saved. Such a row
--    has profile_complete = 0 and a placeholder name; it is not a profile yet (the API reports no
--    profile, phone lookup doesn't find it) until PUT /api/users/:id saves one. Existing rows are
--    complete profiles, hence DEFAULT 1.
ALTER TABLE users
  ADD COLUMN profile_complete TINYINT(1) NOT NULL DEFAULT 1 COMMENT '0 = sign-up row from /me, profile not saved yet' AFTER city;
