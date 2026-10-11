/**
 * Runtime configuration. EXPO_PUBLIC_* vars must be referenced statically so
 * Expo can inline them at build time.
 */
export const firebaseConfig = {
  apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY ?? '',
  authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN ?? '',
  projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID ?? '',
  storageBucket: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET ?? '',
  messagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID ?? '',
  appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID ?? '',
};

import { resolveBackendMode, type BackendKind } from '../core/backendMode';

/** Indian mobile numbers only (+91, see src/core/phone.ts); the server and rules enforce +91 too. */
export { COUNTRY_CODE as DEFAULT_COUNTRY_CODE } from '../core/phone';

const hasFirebase = !!firebaseConfig.apiKey && !!firebaseConfig.projectId && !!firebaseConfig.appId;

/**
 * 1.3.4 (sign-up hardening a): the backend is resolved by core/backendMode, which throws a clear
 * BackendConfigError when API mode is requested without EXPO_PUBLIC_API_URL (or without a way to sign
 * in) instead of silently running the demo. app.config.ts runs the same check at build time.
 */
export const BACKEND_MODE = resolveBackendMode({
  EXPO_PUBLIC_BACKEND: process.env.EXPO_PUBLIC_BACKEND,
  EXPO_PUBLIC_DEMO_MODE: process.env.EXPO_PUBLIC_DEMO_MODE,
  EXPO_PUBLIC_API_URL: process.env.EXPO_PUBLIC_API_URL,
  EXPO_PUBLIC_API_DEV_AUTH: process.env.EXPO_PUBLIC_API_DEV_AUTH,
  EXPO_PUBLIC_API_AUTH: process.env.EXPO_PUBLIC_API_AUTH,
  hasFirebase,
});

/** Base URL of the VolleyLive API server (server/). Empty = use Firebase directly (or demo mode). */
export const API_URL = BACKEND_MODE.apiUrl;

/**
 * Local testing only: sign in to the API with `dev:<phone>` tokens and the demo OTP instead of
 * Firebase. The server must run with AUTH_MODE=dev (refused in production).
 */
export const API_DEV_AUTH = BACKEND_MODE.kind === 'api' && BACKEND_MODE.devAuth;

/** Demo mode: local sample backend, no network, OTP is always 123456. */
export const DEMO_MODE = BACKEND_MODE.kind === 'demo';

export type { BackendKind };
export const BACKEND_KIND: BackendKind = BACKEND_MODE.kind;
/** Shown in Profile > About (host only, never a path or query). */
export const API_HOST = BACKEND_MODE.apiHost;

/** Phone sign-in goes through Firebase (needs the reCAPTCHA verifier) unless demo or API dev auth. */
/** Launch prep: API builds whose sign-in SMS is sent by the server (AUTH_MODE=otp on the server). */
export const API_OTP_AUTH = BACKEND_MODE.kind === 'api' && BACKEND_MODE.apiAuth === 'otp';

export const USES_FIREBASE_AUTH = BACKEND_KIND === 'firebase' || (BACKEND_KIND === 'api' && BACKEND_MODE.apiAuth === 'firebase');

/** Show the "use code 123456" hint on the login screen. */
export const SHOW_DEMO_OTP = DEMO_MODE || (BACKEND_KIND === 'api' && API_DEV_AUTH);

export const DEMO_OTP = '123456';

/**
 * Demo mode only: user ids treated as admins (the API server uses ADMIN_UIDS, Firebase the operator-set
 * `admin` custom claim). No accounts or credentials are created; empty by default.
 */
export const DEMO_ADMIN_UIDS: string[] = (process.env.EXPO_PUBLIC_DEMO_ADMIN_UIDS ?? '').split(',').map((x: string) => x.trim()).filter(Boolean);

/** 1.3.6: minimum player age (default 10, max age is fixed at 100). The API server reads MIN_AGE; keep them equal. */
export const MIN_AGE: number = Number(process.env.EXPO_PUBLIC_MIN_AGE) >= 1 ? Math.floor(Number(process.env.EXPO_PUBLIC_MIN_AGE)) : 10;
