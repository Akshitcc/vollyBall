/**
 * Build 1.2.1 redesign ("Navy Live") behaviour:
 *  - home: every quick action has its own destination (Teams ≠ Photos, Tester 1.2.0), loading
 *    skeleton and the "No live matches nearby" empty state with a CTA;
 *  - new match: colour swatches under 3:1 against the other team are disabled;
 *  - OTP: formatted number "+91 98765 43210", 6 boxes, 30 s resend countdown;
 *  - LIVE camera pill on phones, "Add photo" outline pill on web;
 *  - Reduce Motion: PressableScale fades instead of scaling;
 *  - rankings: podium for the top 3, empty state, sticky "You" bar;
 *  - profile shows the formatted phone number.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import React from 'react';
import { Platform, StyleSheet, Text } from 'react-native';
import i18n from '../../i18n';

jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null, MaterialCommunityIcons: () => null }));
jest.mock('react-native-webview', () => ({ WebView: () => null }));
jest.mock('expo-router', () => ({ router: { push: jest.fn(), replace: jest.fn(), back: jest.fn() }, useLocalSearchParams: () => ({}), Stack: { Screen: () => null } }));
jest.mock('react-native-safe-area-context', () => {
  const { View } = require('react-native');
  return { SafeAreaView: View, SafeAreaProvider: View, useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) };
});
jest.mock('../../state/AuthContext', () => ({ useAuth: () => ({ isAdmin: false, termsOk: true }), useMe: () => ({ id: 'me', name: 'Aarav Sharma', phone: '+919876543210', photoURL: null, position: 'setter', city: '' }) }));
let mockLive: unknown[] | undefined = [];
let mockRankings: unknown = null;
const mockSendOtp = jest.fn(async () => ({ confirm: jest.fn(async () => undefined) }));
jest.mock('../../services/backend', () => ({
  backend: {
    watchMyTeams: (_: string, cb: (v: unknown[]) => void) => (cb([]), () => {}),
    watchTeamInvites: (_: string, cb: (v: unknown[]) => void) => (cb([]), () => {}),
    watchChallenges: (_: string[], cb: (v: unknown[]) => void) => (cb([]), () => {}),
    watchLiveMatches: (cb: (v: unknown[]) => void) => (mockLive && cb(mockLive), () => {}),
    watchMyMatches: (_: string, cb: (v: unknown[]) => void) => (cb([]), () => {}),
    getRankings: () => Promise.resolve(mockRankings),
    listMemories: () => Promise.resolve([]),
    sendOtp: () => mockSendOtp(),
  },
}));
jest.mock('../../services/backend/demoBackend', () => ({ DemoBackend: class {} }));

const { router } = jest.requireMock('expo-router') as { router: { push: jest.Mock } };

beforeEach(async () => {
  await AsyncStorage.clear();
  await i18n.changeLanguage('en');
  jest.clearAllMocks();
  mockLive = [];
  mockRankings = null;
});
afterAll(async () => {
  await i18n.changeLanguage('en');
});

describe('home', () => {
  const Home = require('../../app/(tabs)/index').default;
  it('8 quick actions; Teams and Photos (Memories) open different screens', async () => {
    await render(<Home />);
    await act(async () => {});
    await fireEvent.press(screen.getByTestId('qa-teams'));
    await fireEvent.press(screen.getByTestId('qa-photos'));
    expect(router.push.mock.calls.map((c) => c[0])).toEqual(['/teams', '/memories']);
    for (const id of ['new-match', 'challenge', 'live', 'tournaments', 'rankings', 'teams', 'nearby', 'photos']) expect(screen.getByTestId(`qa-${id}`)).toBeTruthy();
    const dests = new Set<string>();
    for (const id of ['new-match', 'tournaments', 'rankings', 'teams', 'nearby', 'photos']) {
      router.push.mockClear();
      await fireEvent.press(screen.getByTestId(`qa-${id}`));
      dests.add(String(router.push.mock.calls[0][0]));
    }
    expect(dests.size).toBe(6);
  });
  it('no live matches: empty state with a Start a match CTA; loading shows skeletons', async () => {
    await render(<Home />);
    await act(async () => {});
    expect(screen.getByText('No live matches nearby')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('home-no-live-cta'));
    expect(router.push).toHaveBeenCalledWith('/match/new');
    mockLive = undefined;
    await render(<Home />);
    expect(screen.getByTestId('home-loading')).toBeTruthy();
  });
});

describe('new match colour swatches', () => {
  const { TeamBuilder } = require('../TeamBuilder');
  it('colours under 3:1 against the other team are disabled; the chosen one stays enabled', async () => {
    const onChange = jest.fn();
    await render(<TeamBuilder value={{ kind: 'build', name: '', color: '#001F4D', players: [] }} onChange={onChange} otherPlayerIds={[]} otherColor="#D93636" testID="tb" />);
    expect(screen.getByTestId('swatch-tb-FF6B00').props.accessibilityState).toMatchObject({ disabled: true }); // orange vs red
    expect(screen.getByTestId('swatch-tb-D93636').props.accessibilityState).toMatchObject({ disabled: true }); // same colour
    expect(screen.getByTestId('swatch-tb-001F4D').props.accessibilityState).toMatchObject({ selected: true, disabled: false });
    await fireEvent.press(screen.getByTestId('swatch-tb-FF6B00'));
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe('OTP screen', () => {
  const Login = require('../../app/login').default;
  it('shows the number as "+91 98765 43210", six boxes and a 30 s resend countdown', async () => {
    await render(<Login />);
    await fireEvent.changeText(screen.getByTestId('phone-input'), '9876543210');
    await act(async () => {
      fireEvent.press(screen.getByTestId('send-otp'));
    });
    expect(await screen.findByTestId('otp-input')).toBeTruthy();
    expect(screen.getByText(/Sent to \+91 98765 43210/)).toBeTruthy();
    for (let i = 0; i < 6; i++) expect(screen.getByTestId(`otp-box-${i}`)).toBeTruthy();
    await fireEvent.changeText(screen.getByTestId('otp-input'), '12 3');
    expect(screen.getByTestId('otp-box-2').props.children.props.children).toBe('3');
    expect(screen.getByText(/Resend in 0:(30|29)/)).toBeTruthy();
    expect(screen.queryByTestId('otp-resend')).toBeNull();
    await fireEvent.press(screen.getByTestId('otp-change'));
    expect(screen.getByTestId('phone-input')).toBeTruthy();
  });
});

describe('LIVE camera pill', () => {
  const { LiveCameraButton } = require('../MatchCamera');
  const restore = Platform.OS;
  afterEach(() => ((Platform as { OS: string }).OS = restore));
  it('phone: red LIVE pill; web: "Add photo" outline pill (no camera)', async () => {
    (Platform as { OS: string }).OS = 'android';
    await render(<LiveCameraButton matchId="m1" uid="me" pill />);
    expect(screen.getByText('LIVE')).toBeTruthy();
    expect(screen.getByTestId('live-camera').props.accessibilityLabel).toMatch(/photo/i);
    (Platform as { OS: string }).OS = 'web';
    await render(<LiveCameraButton matchId="m1" uid="me" pill />);
    expect(screen.queryByText('LIVE')).toBeNull();
    expect(screen.getByText('Add photo')).toBeTruthy();
  });
});

describe('Reduce Motion', () => {
  const { PressableScale } = require('../PressableScale');
  const { _setReduceMotion } = require('../../hooks/useReduceMotion');
  afterEach(() => act(() => _setReduceMotion(false)));
  it('PressableScale scales normally and only fades with Reduce Motion on', async () => {
    await render(
      <PressableScale testID="p">
        <Text>x</Text>
      </PressableScale>,
    );
    const st = () => StyleSheet.flatten(screen.getByTestId('p').props.style) as Record<string, unknown>;
    expect(st().transform).toBeTruthy();
    await act(async () => _setReduceMotion(true));
    expect(st().transform).toBeUndefined();
    expect(st().opacity).toBe(1);
  });
});

describe('rankings redesign', () => {
  const Rankings = require('../../app/rankings').default;
  const row = (playerId: string, rank: number | null, pts: number, extra = {}) => ({ playerId, name: `${playerId} Name`, matches: 4, wins: 3, points: 20, potm: 1, rankingPoints: pts, winPct: 75, rank, ...extra });
  it('podium for the top 3, list from #4, sticky You bar while you are unranked', async () => {
    mockRankings = { ranked: [row('x', 1, 90), row('y', 2, 80), row('z', 3, 70), row('w', 4, 60)], total: 4, minMatches: 3, me: row('me', null, 12, { matches: 1 }) };
    await render(<Rankings />);
    await act(async () => {});
    expect(screen.getByTestId('podium')).toBeTruthy();
    expect(screen.getByTestId('ranking-1').props.accessibilityLabel).toMatch(/^#1 x Name/);
    expect(screen.getByTestId('ranking-4')).toBeTruthy();
    expect(screen.getByTestId('rankings-you-bar')).toBeTruthy();
    expect(screen.getByText('Play 2 more finished matches to get ranked.')).toBeTruthy();
  });
  it('nobody ranked: "The podium is waiting" with a Start a match CTA', async () => {
    mockRankings = { ranked: [], total: 0, minMatches: 3, me: row('me', null, 0, { matches: 1 }) };
    await render(<Rankings />);
    await act(async () => {});
    expect(screen.getByText('The podium is waiting')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('rankings-empty-cta'));
    expect(router.push).toHaveBeenCalledWith('/match/new');
  });
});

describe('profile', () => {
  const Profile = require('../../app/(tabs)/profile').default;
  it('shows the phone number formatted, storage stays E.164', async () => {
    await render(<Profile />);
    await act(async () => {});
    expect(screen.getByTestId('profile-phone').props.children).toBe('+91 98765 43210');
  });
});
