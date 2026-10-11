/**
 * 1.3.4 sign-up hardening (a): which backend a build talks to, decided from its EXPO_PUBLIC_* values,
 * and a loud failure instead of a silent fall-back to demo mode.
 *
 * Shipped phone builds without any of these values are demo builds (sign-ups stay on the phone).
 * A build that *asks* for the API – EXPO_PUBLIC_BACKEND=api, or EXPO_PUBLIC_API_DEV_AUTH=1, or an
 * EXPO_PUBLIC_API_URL – but can't use it now throws at build time (app.config.ts) and at start-up
 * (services/config.ts), naming the missing variable. Only variable *names* appear in messages.
 *
 * Plain CommonJS JavaScript (types in backendMode.d.ts): app.config.ts requires it at build time,
 * where TypeScript imports are not compiled.
 */
'use strict';

class BackendConfigError extends Error {
  constructor(message) {
    super(`VolleyLive build config: ${message}`);
    this.name = 'BackendConfigError';
  }
}

/** Host (and port) of an http(s) URL, or null when it isn't one. */
function apiHostOf(url) {
  const m = /^https?:\/\/([^/?#@\s]+)(?:[/?#]|$)/i.exec(String(url).trim());
  return m ? m[1].toLowerCase() : null;
}

function resolveBackendMode(env) {
  const requested = (env.EXPO_PUBLIC_BACKEND ?? '').trim().toLowerCase();
  const apiUrl = (env.EXPO_PUBLIC_API_URL ?? '').trim().replace(/\/$/, '');
  const devAuth = env.EXPO_PUBLIC_API_DEV_AUTH === '1';
  // Launch prep: how API builds sign in. "otp" = the server sends the SMS (AUTH_MODE=otp, OTP_PROVIDER=msg91);
  // "firebase" (default) = Firebase Phone Auth on the device; EXPO_PUBLIC_API_DEV_AUTH=1 = local dev tokens.
  const apiAuthRaw = (env.EXPO_PUBLIC_API_AUTH ?? '').trim().toLowerCase();
  if (apiAuthRaw && !['otp', 'firebase', 'dev'].includes(apiAuthRaw))
    throw new BackendConfigError(`EXPO_PUBLIC_API_AUTH must be otp, firebase or dev (got "${apiAuthRaw.slice(0, 20)}").`);
  const forcedDemo = env.EXPO_PUBLIC_DEMO_MODE === '1';
  const demo = { kind: 'demo', apiHost: '', apiUrl: '', devAuth: false, apiAuth: 'none' };
  if (requested && !['demo', 'api', 'firebase'].includes(requested))
    throw new BackendConfigError(`EXPO_PUBLIC_BACKEND must be demo, api or firebase (got "${requested.slice(0, 20)}").`);
  if (requested === 'demo' || (forcedDemo && requested !== 'api' && requested !== 'firebase')) return demo;
  if (forcedDemo) throw new BackendConfigError(`EXPO_PUBLIC_DEMO_MODE=1 contradicts EXPO_PUBLIC_BACKEND=${requested}.`);

  const wantsApi = requested === 'api' || devAuth || (!!apiUrl && requested !== 'firebase');
  if (wantsApi) {
    if (!apiUrl) throw new BackendConfigError('API mode was requested but EXPO_PUBLIC_API_URL is not set.');
    const host = apiHostOf(apiUrl);
    if (!host) throw new BackendConfigError('EXPO_PUBLIC_API_URL must be an http(s) URL.');
    const apiAuth = devAuth || apiAuthRaw === 'dev' ? 'dev' : apiAuthRaw === 'otp' ? 'otp' : 'firebase';
    if (apiAuth === 'firebase' && !env.hasFirebase)
      throw new BackendConfigError('API mode needs a way to sign in: set EXPO_PUBLIC_API_AUTH=otp (server SMS), the EXPO_PUBLIC_FIREBASE_* config (Firebase phone auth) or EXPO_PUBLIC_API_DEV_AUTH=1 (local testing).');
    if (env.production && apiAuth === 'dev') throw new BackendConfigError('Production builds cannot use dev sign-in (EXPO_PUBLIC_API_DEV_AUTH / EXPO_PUBLIC_API_AUTH=dev).');
    return { kind: 'api', apiHost: host, apiUrl, devAuth: apiAuth === 'dev', apiAuth };
  }
  if (requested === 'firebase') {
    if (!env.hasFirebase) throw new BackendConfigError('Firebase mode was requested but the EXPO_PUBLIC_FIREBASE_* config is incomplete.');
    return { kind: 'firebase', apiHost: '', apiUrl: '', devAuth: false, apiAuth: 'none' };
  }
  return env.hasFirebase ? { kind: 'firebase', apiHost: '', apiUrl: '', devAuth: false, apiAuth: 'none' } : demo;
}

/**
 * Launch prep: an EAS production build must talk to the real API over https, with demo mode, the demo
 * admin list and dev sign-in all off, and with the demo code stripped from the bundle.
 */
function assertProductionBuild(mode, env) {
  if (mode.kind !== 'api') throw new BackendConfigError(`production builds must use EXPO_PUBLIC_BACKEND=api (resolved "${mode.kind}").`);
  if (!/^https:\/\//i.test(mode.apiUrl)) throw new BackendConfigError('production builds need an https EXPO_PUBLIC_API_URL.');
  if (mode.apiAuth === 'dev') throw new BackendConfigError('production builds cannot use dev sign-in.');
  if ((env.EXPO_PUBLIC_DEMO_ADMIN_UIDS ?? '').trim()) throw new BackendConfigError('EXPO_PUBLIC_DEMO_ADMIN_UIDS must be empty in production builds.');
  if (env.EXPO_PUBLIC_STRIP_DEMO !== '1') throw new BackendConfigError('production builds need EXPO_PUBLIC_STRIP_DEMO=1 (demo code left out of the bundle).');
  return true;
}

module.exports = { BackendConfigError, apiHostOf, resolveBackendMode, assertProductionBuild };
