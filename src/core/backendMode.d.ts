/** Types for backendMode.js (plain CommonJS so app.config.ts can require it at build time). */
export type BackendKind = 'demo' | 'api' | 'firebase';
export interface BackendEnv {
  EXPO_PUBLIC_BACKEND?: string;
  EXPO_PUBLIC_DEMO_MODE?: string;
  EXPO_PUBLIC_API_URL?: string;
  EXPO_PUBLIC_API_DEV_AUTH?: string;
  /** otp | firebase | dev – how API builds sign in (default firebase) */
  EXPO_PUBLIC_API_AUTH?: string;
  /** set by app.config.ts for EAS production builds: dev sign-in is refused */
  production?: boolean;
  /** true when the Firebase web config (apiKey, projectId, appId) is complete */
  hasFirebase: boolean;
}
export interface BackendMode {
  kind: BackendKind;
  /** API host only (no path, no query), e.g. "api.example.com:4000"; '' unless kind is 'api' */
  apiHost: string;
  apiUrl: string;
  devAuth: boolean;
  /** API sign-in: server SMS OTP, Firebase phone auth, or local dev tokens; 'none' outside API mode */
  apiAuth: 'otp' | 'firebase' | 'dev' | 'none';
}
export declare class BackendConfigError extends Error {
  constructor(message: string);
}
export declare function apiHostOf(url: string): string | null;
export declare function resolveBackendMode(env: BackendEnv): BackendMode;
/** Throws unless this is a valid production build (api over https, no demo/dev settings, demo stripped). */
export declare function assertProductionBuild(mode: BackendMode, env: Record<string, string | undefined>): true;
