import * as Location from 'expo-location';
import { Platform } from 'react-native';
import type { GeoPoint } from '../core/geo';

export const DEFAULT_CENTER: GeoPoint = { lat: 28.6139, lng: 77.209 }; // New Delhi
/** i18n key of DEFAULT_CENTER's area name ("Location off, showing {{area}}"); change both together. */
export const DEFAULT_AREA_KEY = 'map.defaultArea';

/** Give up on a location fix after this long (a pending browser prompt never settles on its own). */
export const LOCATION_TIMEOUT_MS = 10000;
/** Reverse geocoding is best effort; never keep the UI waiting longer than this. */
export const GEOCODE_TIMEOUT_MS = 6000;

/** Resolves `fallback` if `p` hasn't settled after `ms` (the original promise is left to settle on its own). */
export function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(fallback), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      () => {
        clearTimeout(timer);
        resolve(fallback);
      },
    );
  });
}

/** A location attempt: the point, or null – and whether location is blocked (see isBlocked). */
export interface LocationFix {
  point: GeoPoint | null;
  /** Asking again won't help: only the browser's site settings or the phone's Settings can allow it. */
  blocked: boolean;
}

/**
 * Permission blocked for good on a phone (fix re-test 213 #3): denied and the OS won't show the
 * prompt again (canAskAgain false). Web is decided by isWebGeolocationBlocked instead (fix re-test
 * 214 #1): expo-location's web status 'denied' also covers a dismissed prompt or an insecure origin,
 * where Try again can still ask, so 'denied' alone never means blocked there.
 */
export const isBlocked = (perm: { status: string; canAskAgain?: boolean }, os: string = Platform.OS) =>
  os !== 'web' && perm.status === 'denied' && perm.canAskAgain === false;
/** A geolocation error meaning "permission denied" (GeolocationPositionError code 1, or expo's code). */
export const isPermissionDeniedError = (e: unknown) => {
  const code = (e as { code?: unknown } | null)?.code;
  return code === 1 || code === 'E_LOCATION_UNAUTHORIZED';
};

type PermissionsLike = { query?: (d: { name: string }) => Promise<{ state?: string }> };
/**
 * Web: blocked only when the browser's own permission state for this site is 'denied' (the user or
 * policy blocked it in site settings). A missing Permissions API, a query that throws or rejects,
 * or any other state ('prompt' after a dismissed prompt, 'granted') counts as not blocked, so the
 * user keeps "Try again" without a misleading "blocked for this site" hint.
 */
export async function isWebGeolocationBlocked(
  permissions: PermissionsLike | undefined = (globalThis as { navigator?: { permissions?: PermissionsLike } }).navigator?.permissions,
): Promise<boolean> {
  try {
    if (!permissions || typeof permissions.query !== 'function') return false;
    const status = await permissions.query({ name: 'geolocation' });
    return status?.state === 'denied';
  } catch {
    return false;
  }
}

/** Whether a failed attempt is blocked for good: web asks the browser, phones use the OS answer. */
const blockedFor = (nativeBlocked: boolean): Promise<boolean> | boolean =>
  Platform.OS === 'web' ? isWebGeolocationBlocked() : nativeBlocked;

let inFlight: { prompt: boolean; promise: Promise<LocationFix> } | null = null;

/**
 * Current position, or null (no permission, no fix, or timed out).
 * - `prompt: false` (screens opening) never asks: it only uses an already granted permission, so a
 *   screen doesn't open with a browser permission prompt hanging over it (QA bug B).
 * - `prompt: true` (the "Use my current location" button) may ask.
 * Concurrent callers share one request, so re-renders or remounts can't stack up geolocation calls.
 */
export function getCurrentLocation(opts: { prompt?: boolean } = {}): Promise<GeoPoint | null> {
  const fix = getLocationFix(opts);
  let point = pointOf.get(fix);
  if (!point) pointOf.set(fix, (point = fix.then((r) => r.point))); // shared requests share one promise
  return point;
}
const pointOf = new WeakMap<Promise<LocationFix>, Promise<GeoPoint | null>>();

/** getCurrentLocation, also telling whether location is blocked (for a "how to allow it" hint). */
export function getLocationFix(opts: { prompt?: boolean } = {}): Promise<LocationFix> {
  const prompt = opts.prompt ?? false;
  if (inFlight && (inFlight.prompt || !prompt)) return inFlight.promise;
  const promise = withTimeout(locate(prompt), LOCATION_TIMEOUT_MS, { point: null, blocked: false }).finally(() => {
    if (inFlight?.promise === promise) inFlight = null;
  });
  inFlight = { prompt, promise };
  return promise;
}

async function locate(prompt: boolean): Promise<LocationFix> {
  try {
    const perm = prompt ? await Location.requestForegroundPermissionsAsync() : await Location.getForegroundPermissionsAsync();
    if (perm.status !== 'granted') return { point: null, blocked: await blockedFor(isBlocked(perm)) };
    const last = await Location.getLastKnownPositionAsync();
    const pos = last ?? (await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }));
    return { point: { lat: pos.coords.latitude, lng: pos.coords.longitude }, blocked: false };
  } catch (e) {
    return { point: null, blocked: await blockedFor(isPermissionDeniedError(e)) };
  }
}

/**
 * A readable name for a point, or null when none is available. Uses the phone's own geocoder
 * (expo-location: Android Geocoder / Apple CLGeocoder, no API key). Browsers have no geocoder,
 * so on web this is null and the user names the place. We deliberately don't call a third-party
 * web service (e.g. OpenStreetMap Nominatim): that would send users' locations to an unapproved
 * service, and Nominatim's usage policy doesn't allow it as an app's default geocoder.
 */
export async function placeName(p: GeoPoint): Promise<string | null> {
  const lookup = (async () => {
    const [r] = await Location.reverseGeocodeAsync({ latitude: p.lat, longitude: p.lng });
    if (!r) return null;
    const name = [r.name, r.district ?? r.subregion, r.city].filter((x, i, a) => !!x && a.indexOf(x) === i).join(', ');
    return name || null;
  })();
  return withTimeout(lookup, GEOCODE_TIMEOUT_MS, null);
}

/** Coordinates as text, e.g. for a hint ("28.5758, 77.2268"); never used as a place name. */
export const formatCoords = (p: GeoPoint) => `${p.lat.toFixed(4)}, ${p.lng.toFixed(4)}`;
