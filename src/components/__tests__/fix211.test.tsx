/**
 * Fix re-test of build 211: the "you are here" dot only where it belongs (#1 court page, #2 pickers,
 * #3 Nearby before/without a location), the bottom sheet's keyboard focus on web (#4) and the
 * native map's OS dot (#5).
 */
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import React from 'react';
import { Platform } from 'react-native';
import i18n from '../../i18n';
import PreviewMap, { layoutLabels, spanFor, USER_CLEAR } from '../maps/PreviewMap';
import { nativeShowsUser } from '../maps/AppMap';
import type { AppMapProps } from '../maps/types';
import { LocationPicker } from '../LocationPicker';
import CourtPage from '../../app/court/[id]';
import MapScreen from '../../app/(tabs)/map';

jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('react-native-maps', () => ({ __esModule: true, default: () => null, Marker: () => null, PROVIDER_GOOGLE: 'google' }));
// Screens render through AppMap; record what each one asks of it.
const mockMapProps: AppMapProps[] = [];
jest.mock('../maps/AppMap', () => {
  const actual = jest.requireActual('../maps/AppMap');
  return { __esModule: true, ...actual, default: (p: AppMapProps) => (mockMapProps.push(p), null) };
});
jest.mock('expo-router', () => {
  const R = require('react');
  return {
    useLocalSearchParams: () => ({ id: 'c1' }),
    router: { push: jest.fn(), canGoBack: () => true, back: jest.fn(), replace: jest.fn() },
    Stack: { Screen: () => null },
    useFocusEffect: (cb: () => void) => R.useEffect(cb, [cb]),
  };
});
const mockC1 = { id: 'c1', name: 'Lodhi Garden Sand Court', location: { lat: 28.5931, lng: 77.2197, name: 'Lodhi Garden' }, surface: 'beach', addedBy: 'seed2', createdAt: new Date(2026, 9, 1).getTime() };
jest.mock('../../services/backend', () => ({
  backend: { listCourts: async () => [mockC1], listPublicMatches: async () => [], watchTournaments: (cb: (v: unknown[]) => void) => (cb([]), () => {}) },
}));
let mockResolveLoc: (p: { lat: number; lng: number } | null) => void = () => {};
jest.mock('../../services/location', () => ({
  ...jest.requireActual('../../services/location'),
  getCurrentLocation: () => new Promise((r) => (mockResolveLoc = r)),
  getLocationFix: () => new Promise((r) => (mockResolveLoc = (p) => r({ point: p, blocked: false }))),
}));

const lastMap = () => mockMapProps[mockMapProps.length - 1];
const flush = () => act(async () => new Promise((r) => setTimeout(r, 0)));
const restoreOS = Platform.OS;
// Load-safe (fix re-test 214 #2): each screen renders once up front, so a cold cache's module loading
// isn't timed inside the first test that uses it; then a tight per-test timeout (WARM_T backstops the warm-up).
const WARM_T = 15_000;
jest.setTimeout(5_000);
beforeAll(async () => {
  void require('react-native').Modal;
  await render(<CourtPage />);
  await flush();
  await screen.unmount();
  await render(<LocationPicker value={{ lat: 28.6, lng: 77.2, name: 'India Gate' }} onChange={() => {}} />);
  await screen.unmount();
  await render(<MapScreen />);
  await flush();
  await act(async () => mockResolveLoc(null));
  await screen.unmount();
  const many = Array.from({ length: 7 }, (_, i) => ({ id: 'court:k' + i, title: 'Court ' + i, lat: 28.6139 + 0.001 * i, lng: 77.21 }));
  await render(<PreviewMap center={{ lat: 28.6139, lng: 77.209 }} radiusKm={25} markers={many} />);
  await act(async () => screen.getByTestId('preview-map').props.onLayout({ nativeEvent: { layout: { width: 360, height: 200 } } }));
  await fireEvent.press(screen.getByTestId('marker-cluster-court:k0'));
  await fireEvent.press(screen.getByTestId('map-sheet-close'));
  await screen.unmount();
}, WARM_T);
beforeEach(() => (mockMapProps.length = 0));
afterEach(async () => {
  (Platform as { OS: string }).OS = restoreOS;
  delete (global as { document?: unknown }).document;
  jest.useRealTimers();
  await act(async () => {
    await i18n.changeLanguage('en');
  });
});

const COURT = { id: 'court:c1', title: '🏐 Lodhi Garden Sand Court', subtitle: 'Lodhi Garden', lat: mockC1.location.lat, lng: mockC1.location.lng };
const pctNum = (v: unknown) => parseFloat(String(v));

describe('#1 court page: the court pin sits on its real spot, no "you are here" dot', () => {
  test('the court page asks for no user dot', async () => {
    await render(<CourtPage />);
    await flush();
    expect((lastMap().markers ?? []).map((m) => m.id)).toEqual(['c1']);
    expect(lastMap().center).toEqual(mockC1.location); // the map is centred on the court
    expect(lastMap().showsUser).toBeFalsy();
  });
  test('showsUser={false} (the default): no dot and the pin is not displaced, at QA sizes', async () => {
    for (const [w, h] of [[1280, 312], [1008, 305], [708, 305], [618, 304], [412, 200]]) {
      const out = layoutLabels([COURT], mockC1.location, spanFor(2), { w, h });
      expect([out[0].fx, out[0].fy]).toEqual([0.5, 0.5]); // centred on the court
    }
    await render(<PreviewMap center={mockC1.location} radiusKm={2} markers={[COURT]} userLocation={mockC1.location} />);
    await act(async () => screen.getByTestId('preview-map').props.onLayout({ nativeEvent: { layout: { width: 1008, height: 305 } } }));
    expect(screen.queryByTestId('you-are-here')).toBeNull(); // a known location alone draws nothing
    const st = screen.getByTestId('marker-court:c1').props.style;
    expect([pctNum(st.left), pctNum(st.top)]).toEqual([50, 50]);
  });
  test('regression guard: with a real user dot on the same spot the pin does step aside', () => {
    const out = layoutLabels([COURT], mockC1.location, spanFor(2), { w: 1008, h: 305 }, undefined, mockC1.location);
    expect(Math.hypot((out[0].fx - 0.5) * 1008, (out[0].fy - 0.5) * 305)).toBeGreaterThanOrEqual(USER_CLEAR - 0.01);
  });
});

describe('#2 location pickers show no "you are here" dot', () => {
  test('LocationPicker (Challenge / New tournament) asks for no user dot, with or without a pin', async () => {
    await render(<LocationPicker value={null} onChange={jest.fn()} />);
    expect(mockMapProps.length).toBeGreaterThan(0);
    expect(mockMapProps.every((p) => !p.showsUser)).toBe(true);
    mockMapProps.length = 0;
    await render(<LocationPicker value={{ lat: 28.6, lng: 77.2, name: 'India Gate' }} onChange={jest.fn()} />);
    expect(mockMapProps.every((p) => !p.showsUser)).toBe(true);
  });
  test('a key-less map with showsUser but no real location draws no dot', async () => {
    await render(<PreviewMap center={mockC1.location} radiusKm={5} markers={[]} showsUser userLocation={null} />);
    await act(async () => screen.getByTestId('preview-map').props.onLayout({ nativeEvent: { layout: { width: 708, height: 305 } } }));
    expect(screen.queryByTestId('you-are-here')).toBeNull();
  });
});

describe('#3 Nearby: the user dot only with a real location; a hint otherwise', () => {
  test.each(['en', 'hi'])('pending, then denied (%s): hint, no dot, no obstacle', async (lang) => {
    await act(async () => {
      await i18n.changeLanguage(lang);
    });
    await render(<MapScreen />);
    await flush();
    expect(screen.getByTestId('location-status').props.children).toBe(i18n.t('map.locating'));
    expect(lastMap().showsUser).toBe(false);
    expect(lastMap().userLocation).toBeNull();
    await act(async () => mockResolveLoc(null)); // denied / unavailable / 10 s timeout
    expect(screen.getByTestId('location-status').props.children).toBe(i18n.t('map.locationOff', { area: i18n.t('map.defaultArea') }));
    expect(screen.getByTestId('location-status').props.children).toBe(lang === 'en' ? 'Location off, showing Delhi' : 'लोकेशन बंद है, दिल्ली दिखा रहे हैं');
    expect(lastMap().showsUser).toBe(false);
    expect(lastMap().userLocation).toBeNull();
    expect(lastMap().center).toEqual({ lat: 28.6139, lng: 77.209 });
  });
  test('granted: the dot is drawn at the real location', async () => {
    await render(<MapScreen />);
    await flush();
    const here = { lat: 28.62, lng: 77.21 };
    await act(async () => mockResolveLoc(here));
    expect(screen.getByTestId('location-status').props.children).toBe(i18n.t('map.yourLocation'));
    expect(lastMap().showsUser).toBe(true);
    expect(lastMap().userLocation).toEqual(here);
    expect(lastMap().center).toEqual(here);
  });
  test('the key-less map draws the dot (and steers dots off it) only with showsUser + a location', async () => {
    const here = mockC1.location;
    await render(<PreviewMap center={here} radiusKm={2} markers={[COURT]} showsUser userLocation={here} />);
    await act(async () => screen.getByTestId('preview-map').props.onLayout({ nativeEvent: { layout: { width: 708, height: 305 } } }));
    expect(screen.getByTestId('you-are-here')).toBeTruthy();
    const st = screen.getByTestId('marker-court:c1').props.style;
    expect([pctNum(st.left), pctNum(st.top)]).not.toEqual([50, 50]);
  });
});

test('#5 native maps: the OS dot only when asked for and a real location is known', () => {
  expect(nativeShowsUser({})).toBe(false); // court page, pickers
  expect(nativeShowsUser({ showsUser: false, userLocation: { lat: 1, lng: 2 } })).toBe(false);
  expect(nativeShowsUser({ showsUser: true, userLocation: null })).toBe(false); // Nearby, pending/denied
  expect(nativeShowsUser({ showsUser: true, userLocation: { lat: 1, lng: 2 } })).toBe(true);
});

describe('#4 web bottom sheet: focus moves in, Tab is trapped, Esc closes and refocuses the dot', () => {
  test('focus, Tab, Shift+Tab, Esc', async () => {
    jest.useFakeTimers();
    (Platform as { OS: string }).OS = 'web';
    const handlers: Record<string, ((e: unknown) => void)[]> = {};
    const doc: { activeElement: unknown; [k: string]: unknown } = { activeElement: null };
    type El = { name: string; focus: jest.Mock; closest?: (sel: string) => unknown };
    const el = (name: string, inSheet = false): El => {
      const e: El = { name, focus: jest.fn(), ...(inSheet ? { closest: (sel: string) => (sel.includes('map-sheet') ? {} : null) } : {}) };
      e.focus.mockImplementation(() => (doc.activeElement = e));
      return e;
    };
    const rows = [el('row0', true), el('row1', true), el('row2', true), el('close', true)];
    const dotEl = el('dot');
    let sheetInDom = false; // the Modal's portal mounts a commit later
    const asked: string[] = [];
    Object.assign(doc, {
      addEventListener: (t: string, h: (e: unknown) => void) => (handlers[t] = [...(handlers[t] ?? []), h]),
      removeEventListener: (t: string, h: (e: unknown) => void) => (handlers[t] = (handlers[t] ?? []).filter((x) => x !== h)),
      querySelector: (sel: string) => (asked.push(sel), dotEl),
      querySelectorAll: (sel: string) => (!sheetInDom ? [] : sel.includes('map-sheet-close') ? [rows[3]] : rows.slice(0, 3)),
    });
    (global as { document?: unknown }).document = doc;
    const fire = (e: object) => (handlers.keydown ?? []).forEach((h) => h(e));
    const key = (k: string, shiftKey = false) => ({ key: k, shiftKey, preventDefault: jest.fn(), stopPropagation: jest.fn() });

    const HOME = { lat: 28.6139, lng: 77.209 };
    const many = Array.from({ length: 7 }, (_, i) => ({ id: 'court:k' + i, title: 'Court ' + i, subtitle: 'Area ' + i, lat: HOME.lat + 0.001 * i, lng: HOME.lng + 0.001 }));
    await render(<PreviewMap center={HOME} radiusKm={25} markers={many} />);
    await act(async () => screen.getByTestId('preview-map').props.onLayout({ nativeEvent: { layout: { width: 360, height: 200 } } }));
    await fireEvent.press(screen.getByTestId('marker-cluster-court:k0'));
    expect(screen.getByTestId('map-sheet')).toBeTruthy();
    await act(async () => jest.advanceTimersByTime(40)); // not mounted yet: keeps looking
    expect(rows[0].focus).not.toHaveBeenCalled();
    sheetInDom = true;
    await act(async () => jest.advanceTimersByTime(40));
    expect(doc.activeElement).toBe(rows[0]); // first row focused on open

    const tab = key('Tab');
    fire(tab);
    expect(tab.preventDefault).toHaveBeenCalled();
    expect(doc.activeElement).toBe(rows[1]);
    rows[3].focus();
    fire(key('Tab'));
    expect(doc.activeElement).toBe(rows[0]); // wraps from ✕ to the first row
    fire(key('Tab', true));
    expect(doc.activeElement).toBe(rows[3]); // Shift+Tab wraps back to ✕
    doc.activeElement = { name: 'outside' };
    fire(key('Tab'));
    expect(doc.activeElement).toBe(rows[0]); // focus that escaped is pulled back in

    await act(async () => fire(key('Escape')));
    expect(screen.queryByTestId('map-sheet')).toBeNull();
    await act(async () => jest.runOnlyPendingTimers());
    expect(asked).toContain('[data-testid="marker-cluster-court:k0"]');
    expect(doc.activeElement).toBe(dotEl); // focus back on the dot
    await act(async () => jest.runAllTimers()); // the focus restore finishes…
    expect(handlers.keydown ?? []).toHaveLength(0); // …and every listener is gone once closed
  });
  test('closing the sheet with ✕ also returns focus to the dot', async () => {
    jest.useFakeTimers();
    (Platform as { OS: string }).OS = 'web';
    const dotEl = { focus: jest.fn() };
    (global as { document?: unknown }).document = { addEventListener: jest.fn(), removeEventListener: jest.fn(), querySelector: () => dotEl, querySelectorAll: () => [] };
    const HOME = { lat: 28.6139, lng: 77.209 };
    const many = Array.from({ length: 7 }, (_, i) => ({ id: 'court:k' + i, title: 'Court ' + i, lat: HOME.lat + 0.001 * i, lng: HOME.lng + 0.001 }));
    await render(<PreviewMap center={HOME} radiusKm={25} markers={many} />);
    await act(async () => screen.getByTestId('preview-map').props.onLayout({ nativeEvent: { layout: { width: 360, height: 200 } } }));
    await fireEvent.press(screen.getByTestId('marker-cluster-court:k0'));
    await fireEvent.press(screen.getByTestId('map-sheet-close'));
    expect(screen.queryByTestId('map-sheet')).toBeNull();
    await act(async () => jest.runOnlyPendingTimers());
    expect(dotEl.focus).toHaveBeenCalled();
  });
});
