/**
 * Fix re-test of build 214: on web, "location blocked for this site" only when the browser's own
 * permission state is 'denied' (#1), and a failing "Open settings" is handled (#3). Unlike
 * fix213, getLocationFix is NOT mocked here: the real service runs on a faked expo-location and a
 * faked navigator.permissions, so the screen shows what the real decision logic decides.
 * (#2, load-safe tests: warm-ups + tight per-test timeouts in previewMap / teamBuilder / fix204 / fix211.)
 */
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import React from 'react';
import { Linking, Platform } from 'react-native';
import i18n from '../../i18n';
import MapScreen from '../../app/(tabs)/map';

jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('react-native-maps', () => ({ __esModule: true, default: () => null, Marker: () => null, PROVIDER_GOOGLE: 'google' }));
jest.mock('expo-router', () => {
  const R = require('react');
  return { router: { push: jest.fn(), canGoBack: () => true, back: jest.fn(), replace: jest.fn() }, useFocusEffect: (cb: () => void) => R.useEffect(cb, [cb]) };
});
jest.mock('../../services/backend', () => ({
  backend: { listCourts: async () => [], listPublicMatches: async () => [], watchTournaments: (cb: (v: unknown[]) => void) => (cb([]), () => {}) },
}));
jest.mock('expo-location', () => ({
  requestForegroundPermissionsAsync: jest.fn(),
  getForegroundPermissionsAsync: jest.fn(),
  getLastKnownPositionAsync: jest.fn(),
  getCurrentPositionAsync: jest.fn(),
  reverseGeocodeAsync: jest.fn(),
  Accuracy: { Balanced: 3 },
}));
import * as ExpoLocation from 'expo-location';

const mockLoc = ExpoLocation as unknown as Record<string, jest.Mock>;
/** What expo-location's web module answers for a dismissed prompt, an insecure origin or a blocked site alike. */
const EXPO_WEB_DENIED = { status: 'denied', granted: false, canAskAgain: true, expires: 0 };
const g = globalThis as { navigator?: unknown };
const realNav = Object.getOwnPropertyDescriptor(g, 'navigator');
const setNavigator = (nav: unknown) => Object.defineProperty(g, 'navigator', { value: nav, configurable: true, writable: true });
const permissionState = (state: string) => setNavigator({ permissions: { query: jest.fn(async () => ({ state })) } });
const restoreOS = Platform.OS;
const flush = () => act(async () => new Promise((r) => setTimeout(r, 0)));

// Load-safe: one warm-up render, then a tight per-test timeout (WARM_T backstops the warm-up).
const WARM_T = 15_000;
jest.setTimeout(5_000);
beforeAll(async () => {
  mockLoc.requestForegroundPermissionsAsync.mockResolvedValue({ status: 'denied', canAskAgain: false });
  await render(<MapScreen />);
  await flush();
  await screen.unmount();
}, WARM_T);
beforeEach(() => {
  jest.clearAllMocks();
  mockLoc.requestForegroundPermissionsAsync.mockResolvedValue(EXPO_WEB_DENIED);
});
afterEach(async () => {
  (Platform as { OS: string }).OS = restoreOS;
  if (realNav) Object.defineProperty(g, 'navigator', realNav);
  else delete g.navigator;
  await act(async () => {
    await i18n.changeLanguage('en');
  });
});

async function nearby(os: string, lang: string) {
  (Platform as { OS: string }).OS = os;
  await act(async () => {
    await i18n.changeLanguage(lang);
  });
  await render(<MapScreen />);
  await flush();
}
const offText = () => i18n.t('map.locationOff', { area: i18n.t('map.defaultArea') });

describe('#1 web: blocked only when the browser says the site is denied', () => {
  test.each(['en', 'hi'])("prompt dismissed (state 'prompt', %s): Location off + Try again, no 'blocked' hint", async (lang) => {
    permissionState('prompt');
    await nearby('web', lang);
    expect(mockLoc.requestForegroundPermissionsAsync).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('location-status').props.children).toBe(offText());
    expect(screen.getByTestId('location-retry')).toBeTruthy();
    expect(screen.queryByTestId('location-blocked')).toBeNull();
  });
  test.each(['en', 'hi'])("state 'denied' (%s): the browser site-settings hint", async (lang) => {
    permissionState('denied');
    await nearby('web', lang);
    expect(screen.getByText(i18n.t('map.locationBlockedWeb'))).toBeTruthy();
    expect(screen.getByTestId('location-retry')).toBeTruthy();
    expect(screen.queryByTestId('location-open-settings')).toBeNull();
  });
  test('no Permissions API: not blocked, Try again only', async () => {
    setNavigator({});
    await nearby('web', 'en');
    expect(screen.getByTestId('location-status').props.children).toBe(offText());
    expect(screen.queryByTestId('location-blocked')).toBeNull();
    expect(screen.getByTestId('location-retry')).toBeTruthy();
  });
  test('Permissions API rejects: not blocked', async () => {
    setNavigator({ permissions: { query: () => Promise.reject(new TypeError('unsupported')) } });
    await nearby('web', 'en');
    expect(screen.queryByTestId('location-blocked')).toBeNull();
  });
  test('dismissed, then allowed on Try again: "Your location"', async () => {
    permissionState('prompt');
    await nearby('web', 'en');
    mockLoc.requestForegroundPermissionsAsync.mockResolvedValueOnce({ status: 'granted', granted: true, canAskAgain: true, expires: 0 });
    mockLoc.getLastKnownPositionAsync.mockResolvedValueOnce({ coords: { latitude: 28.62, longitude: 77.21 } });
    await fireEvent.press(screen.getByTestId('location-retry'));
    await flush();
    expect(screen.getByTestId('location-status').props.children).toBe('Your location');
  });
});

describe('#3 Open settings that fails is handled', () => {
  test.each(['en', 'hi'])('openSettings rejects (%s): a translated "open Settings yourself" message, no unhandled rejection', async (lang) => {
    mockLoc.requestForegroundPermissionsAsync.mockResolvedValue({ status: 'denied', canAskAgain: false });
    const open = jest.spyOn(Linking, 'openSettings').mockRejectedValue(new Error('Unable to open settings'));
    await nearby('android', lang);
    expect(screen.queryByTestId('location-settings-failed')).toBeNull();
    await fireEvent.press(screen.getByTestId('location-open-settings'));
    await flush();
    expect(open).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('location-settings-failed').props.children).toBe(i18n.t('map.openSettingsFailed'));
    expect(i18n.t('map.openSettingsFailed')).toMatch(lang === 'en' ? /Couldn't open Settings/ : /सेटिंग नहीं खुल सकी/);
    // Try again clears it
    await fireEvent.press(screen.getByTestId('location-retry'));
    expect(screen.queryByTestId('location-settings-failed')).toBeNull();
    open.mockRestore();
  });
  test('openSettings throws synchronously: same message', async () => {
    mockLoc.requestForegroundPermissionsAsync.mockResolvedValue({ status: 'denied', canAskAgain: false });
    const open = jest.spyOn(Linking, 'openSettings').mockImplementation(() => {
      throw new Error('no activity');
    });
    await nearby('ios', 'en');
    await fireEvent.press(screen.getByTestId('location-open-settings'));
    await flush();
    expect(screen.getByTestId('location-settings-failed')).toBeTruthy();
    open.mockRestore();
  });
  test('openSettings succeeds: no message', async () => {
    mockLoc.requestForegroundPermissionsAsync.mockResolvedValue({ status: 'denied', canAskAgain: false });
    const open = jest.spyOn(Linking, 'openSettings').mockResolvedValue(undefined);
    await nearby('android', 'en');
    await fireEvent.press(screen.getByTestId('location-open-settings'));
    await flush();
    expect(open).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('location-settings-failed')).toBeNull();
    open.mockRestore();
  });
});
