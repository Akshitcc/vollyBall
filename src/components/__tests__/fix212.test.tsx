/**
 * Fix re-test of build 212: every way of closing the cluster list gives focus back to its dot
 * (#1), untyped credits show no 💥 and agree with the stats (#2), the venue map box is never blank
 * (#3), and the Nearby status names the default area, offers "Try again", and uses map.defaultArea.
 */
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import React from 'react';
import { Platform } from 'react-native';
import i18n from '../../i18n';
import en from '../../i18n/locales/en';
import hi from '../../i18n/locales/hi';
import PreviewMap, { MAP_BG, restoreDotFocus } from '../maps/PreviewMap';
import { LocationPicker } from '../LocationPicker';
import MapScreen from '../../app/(tabs)/map';
import { attributePoint, addPoint, timeline } from '../../core/scoring';
import { creditLabel, kindEmoji, playerStats, teamTotals } from '../../core/stats';
import { INDOOR_RULES } from '../../core/rules';
import type { MapMarker } from '../maps/types';

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
type MockFix = { lat: number; lng: number } | null | { point: { lat: number; lng: number } | null; blocked: boolean };
const mockAsks: ((p: MockFix) => void)[] = [];
jest.mock('../../services/location', () => ({
  ...jest.requireActual('../../services/location'),
  getCurrentLocation: () => new Promise((r) => mockAsks.push(r)),
  // a point (or null) settles as { point, blocked: false }; pass { point, blocked } to say more
  getLocationFix: () => new Promise((r) => mockAsks.push((p: MockFix) => r(p && 'point' in p ? p : { point: p, blocked: false }))),
}));

// Load-safe (fix re-test 213 #2): the map with its bottom sheet (RN Modal, lazily required) and the
// Nearby screen are rendered once up front, so module loading isn't timed inside the first test.
// Tests use fake timers (no real waits); T is a backstop for a busy CPU.
const T = 15_000;
jest.setTimeout(5_000); // per test, after the warm-up (fix re-test 214 #2); T backstops the warm-up
beforeAll(async () => {
  void require('react-native').Modal;
  const HOME0 = { lat: 28.6139, lng: 77.209 };
  const pins = Array.from({ length: 4 }, (_, i) => ({ id: 'w' + i, title: 'W' + i, lat: HOME0.lat + 0.001 * i, lng: HOME0.lng }));
  const warm = await render(<PreviewMap center={HOME0} radiusKm={25} markers={pins} onMarkerPress={() => {}} />);
  await act(async () => warm.getByTestId('preview-map').props.onLayout({ nativeEvent: { layout: { width: 354, height: 152 } } }));
  await fireEvent.press(warm.getAllByTestId(/^marker-cluster-/)[0]);
  await warm.unmount();
  const nearby = await render(<MapScreen />);
  await nearby.unmount();
  mockAsks.length = 0;
}, T);
const restoreOS = Platform.OS;
afterEach(async () => {
  (Platform as { OS: string }).OS = restoreOS;
  delete (global as { document?: unknown }).document;
  jest.useRealTimers();
  mockAsks.length = 0;
  await act(async () => {
    await i18n.changeLanguage('en');
  });
});

// ---- #1 focus back on the dot -------------------------------------------------------------------
type FakeEl = { id: string; focus: jest.Mock; isConnected?: boolean; dataset?: { testid: string }; closest?: (s: string) => unknown };
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
  const el = (id: string, extra: Partial<FakeEl> = {}): FakeEl => {
    const e: FakeEl = { id, focus: jest.fn(() => (doc.activeElement = e)), dataset: { testid: id }, ...extra };
    return e;
  };
  /** The dot as rendered now (re-rendering may swap the element, as RN Web can on remount). */
  const mountDot = (testid: string) => (doc.dots[testid] = el(testid));
  (global as { document?: unknown }).document = doc;
  const fire = (t: string, e: object) => (handlers[t] ?? []).forEach((h) => h(e));
  return { doc, el, mountDot, fire, handlers };
}
const HOME = { lat: 28.6139, lng: 77.209 };
const many = Array.from({ length: 7 }, (_, i) => ({ id: 'court:k' + i, title: 'Court ' + i, subtitle: 'Area ' + i, lat: HOME.lat + 0.001 * i, lng: HOME.lng + 0.001 }));
const four = [
  { id: 'match:a', title: 'A', lat: HOME.lat, lng: HOME.lng + 0.01 },
  { id: 'match:b', title: 'B', lat: HOME.lat + 0.001, lng: HOME.lng + 0.01 },
  { id: 'court:c', title: 'C', lat: HOME.lat - 0.001, lng: HOME.lng + 0.01 },
  { id: 'tournament:d', title: 'D', lat: HOME.lat, lng: HOME.lng + 0.011 },
];
async function openList(markers: MapMarker[], size: { w: number; h: number }) {
  const onMarkerPress = jest.fn();
  await render(<PreviewMap center={HOME} radiusKm={25} markers={markers} onMarkerPress={onMarkerPress} />);
  await act(async () => screen.getByTestId('preview-map').props.onLayout({ nativeEvent: { layout: { width: size.w, height: size.h } } }));
  const dot = screen.getAllByTestId(/^marker-cluster-/)[0];
  await fireEvent.press(dot);
  return { onMarkerPress, dotId: dot.props.testID as string };
}

describe('#1 every close path gives focus back to the cluster dot (web)', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    (Platform as { OS: string }).OS = 'web';
  });
  // QA: ~708 px window at 200% zoom = a ~354 px wide page, so the 4-places list opens as a sheet
  const ZOOMED = { w: 354, h: 152 };

  test('backdrop (the bug): pressing the dimmed map closes the sheet and focuses the dot', async () => {
    const { doc, mountDot, el, fire } = fakeDom();
    const { dotId } = await openList(four, ZOOMED);
    expect(screen.getByTestId('map-sheet')).toBeTruthy();
    const backdrop = el('map-sheet-backdrop', { closest: (s: string) => (s.includes('map-sheet-backdrop') ? {} : null) });
    doc.activeElement = el('map-callout-match:a', { closest: (s: string) => (s.includes('map-sheet') ? {} : null) }); // focus was in the sheet
    const dot = mountDot(dotId);
    await act(async () => fire('pointerdown', { target: backdrop }));
    expect(screen.queryByTestId('map-sheet')).toBeNull();
    doc.activeElement = doc.body; // the sheet unmounted: the browser drops focus to <body>
    await act(async () => jest.runAllTimers());
    expect(doc.activeElement).toBe(dot);
  });

  test('backdrop press (native-style onPress path) also restores focus', async () => {
    const { doc, mountDot } = fakeDom();
    const { dotId } = await openList(four, ZOOMED);
    const dot = mountDot(dotId);
    await fireEvent.press(screen.getByTestId('map-sheet-backdrop'));
    expect(screen.queryByTestId('map-sheet')).toBeNull();
    await act(async () => jest.runAllTimers());
    expect(doc.activeElement).toBe(dot);
  });

  test.each(['Esc', '✕'])('%s closes and focuses the dot', async (how) => {
    const { doc, mountDot, fire } = fakeDom();
    const { dotId } = await openList(four, ZOOMED);
    const dot = mountDot(dotId);
    if (how === 'Esc') await act(async () => fire('keydown', { key: 'Escape', preventDefault: jest.fn(), stopPropagation: jest.fn() }));
    else await fireEvent.press(screen.getByTestId('map-sheet-close'));
    expect(screen.queryByTestId('map-sheet')).toBeNull();
    await act(async () => jest.runAllTimers());
    expect(doc.activeElement).toBe(dot);
  });

  test('outside tap on the small popup closes it and focuses the dot', async () => {
    const { doc, mountDot, el, fire } = fakeDom();
    const { dotId } = await openList(four, { w: 708, h: 305 });
    expect(screen.getByTestId('map-callout')).toBeTruthy();
    const dot = mountDot(dotId);
    await act(async () => fire('pointerdown', { target: el('somewhere-on-the-page') }));
    expect(screen.queryByTestId('map-callout')).toBeNull();
    await act(async () => jest.runAllTimers());
    expect(doc.activeElement).toBe(dot);
  });

  test('picking a row navigates and does not pull focus back to the map', async () => {
    const { doc, mountDot } = fakeDom();
    const { onMarkerPress, dotId } = await openList(four, ZOOMED);
    const dot = mountDot(dotId);
    await fireEvent.press(screen.getByTestId('map-callout-court:c'));
    expect(onMarkerPress).toHaveBeenCalledWith('court:c');
    await act(async () => jest.runAllTimers());
    expect(dot.focus).not.toHaveBeenCalled();
    expect(doc.activeElement).toBe(doc.body);
  });

  test('the dot remounting after close: the fresh element gets focus, not the stale one', () => {
    const { doc, mountDot } = fakeDom();
    const stale = mountDot('marker-cluster-match:a');
    restoreDotFocus(['match:a', 'match:b']);
    jest.advanceTimersByTime(0);
    expect(doc.activeElement).toBe(stale);
    stale.isConnected = false; // re-render replaced the node; focus went with the old one
    const fresh = mountDot('marker-cluster-match:a');
    jest.advanceTimersByTime(20);
    expect(doc.activeElement).toBe(fresh);
  });

  test('the cluster re-forming under another first place is still found', () => {
    const { doc, mountDot } = fakeDom();
    const dot = mountDot('marker-cluster-match:b'); // "match:a" moved out of the cluster
    restoreDotFocus(['match:a', 'match:b']);
    jest.runAllTimers();
    expect(doc.activeElement).toBe(dot);
  });

  test('late focus loss (RN Web Modal handing focus back after unmount) is corrected', () => {
    const { doc, mountDot } = fakeDom();
    const dot = mountDot('marker-cluster-match:a');
    restoreDotFocus(['match:a']);
    jest.advanceTimersByTime(20);
    expect(doc.activeElement).toBe(dot);
    doc.activeElement = doc.body; // something blurred it a frame later
    jest.advanceTimersByTime(40);
    expect(doc.activeElement).toBe(dot);
  });

  test('never steals focus the user moved elsewhere (e.g. tapped a radius chip)', () => {
    const { doc, mountDot, el } = fakeDom();
    const dot = mountDot('marker-cluster-match:a');
    const chip = el('chip-100km');
    doc.activeElement = chip;
    restoreDotFocus(['match:a']);
    jest.runAllTimers();
    expect(doc.activeElement).toBe(chip);
    expect(dot.focus).not.toHaveBeenCalled();
  });
});

// ---- #2 untyped credits ------------------------------------------------------------------------
describe('#2 a point credited without a shot type: no 💥, and stats agree', () => {
  const build = () => {
    let ev = addPoint(INDOOR_RULES, [], 'A', { at: 1 });
    ev = addPoint(INDOOR_RULES, ev, 'A', { at: 2 });
    ev = attributePoint(ev, 0, 'u_rohan'); // tap on the player only
    ev = attributePoint(ev, 1, 'u_rohan', 'kill'); // tap + Spike
    return ev;
  };
  test('timeline label', () => {
    const tl = timeline(INDOOR_RULES, build(), 'A');
    expect(creditLabel('Rohan Das', tl[0].event.type === 'point' ? tl[0].event.kind : undefined)).toBe('Rohan Das');
    expect(creditLabel('Rohan Das', tl[1].event.type === 'point' ? tl[1].event.kind : undefined)).toBe('💥 Rohan Das');
    expect(kindEmoji(undefined)).toBe('');
    expect(kindEmoji(null)).toBe('');
  });
  test('stats: 2 points for him, 1 spike – the same one the timeline marks with 💥', () => {
    const ev = build();
    const line = playerStats(INDOOR_RULES, ev, 'A').u_rohan;
    expect(line.points).toBe(2);
    expect(line.kill).toBe(1);
    expect(teamTotals(ev).byKind.A.kill).toBe(1);
    const marked = timeline(INDOOR_RULES, ev, 'A').filter((e) => e.event.type === 'point' && e.event.playerId === 'u_rohan' && kindEmoji(e.event.kind) === '💥');
    expect(marked).toHaveLength(line.kill);
  });
  test('re-crediting without a type drops the old type (no stale 💥)', () => {
    const ev = attributePoint(build(), 1, 'u_rohan');
    expect(ev[1].type === 'point' && ev[1].kind).toBeFalsy();
  });
});

// ---- #3 venue map box --------------------------------------------------------------------------
test('#3 the venue map box has the map colour from the first render', async () => {
  await render(<LocationPicker value={null} onChange={jest.fn()} />);
  const box = screen.getByTestId('location-map-box');
  expect([box.props.style].flat().find((x: { backgroundColor?: string }) => x?.backgroundColor)?.backgroundColor).toBe(MAP_BG);
});

// ---- code review: area name, Try again, map.defaultArea ----------------------------------------
describe('Nearby location status', () => {
  test('the area name is interpolated, not hard-coded, and map.defaultArea is it (en/hi match)', () => {
    expect(en.map.locationOff).toContain('{{area}}');
    expect(hi.map.locationOff).toContain('{{area}}');
    expect(en.map.locationOff).not.toMatch(/Delhi/);
    expect(hi.map.locationOff).not.toMatch(/दिल्ली/);
    expect(Object.keys(en.map).sort()).toEqual(Object.keys(hi.map).sort());
    expect(i18n.t('map.locationOff', { area: i18n.t('map.defaultArea') })).toBe('Location off, showing Delhi');
  });
  test.each(['en', 'hi'])('"Try again" (%s) asks again; a fix turns the dot on', async (lang) => {
    await act(async () => {
      await i18n.changeLanguage(lang);
    });
    await render(<MapScreen />);
    expect(screen.queryByTestId('location-retry')).toBeNull(); // not while asking
    await act(async () => mockAsks[0](null));
    expect(screen.getByText(lang === 'en' ? 'Try again' : 'फिर कोशिश करें')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('location-retry'));
    expect(mockAsks).toHaveLength(2);
    expect(screen.getByTestId('location-status').props.children).toBe(i18n.t('map.locating'));
    expect(screen.queryByTestId('location-retry')).toBeNull();
    await act(async () => mockAsks[1]({ lat: 28.62, lng: 77.21 }));
    expect(screen.getByTestId('location-status').props.children).toBe(i18n.t('map.yourLocation'));
  });
  test('a late answer to an older ask cannot overwrite a newer one', async () => {
    await render(<MapScreen />);
    await act(async () => mockAsks[0](null));
    await fireEvent.press(screen.getByTestId('location-retry'));
    await act(async () => mockAsks[1]({ lat: 28.62, lng: 77.21 }));
    await act(async () => mockAsks[0](null)); // stale, already settled – ignored either way
    expect(screen.getByTestId('location-status').props.children).toBe(i18n.t('map.yourLocation'));
  });
});

test('the Nearby map box is never shorter than the map (no spill over the header on short windows)', async () => {
  await render(<MapScreen />);
  const st = [screen.getByTestId('nearby-map-box').props.style].flat().reduce((a: object, b: object) => ({ ...a, ...b }), {});
  expect(st).toMatchObject({ height: '45%', minHeight: 200 });
});
