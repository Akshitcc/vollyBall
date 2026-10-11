/**
 * Fix re-test of build 213: the focus restore after closing a cluster list gives way to the user at
 * once (#1), and when location is blocked for good the Nearby map says how to allow it (#3).
 * (#2, load-safe tests: warm-ups, fake timers and backstops in scoreScreen / rotationUi / fix212.)
 */
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import React from 'react';
import { Linking, Platform } from 'react-native';
import i18n from '../../i18n';
import PreviewMap, { restoreDotFocus } from '../maps/PreviewMap';
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
type Fix = { point: { lat: number; lng: number } | null; blocked: boolean };
const mockFixes: ((f: Fix) => void)[] = [];
jest.mock('../../services/location', () => ({
  ...jest.requireActual('../../services/location'),
  getLocationFix: () => new Promise((r) => mockFixes.push(r)),
}));

// Load-safe (#2): one warm-up render up front, fake timers in every test, a 15 s backstop.
const T = 15_000;
jest.setTimeout(5_000); // per test, after the warm-up (fix re-test 214 #2); T backstops the warm-up
const HOME = { lat: 28.6139, lng: 77.209 };
const four = ['match:a', 'match:b', 'court:c', 'tournament:d'].map((id, i) => ({ id, title: id, lat: HOME.lat + 0.001 * i, lng: HOME.lng + 0.01 }));
beforeAll(async () => {
  void require('react-native').Modal;
  const warm = await render(<PreviewMap center={HOME} radiusKm={25} markers={four} onMarkerPress={() => {}} />);
  await act(async () => warm.getByTestId('preview-map').props.onLayout({ nativeEvent: { layout: { width: 354, height: 152 } } }));
  await fireEvent.press(warm.getAllByTestId(/^marker-cluster-/)[0]);
  await warm.unmount();
  const nearby = await render(<MapScreen />);
  await nearby.unmount();
  mockFixes.length = 0;
}, T);
const restoreOS = Platform.OS;
beforeEach(() => jest.useFakeTimers());
afterEach(async () => {
  await act(async () => jest.runOnlyPendingTimers());
  jest.useRealTimers();
  (Platform as { OS: string }).OS = restoreOS;
  delete (global as { document?: unknown }).document;
  mockFixes.length = 0;
  await act(async () => {
    await i18n.changeLanguage('en');
  });
});

// ---- #1 ------------------------------------------------------------------------------------------
type FakeEl = { id: string; focus: jest.Mock; dataset: { testid: string }; closest?: (s: string) => unknown };
/** A tiny DOM: capture listeners per type (a listener added during dispatch isn't called for that event, as in browsers). */
function fakeDom() {
  const handlers: Record<string, ((e: unknown) => void)[]> = {};
  const body = { id: 'body' };
  const doc = {
    body,
    activeElement: body as unknown,
    dots: {} as Record<string, FakeEl>,
    addEventListener: (t: string, h: (e: unknown) => void) => (handlers[t] = [...(handlers[t] ?? []), h]),
    removeEventListener: (t: string, h: (e: unknown) => void) => (handlers[t] = (handlers[t] ?? []).filter((x) => x !== h)),
    querySelector: (sel: string) => doc.dots[sel.replace(/^\[data-testid="(.*)"\]$/, '$1')] ?? null,
    querySelectorAll: () => [],
  };
  const fire = (type: string, e: object = {}) => (handlers[type] ?? []).forEach((h) => h({ type, preventDefault: jest.fn(), stopPropagation: jest.fn(), ...e }));
  const el = (id: string): FakeEl => {
    const e: FakeEl = { id, dataset: { testid: id }, focus: jest.fn() };
    e.focus.mockImplementation(() => {
      doc.activeElement = e;
      fire('focusin', { target: e }); // as the browser does – must not count as the user
    });
    return e;
  };
  const mountDot = (testid: string) => (doc.dots[testid] = el(testid));
  (global as { document?: unknown }).document = doc;
  const userListeners = () => ['pointerdown', 'focusin', 'keydown', 'click'].reduce((n, t) => n + (handlers[t]?.length ?? 0), 0);
  return { doc, el, mountDot, fire, userListeners };
}
async function openSheet() {
  (Platform as { OS: string }).OS = 'web';
  await render(<PreviewMap center={HOME} radiusKm={25} markers={four} onMarkerPress={jest.fn()} />);
  await act(async () => screen.getByTestId('preview-map').props.onLayout({ nativeEvent: { layout: { width: 354, height: 152 } } })); // 708 px at 200%
  const dot = screen.getAllByTestId(/^marker-cluster-/)[0];
  await fireEvent.press(dot);
  expect(screen.getByTestId('map-sheet')).toBeTruthy();
  return dot.props.testID as string;
}
const blank = { id: 'blank-next-to-play-nearby', dataset: { testid: '' } };

describe('#1 a quick click after closing keeps focus where the user put it', () => {
  test.each(['Esc', 'backdrop'])('QA repro: close (%s), click blank space ~50 ms later → focus stays off the dot', async (how) => {
    const { doc, mountDot, fire, userListeners } = fakeDom();
    const dotId = await openSheet();
    const dot = mountDot(dotId);
    if (how === 'Esc') await act(async () => fire('keydown', { key: 'Escape' }));
    else await act(async () => fire('pointerdown', { target: { closest: (s: string) => (s.includes('map-sheet-backdrop') ? {} : null) } }));
    expect(screen.queryByTestId('map-sheet')).toBeNull();
    doc.activeElement = doc.body; // QA: focus on <body> at ~50 ms…
    // …and the click on blank space at ~50 ms, before the restore got there
    await act(async () => jest.advanceTimersByTime(0));
    dot.focus.mockClear();
    doc.activeElement = doc.body;
    fire('pointerdown', { target: blank });
    fire('click', { target: blank });
    await act(async () => jest.advanceTimersByTime(1000)); // QA saw it pulled back by ~200 ms
    expect(dot.focus).not.toHaveBeenCalled();
    expect(doc.activeElement).toBe(doc.body);
    expect(userListeners()).toBe(0); // listeners cleaned up
  });

  test('the click that completes the closing press is not "new" input: focus still returns', async () => {
    const { doc, mountDot, fire, userListeners } = fakeDom();
    const dotId = await openSheet();
    const dot = mountDot(dotId);
    await act(async () => fire('pointerdown', { target: { closest: (s: string) => (s.includes('map-sheet-backdrop') ? {} : null) } }));
    doc.activeElement = doc.body;
    fire('click', { target: doc.body }); // the same press ends
    await act(async () => jest.runAllTimers());
    expect(doc.activeElement).toBe(dot);
    expect(userListeners()).toBe(0); // gone after it settled
  });

  test.each([
    ['pointerdown', {}],
    ['keydown', { key: 'Tab' }],
    ['click', {}],
    ['focusin', { target: { id: 'chip-100km' } }],
  ])('any %s after the close cancels the retries and removes the listeners', (type, extra) => {
    const { doc, mountDot, fire, userListeners } = fakeDom();
    (Platform as { OS: string }).OS = 'web';
    const dot = mountDot('marker-cluster-match:a');
    restoreDotFocus(['match:a']);
    expect(userListeners()).toBe(4);
    fire(type, { target: blank, ...extra });
    expect(userListeners()).toBe(0);
    jest.runAllTimers();
    expect(dot.focus).not.toHaveBeenCalled();
    expect(doc.activeElement).toBe(doc.body);
  });

  test("our own focus() and focus landing on the dot (RN Web's Modal handing it back) don't cancel", () => {
    const { doc, mountDot, fire } = fakeDom();
    (Platform as { OS: string }).OS = 'web';
    const dot = mountDot('marker-cluster-match:a');
    restoreDotFocus(['match:a']);
    fire('focusin', { target: dot }); // Modal returns focus to the dot
    jest.advanceTimersByTime(20); // our focus() fires focusin too
    expect(doc.activeElement).toBe(dot);
    doc.activeElement = doc.body; // a late blur, not from the user
    jest.advanceTimersByTime(40);
    expect(doc.activeElement).toBe(dot); // still restoring
  });

  test('closing the popup by clicking the map: the map taking focus under that click does not cancel', () => {
    const { doc, mountDot, fire } = fakeDom();
    (Platform as { OS: string }).OS = 'web';
    const dot = mountDot('marker-cluster-match:a');
    const map = { id: 'preview-map', dataset: { testid: 'preview-map' } } as unknown as Element;
    restoreDotFocus(['match:a'], map, { fromPress: true });
    doc.activeElement = map; // mousedown focuses the (focusable) map
    fire('focusin', { target: map });
    fire('click', { target: map }); // and the press completes
    jest.runAllTimers();
    expect(doc.activeElement).toBe(dot);
  });

  test('a new close replaces a pending restore (one set of listeners)', () => {
    const { mountDot, userListeners } = fakeDom();
    (Platform as { OS: string }).OS = 'web';
    mountDot('marker-cluster-match:a');
    restoreDotFocus(['match:a']);
    restoreDotFocus(['match:a']);
    expect(userListeners()).toBe(4);
    jest.runAllTimers();
    expect(userListeners()).toBe(0);
  });
});

// ---- #3 ------------------------------------------------------------------------------------------
describe('#3 location blocked for good: how to allow it', () => {
  async function nearby(os: string, lang: string, fix: Fix) {
    (Platform as { OS: string }).OS = os;
    await act(async () => {
      await i18n.changeLanguage(lang);
    });
    await render(<MapScreen />);
    await act(async () => mockFixes[0](fix));
  }
  test.each(['en', 'hi'])('web (%s): browser settings hint, Try again still there, no settings button', async (lang) => {
    await nearby('web', lang, { point: null, blocked: true });
    expect(screen.getByTestId('location-status').props.children).toBe(i18n.t('map.locationOff', { area: i18n.t('map.defaultArea') }));
    expect(screen.getByText(i18n.t('map.locationBlockedWeb'))).toBeTruthy();
    expect(i18n.t('map.locationBlockedWeb')).toMatch(lang === 'en' ? /browser's site settings/ : /ब्राउज़र की साइट सेटिंग/);
    expect(screen.getByTestId('location-retry')).toBeTruthy();
    expect(screen.queryByTestId('location-open-settings')).toBeNull();
  });
  test.each(['en', 'hi'])('native (%s): phone settings hint and an Open settings button', async (lang) => {
    const open = jest.spyOn(Linking, 'openSettings').mockResolvedValue(undefined);
    await nearby('android', lang, { point: null, blocked: true });
    expect(screen.getByText(i18n.t('map.locationBlockedApp'))).toBeTruthy();
    expect(screen.getByText(lang === 'en' ? 'Open settings' : 'सेटिंग खोलें')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('location-open-settings'));
    expect(open).toHaveBeenCalledTimes(1);
    open.mockRestore();
  });
  test('not blocked (dismissed, no fix, timed out): just "Location off" + Try again, no hint', async () => {
    await nearby('web', 'en', { point: null, blocked: false });
    expect(screen.queryByTestId('location-blocked')).toBeNull();
    expect(screen.getByTestId('location-retry')).toBeTruthy();
  });
  test('Try again while blocked: the hint goes while asking and comes back if still blocked; a fix clears it', async () => {
    await nearby('web', 'en', { point: null, blocked: true });
    await fireEvent.press(screen.getByTestId('location-retry'));
    expect(screen.queryByTestId('location-blocked')).toBeNull();
    await act(async () => mockFixes[1]({ point: null, blocked: true }));
    expect(screen.getByTestId('location-blocked')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('location-retry'));
    await act(async () => mockFixes[2]({ point: { lat: 28.62, lng: 77.21 }, blocked: false }));
    expect(screen.queryByTestId('location-blocked')).toBeNull();
    expect(screen.getByTestId('location-status').props.children).toBe('Your location');
  });
});
