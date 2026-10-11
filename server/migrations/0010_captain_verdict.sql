-- 1.3.7 (F135-1, additive): keep the opposing captain's verdict separately from the admin review, so
-- an admin's approval can clear the fraud flag without replacing the captain's confirmation.
ALTER TABLE matches
  ADD COLUMN captain_verdict ENUM('confirmed','rejected') NULL COMMENT 'opposing captain: confirmed / rejected; NULL = no answer yet' AFTER dispute_reason;
-- ;;
-- Backfill from the current status (approved / voided rows keep NULL: their history is unknown, so
-- under the safe default an approved-but-never-confirmed match waits for the captain again).
UPDATE matches SET captain_verdict = 'confirmed' WHERE verification_status = 'confirmed' AND captain_verdict IS NULL;
-- ;;
UPDATE matches SET captain_verdict = 'rejected' WHERE verification_status = 'disputed' AND captain_verdict IS NULL;
