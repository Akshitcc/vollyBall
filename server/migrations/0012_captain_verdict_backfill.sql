-- 1.3.8 (QA V137-1, additive data fix; 0010 is NOT edited because it may already be applied).
-- 0010 left captain_verdict NULL on matches an admin had already approved (or voided) under 1.3.6,
-- even when the opposing captain had answered first. Under 1.3.7 such a match never counts and the
-- captain can't answer again (verified_by is set). The answer is still in the older columns:
--   verified_by set + no dispute_reason  -> the captain confirmed
--   verified_by set + a dispute_reason   -> the captain rejected
-- Only rows still NULL are touched, so re-running it (or running it after 1.3.7 wrote verdicts) changes
-- nothing. Note: a 1.3.6 rejection sent WITHOUT a reason can't be told apart from a confirmation; it is
-- treated as confirmed (exactly how 1.3.6 counted it after the admin's approval).
UPDATE matches SET captain_verdict = 'confirmed'
  WHERE verification_status IN ('approved', 'voided') AND captain_verdict IS NULL
    AND verified_by IS NOT NULL AND dispute_reason IS NULL;
-- ;;
UPDATE matches SET captain_verdict = 'rejected'
  WHERE verification_status IN ('approved', 'voided') AND captain_verdict IS NULL
    AND verified_by IS NOT NULL AND dispute_reason IS NOT NULL;
