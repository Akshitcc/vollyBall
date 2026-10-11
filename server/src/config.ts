/**
 * Server configuration from environment variables (see .env.example).
 * Nothing secret has a default; dev-only conveniences refuse to run in production.
 */
import crypto from 'node:crypto';
import path from 'node:path';

export type AuthMode = 'firebase' | 'dev';

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
  if (authMode !== 'firebase' && authMode !== 'dev') throw new Error(`AUTH_MODE must be "firebase" or "dev" (got ${authMode})`);
  if (authMode === 'dev' && prod) throw new Error('AUTH_MODE=dev is a local-testing shortcut and is refused when NODE_ENV=production');
  if (!env.DATABASE_URL) throw new Error('DATABASE_URL is required (see server/.env.example)');
  if (authMode === 'firebase' && !env.FIREBASE_PROJECT_ID) throw new Error('FIREBASE_PROJECT_ID is required when AUTH_MODE=firebase');

  let fileUrlSecret = env.FILE_URL_SECRET || '';
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
    publicBaseUrl: (env.PUBLIC_BASE_URL || `http://localhost:${port}`).replace(/\/$/, ''),
    fileUrlSecret,
    fileUrlTtlSeconds: Number(env.FILE_URL_TTL_SECONDS || 7 * 24 * 3600),
    corsOrigins: (env.CORS_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean),
    pushEnabled: env.PUSH_ENABLED !== '0',
    expoAccessToken: env.EXPO_ACCESS_TOKEN || '',
    adminUids: parseAdminUids(env.ADMIN_UIDS),
  };
}
