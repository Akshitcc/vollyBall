/**
 * 1.4.11 UI (QA V1410-4): in Custom a clashing player is left out of the "will play" count. (Header from 1.4.10 UI (QA V149): V149-4 (the "N players from Team will play" line counts the players who play), V149-5 (the
 * Void question carries the score), V149-3 (the repair card: a captain choice for an older match whose captain plays
 * for the other team, and an honest hint). Header copied from ui149 (1.4.9 UI (QA V148)): V148-6 (a player in both squads is caught at team selection: inline error kept in view, Next
 * disabled; the summary counts the players actually picked), V148-7 (messages reveal themselves), V148-5 (Void asks
 * first, EN/HI), V148-8 (HI: the admin's "Confirm abandon" ≠ the scorer's "Abandon"), V148-3 (scorer-only repair
 * hint) and V148-4 (current zone city names).
 */
import { act, fireEvent, render, screen, within } from '@testing-library/react-native';
import React from 'react';
import { BackHandler, StyleSheet, Text } from 'react-native';
import i18n from '../../i18n';
import { canOpenStep, maxReachableStep, previousStep, teamsProblem } from '../../core/newMatchFlow';
import { MIN_PLAYERS } from '../../core/roster';

const mockInsets = { top: 0, bottom: 0, left: 0, right: 0 };
jest.mock('react-native-safe-area-context', () => {
  const { View } = require('react-native');
  return { SafeAreaView: View, SafeAreaProvider: View, useSafeAreaInsets: () => mockInsets };
});
jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null, MaterialCommunityIcons: () => null }));
jest.mock('react-native-webview', () => ({ WebView: () => null }));
jest.mock('expo-image', () => ({ Image: () => null }));
jest.mock('react-native-maps', () => ({ __esModule: true, default: () => null, Marker: () => null, Circle: () => null }));
// The header options the screen sets are rendered, so the header arrow and "Step n of 3" can be tested.
jest.mock('expo-router', () => {
  const React = require('react');
  return {
    router: { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: () => true },
    useLocalSearchParams: () => ({}),
    Stack: { Screen: ({ options }: { options?: { headerLeft?: (p: object) => React.ReactNode; headerRight?: () => React.ReactNode } }) => React.createElement(React.Fragment, null, options?.headerLeft?.({}), options?.headerRight?.()) },
  };
});
jest.mock('expo-router/react-navigation', () => {
  const React = require('react');
  const { Pressable } = require('react-native');
  return { HeaderBackButton: ({ onPress, testID }: { onPress: () => void; testID?: string }) => React.createElement(Pressable, { onPress, testID }) };
});
jest.mock('../../state/AuthContext', () => ({
  useAuth: () => ({ isAdmin: false, termsOk: true }),
  useMe: () => ({ id: 'a1', name: 'Aarav', phone: '+919876543210', photoURL: null, city: '' }),
}));
jest.mock('../LocationPicker', () => ({ LocationPicker: () => null, placeReady: () => true }));

const team = (id: string, name: string, color: string, prefix: string, n: number) => ({
  id,
  name,
  nameLower: name.toLowerCase(),
  color,
  captainId: `${prefix}1`,
  memberIds: Array.from({ length: n }, (_, i) => `${prefix}${i + 1}`),
  subIds: [],
  pendingPhones: [],
  createdAt: 1,
});
const mockTeams = [team('tA', 'Delhi Smashers', '#D93636', 'a', 6), team('tB', 'Sand Kings', '#001F4D', 'b', 6), { ...team('tX', 'Shared Seven', '#0F7B6C', 'x', 7), memberIds: ['x1', 'x2', 'x3', 'x4', 'x5', 'a2', 'x7'] }, team('tS', 'Big Seven', '#7B3F0F', 's', 7)];
const mockBackend = {
  watchMyTeams: jest.fn((_u: string, cb: (t: unknown[]) => void) => (cb(mockTeams), () => {})),
  searchTeams: jest.fn(async () => [] as unknown[]),
  listCourts: jest.fn(async () => []),
  findUserByPhone: jest.fn(async () => null),
  getProfiles: jest.fn(async (ids: string[]) => ids.map((id) => ({ id, name: `P-${id}`, photoURL: null }))),
  createMatch: jest.fn(async (_m: unknown) => 'M1'),
};
jest.mock('../../services/backend', () => ({ get backend() { return mockBackend; } }));
jest.mock('../../services/backend/demoBackend', () => ({ DemoBackend: class {} }));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const NewMatch = require('../../app/match/new').default as React.ComponentType;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { router } = require('expo-router') as { router: { replace: jest.Mock } };
import { SafeFooter, bottomPadding } from '../SafeFooter';
import { KeyboardAwareScreen } from '../KeyboardAwareScreen';
import { Screen } from '../ui';

import { AdminReviewButtons, reviewScoreText } from '../ResultBadge';
import { VerdictRepairCard, resetRepairedForTests } from '../VerdictRepairCard';
afterEach(() => resetRepairedForTests());
import { presetRules } from '../../core/rules';
import type { Match } from '../../core/types';
import en from '../../i18n/locales/en';
import hi from '../../i18n/locales/hi';

const mockConfirm = jest.fn(async (_m: string, _o?: unknown) => true);
jest.mock('../../services/dialogs', () => ({ ...jest.requireActual('../../services/dialogs'), confirmAsk: (m: string, o?: unknown) => mockConfirm(m, o) }));

beforeEach(() => jest.clearAllMocks());
afterEach(async () => {
  await i18n.changeLanguage('en');
});
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });


describe('V1410-4: Custom – a player in both squads is not counted as playing', () => {
  it.each(['en', 'hi'])('Delhi Smashers vs Shared Seven in Custom: 6 and 6, not 6 and 7 (%s)', async (lang) => {
    await i18n.changeLanguage(lang);
    await render(<NewMatch />);
    await fireEvent.press(screen.getByTestId('team-size-custom'));
    await fireEvent.press(within(screen.getByTestId('side-a')).getByText('Delhi Smashers'));
    await fireEvent.press(within(screen.getByTestId('side-b')).getByText('Shared Seven'));
    await flush();
    expect(screen.getByTestId('both-teams-error-text')).toBeTruthy();
    expect(screen.queryByText(i18n.t('newMatch.fromTeam', { count: 7, team: 'Shared Seven' }))).toBeNull();
    expect(screen.getByText(i18n.t('newMatch.fromTeam', { count: 6, team: 'Shared Seven' }))).toBeTruthy();
    expect(screen.getByText(i18n.t('newMatch.fromTeam', { count: 5, team: 'Delhi Smashers' }))).toBeTruthy();
  });
});
