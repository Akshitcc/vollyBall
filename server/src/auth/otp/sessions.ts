/**
 * Launch prep: the API's own sign-in sessions (AUTH_MODE=otp). Token = `vls1.<payload>.<sig>`, where
 * payload is base64url JSON {sid, uid, phone, iat, exp} and sig an HMAC-SHA256 with a key derived from
 * SESSION_SECRET. Every request also checks the auth_sessions row, so sign-out revokes immediately.
 */
import crypto from 'node:crypto';
import type { Db } from '../../db/knex';
import { InvalidTokenError, type Identity, type TokenVerifier } from '../verifier';

export const SESSION_PREFIX = 'vls1.';

/** Sub-keys of SESSION_SECRET, one per purpose. */
export function deriveKey(secret: string, purpose: 'session' | 'otp' | 'phone' | 'uid') {
  return crypto.createHmac('sha256', secret).update(`volleylive:${purpose}`).digest();
}

export const hmacHex = (key: Buffer, data: string) => crypto.createHmac('sha256', key).update(data).digest('hex');

export interface SessionPayload {
  sid: string;
  uid: string;
  phone: string | null;
  iat: number;
  exp: number;
}

export class SessionSigner {
  private readonly key: Buffer;
  constructor(
    secret: string,
    readonly ttlSeconds = 30 * 24 * 3600,
    private readonly now: () => number = Date.now,
  ) {
    if (secret.length < 32) throw new Error('SESSION_SECRET must be at least 32 characters');
    this.key = deriveKey(secret, 'session');
  }
  sign(p: Omit<SessionPayload, 'iat' | 'exp'>): { token: string; payload: SessionPayload } {
    const iat = Math.floor(this.now() / 1000);
    const payload: SessionPayload = { ...p, iat, exp: iat + this.ttlSeconds };
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    return { token: `${SESSION_PREFIX}${body}.${crypto.createHmac('sha256', this.key).update(body).digest('base64url')}`, payload };
  }
  /** Signature and expiry only (the DB check is SessionTokenVerifier's). */
  check(token: string): SessionPayload {
    if (!token.startsWith(SESSION_PREFIX)) throw new InvalidTokenError('Not a session token');
    const [body, sig] = token.slice(SESSION_PREFIX.length).split('.');
    if (!body || !sig) throw new InvalidTokenError('Malformed session token');
    const want = Buffer.from(crypto.createHmac('sha256', this.key).update(body).digest('base64url'));
    const got = Buffer.from(sig);
    if (want.length !== got.length || !crypto.timingSafeEqual(want, got)) throw new InvalidTokenError('Bad session signature');
    let p: SessionPayload;
    try {
      p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    } catch {
      throw new InvalidTokenError('Malformed session token');
    }
    if (typeof p.exp !== 'number' || p.exp < Math.floor(this.now() / 1000)) throw new InvalidTokenError('Session expired');
    return p;
  }
}

export async function createSession(db: Db, signer: SessionSigner, uid: string, phone: string | null) {
  const sid = crypto.randomBytes(16).toString('hex');
  const { token, payload } = signer.sign({ sid, uid, phone });
  await db('auth_sessions').insert({ id: sid, user_id: uid, created_at: new Date(payload.iat * 1000), expires_at: new Date(payload.exp * 1000) });
  return { token, uid, expiresAt: payload.exp * 1000 };
}

export async function revokeSession(db: Db, signer: SessionSigner, token: string) {
  const p = signer.check(token);
  await db('auth_sessions').where({ id: p.sid }).whereNull('revoked_at').update({ revoked_at: new Date() });
}

export class SessionTokenVerifier implements TokenVerifier {
  constructor(
    private readonly db: Db,
    private readonly signer: SessionSigner,
  ) {}
  async verify(token: string): Promise<Identity> {
    const p = this.signer.check(token);
    const row = await this.db('auth_sessions').where({ id: p.sid }).first('user_id', 'revoked_at');
    if (!row || row.revoked_at || row.user_id !== p.uid) throw new InvalidTokenError('Session revoked');
    return { uid: p.uid, phone: p.phone };
  }
}

/** Tries each verifier in turn (session tokens first, then e.g. Firebase ID tokens). */
export class CompositeVerifier implements TokenVerifier {
  constructor(private readonly verifiers: TokenVerifier[]) {}
  async verify(token: string): Promise<Identity> {
    const first = token.startsWith(SESSION_PREFIX) ? this.verifiers.slice(0, 1) : this.verifiers.slice(1);
    for (const v of first) {
      try {
        return await v.verify(token);
      } catch {
        // next
      }
    }
    throw new InvalidTokenError('Invalid or expired sign-in token');
  }
}
