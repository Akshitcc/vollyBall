/** QA bugs B/C: location requests can't hang or stack up, opening a screen never prompts, geocoding is best effort. */
jest.mock('expo-location', () => ({
  requestForegroundPermissionsAsync: jest.fn(),
  getForegroundPermissionsAsync: jest.fn(),
  getLastKnownPositionAsync: jest.fn(),
  getCurrentPositionAsync: jest.fn(),
  reverseGeocodeAsync: jest.fn(),
  Accuracy: { Balanced: 3 },
}));
import * as ExpoLocation from 'expo-location';
import { formatCoords, GEOCODE_TIMEOUT_MS, getCurrentLocation, LOCATION_TIMEOUT_MS, placeName, withTimeout } from '../location';

const mockLoc = ExpoLocation as unknown as Record<string, jest.Mock>;
const never = <T,>() => new Promise<T>(() => {});
const pos = { coords: { latitude: 28.5, longitude: 77.2 } };

beforeEach(() => {
  jest.clearAllMocks();
  jest.useRealTimers();
});

test('withTimeout resolves the value, the fallback on timeout, and the fallback on rejection', async () => {
  await expect(withTimeout(Promise.resolve(1), 50, 0)).resolves.toBe(1);
  await expect(withTimeout(Promise.reject(new Error('x')), 50, 0)).resolves.toBe(0);
  jest.useFakeTimers();
  const p = withTimeout(never<number>(), 100, -1);
  jest.advanceTimersByTime(100);
  await expect(p).resolves.toBe(-1);
});

test('prompt:false never asks for permission', async () => {
  mockLoc.getForegroundPermissionsAsync.mockResolvedValue({ status: 'undetermined' });
  await expect(getCurrentLocation({ prompt: false })).resolves.toBeNull();
  expect(mockLoc.requestForegroundPermissionsAsync).not.toHaveBeenCalled();
});

test('prompt:true asks and returns the position', async () => {
  mockLoc.requestForegroundPermissionsAsync.mockResolvedValue({ status: 'granted' });
  mockLoc.getLastKnownPositionAsync.mockResolvedValue(null);
  mockLoc.getCurrentPositionAsync.mockResolvedValue(pos);
  await expect(getCurrentLocation({ prompt: true })).resolves.toEqual({ lat: 28.5, lng: 77.2 });
});

test('a pending permission prompt times out to null, and concurrent callers share one request', async () => {
  jest.useFakeTimers();
  mockLoc.requestForegroundPermissionsAsync.mockReturnValue(never());
  const a = getCurrentLocation({ prompt: true });
  const b = getCurrentLocation({ prompt: true });
  const c = getCurrentLocation({ prompt: false }); // rides on the prompting request
  expect(b).toBe(a);
  expect(c).toBe(a);
  expect(mockLoc.requestForegroundPermissionsAsync).toHaveBeenCalledTimes(1);
  jest.advanceTimersByTime(LOCATION_TIMEOUT_MS);
  await expect(a).resolves.toBeNull();
  // the next request starts fresh
  mockLoc.getForegroundPermissionsAsync.mockResolvedValue({ status: 'denied' });
  jest.useRealTimers();
  await expect(getCurrentLocation()).resolves.toBeNull();
  expect(mockLoc.getForegroundPermissionsAsync).toHaveBeenCalledTimes(1);
});

test('placeName builds a name, and gives null when the geocoder fails (web) or hangs', async () => {
  mockLoc.reverseGeocodeAsync.mockResolvedValueOnce([{ name: 'Nehru Park', district: 'Chanakyapuri', city: 'New Delhi' }]);
  await expect(placeName({ lat: 1, lng: 2 })).resolves.toBe('Nehru Park, Chanakyapuri, New Delhi');
  mockLoc.reverseGeocodeAsync.mockRejectedValueOnce(new Error('not supported on web'));
  await expect(placeName({ lat: 1, lng: 2 })).resolves.toBeNull();
  jest.useFakeTimers();
  mockLoc.reverseGeocodeAsync.mockReturnValueOnce(never());
  const p = placeName({ lat: 1, lng: 2 });
  jest.advanceTimersByTime(GEOCODE_TIMEOUT_MS);
  await expect(p).resolves.toBeNull();
});

test('formatCoords', () => {
  expect(formatCoords({ lat: 28.57581, lng: 77.22683 })).toBe('28.5758, 77.2268');
});

// Fix re-test 213 #3: "blocked" = asking again can't help (browser site settings / phone Settings).
describe('blocked location', () => {
  const { getLocationFix, isBlocked, isPermissionDeniedError } = require('../location');
  test('web: expo\'s status alone never means blocked (decided by the Permissions API, see below)', () => {
    expect(isBlocked({ status: 'denied', canAskAgain: true }, 'web')).toBe(false); // a dismissed prompt maps to 'denied' too (214 #1)
    expect(isBlocked({ status: 'denied', canAskAgain: false }, 'web')).toBe(false);
    expect(isBlocked({ status: 'undetermined', canAskAgain: true }, 'web')).toBe(false);
    expect(isBlocked({ status: 'granted' }, 'web')).toBe(false);
  });
  test('native: only when the OS won\'t ask again', () => {
    expect(isBlocked({ status: 'denied', canAskAgain: false }, 'android')).toBe(true);
    expect(isBlocked({ status: 'denied', canAskAgain: true }, 'android')).toBe(false); // Try again re-prompts
    expect(isBlocked({ status: 'denied', canAskAgain: false }, 'ios')).toBe(true);
  });
  test('PERMISSION_DENIED errors (code 1, or expo\'s E_LOCATION_UNAUTHORIZED); others are not', () => {
    expect(isPermissionDeniedError({ code: 1, PERMISSION_DENIED: 1 })).toBe(true);
    expect(isPermissionDeniedError({ code: 'E_LOCATION_UNAUTHORIZED' })).toBe(true);
    expect(isPermissionDeniedError({ code: 3 })).toBe(false); // timeout
    expect(isPermissionDeniedError(new Error('x'))).toBe(false);
    expect(isPermissionDeniedError(null)).toBe(false);
  });
  test('getLocationFix reports it (native): denied for good, a denied position request, a granted fix, a timeout', async () => {
    mockLoc.requestForegroundPermissionsAsync.mockResolvedValueOnce({ status: 'denied', canAskAgain: false });
    await expect(getLocationFix({ prompt: true })).resolves.toEqual({ point: null, blocked: true });
    mockLoc.requestForegroundPermissionsAsync.mockResolvedValueOnce({ status: 'denied', canAskAgain: true });
    await expect(getLocationFix({ prompt: true })).resolves.toEqual({ point: null, blocked: false }); // Try again re-prompts
    mockLoc.requestForegroundPermissionsAsync.mockResolvedValueOnce({ status: 'granted' });
    mockLoc.getLastKnownPositionAsync.mockResolvedValueOnce(null);
    mockLoc.getCurrentPositionAsync.mockRejectedValueOnce({ code: 1, message: 'User denied Geolocation' });
    await expect(getLocationFix({ prompt: true })).resolves.toEqual({ point: null, blocked: true });
    mockLoc.requestForegroundPermissionsAsync.mockResolvedValueOnce({ status: 'granted' });
    mockLoc.getLastKnownPositionAsync.mockResolvedValueOnce(pos);
    await expect(getLocationFix({ prompt: true })).resolves.toEqual({ point: { lat: 28.5, lng: 77.2 }, blocked: false });
    jest.useFakeTimers();
    mockLoc.requestForegroundPermissionsAsync.mockReturnValueOnce(never());
    const p = getLocationFix({ prompt: true });
    jest.advanceTimersByTime(LOCATION_TIMEOUT_MS);
    await expect(p).resolves.toEqual({ point: null, blocked: false }); // no answer: not "blocked"
  });
});

// Fix re-test 214 #1: on web only the browser's own permission state 'denied' means blocked. The real
// getLocationFix / isWebGeolocationBlocked run here; only expo-location and navigator.permissions are faked.
describe('web blocked detection (Permissions API)', () => {
  const { Platform } = require('react-native');
  const { getLocationFix, isWebGeolocationBlocked } = require('../location');
  const g = globalThis as { navigator?: unknown };
  const realOS = Platform.OS;
  const realNav = Object.getOwnPropertyDescriptor(g, 'navigator');
  const setNavigator = (nav: unknown) => Object.defineProperty(g, 'navigator', { value: nav, configurable: true, writable: true });
  const withPermissionState = (state: string) => {
    const query = jest.fn(async () => ({ state }));
    setNavigator({ permissions: { query } });
    return query;
  };
  /** What expo-location's web module answers for a dismissed prompt / insecure origin / blocked site. */
  const expoWebDenied = { status: 'denied', granted: false, canAskAgain: true, expires: 0 };
  beforeEach(() => {
    Platform.OS = 'web';
  });
  afterEach(() => {
    Platform.OS = realOS;
    if (realNav) Object.defineProperty(g, 'navigator', realNav);
    else delete g.navigator;
  });

  test("prompt dismissed (state still 'prompt') → not blocked, Try again stays useful", async () => {
    const query = withPermissionState('prompt');
    mockLoc.requestForegroundPermissionsAsync.mockResolvedValueOnce(expoWebDenied);
    await expect(getLocationFix({ prompt: true })).resolves.toEqual({ point: null, blocked: false });
    expect(query).toHaveBeenCalledWith({ name: 'geolocation' });
  });
  test("state 'denied' (blocked in site settings) → blocked", async () => {
    withPermissionState('denied');
    mockLoc.requestForegroundPermissionsAsync.mockResolvedValueOnce(expoWebDenied);
    await expect(getLocationFix({ prompt: true })).resolves.toEqual({ point: null, blocked: true });
  });
  test('no Permissions API → not blocked', async () => {
    setNavigator({});
    mockLoc.requestForegroundPermissionsAsync.mockResolvedValueOnce(expoWebDenied);
    await expect(getLocationFix({ prompt: true })).resolves.toEqual({ point: null, blocked: false });
    setNavigator(undefined);
    mockLoc.requestForegroundPermissionsAsync.mockResolvedValueOnce(expoWebDenied);
    await expect(getLocationFix({ prompt: true })).resolves.toEqual({ point: null, blocked: false });
  });
  test('Permissions API throws or rejects (e.g. "geolocation" not a queryable name) → not blocked', async () => {
    setNavigator({ permissions: { query: () => { throw new TypeError('bad name'); } } });
    mockLoc.requestForegroundPermissionsAsync.mockResolvedValueOnce(expoWebDenied);
    await expect(getLocationFix({ prompt: true })).resolves.toEqual({ point: null, blocked: false });
    setNavigator({ permissions: { query: () => Promise.reject(new TypeError('bad name')) } });
    mockLoc.requestForegroundPermissionsAsync.mockResolvedValueOnce(expoWebDenied);
    await expect(getLocationFix({ prompt: true })).resolves.toEqual({ point: null, blocked: false });
  });
  test('a PERMISSION_DENIED position error is blocked only if the site state is denied', async () => {
    for (const [state, blocked] of [['prompt', false], ['denied', true]] as const) {
      withPermissionState(state);
      mockLoc.requestForegroundPermissionsAsync.mockResolvedValueOnce({ status: 'granted' });
      mockLoc.getLastKnownPositionAsync.mockResolvedValueOnce(null);
      mockLoc.getCurrentPositionAsync.mockRejectedValueOnce({ code: 1, message: 'User denied Geolocation' });
      await expect(getLocationFix({ prompt: true })).resolves.toEqual({ point: null, blocked });
    }
  });
  test('isWebGeolocationBlocked with an explicit permissions object', async () => {
    await expect(isWebGeolocationBlocked({ query: async () => ({ state: 'denied' }) })).resolves.toBe(true);
    await expect(isWebGeolocationBlocked({ query: async () => ({ state: 'granted' }) })).resolves.toBe(false);
    await expect(isWebGeolocationBlocked({ query: async () => ({}) })).resolves.toBe(false);
    await expect(isWebGeolocationBlocked({})).resolves.toBe(false);
  });
  test('native ignores the Permissions API', async () => {
    Platform.OS = 'android';
    const query = withPermissionState('denied');
    mockLoc.requestForegroundPermissionsAsync.mockResolvedValueOnce({ status: 'denied', canAskAgain: true });
    await expect(getLocationFix({ prompt: true })).resolves.toEqual({ point: null, blocked: false });
    expect(query).not.toHaveBeenCalled();
  });
});
