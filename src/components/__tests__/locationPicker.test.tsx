/**
 * QA bugs B/C: the picker never prompts on open, keeps the map still when you tap, never uses
 * raw coordinates as the name, keeps a typed name, and ignores a late lookup for an older tap.
 */
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import React, { useState } from 'react';
import { Text } from 'react-native';
import type { GeoPoint, Place } from '../../core/geo';
import { LocationPicker, placeReady } from '../LocationPicker';
import '../../i18n';

jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null, MaterialCommunityIcons: () => null }));

type Pending = { p: GeoPoint; resolve: (n: string | null) => void };
const mockPending: Pending[] = [];
const mockGetCurrent = jest.fn(async (_o?: { prompt?: boolean }): Promise<GeoPoint | null> => null);
jest.mock('../../services/location', () => ({
  DEFAULT_CENTER: { lat: 28.6, lng: 77.2 },
  formatCoords: (p: GeoPoint) => `${p.lat.toFixed(4)}, ${p.lng.toFixed(4)}`,
  getCurrentLocation: (o?: { prompt?: boolean }) => mockGetCurrent(o),
  placeName: (p: GeoPoint) => new Promise<string | null>((resolve) => mockPending.push({ p, resolve })),
}));
// Stand-in map: shows the centre it was given and lets the test "tap" a point.
const mockMapProps: { onMapPress?: (p: GeoPoint) => void; center?: GeoPoint } = {};
jest.mock('../maps/AppMap', () => ({
  __esModule: true,
  default: (props: { onMapPress?: (p: GeoPoint) => void; center: GeoPoint }) => {
    Object.assign(mockMapProps, props);
    return null;
  },
}));

let last: Place | null = null;
function Harness() {
  const [v, setV] = useState<Place | null>(null);
  last = v;
  return (
    <>
      <LocationPicker value={v} onChange={setV} />
      <Text testID="ready">{String(placeReady(v))}</Text>
    </>
  );
}
const tap = async (p: GeoPoint) => {
  await act(async () => {
    mockMapProps.onMapPress!(p);
  });
};
const lookup = async (i: number, name: string | null) => {
  await act(async () => {
    mockPending[i].resolve(name);
  });
};

beforeEach(() => {
  mockPending.length = 0;
  mockGetCurrent.mockClear();
  last = null;
});

test('opening the picker never prompts for location', async () => {
  await render(<Harness />);
  expect(mockGetCurrent).toHaveBeenCalledTimes(1);
  expect(mockGetCurrent).toHaveBeenCalledWith({ prompt: false });
});

test('tapping keeps the map still and uses the geocoded name', async () => {
  await render(<Harness />);
  const centre = mockMapProps.center;
  await tap({ lat: 28.61, lng: 77.21 });
  expect(mockMapProps.center).toEqual(centre);
  expect(last).toEqual({ lat: 28.61, lng: 77.21, name: '' });
  await lookup(0, 'Nehru Park');
  expect(last!.name).toBe('Nehru Park');
  expect(screen.getByTestId('ready').props.children).toBe('true');
});

test('no geocoder: the name stays empty (never coordinates) with a hint, and the place is not ready', async () => {
  await render(<Harness />);
  await tap({ lat: 28.57581, lng: 77.22683 });
  await lookup(0, null);
  expect(last!.name).toBe('');
  expect(screen.getByTestId('place-name-hint').props.children).toContain('28.5758, 77.2268');
  expect(screen.getByTestId('ready').props.children).toBe('false');
  await fireEvent.changeText(screen.getByTestId('place-name'), 'Sector 21 court');
  expect(last!.name).toBe('Sector 21 court');
  expect(screen.getByTestId('ready').props.children).toBe('true');
});

test('a typed name survives later taps and lookups', async () => {
  await render(<Harness />);
  await tap({ lat: 1, lng: 1 });
  await fireEvent.changeText(screen.getByTestId('place-name'), 'My court');
  await lookup(0, 'Somewhere else');
  expect(last!.name).toBe('My court');
  await tap({ lat: 2, lng: 2 });
  expect(last).toEqual({ lat: 2, lng: 2, name: 'My court' });
});

test('a slow lookup for an earlier tap cannot overwrite the newer one', async () => {
  await render(<Harness />);
  await tap({ lat: 1, lng: 1 });
  await tap({ lat: 2, lng: 2 });
  await lookup(1, 'Second');
  await lookup(0, 'First');
  expect(last).toEqual({ lat: 2, lng: 2, name: 'Second' });
});

test('"Use my current location" without geolocation stops spinning and shows a translated error (QA retest #5)', async () => {
  mockGetCurrent.mockResolvedValueOnce(null); // mount (no prompt)
  mockGetCurrent.mockResolvedValueOnce(null); // the button: no fix / timed out (location.ts gives up after 10 s)
  await render(<Harness />);
  await act(async () => {
    await fireEvent.press(screen.getByTestId('use-my-location'));
  });
  expect(mockGetCurrent).toHaveBeenLastCalledWith({ prompt: true });
  expect(screen.getByTestId('no-fix').props.children).toBe("Couldn't get your location. Check the location permission, or tap the map instead.");
  // the button is usable again (not stuck loading)
  expect(screen.getByTestId('use-my-location').props.accessibilityState?.busy).not.toBe(true);
});
