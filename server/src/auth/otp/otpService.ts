/**
 * Launch prep: server-side OTP – request, verify, limits. All checks that must hold across several API
 * instances use the database (not process memory):
 *  - a code expires after OTP_TTL_SECONDS (default 300) and works once;
 *  - at most OTP_MAX_ATTEMPTS wrong guesses per code (default 5), counted with an atomic UPDATE;
 *  - per phone: one code per OTP_RESEND_SECONDS (default 30) and OTP_MAX_PER_HOUR (default 5) per hour;
 *  - per IP: OTP_IP_PER_HOUR requests (default 20) through the rate limiter (shared when REDIS_URL is set);
 *  - phone numbers and codes are stored only as keyed HMAC hashes.
 */
import crypto from 'node:crypto';
import type { Db } from '../../db/knex';
import { HttpError } from '../../errors';
import { log } from '../../ops/logger';
import type { RateLimiter } from '../../rateLimit';
import { isValidE164, INVALID_PHONE_CODE, INVALID_PHONE_MESSAGE } from '../../../../src/core/phone';
import { OtpSendError, type OtpProvider } from './providers';
import { createSession, deriveKey, hmacHex, type SessionSigner } from './sessions';

export interface OtpLimits {
  ttlSeconds: number;
  maxAttempts: number;
  resendSeconds: number;
  maxPerHour: number;
  ipPerHour: number;
}
export const DEFAULT_OTP_LIMITS: OtpLimits = Object.freeze({ ttlSeconds: 300, maxAttempts: 5, resendSeconds: 30, maxPerHour: 5, ipPerHour: 20 });

export const OTP_ERRORS = {
  invalid_phone: INVALID_PHONE_MESSAGE,
  otp_resend_wait: 'Wait a little before asking for a new code',
  otp_too_many: 'Too many codes asked for this number. Try again later.',
  otp_expired: 'This code has expired. Ask for a new one.',
  otp_invalid: 'Wrong code',
  otp_too_many_attempts: 'Too many wrong codes. Ask for a new one.',
  otp_send_failed: 'The SMS could not be sent. Try again in a minute.',
  otp_use_device: 'Sign-in codes are sent by Firebase on this server',
  rate_limited: 'Too many requests. Wait a moment and try again.',
} as const;

const err = (status: number, code: keyof typeof OTP_ERRORS, extra?: Record<string, string | number | undefined>) => new HttpError(status, code, OTP_ERRORS[code], extra);

export class OtpService {
  private readonly otpKey: Buffer;
  private readonly phoneKey: Buffer;
  private readonly uidKey: Buffer;
  constructor(
    private readonly db: Db,
    readonly provider: OtpProvider,
    private readonly signer: SessionSigner,
    secret: string,
    private readonly limiter: RateLimiter,
    readonly limits: OtpLimits = DEFAULT_OTP_LIMITS,
    private readonly now: () => number = Date.now,
  ) {
    this.otpKey = deriveKey(secret, 'otp');
    this.phoneKey = deriveKey(secret, 'phone');
    this.uidKey = deriveKey(secret, 'uid');
  }

  phoneHash(phone: string) {
    return hmacHex(this.phoneKey, phone);
  }
  private codeHash(id: string, code: string) {
    return hmacHex(this.otpKey, `${id}:${code}`);
  }

  private checkPhone(phone: unknown): string {
    if (!isValidE164(phone)) throw new HttpError(400, INVALID_PHONE_CODE, INVALID_PHONE_MESSAGE);
    return phone;
  }

  async request(phoneIn: unknown, ip: string): Promise<{ ttlSeconds: number; resendAfter: number }> {
    if (this.provider.mode !== 'server') throw err(409, 'otp_use_device');
    const phone = this.checkPhone(phoneIn);
    const ipWait = await this.limiter.takeShared(crypto.createHash('sha256').update(ip).digest('hex').slice(0, 32), 'otpIp', { burst: this.limits.ipPerHour, perMinute: this.limits.ipPerHour / 60 });
    if (ipWait) throw err(429, 'rate_limited', { retryAfter: ipWait });
    const ph = this.phoneHash(phone);
    const t = this.now();
    // housekeeping: drop day-old rows (cheap, indexed)
    await this.db('otp_challenges').where('created_at', '<', new Date(t - 24 * 3600_000)).del();
    const recent: { created_at: Date }[] = await this.db('otp_challenges').where({ phone_hash: ph }).andWhere('created_at', '>=', new Date(t - 3600_000)).orderBy('created_at', 'desc').select('created_at');
    if (recent.length) {
      const since = (t - new Date(recent[0].created_at).getTime()) / 1000;
      if (since < this.limits.resendSeconds) throw err(429, 'otp_resend_wait', { retryAfter: Math.ceil(this.limits.resendSeconds - since) });
    }
    if (recent.length >= this.limits.maxPerHour) {
      const oldest = new Date(recent[recent.length - 1].created_at).getTime();
      throw err(429, 'otp_too_many', { retryAfter: Math.max(1, Math.ceil((oldest + 3600_000 - t) / 1000)) });
    }
    const id = crypto.randomBytes(16).toString('hex');
    const code = this.provider.fixedCode?.() ?? String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
    // older open codes for this number stop working when a new one is sent
    await this.db('otp_challenges').where({ phone_hash: ph }).whereNull('consumed_at').update({ consumed_at: new Date(t) });
    await this.db('otp_challenges').insert({ id, phone_hash: ph, code_hash: this.codeHash(id, code), expires_at: new Date(t + this.limits.ttlSeconds * 1000), attempts: 0, created_at: new Date(t) });
    try {
      await this.provider.send!(phone, code, this.limits.ttlSeconds);
    } catch (e) {
      await this.db('otp_challenges').where({ id }).del(); // not sent: doesn't count against the user
      log.warn('otp send failed', { provider: this.provider.name, status: e instanceof OtpSendError ? e.status : undefined });
      throw err(502, 'otp_send_failed');
    }
    return { ttlSeconds: this.limits.ttlSeconds, resendAfter: this.limits.resendSeconds };
  }

  /** Existing account with this number, else a stable id derived from it (same id on every sign-in). */
  async uidFor(phone: string): Promise<string> {
    const r = await this.db('users').where({ phone }).first('id');
    return r?.id ?? `u_${hmacHex(this.uidKey, phone).slice(0, 24)}`;
  }

  async verify(phoneIn: unknown, codeIn: unknown) {
    if (this.provider.mode !== 'server') throw err(409, 'otp_use_device');
    const phone = this.checkPhone(phoneIn);
    const code = typeof codeIn === 'string' ? codeIn.trim() : '';
    const t = new Date(this.now());
    const ch = await this.db('otp_challenges').where({ phone_hash: this.phoneHash(phone) }).whereNull('consumed_at').andWhere('expires_at', '>', t).orderBy('created_at', 'desc').first('id', 'code_hash', 'attempts');
    if (!ch) throw err(400, 'otp_expired');
    // count the attempt first (atomic): parallel guesses can't exceed the limit
    const n = await this.db('otp_challenges').where({ id: ch.id }).whereNull('consumed_at').andWhere('attempts', '<', this.limits.maxAttempts).increment('attempts', 1);
    if (!n) throw err(429, 'otp_too_many_attempts');
    const ok = /^\d{6}$/.test(code) && crypto.timingSafeEqual(Buffer.from(this.codeHash(ch.id, code)), Buffer.from(ch.code_hash));
    if (!ok) {
      const left = this.limits.maxAttempts - (ch.attempts + 1);
      throw err(400, left > 0 ? 'otp_invalid' : 'otp_too_many_attempts', { attemptsLeft: Math.max(0, left) });
    }
    const used = await this.db('otp_challenges').where({ id: ch.id }).whereNull('consumed_at').update({ consumed_at: t });
    if (!used) throw err(400, 'otp_expired'); // used by a parallel request
    return createSession(this.db, this.signer, await this.uidFor(phone), phone);
  }

  /** Device mode (Firebase Phone Auth): a verified ID token becomes an API session. */
  async exchange(idToken: unknown) {
    if (!this.provider.verifyIdToken) throw new HttpError(409, 'otp_use_server', 'This server sends its own codes');
    if (typeof idToken !== 'string' || !idToken) throw new HttpError(401, 'unauthenticated', 'Invalid or expired sign-in token');
    let id: { uid: string; phone: string | null };
    try {
      id = await this.provider.verifyIdToken(idToken);
    } catch {
      throw new HttpError(401, 'unauthenticated', 'Invalid or expired sign-in token');
    }
    return createSession(this.db, this.signer, id.uid, id.phone);
  }
}
