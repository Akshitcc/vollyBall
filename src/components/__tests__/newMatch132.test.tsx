/**
 * 1.3.2: New match as a real 3-step flow (Teams → Rules → Start, mockup 05) and safe-area footers
 * (Akshit: the New match footer text sat under the Android nav bar).
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
const mockTeams = [team('tA', 'Delhi Smashers', '#D93636', 'a', 6), team('tB', 'Sand Kings', '#001F4D', 'b', 6), team('tS', 'Small Five', '#0F7B6C', 's', 5)];
const mockBackend = {
  watchMyTeams: jest.fn((_u: string, cb: (t: unknown[]) => void) => (cb(mockTeams), () => {})),
  searchTeams: jest.fn(async () => [] as unknown[]),
  listCourts: jest.fn(async () => []),
  findUserByPhone: jest.fn(async () => null),
  getProfiles: jest.fn(async (ids: string[]) => ids.map((id) => ({ id, name: `P-${id}`, photoURL: null }))),
  createMatch: jest.fn(async (_m: unknown) => 'M1'),
};
jest.mock('../../services/backend', () => ({ backend: mockBackend }));
jest.mock('../../services/backend/demoBackend', () => ({ DemoBackend: class {} }));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const NewMatch = require('../../app/match/new').default as React.ComponentType;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { router } = require('expo-router') as { router: { replace: jest.Mock } };
import { SafeFooter, bottomPadding } from '../SafeFooter';
import { KeyboardAwareScreen } from '../KeyboardAwareScreen';
import { Screen } from '../ui';

const H = { includeHiddenElements: true } as const;
const shown = (id: string) => StyleSheet.flatten(screen.getByTestId(id, H).props.style)?.display !== 'none';
const currentStep = () => ['teams', 'rules', 'start'].findIndex((s) => shown(`new-match-step-${s}`));
const a11y = (id: string) => screen.getByTestId(id, H).props.accessibilityState;
let hardwareBack: (() => boolean) | null = null;

beforeEach(() => {
  jest.clearAllMocks();
  mockInsets.bottom = 0;
  hardwareBack = null;
  jest.spyOn(BackHandler, 'addEventListener').mockImplementation((_e, h) => {
    hardwareBack = h as () => boolean;
    return { remove: jest.fn() } as unknown as ReturnType<typeof BackHandler.addEventListener>;
  });
});
afterEach(async () => {
  await i18n.changeLanguage('en');
});

const pickTeams = async (bName = 'Sand Kings') => {
  await fireEvent.press(within(screen.getByTestId('side-a')).getByText('Delhi Smashers'));
  // Team B starts collapsed ("Tap to set up") and opens once Team A is complete.
  await fireEvent.press(within(screen.getByTestId('side-b')).getByText(bName));
};

describe('core: newMatchFlow', () => {
  const side = (players: number, o: object = {}) => ({ kind: 'team' as const, teamId: `t${players}${JSON.stringify(o)}`, name: 'X', players, ...o });
  it('the first thing blocking Next: Rules, side A before side B', () => {
    expect(teamsProblem(null, null)).toEqual({ code: 'pickBoth' });
    expect(teamsProblem(side(5), side(6))).toEqual({ code: 'needPlayers', side: 'A', missing: 1 });
    expect(teamsProblem(side(6), side(2))).toEqual({ code: 'needPlayers', side: 'B', missing: MIN_PLAYERS - 2 });
    expect(teamsProblem({ kind: 'build', name: ' ', players: 6, captain: 'x' }, side(6))).toEqual({ code: 'nameRequired', side: 'A' });
    expect(teamsProblem(side(6), { kind: 'build', name: 'B', players: 6, captain: null })).toEqual({ code: 'captainRequired', side: 'B' });
    expect(teamsProblem({ kind: 'team', teamId: 't', name: 'T', players: 6 }, { kind: 'team', teamId: 't', name: 'T', players: 6 })).toEqual({ code: 'sameTeams' });
    expect(teamsProblem(side(6), { kind: 'build', name: 'B', players: 12, captain: 'b1' })).toBeNull();
  });
  it('tabs: back always, forward only past complete steps; back goes one step', () => {
    expect([0, 1, 2].map((s) => canOpenStep(s as 0, false))).toEqual([true, false, false]);
    expect([0, 1, 2].map((s) => canOpenStep(s as 0, true))).toEqual([true, true, true]);
    expect([0, 1, 2].map((s) => canOpenStep(s as 0, true, false))).toEqual([true, true, false]);
    expect(maxReachableStep(true, false)).toBe(1);
    expect([previousStep(0), previousStep(1), previousStep(2)]).toEqual([null, 0, 1]);
  });
});

describe('navigation gating (Teams step)', () => {
  it('Next: Rules is disabled with a hint until both teams have 6 players; later tabs are disabled', async () => {
    await render(<NewMatch />);
    expect(currentStep()).toBe(0);
    expect(screen.getByTestId('new-match-step-of').props.children).toBe('Step 1 of 3');
    const next = screen.getByTestId('next-rules');
    expect(next.props.accessibilityState).toMatchObject({ disabled: true });
    expect(screen.getByText('Next: Rules · needs 6 per team →')).toBeTruthy();
    expect(screen.getByTestId('next-rules-hint').props.children).toBe('Pick or build Team A and Team B to continue.');
    expect(a11y('step-tab-0')).toEqual({ selected: true, disabled: false });
    expect(a11y('step-tab-1')).toEqual({ selected: false, disabled: true });
    expect(a11y('step-tab-2')).toEqual({ selected: false, disabled: true });
    expect(screen.getByTestId('step-tab-1', H).props.accessibilityHint).toBe('Finish the Teams step first');
    // Tapping a locked tab or the disabled button does nothing.
    await fireEvent.press(screen.getByTestId('step-tab-2', H));
    await fireEvent.press(next);
    expect(currentStep()).toBe(0);
    // Team B starts collapsed.
    expect(within(screen.getByTestId('side-b')).getByText('Tap to set up')).toBeTruthy();

    // Team A ready, Team B with only 5 players: still locked, and the hint says why.
    await pickTeams('Small Five');
    expect(screen.getByTestId('next-rules').props.accessibilityState).toMatchObject({ disabled: true });
    expect(screen.getByTestId('next-rules-hint').props.children).toBe('Team B needs 1 more player (6 per team to start).');
    expect(a11y('step-tab-1')).toMatchObject({ disabled: true });

    // Both teams ready: unlocked.
    await fireEvent.press(within(screen.getByTestId('side-b')).getByText('Sand Kings'));
    expect(screen.getByTestId('next-rules').props.accessibilityState).toMatchObject({ disabled: false });
    expect(screen.getByText('Next: Rules →')).toBeTruthy();
    expect(screen.queryByTestId('next-rules-hint')).toBeNull();
    expect(a11y('step-tab-1')).toEqual({ selected: false, disabled: false });
    expect(a11y('step-tab-2')).toEqual({ selected: false, disabled: false });
    await fireEvent.press(screen.getByTestId('next-rules'));
    expect(currentStep()).toBe(1);
    expect(screen.getByTestId('new-match-step-of').props.children).toBe('Step 2 of 3');
    expect(a11y('step-tab-1')).toEqual({ selected: true, disabled: false });
  });

  it('Hindi: the disabled button and its hint are translated', async () => {
    await i18n.changeLanguage('hi');
    await render(<NewMatch />);
    expect(screen.getByText('आगे: नियम · हर टीम में 6 चाहिए →')).toBeTruthy();
    expect(screen.getByTestId('next-rules-hint').props.children).toBe('आगे बढ़ने के लिए टीम A और टीम B चुनें या बनाएँ।');
    expect(screen.getByTestId('new-match-step-of').props.children).toBe('चरण 1 / 3');
    expect(screen.getByTestId('step-tab-1', H).props.accessibilityHint).toBe('पहले टीमें वाला चरण पूरा करें');
  });
});

describe('back keeps state', () => {
  it('Back button, header arrow, Android back and the tabs move between steps without losing anything', async () => {
    await render(<NewMatch />);
    await pickTeams();
    await fireEvent.press(screen.getByTestId('next-rules'));
    await fireEvent.changeText(screen.getByTestId('match-title'), 'Sunday decider');
    await fireEvent.press(screen.getByTestId('first-serve-B'));
    await fireEvent.press(screen.getByTestId('next-start'));
    expect(currentStep()).toBe(2);
    expect(within(screen.getByTestId('summary-when')).getByText('Now · Sunday decider')).toBeTruthy();
    expect(within(screen.getByTestId('summary-rules')).getByText('First serve: Team B')).toBeTruthy();

    // Footer Back → Rules: the title is still there.
    await fireEvent.press(screen.getByTestId('step-back'));
    expect(currentStep()).toBe(1);
    expect(screen.getByTestId('match-title').props.value).toBe('Sunday decider');
    // Header arrow → Teams (does not leave the screen).
    await fireEvent.press(screen.getByTestId('header-back'));
    expect(currentStep()).toBe(0);
    expect(router.replace).not.toHaveBeenCalled();
    expect(within(screen.getByTestId('side-a')).getByText('Delhi Smashers · 6 players')).toBeTruthy();
    expect(within(screen.getByTestId('side-b')).getByText('Sand Kings · 6 players')).toBeTruthy();
    // Tab straight to Start (both earlier steps complete): everything is kept.
    await fireEvent.press(screen.getByTestId('step-tab-2', H));
    expect(currentStep()).toBe(2);
    expect(within(screen.getByTestId('summary-when')).getByText('Now · Sunday decider')).toBeTruthy();
    // Android back: previous step, consumed; at the Teams step it is left to the navigator.
    let handled = false;
    await act(async () => void (handled = hardwareBack!()));
    expect(handled).toBe(true);
    expect(currentStep()).toBe(1);
    await act(async () => void (handled = hardwareBack!()));
    expect(handled).toBe(true);
    expect(currentStep()).toBe(0);
    await act(async () => void (handled = hardwareBack!()));
    expect(handled).toBe(false);
    expect(within(screen.getByTestId('side-a')).getByText('Delhi Smashers · 6 players')).toBeTruthy();
  });
});

describe('start creates the match', () => {
  it('the Start step summarises teams, rules, court and scorer; Start match creates it and opens live scoring', async () => {
    await render(<NewMatch />);
    await pickTeams();
    await fireEvent.press(screen.getByTestId('next-rules'));
    await fireEvent.press(screen.getByTestId('next-start'));
    const teams = screen.getByTestId('summary-teams');
    expect(within(teams).getByText('Delhi Smashers')).toBeTruthy();
    expect(within(teams).getByText('Sand Kings')).toBeTruthy();
    expect(within(screen.getByTestId('summary-court')).getByText('No court set')).toBeTruthy();
    expect(within(screen.getByTestId('summary-scorer')).getByText('You (Aarav)')).toBeTruthy();
    expect(within(screen.getByTestId('summary-rules')).getByText(/25/)).toBeTruthy();
    await act(async () => {
      await fireEvent.press(screen.getByTestId('create-match'));
    });
    expect(mockBackend.createMatch).toHaveBeenCalledTimes(1);
    const m = mockBackend.createMatch.mock.calls[0][0] as { teamA: { name: string; players: unknown[] }; teamB: { name: string; players: unknown[] }; scorerId: string; captains: object; status: string };
    expect(m.teamA.name).toBe('Delhi Smashers');
    expect(m.teamB.name).toBe('Sand Kings');
    expect(m.teamA.players).toHaveLength(6);
    expect(m.teamB.players).toHaveLength(6);
    expect(m.scorerId).toBe('a1');
    expect(m.captains).toEqual({ A: 'a1', B: 'b1' });
    expect(router.replace).toHaveBeenCalledWith('/match/M1/score');
  });
  it('a "Change" link on the summary jumps back to that step', async () => {
    await render(<NewMatch />);
    await pickTeams();
    await fireEvent.press(screen.getByTestId('step-tab-2', H));
    await fireEvent.press(screen.getByTestId('summary-court-change'));
    expect(currentStep()).toBe(1);
  });
});

describe('safe-area padding', () => {
  it('SafeFooter adds the bottom inset (Android nav bar) to its own padding', async () => {
    expect(bottomPadding(0)).toBe(12);
    expect(bottomPadding(48)).toBe(60);
    expect(bottomPadding(-3)).toBe(12);
    mockInsets.bottom = 48;
    await render(<SafeFooter><Text>x</Text></SafeFooter>);
    expect(StyleSheet.flatten(screen.getByTestId('safe-footer').props.style).paddingBottom).toBe(60);
  });
  it('the New match footer clears the nav bar', async () => {
    mockInsets.bottom = 48;
    await render(<NewMatch />);
    expect(StyleSheet.flatten(screen.getByTestId('new-match-footer').props.style).paddingBottom).toBe(60);
    // The footer sits below the scroll area, not over it.
    const scroll = screen.getByTestId('keyboard-aware-screen-scroll');
    expect(StyleSheet.flatten(scroll.props.contentContainerStyle).paddingBottom).toBe(40);
  });
  it('screens without a footer pad their scroll content by the inset (KeyboardAwareScreen and Screen)', async () => {
    mockInsets.bottom = 30;
    await render(<KeyboardAwareScreen edges={[]}><Text>x</Text></KeyboardAwareScreen>);
    expect(StyleSheet.flatten(screen.getByTestId('keyboard-aware-screen-scroll').props.contentContainerStyle).paddingBottom).toBe(40 + 30);
    await render(<KeyboardAwareScreen edges={['top', 'bottom']}><Text>x</Text></KeyboardAwareScreen>);
    expect(StyleSheet.flatten(screen.getByTestId('keyboard-aware-screen-scroll').props.contentContainerStyle).paddingBottom).toBe(40);
    await render(<Screen edges={[]}><Text>x</Text></Screen>);
    expect(StyleSheet.flatten(screen.getByTestId('screen-scroll').props.contentContainerStyle).paddingBottom).toBe(40 + 30);
    await render(<Screen><Text>x</Text></Screen>);
    expect(StyleSheet.flatten(screen.getByTestId('screen-scroll').props.contentContainerStyle).paddingBottom).toBe(40 + 30);
    await render(<Screen edges={['bottom']}><Text>x</Text></Screen>);
    expect(StyleSheet.flatten(screen.getByTestId('screen-scroll').props.contentContainerStyle).paddingBottom).toBe(40);
  });
});
