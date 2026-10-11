/**
 * T&C acceptance on the API server (1.3.0, src/core/terms.ts). Stored in terms_acceptances (0006),
 * written ONLY by acceptTerms(): exactly the current version, the server's time, the caller's own
 * uid, idempotent, never deleted. requireTerms() refuses every write until it is accepted.
 */
import type { NextFunction, Request, Response } from 'express';
import { TERMS_NOT_ACCEPTED, TERMS_NOT_ACCEPTED_MESSAGE, TERMS_VERSION, TERMS_VERSION_MISMATCH, type TermsAcceptance } from '../../../src/core/terms';
import type { Services } from '../context';
import type { Identity } from '../auth/verifier';
import { HttpError } from '../errors';
import { nowDate, toMs, type Trx } from './util';

export async function getTerms(db: Trx, uid: string): Promise<TermsAcceptance | null> {
  const r = await db('terms_acceptances').where({ user_id: uid }).first('version', 'accepted_at');
  return r ? { version: r.version, acceptedAt: toMs(r.accepted_at)! } : null;
}

export async function hasAcceptedTerms(db: Trx, uid: string): Promise<boolean> {
  return (await getTerms(db, uid))?.version === TERMS_VERSION;
}

/** Accept the current T&C. Replays return the first acceptance unchanged. */
export async function acceptTerms(s: Services, viewer: Identity, version: string): Promise<TermsAcceptance> {
  if (version !== TERMS_VERSION)
    throw new HttpError(400, TERMS_VERSION_MISMATCH, `Only the current Terms & Conditions version (${TERMS_VERSION}) can be accepted`, { currentVersion: TERMS_VERSION });
  const now = nowDate();
  // One statement (safe under parallel replays): insert, or move an OLDER version forward; the same
  // version keeps its first timestamp.
  await s.db.raw(
    `INSERT INTO terms_acceptances (user_id, version, accepted_at) VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE accepted_at = IF(version = VALUES(version), accepted_at, VALUES(accepted_at)), version = VALUES(version)`,
    [viewer.uid, TERMS_VERSION, now],
  );
  return (await getTerms(s.db, viewer.uid))!;
}

/** Writes that stay open before acceptance: the accept call itself and removing a push token at sign-out. */
const OPEN = [/^\/me\/terms\/accept$/, /^\/me\/push-tokens\/[^/]+$/];

/** 403 terms_not_accepted for every non-GET route until the current version is accepted. */
export function requireTerms(s: Services) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
      if (OPEN.some((re) => re.test(req.path))) return next();
      const uid = req.identity?.uid;
      if (!uid || !(await hasAcceptedTerms(s.db, uid)))
        return next(new HttpError(403, TERMS_NOT_ACCEPTED, TERMS_NOT_ACCEPTED_MESSAGE, { currentVersion: TERMS_VERSION }));
      next();
    } catch (e) {
      next(e);
    }
  };
}
