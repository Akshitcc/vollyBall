import type { NextFunction, Request, Response } from 'express';
import { unauthorized } from '../errors';
import type { Identity, TokenVerifier } from './verifier';

declare module 'express-serve-static-core' {
  interface Request {
    identity?: Identity;
  }
}

export function bearer(req: Request): string | null {
  const h = req.header('authorization') || '';
  const m = /^Bearer\s+(.+)$/i.exec(h);
  return m ? m[1].trim() : null;
}

/** Every API route requires a verified identity (Firestore rules: `signedIn()`). */
export function requireAuth(verifier: TokenVerifier) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    const token = bearer(req);
    if (!token) return next(unauthorized());
    try {
      req.identity = await verifier.verify(token);
      next();
    } catch {
      next(unauthorized('Invalid or expired sign-in token'));
    }
  };
}

export function me(req: Request): Identity {
  if (!req.identity) throw unauthorized();
  return req.identity;
}
