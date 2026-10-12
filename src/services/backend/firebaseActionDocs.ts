/**
 * 1.4.6 (QA V145, one lifecycle): the Firestore WRITE PAYLOADS of the match actions, as pure functions. The Firebase
 * backend and rules-tests ("1.4.6 lifecycle walk") build their writes with these, so the rules are tested against the
 * exact documents the app sends. `fx.stamp` is the server-time sentinel (serverTimestamp(): request.time in the rules),
 * `fx.del` the field-delete sentinel (deleteField()); `now` is Date.now() (updatedAt / device-side times).
 *
 * The allowed-ness comes from core (planAbandon / resolvePatch / reportAbandon / confirmProblem / reassignProblem,
 * all built on core/lifecycle.ts); these only turn the core patch into the Firestore shape the rules check.
 */
import type { AbandonPlan } from '../../core/abandon';
import type { Match } from '../../core/types';

export interface FxSentinels {
  stamp: unknown;
  del: unknown;
}
type Raw = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
type Out = Record<string, unknown>;

/** Drops undefined values (Firestore refuses them). */
const clean = (o: Out): Out => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));

/** The scorer's abandon (direct / record) or consent request – V145-12: the request counter and its server time. */
export function abandonDoc(plan: AbandonPlan, raw: Raw, fx: FxSentinels, now: number): Out {
  if (plan.kind === 'request') {
    return { abandonRequest: { ...plan.request, at: fx.stamp }, abandonRequests: (raw.abandonRequests ?? 0) + 1, abandonRequestAt: fx.stamp, updatedAt: now };
  }
  return clean({ status: 'abandoned', finishedAt: now, ...(plan.kind === 'flag' ? { abandon: { ...plan.record, at: fx.stamp } } : {}), updatedAt: now });
}

/** An admin's resolution (core resolvePatch → Firestore). */
export function resolveDoc(raw: Raw, m: Match, patch: Partial<Match>, me: string, fx: FxSentinels, now: number): Out {
  const out: Out = { updatedAt: now };
  if (patch.status) {
    out.status = patch.status;
    out.finishedAt = patch.status === 'live' ? null : now;
    // (only when it changes: an abandoned doc has none, and the rules' reinstate key list doesn't include it – 1.4.5
    // wrote null here, so a Firebase reinstate to live was refused; found by the 1.4.6 walk)
    if (patch.status === 'finished') out.finishedServerAt = fx.stamp;
    else if (raw.finishedServerAt != null) out.finishedServerAt = null;
  }
  if (patch.playerOfMatchId === null && raw.playerOfMatchId != null) out.playerOfMatchId = null;
  if (patch.wasWon === false && raw.wasWon != null) out.wasWon = false;
  // V145-10: reinstated to finished latches wasWon
  if (patch.wasWon === true) out.wasWon = true;
  // V145-2: a re-open clears the verdict / review (the field is removed) and starts a new epoch
  if (patch.verification === null && raw.verification !== undefined) out.verification = fx.del;
  if (patch.reopenEpoch !== undefined) out.reopenEpoch = patch.reopenEpoch;
  if (patch.abandon) {
    // a review keeps the stored record (and its server time) and adds who reviewed it, at request.time
    out.abandon =
      patch.abandon.mode === 'admin'
        ? { ...patch.abandon, at: fx.stamp, reviewedAt: fx.stamp }
        : raw.abandon
          ? { ...raw.abandon, review: patch.abandon.review, reviewedBy: me, reviewedAt: fx.stamp }
          : { mode: 'legacy', events: m.events.length, review: patch.abandon.review, reviewedBy: me, reviewedAt: fx.stamp };
  }
  // V145-5: the stored record moves to the history exactly as stored (the rules compare old.concat([old abandon]))
  if (patch.abandonHistory && raw.abandon) out.abandonHistory = [...(raw.abandonHistory ?? []), raw.abandon];
  if (patch.resolution) out.resolution = { ...patch.resolution, at: fx.stamp };
  if (patch.abandonRequest === null) out.abandonRequest = null;
  return out;
}

/** The opposing captain's report (V145-11: needs the stored record – core reportAbandon refuses without one). */
export function reportDoc(raw: Raw, me: string, fx: FxSentinels, now: number): Out {
  return { abandon: { ...raw.abandon, review: 'pending', reportedBy: me, reportedAt: fx.stamp }, updatedAt: now };
}

/** Epoch field for a verdict / review: written only after a re-open (epoch 0 docs look exactly like 1.4.5's). */
const epochOf = (raw: Raw) => ((raw.reopenEpoch ?? 0) > 0 ? { epoch: raw.reopenEpoch } : {});

/** The verdict captain confirms / rejects (1.3.7: after an admin's approval the status stays 'approved'). */
export function verifyDoc(raw: Raw, me: string, status: 'confirmed' | 'disputed', reason: string | undefined, fx: FxSentinels, now: number): Out {
  const old = (raw.verification ?? {}) as Raw;
  const captain = status === 'confirmed' ? 'confirmed' : 'rejected';
  const fromApproved = old.status === 'approved' && (old.epoch ?? 0) === (raw.reopenEpoch ?? 0);
  return {
    verification: fromApproved
      ? clean({ status: 'approved', captain, by: me, at: fx.stamp, reason: reason || undefined, reviewedBy: old.reviewedBy, reviewedAt: old.reviewedAt, ...epochOf(raw) })
      : clean({ status, captain, by: me, at: fx.stamp, reason: reason || undefined, ...epochOf(raw) }),
    updatedAt: now,
  };
}

/** An admin's approve / void; the captain's answer fields are kept, the verdict written explicitly. */
export function reviewDoc(raw: Raw, me: string, decision: 'approve' | 'void', captain: string | null, fx: FxSentinels, now: number): Out {
  const old = (raw.verification ?? {}) as Raw;
  return {
    verification: clean({ by: old.by, at: old.at, reason: old.reason, captain: captain ?? undefined, status: decision === 'approve' ? 'approved' : 'voided', reviewedBy: me, reviewedAt: fx.stamp, ...epochOf(raw) }),
    updatedAt: now,
  };
}

/** 1.4.8 (QA V147-2): an admin's verdict repair (core repairPatch → Firestore; the record's time is the server's). */
export function repairDoc(patch: Partial<Match>, fx: FxSentinels, now: number): Out {
  const out: Out = { verdictRepair: { ...patch.verdictRepair, at: fx.stamp }, updatedAt: now };
  if (patch.scorerId !== undefined) {
    out.scorerId = patch.scorerId;
    out.scorerReassign = fx.del;
  }
  if (patch.captains) out.captains = patch.captains;
  return out;
}

/** An admin moves scoring (recorded after the first rally). */
export function reassignDoc(scorerId: string, rec: { from: string; to: string; by: string; at: number } | null, fx: FxSentinels, now: number): Out {
  return { scorerId, ...(rec ? { scorerReassign: { ...rec, at: fx.stamp } } : {}), updatedAt: now };
}
