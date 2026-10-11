/**
 * Server configuration from environment variables (see .env.example).
 * Nothing secret has a default; dev-only conveniences refuse to run in production.
 */
import crypto from 'node:crypto';
import path from 'node:path';

import type { OtpProviderName } from './auth/otp/providers';
import { DEFAULT_OTP_LIMITS, type OtpLimits } from './auth/otp/otpService';
import type { LogLevel } from './ops/logger';
import { parseLogLevel } from './ops/logger';
import type { S3Config } from './storage/s3Storage';

/**
 * firebase: every request carries a Firebase ID token (phone auth on the device).
 * otp:      the API runs sign-in itself (OTP_PROVIDER = msg91 | firebase | dev) and issues sessions.
 * dev:      unsigned dev:+91… tokens, local testing only (refused in production).
 */
export type AuthMode = 'firebase' | 'dev' | 'otp';

export interface Config {
  env: string;
  port: number;
  databaseUrl: string;
  authMode: AuthMode;
  firebaseProjectId: string;
  storageDir: string;
  /** Base URL the app uses to reach this server (used to build photo URLs). */
  publicBaseUrl: string;
  /** HMAC key for signed photo URLs. */
  fileUrlSecret: string;
  fileUrlTtlSeconds: number;
  corsOrigins: string[];
  pushEnabled: boolean;
  /** Optional Expo access token (only if "enhanced push security" is on in Expo). */
  expoAccessToken: string;
  /** 1.3.0: uids allowed to review flagged matches (ADMIN_UIDS, comma-separated). Empty = no admins. */
  adminUids: string[];
  // ---- launch prep ----
  logLevel: LogLevel;
  /** Express "trust proxy": 'loopback' (default), or the number of proxy hops in front (PaaS: 1). */
  trustProxy: string | number;
  storage: { driver: 'local' } | { driver: 's3'; s3: S3Config };
  /** Shared rate-limit store; '' = in memory (single instance). */
  redisUrl: string;
  /** AUTH_MODE=otp only. */
  otp: { provider: OtpProviderName; sessionSecret: string; sessionTtlSeconds: number; limits: OtpLimits; msg91?: { authKey: string; templateId: string; otpVar: string } } | null;
}

/** The .env.example placeholders must never run in production. */
export const isPlaceholder = (v: string) => /replace-with|CHANGE_ME|your-|example/i.test(v);

const int = (v: string | undefined, def: number, min = 0) => {
  const n = v === undefined || v === '' ? def : Number(v);
  if (!Number.isFinite(n) || n < min) throw new Error(`Invalid number "${v}"`);
  return n;
};

/**
 * CORS_ORIGINS: exact origins (scheme://host[:port]) of the web app. In production '*' and plain-http
 * origins (other than none) are refused; native Android/iOS apps send no Origin and don't need CORS.
 */
export function parseCorsOrigins(raw: string | undefined, prod: boolean): string[] {
  const list = (raw || '').split(',').map((s) => s.trim().replace(/\/$/, '')).filter(Boolean);
  for (const o of list) {
    if (o === '*') {
      if (prod) throw new Error('CORS_ORIGINS=* is refused in production; list the web origins');
      continue;
    }
    if (!/^https?:\/\/[A-Za-z0-9.-]+(:\d+)?$/.test(o)) throw new Error(`CORS_ORIGINS: "${o}" is not an origin (scheme://host[:port])`);
    if (prod && !o.startsWith('https://')) throw new Error(`CORS_ORIGINS: "${o}" must be https in production`);
  }
  return [...new Set(list)];
}

/** ADMIN_UIDS=uid1,uid2 – ids only (no secrets); invalid entries are refused at startup. */
export function parseAdminUids(raw: string | undefined): string[] {
  const ids = (raw || '').split(',').map((x) => x.trim()).filter(Boolean);
  for (const x of ids) if (!/^[A-Za-z0-9_-]{1,128}$/.test(x)) throw new Error(`ADMIN_UIDS: invalid uid "${x}"`);
  return [...new Set(ids)];
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const nodeEnv = env.NODE_ENV || 'development';
  const prod = nodeEnv === 'production';
  const authMode = (env.AUTH_MODE || 'firebase') as AuthMode;
  if (!['firebase', 'dev', 'otp'].includes(authMode)) throw new Error(`AUTH_MODE must be "firebase", "otp" or "dev" (got ${String(authMode).slice(0, 20)})`);
  if (authMode === 'dev' && prod) throw new Error('AUTH_MODE=dev is a local-testing shortcut and is refused when NODE_ENV=production');
  if (!env.DATABASE_URL) throw new Error('DATABASE_URL is required (see server/.env.example)');
  if (authMode === 'firebase' && !env.FIREBASE_PROJECT_ID) throw new Error('FIREBASE_PROJECT_ID is required when AUTH_MODE=firebase');
  const publicBase = (env.PUBLIC_BASE_URL || '').replace(/\/$/, '');
  if (prod && !/^https:\/\//.test(publicBase)) throw new Error('PUBLIC_BASE_URL must be the https URL of this API in production');

  // ---- OTP sign-in (AUTH_MODE=otp) ----
  let otp: Config['otp'] = null;
  if (authMode === 'otp') {
    const provider = (env.OTP_PROVIDER || '') as OtpProviderName;
    if (!['msg91', 'firebase', 'dev'].includes(provider)) throw new Error('AUTH_MODE=otp needs OTP_PROVIDER=msg91, firebase or dev');
    if (provider === 'dev' && prod) throw new Error('OTP_PROVIDER=dev (fixed code 123456) is refused when NODE_ENV=production');
    if (provider === 'firebase' && !env.FIREBASE_PROJECT_ID) throw new Error('OTP_PROVIDER=firebase needs FIREBASE_PROJECT_ID');
    if (provider === 'msg91' && (!env.MSG91_AUTH_KEY || !env.MSG91_TEMPLATE_ID)) throw new Error('OTP_PROVIDER=msg91 needs MSG91_AUTH_KEY and MSG91_TEMPLATE_ID');
    let sessionSecret = env.SESSION_SECRET || '';
    if (prod && isPlaceholder(sessionSecret)) throw new Error('SESSION_SECRET is still the .env.example placeholder');
    if (sessionSecret.length < 32) {
      if (prod) throw new Error('SESSION_SECRET must be at least 32 characters in production');
      sessionSecret = crypto.randomBytes(32).toString('hex'); // dev: sessions end at restart
    }
    otp = {
      provider,
      sessionSecret,
      sessionTtlSeconds: int(env.SESSION_TTL_SECONDS, 30 * 24 * 3600, 300),
      limits: {
        ttlSeconds: int(env.OTP_TTL_SECONDS, DEFAULT_OTP_LIMITS.ttlSeconds, 60),
        maxAttempts: int(env.OTP_MAX_ATTEMPTS, DEFAULT_OTP_LIMITS.maxAttempts, 1),
        resendSeconds: int(env.OTP_RESEND_SECONDS, DEFAULT_OTP_LIMITS.resendSeconds, 0),
        maxPerHour: int(env.OTP_MAX_PER_HOUR, DEFAULT_OTP_LIMITS.maxPerHour, 1),
        ipPerHour: int(env.OTP_IP_PER_HOUR, DEFAULT_OTP_LIMITS.ipPerHour, 1),
      },
      ...(provider === 'msg91' ? { msg91: { authKey: env.MSG91_AUTH_KEY!, templateId: env.MSG91_TEMPLATE_ID!, otpVar: env.MSG91_OTP_VAR || 'otp' } } : {}),
    };
  }

  // ---- photo storage ----
  const driver = (env.STORAGE_DRIVER || 'local').toLowerCase();
  if (driver !== 'local' && driver !== 's3') throw new Error('STORAGE_DRIVER must be "local" or "s3"');
  const storage: Config['storage'] =
    driver === 's3'
      ? (() => {
          for (const k of ['S3_ENDPOINT', 'S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'])
            if (!env[k]) throw new Error(`STORAGE_DRIVER=s3 needs ${k}`);
          return {
            driver: 's3' as const,
            s3: {
              endpoint: env.S3_ENDPOINT!,
              bucket: env.S3_BUCKET!,
              region: env.S3_REGION || 'auto',
              accessKeyId: env.S3_ACCESS_KEY_ID!,
              secretAccessKey: env.S3_SECRET_ACCESS_KEY!,
              forcePathStyle: env.S3_FORCE_PATH_STYLE !== '0',
              redirect: env.S3_REDIRECT !== '0',
              presignSeconds: int(env.S3_PRESIGN_SECONDS, 300, 30),
            },
          };
        })()
      : { driver: 'local' as const };
  if (env.REDIS_URL && !/^rediss?:\/\//.test(env.REDIS_URL)) throw new Error('REDIS_URL must start with redis:// or rediss://');
  const tp = env.TRUST_PROXY || 'loopback';

  let fileUrlSecret = env.FILE_URL_SECRET || '';
  if (prod && isPlaceholder(fileUrlSecret)) throw new Error('FILE_URL_SECRET is still the .env.example placeholder');
  if (fileUrlSecret.length < 32) {
    if (prod) throw new Error('FILE_URL_SECRET must be at least 32 characters in production');
    // Development: an ephemeral key (photo links stop working after a restart, which is fine locally).
    fileUrlSecret = crypto.randomBytes(32).toString('hex');
  }
  const port = Number(env.PORT || 4000);
  return {
    env: nodeEnv,
    port,
    databaseUrl: env.DATABASE_URL,
    authMode,
    firebaseProjectId: env.FIREBASE_PROJECT_ID || '',
    storageDir: path.resolve(env.STORAGE_DIR || './uploads'),
    publicBaseUrl: publicBase || `http://localhost:${port}`,
    fileUrlSecret,
    fileUrlTtlSeconds: Number(env.FILE_URL_TTL_SECONDS || 7 * 24 * 3600),
    corsOrigins: parseCorsOrigins(env.CORS_ORIGINS, prod),
    pushEnabled: env.PUSH_ENABLED !== '0',
    expoAccessToken: env.EXPO_ACCESS_TOKEN || '',
    adminUids: parseAdminUids(env.ADMIN_UIDS),
    logLevel: parseLogLevel(env.LOG_LEVEL),
    trustProxy: /^\d+$/.test(tp) ? Number(tp) : tp,
    storage,
    redisUrl: env.REDIS_URL || '',
    otp,
  };
}
