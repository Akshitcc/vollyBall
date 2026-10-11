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

/** Indian mobile numbers only (+91, see src/core/phone.ts); the server and rules enforce +91 too. */
export { COUNTRY_CODE as DEFAULT_COUNTRY_CODE } from '../core/phone';

const hasFirebase = !!firebaseConfig.apiKey && !!firebaseConfig.projectId && !!firebaseConfig.appId;

/** Base URL of the VolleyLive API server (server/). Empty = use Firebase directly (or demo mode). */
export const API_URL = (process.env.EXPO_PUBLIC_API_URL ?? '').replace(/\/$/, '');

/**
 * Local testing only: sign in to the API with `dev:<phone>` tokens and the demo OTP instead of
 * Firebase. The server must run with AUTH_MODE=dev (refused in production).
 */
export const API_DEV_AUTH = process.env.EXPO_PUBLIC_API_DEV_AUTH === '1';

/** Demo mode: local sample backend, no network, OTP is always 123456. */
export const DEMO_MODE = process.env.EXPO_PUBLIC_DEMO_MODE === '1' || (!hasFirebase && !(API_URL && API_DEV_AUTH));

export type BackendKind = 'demo' | 'api' | 'firebase';
export const BACKEND_KIND: BackendKind = DEMO_MODE ? 'demo' : API_URL ? 'api' : 'firebase';

/** Phone sign-in goes through Firebase (needs the reCAPTCHA verifier) unless demo or API dev auth. */
export const USES_FIREBASE_AUTH = BACKEND_KIND === 'firebase' || (BACKEND_KIND === 'api' && !API_DEV_AUTH);

/** Show the "use code 123456" hint on the login screen. */
export const SHOW_DEMO_OTP = DEMO_MODE || (BACKEND_KIND === 'api' && API_DEV_AUTH);

export const DEMO_OTP = '123456';

/**
 * Demo mode only: user ids treated as admins (the API server uses ADMIN_UIDS, Firebase the operator-set
 * `admin` custom claim). No accounts or credentials are created; empty by default.
 */
export const DEMO_ADMIN_UIDS: string[] = (process.env.EXPO_PUBLIC_DEMO_ADMIN_UIDS ?? '').split(',').map((x: string) => x.trim()).filter(Boolean);
