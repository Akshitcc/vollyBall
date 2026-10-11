/**
 * 1.3.2 /match/[id] viewer (design-spec §11.6): big navy scoreboard with the sets count and a Serving
 * pill, pulsing LIVE, last rally, read-only court chips with each player's live points, recent rallies,
 * 48 dp tabs, Gallery (+ Camera on phones only) next to the photos, and the safe-area bottom padding.
 */
import { act, fireEvent, render, screen, within } from '@testing-library/react-native';
import React from 'react';
import { StyleSheet } from 'react-native';
import { INDOOR_RULES } from '../../core/rules';
import type { Match } from '../../core/types';
import i18n from '../../i18n';
import MatchScreen from '../../app/match/[id]/index';
import { PhotoSheet } from '../PhotoSheet';

let mockInsets = { top: 0, bottom: 0, left: 0, right: 0 };
jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null, MaterialCommunityIcons: () => null }));
jest.mock('expo-image', () => ({ Image: () => null }));
jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ id: 'm1' }),
  router: { replace: jest.fn(), back: jest.fn(), canGoBack: () => true, push: jest.fn() },
  Stack: { Screen: () => null },
  Link: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock('react-native-safe-area-context', () => {
  const { View } = require('react-native');
  return { SafeAreaView: View, SafeAreaProvider: View, useSafeAreaInsets: () => mockInsets };
});
jest.mock('../../state/AuthContext', () => ({ useAuth: () => ({ isAdmin: false, termsOk: true, user: { uid: 'b1' } }), useMe: () => ({ id: 'b1', name: 'B1' }) }));
jest.mock('../../state/profiles', () => ({ useProfiles: () => ({}), useProfile: () => null }));

const players = (p: string) => Array.from({ length: 6 }, (_, i) => ({ id: `${p}${i + 1}`, name: `${p.toUpperCase()}${i + 1} Surname`, photoURL: null }));
let mockMatch: Match;
jest.mock('../../services/backend', () => ({
  backend: {
    watchMatch: (_id: string, cb: (m: Match) => void) => {
      setTimeout(() => cb(mockMatch), 0);
      return () => {};
    },
    watchPhotos: (_id: string, cb: (p: unknown[]) => void) => {
      setTimeout(() => cb([]), 0);
      return () => {};
    },
    saveMatchProgress: jest.fn(async () => {}),
    updateMatch: jest.fn(async () => {}),
  },
}));
const pt = (side: 'A' | 'B', at: number, playerId?: string) => ({ type: 'point' as const, side, at, ...(playerId ? { playerId } : {}) });
const make = (events: Match['events']): Match =>
  ({
    id: 'm1',
    teamA: { teamId: null, name: 'Delhi Spikers', color: '#D93636', players: players('a') },
    teamB: { teamId: null, name: 'Mumbai Blockers', color: '#001F4D', players: players('b') },
    rules: { ...INDOOR_RULES, bestOf: 3, pointsPerSet: 25, winBy: 2 },
    firstServe: 'A',
    events,
    status: 'live',
    createdBy: 'a1',
    scorerId: 'a1',
    participantIds: [...players('a'), ...players('b')].map((p) => p.id),
    startedAt: Date.now() - 600_000,
    finishedAt: null,
    updatedAt: Date.now(),
    createdAt: 1,
    lineups: null,
  }) as unknown as Match;

async function open(events: Match['events']) {
  mockMatch = make(events);
  await render(<MatchScreen />);
  await act(async () => {
    await jest.advanceTimersByTimeAsync(5);
  });
}
const text = (id: string) => {
  const c = screen.getByTestId(id).props.children;
  return Array.isArray(c) ? c.join('') : String(c);
};
jest.setTimeout(15_000);
beforeEach(() => {
  jest.useFakeTimers();
  mockInsets = { top: 0, bottom: 0, left: 0, right: 0 };
});
afterEach(async () => {
  await act(async () => {
    await i18n.changeLanguage('en');
  });
  jest.useRealTimers();
});

test('scoreboard, serving pill, LIVE, last rally, read-only chip counts and recent rallies', async () => {
  const now = Date.now();
  await open([pt('A', now - 9000, 'a2'), pt('B', now - 5000, 'b3'), pt('B', now - 1000)]);
  expect(screen.getByTestId('live-scoreboard')).toBeTruthy();
  expect(text('viewer-score-A')).toBe('1');
  expect(text('viewer-score-B')).toBe('2');
  expect(screen.getByTestId('serving-B')).toBeTruthy();
  expect(screen.queryByTestId('serving-A')).toBeNull();
  expect(screen.getByTestId('live-pill')).toBeTruthy();
  expect(screen.getByTestId('viewer-ticker')).toBeTruthy();
  const court = screen.getByTestId('viewer-court');
  expect([].concat(within(court).getByTestId('court-pts-a2').props.children).join('')).toMatch(/^1/);
  expect([].concat(within(court).getByTestId('court-pts-b3').props.children).join('')).toMatch(/^1/);
  // read-only: no chip is a button
  expect(within(court).getByTestId('court-tile-b3').props.accessibilityRole).toBe('text');
  expect(screen.getByTestId('recent-rallies')).toBeTruthy();
});

test('tabs are 48 dp; the photos tab offers Gallery (Camera only on phones)', async () => {
  await open([pt('A', 1, 'a1')]);
  for (const tab of screen.getAllByTestId(/^match-tab-/)) expect(StyleSheet.flatten(tab.props.style).minHeight).toBeGreaterThanOrEqual(48);
  await fireEvent.press(screen.getByTestId('match-tab-photos'));
  expect(screen.getByTestId('add-photo-gallery')).toBeTruthy();
  expect(screen.getByTestId('add-photo-camera')).toBeTruthy(); // jest-expo runs as iOS: a phone
});

test('the page scroll pads the bottom by the nav inset', async () => {
  mockInsets = { top: 24, bottom: 48, left: 0, right: 0 };
  await open([]);
  const st = StyleSheet.flatten(screen.getByTestId('screen-scroll').props.contentContainerStyle);
  expect(st.paddingBottom).toBeGreaterThanOrEqual(48);
});

test('works in Hindi', async () => {
  await act(async () => {
    await i18n.changeLanguage('hi');
  });
  await open([pt('A', Date.now() - 1000, 'a2')]);
  expect(i18n.t('viewer.serving')).toMatch(/[\u0900-\u097F]/);
  expect(screen.getAllByText(new RegExp(i18n.t('viewer.serving'))).length).toBeGreaterThan(0);
});

test('photo sheet: Gallery tile always, Camera tile on phones only; the sheet clears the inset', async () => {
  mockInsets = { top: 0, bottom: 48, left: 0, right: 0 };
  await render(<PhotoSheet matchId="m1" uid="b1" visible onClose={() => {}} />);
  expect(screen.getByTestId('photo-sheet-gallery')).toBeTruthy();
  expect(screen.getByTestId('photo-sheet-camera')).toBeTruthy(); // iOS
  expect(StyleSheet.flatten(screen.getByTestId('photo-sheet').props.style).paddingBottom).toBe(64);
  await screen.unmount();
  const { Platform } = require('react-native');
  const os = Platform.OS;
  Platform.OS = 'web';
  try {
    await render(<PhotoSheet matchId="m1" uid="b1" visible onClose={() => {}} />);
    expect(screen.getByTestId('photo-sheet-gallery')).toBeTruthy();
    expect(screen.queryByTestId('photo-sheet-camera')).toBeNull();
  } finally {
    Platform.OS = os;
  }
});
