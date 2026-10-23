/**
 * 1.5.1 (Tester F150-2 / F150-7): one plain status per finished result, for the team page and Ask.
 *  - counted:   counts (core/antifraud isEligible)
 *  - awaiting:  really waiting for the other captain to confirm (incl. an admin-cleared flag still waiting for them)
 *  - potm:      the Player of the Match isn't picked yet (waiting for the scorer, not the other captain)
 *  - review:    flagged (e.g. played in under 10 minutes) and the other captain confirmed – waiting for an admin
 *  - reviewAwaiting: 1.5.2 (Tester F151-3) flagged AND the other captain hasn't confirmed yet – waiting for both
 *                (an admin's approve only clears the flag; it still needs the captain – ADMIN_APPROVAL)
 *  - disputed:  the other captain rejected it – never counts (an admin's approve doesn't change that; an admin can void it)
 *  - voided:    an admin voided it – never counts
 * Not finished / abandoned → null.
 */
import { ADMIN_APPROVAL, captainVerdict, isEligible, matchFlags, matchWinner, verificationStatus, type CountableMatch } from './antifraud';

export type ResultStatus = 'counted' | 'awaiting' | 'potm' | 'review' | 'reviewAwaiting' | 'disputed' | 'voided';
export function resultStatus(m0: unknown): ResultStatus | null {
  const m = m0 as CountableMatch & { summary?: { winner?: 'A' | 'B' | null } | null };
  if (m.status !== 'finished') return null;
  const v = verificationStatus(m);
  if (v === 'voided') return 'voided';
  if (isEligible(m)) return 'counted';
  const winner = m.summary?.winner !== undefined ? m.summary?.winner ?? null : matchWinner(m);
  if (!winner) return 'review';
  if (captainVerdict(m) === 'rejected' || v === 'disputed') return 'disputed';
  if (v !== 'approved' && matchFlags(m).length) return captainVerdict(m) === 'confirmed' || ADMIN_APPROVAL.COUNTS_WITHOUT_CAPTAIN ? 'review' : 'reviewAwaiting';
  if (!m.playerOfMatchId) return 'potm';
  return 'awaiting';
}
