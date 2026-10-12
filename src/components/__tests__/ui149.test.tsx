/**
 * 1.4.9 UI (QA V148): V148-6 (a player in both squads is caught at team selection: inline error kept in view, Next
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

import { RevealOnShow, ScrollRevealContext } from '../KeyboardAwareScreen';
import { AdminReviewButtons } from '../ResultBadge';
import { zoneLabel, LEGACY_ZONES } from '../../i18n/format';
import en from '../../i18n/locales/en';
import hi from '../../i18n/locales/hi';

const mockConfirm = jest.fn(async (_m: string, _o?: unknown) => true);
jest.mock('../../services/dialogs', () => ({ ...jest.requireActual('../../services/dialogs'), confirmAsk: (m: string, o?: unknown) => mockConfirm(m, o) }));

beforeEach(() => jest.clearAllMocks());
afterEach(async () => {
  await i18n.changeLanguage('en');
});
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

describe('V148-6: a player in both squads', () => {
  it.each(['en', 'hi'])('inline error next to Team B, Next disabled with the reason (%s)', async (lang) => {
    await i18n.changeLanguage(lang);
    await render(<NewMatch />);
    await fireEvent.press(within(screen.getByTestId('side-a')).getByText('Delhi Smashers'));
    await fireEvent.press(within(screen.getByTestId('side-b')).getByText('Shared Seven'));
    await flush();
    const err = screen.getByTestId('both-teams-error-text');
    expect(err.props.children).toBe(i18n.t('newMatch.inBothTeams', { count: 1, names: 'P-a2' }));
    if (lang === 'hi') expect(err.props.children).toMatch(/दोनों टीमों/);
    expect(screen.getByTestId('next-rules').props.accessibilityState?.disabled).toBe(true);
    expect(screen.getByText(`${i18n.t('newMatch.nextRulesBoth')} →`)).toBeTruthy();
  });
  it('no error for two separate teams; the summary counts the 6 picked of a 7-player team (not 7)', async () => {
    await render(<NewMatch />);
    await fireEvent.press(within(screen.getByTestId('side-a')).getByText('Big Seven'));
    await fireEvent.press(within(screen.getByTestId('side-b')).getByText('Sand Kings'));
    await flush();
    expect(screen.queryByTestId('both-teams-error-text')).toBeNull();
    await fireEvent.press(screen.getByTestId('next-rules'));
    await fireEvent.press(screen.getByTestId('next-start'));
    expect(within(screen.getByTestId('summary-team-A')).getByText(/6 players/)).toBeTruthy();
    expect(within(screen.getByTestId('summary-team-A')).queryByText(/7 players/)).toBeNull();
  });
});

describe('V148-7: RevealOnShow', () => {
  it('reveals when shown and again when the message changes (also after the keyboard reveal)', async () => {
    jest.useFakeTimers();
    const reveal = jest.fn();
    const Ui = ({ msg }: { msg: string | null }) => (
      <ScrollRevealContext.Provider value={reveal}>
        <RevealOnShow show={!!msg} dep={msg} testID="r"><Text>{msg}</Text></RevealOnShow>
      </ScrollRevealContext.Provider>
    );
    const r = await render(<Ui msg={null} />);
    expect(screen.queryByTestId('r')).toBeNull();
    await r.rerender(<Ui msg="refused" />);
    await act(async () => { jest.advanceTimersByTime(500); });
    expect(reveal).toHaveBeenCalledTimes(2); // right away and once more after the keyboard's own reveal
    await r.rerender(<Ui msg="another" />);
    await act(async () => { jest.advanceTimersByTime(500); });
    expect(reveal).toHaveBeenCalledTimes(4);
    jest.useRealTimers();
  });
  it('the refusal, the lookup errors and new-match-error are wrapped', () => {
    const fs = require('fs');
    const path = require('path');
    const tb = fs.readFileSync(path.join(__dirname, '../TeamBuilder.tsx'), 'utf8');
    const nm = fs.readFileSync(path.join(__dirname, '../../app/match/new.tsx'), 'utf8');
    for (const id of ['-problem', '-lookup-error', '-not-registered']) expect(tb).toMatch(new RegExp(`<RevealOnShow[^>]*>\\s*<Text[^>]*testID=\\{\`\\$\\{testID\\}${id}\`\\}`));
    expect(nm).toMatch(/<RevealOnShow show=\{!!error\}[^>]*>\s*<Text[^>]*testID="new-match-error"/);
  });
});

describe('V148-5: Void asks first', () => {
  it.each(['en', 'hi'])('nothing happens until the admin confirms (%s)', async (lang) => {
    await i18n.changeLanguage(lang);
    const onVoid = jest.fn();
    await render(<AdminReviewButtons onApprove={jest.fn()} onVoid={onVoid} approveID="ap" voidID="vo" />);
    mockConfirm.mockResolvedValueOnce(false);
    await act(async () => { fireEvent.press(screen.getByTestId('vo')); });
    expect(mockConfirm).toHaveBeenCalledWith(i18n.t('verify.voidAsk'), expect.objectContaining({ confirmLabel: i18n.t('verify.voidShort') }));
    expect(onVoid).not.toHaveBeenCalled();
    await act(async () => { fireEvent.press(screen.getByTestId('vo')); });
    expect(onVoid).toHaveBeenCalledTimes(1);
  });
  it('the abandon panel asks with what happens, EN and HI', () => {
    const src = require('fs').readFileSync(require('path').join(__dirname, '../AbandonPanel.tsx'), 'utf8');
    expect(src).toMatch(/k === 'reinstate' \|\| k === 'confirm_abandon' \|\| k === 'void'/);
    expect(en.abandon.confirm.void).toMatch(/never counts/);
    expect(hi.abandon.confirm.void).toMatch(/अमान्य/);
    expect(hi.verify.voidAsk).toMatch(/अमान्य/);
  });
});

describe('V148-8 / V148-3: wording', () => {
  it('HI: the admin\'s Confirm abandon differs from the scorer\'s Abandon, same छोड़ family, no क्का', () => {
    const scorer = (hi as unknown as { score: Record<string, string> }).score;
    const scorerAbandon = Object.values(scorer ?? {}).filter((v) => typeof v === 'string' && v === 'मैच छोड़ें');
    expect(hi.abandon.actions.confirm_abandon).toBe('छोड़ना स्वीकार करें');
    expect(hi.abandon.actions.confirm_abandon).not.toBe('मैच छोड़ें');
    expect(scorerAbandon.every((v) => v !== hi.abandon.actions.confirm_abandon)).toBe(true);
    expect(JSON.stringify(hi.abandon)).not.toMatch(/क्का/);
  });
  it('the repair hint names only the scorer choice (EN/HI)', () => {
    expect(en.abandon.repairHint).not.toMatch(/captain who will confirm/);
    expect(en.abandon.repairHint).toMatch(/scorer/);
    expect(hi.abandon.repairHint).not.toMatch(/पुष्टि करने वाला नया कप्तान/);
    expect(hi.abandon.repairHint).toMatch(/स्कोरर/);
  });
});

describe('V148-4: current zone city names', () => {
  const ts = Date.parse('2026-10-10T10:20:00Z');
  it('legacy ids map to the current zone', () => {
    expect(zoneLabel(ts, 'Asia/Katmandu')).toBe(zoneLabel(ts, 'Asia/Kathmandu'));
    expect(zoneLabel(ts, 'Asia/Katmandu')).not.toMatch(/Katmandu/);
    expect(zoneLabel(ts, 'Asia/Calcutta')).toBe('IST');
    expect(LEGACY_ZONES['Europe/Kiev']).toBe('Europe/Kyiv');
    for (const z of Object.values(LEGACY_ZONES)) expect(() => new Intl.DateTimeFormat('en', { timeZone: z })).not.toThrow();
  });
});
