/**
 * Launch prep: sign-in routes for AUTH_MODE=otp (no Bearer token needed to call them).
 *   POST /auth/otp/request  {phone}            → 202 {ttlSeconds, resendAfter}     (OTP_PROVIDER=msg91|dev)
 *   POST /auth/otp/verify   {phone, code}      → 200 {token, uid, expiresAt}
 *   POST /auth/firebase     {idToken}          → 200 {token, uid, expiresAt}       (OTP_PROVIDER=firebase)
 *   POST /auth/logout       Bearer <session>   → 204 (revokes this session)
 * Bodies are tiny; phone numbers and codes are never logged (see ops/logger.ts).
 */
import express, { Router } from 'express';
import { bearer } from '../auth/middleware';
import type { OtpService } from '../auth/otp/otpService';
import { revokeSession, type SessionSigner } from '../auth/otp/sessions';
import type { Db } from '../db/knex';
import { h } from './handler';

export function authRouter(otp: OtpService, db: Db, signer: SessionSigner) {
  const r = Router();
  r.use(express.json({ limit: '4kb' }));
  r.post('/otp/request', h(async (req, res) => {
    res.status(202).json(await otp.request(req.body?.phone, req.ip || 'unknown'));
  }));
  r.post('/otp/verify', h(async (req, res) => {
    res.json(await otp.verify(req.body?.phone, req.body?.code));
  }));
  r.post('/firebase', h(async (req, res) => {
    res.json(await otp.exchange(req.body?.idToken));
  }));
  r.post('/logout', h(async (req, res) => {
    const t = bearer(req);
    if (t) await revokeSession(db, signer, t).catch(() => {});
    res.status(204).end();
  }));
  r.get('/config', (_req, res) => {
    res.json({ provider: otp.provider.name, mode: otp.provider.mode, ttlSeconds: otp.limits.ttlSeconds, resendSeconds: otp.limits.resendSeconds });
  });
  return r;
}
