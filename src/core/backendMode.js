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
  const forcedDemo = env.EXPO_PUBLIC_DEMO_MODE === '1';
  const demo = { kind: 'demo', apiHost: '', apiUrl: '', devAuth: false };
  if (requested && !['demo', 'api', 'firebase'].includes(requested))
    throw new BackendConfigError(`EXPO_PUBLIC_BACKEND must be demo, api or firebase (got "${requested.slice(0, 20)}").`);
  if (requested === 'demo' || (forcedDemo && requested !== 'api' && requested !== 'firebase')) return demo;
  if (forcedDemo) throw new BackendConfigError(`EXPO_PUBLIC_DEMO_MODE=1 contradicts EXPO_PUBLIC_BACKEND=${requested}.`);

  const wantsApi = requested === 'api' || devAuth || (!!apiUrl && requested !== 'firebase');
  if (wantsApi) {
    if (!apiUrl) throw new BackendConfigError('API mode was requested but EXPO_PUBLIC_API_URL is not set.');
    const host = apiHostOf(apiUrl);
    if (!host) throw new BackendConfigError('EXPO_PUBLIC_API_URL must be an http(s) URL.');
    if (!devAuth && !env.hasFirebase)
      throw new BackendConfigError('API mode needs a way to sign in: set EXPO_PUBLIC_API_DEV_AUTH=1 (local testing) or the EXPO_PUBLIC_FIREBASE_* config (phone auth).');
    return { kind: 'api', apiHost: host, apiUrl, devAuth };
  }
  if (requested === 'firebase') {
    if (!env.hasFirebase) throw new BackendConfigError('Firebase mode was requested but the EXPO_PUBLIC_FIREBASE_* config is incomplete.');
    return { kind: 'firebase', apiHost: '', apiUrl: '', devAuth: false };
  }
  return env.hasFirebase ? { kind: 'firebase', apiHost: '', apiUrl: '', devAuth: false } : demo;
}

module.exports = { BackendConfigError, apiHostOf, resolveBackendMode };
