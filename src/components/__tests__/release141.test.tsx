/**
 * 1.4.1 UI: V140-12 (the opposing captain's answer survives a reload), V140-14 (field names, Save → Profile,
 * the match-over sheet can be closed), V140-15 is in release131 (career strip).
 */
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import React from 'react';
import i18n from '../../i18n';
import type { Match } from '../../core/types';
import { INDOOR_RULES, type RuleSet } from '../../core/rules';
import { addPoint, computeState, summarize, type MatchEvent } from '../../core/scoring';

jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null, MaterialCommunityIcons: () => null }));
jest.mock('react-native-webview', () => ({ WebView: () => null }));
jest.mock('expo-image', () => ({ Image: () => null }));
jest.mock('expo-router', () => ({ router: { push: jest.fn(), replace: jest.fn(), back: jest.fn(), dismissTo: jest.fn() }, useLocalSearchParams: () => ({}), Stack: { Screen: () => null } }));
jest.mock('react-native-safe-area-context', () => {
  const { View } = require('react-native');
  return { SafeAreaView: View, useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }), SafeAreaProvider: View };
});
let mockIsAdmin = false;
jest.mock('../../state/AuthContext', () => ({
  useAuth: () => ({ isAdmin: mockIsAdmin, termsOk: true, user: { uid: 'a1' } }),
  useMe: () => ({ id: 'a1', name: 'Aarav', phone: '+919876543210', photoURL: null, city: '' }),
}));
jest.mock('../../services/session', () => ({ signOut: jest.fn() }));
jest.mock('../LocationPicker', () => ({ LocationPicker: () => null, placeReady: () => true }));
jest.mock('react-native-maps', () => ({ __esModule: true, default: () => null, Marker: () => null, Circle: () => null }));
const mockBackend = {
  getWallet: jest.fn(async () => ({ balance: 0, points: 0, wins: 0, potm: 0, matchPoints: 0, bonus: 0, winsToNextBonus: 10, countedMatches: 0, awaitingConfirmation: 0, flagged: 0 })),
  getRankings: jest.fn(async () => ({ ranked: [], total: 0, minMatches: 3, me: null, myCountedMatchIds: [] })),
  watchMyMatches: jest.fn((_u: string, cb: (m: unknown[]) => void) => (cb([]), () => {})),
  watchMyTeams: jest.fn((_u: string, cb: (t: unknown[]) => void) => (cb([]), () => {})),
  listMemories: jest.fn(async () => []),
  confirmResult: jest.fn(async () => undefined),
  rejectResult: jest.fn(async () => undefined),
  reviewMatch: jest.fn(async () => undefined),
  setPlayerOfMatch: jest.fn(async () => undefined),
  listFlaggedMatches: jest.fn(async () => [] as unknown[]),
};
jest.mock('../../services/backend', () => ({ backend: mockBackend }));
jest.mock('../../services/backend/demoBackend', () => ({ DemoBackend: class {} }));

const QUICK = { ...INDOOR_RULES, bestOf: 1, pointsPerSet: 3, winBy: 1, pointCap: null, sideSwitchEvery: null, decidingSideSwitchEvery: null, decidingSwitchAt: null } as RuleSet;
let ev: MatchEvent[] = [];
ev = addPoint(QUICK, ev, 'A', { at: 1, playerId: 'a2' });
ev = addPoint(QUICK, ev, 'A', { at: 2, playerId: 'a2' });
ev = addPoint(QUICK, ev, 'A', { at: 3, playerId: 'a1' });
const EVENTS = ev;
const mkMatch = (over: Partial<Match> = {}): Match =>
  ({
    id: 'm1',
    status: 'finished',
    teamA: { teamId: null, name: 'Delhi Smashers', color: '#D93636', players: [{ id: 'a1', name: 'Aarav' }, { id: 'a2', name: 'Ishaan' }] },
    teamB: { teamId: null, name: 'Yamuna Blockers', color: '#001F4D', players: [{ id: 'b1', name: 'Kavya' }, { id: 'b2', name: 'Meera' }] },
    captains: { A: 'a1', B: 'b1' },
    events: EVENTS,
    summary: summarize(computeState(QUICK, EVENTS, 'A')),
    firstServe: 'A',
    createdBy: 'a1',
    scorerId: 'a1',
    playerOfMatchId: 'a2',
    createdAt: 0,
    startedAt: 0,
    startedServerAt: 0,
    finishedAt: 30 * 60_000,
    finishedServerAt: 30 * 60_000,
    verification: { status: 'pending' },
    rules: QUICK,
    ...over,
  }) as unknown as Match;
const allText = () => JSON.stringify(screen.toJSON());
const count = (s: string) => allText().split(s).length - 1;

beforeEach(async () => {
  jest.clearAllMocks();
  mockIsAdmin = false;
  await i18n.changeLanguage('en');
});
afterAll(async () => {
  await i18n.changeLanguage('en');
});


describe('V140-12: "Result confirmed by the opposing captain" is read from the match (survives a reload)', () => {
  const { ResultPanel } = require('../ResultBadge');
  const nameOf = (u: string) => ({ a1: 'Aarav', b1: 'Kavya' })[u];
  const short = { finishedAt: 8 * 60_000, finishedServerAt: 8 * 60_000 } as Partial<Match>;
  it.each(['en', 'hi'])('%s: a flagged match the captain confirmed, opened fresh, says so (once), and keeps saying it', async (lng) => {
    await i18n.changeLanguage(lng);
    jest.useFakeTimers();
    await render(<ResultPanel match={mkMatch({ ...short, verification: { status: 'confirmed', captain: 'confirmed', by: 'b1', at: 1 } } as Partial<Match>)} meId="a1" isAdmin={false} nameOf={nameOf} />);
    expect(screen.getByTestId('result-flagged')).toBeTruthy();
    expect(screen.getByTestId('result-verdict-confirmed')).toHaveTextContent(i18n.t('verify.confirmed'));
    await act(async () => jest.advanceTimersByTime(60_000)); // not a 5-second notice
    expect(screen.getByTestId('result-verdict-confirmed')).toBeTruthy();
    expect(count(i18n.t('verify.confirmed'))).toBe(1);
    jest.useRealTimers();
  });
  it('a rejection on a flagged match is shown too; nothing while unanswered; the confirmed badge alone when it counts', async () => {
    const view = await render(<ResultPanel match={mkMatch({ ...short, verification: { status: 'disputed', captain: 'rejected', by: 'b1', at: 1, reason: 'no' } } as Partial<Match>)} meId="a1" isAdmin={false} nameOf={nameOf} />);
    expect(screen.getByTestId('result-verdict-rejected')).toHaveTextContent(i18n.t('verify.opponentRejected'));
    await view.rerender(<ResultPanel match={mkMatch(short)} meId="a1" isAdmin={false} nameOf={nameOf} />);
    expect(screen.queryByTestId('result-verdict-confirmed')).toBeNull();
    expect(screen.queryByTestId('result-verdict-rejected')).toBeNull();
    await view.rerender(<ResultPanel match={mkMatch({ verification: { status: 'confirmed', captain: 'confirmed', by: 'b1', at: 1 } } as Partial<Match>)} meId="a1" isAdmin={false} nameOf={nameOf} />);
    expect(screen.getByTestId('result-confirmed')).toBeTruthy();
    expect(screen.queryByTestId('result-verdict-confirmed')).toBeNull();
    expect(count('Result confirmed by the opposing captain')).toBe(1);
  });
});

describe('V140-14: accessible names, Save → Profile, closable result sheet', () => {
  it.each(['en', 'hi'])('%s: a Field\'s visible label is its accessible name (the admin "Add fact" inputs had none)', async (lng) => {
    await i18n.changeLanguage(lng);
    const { Field } = require('../ui');
    await render(<Field label={i18n.t('daily.fields.textEn')} value="" onChangeText={() => {}} testID="f1" />);
    expect(screen.getByTestId('f1').props.accessibilityLabel).toBe(i18n.t('daily.fields.textEn'));
    await render(<Field label="Name *" value="" onChangeText={() => {}} testID="f2" />);
    expect(screen.getByTestId('f2').props.accessibilityLabel).toBe('Name');
    await render(<Field label="Name *" value="" error="Too short" onChangeText={() => {}} testID="f3" />);
    expect(screen.getByTestId('f3').props.accessibilityLabel).toBe('Name, Too short');
  });
  it('Edit profile → Save lands on Profile (dismissTo, whatever opened the form)', () => {
    const { router } = require('expo-router');
    const { toProfileAfterSave } = require('../../services/nav');
    toProfileAfterSave();
    expect(router.dismissTo).toHaveBeenCalledWith('/profile');
    router.dismissTo.mockImplementationOnce(() => {
      throw new Error('no navigator');
    });
    toProfileAfterSave();
    expect(router.replace).toHaveBeenCalledWith('/profile');
  });
  it('the match-over sheet has a labelled Close button, closes on Escape / back (onRequestClose) and on the backdrop', () => {
    const src = require('fs').readFileSync(require('path').join(__dirname, '../../app/match/[id]/score.tsx'), 'utf8') as string;
    const sheet = src.slice(src.indexOf('{/* match over */}'), src.indexOf('<LineupPicker'));
    expect(sheet).toMatch(/<Modal visible=\{st\.finished && !attrib && !overClosed\}[^>]*onRequestClose=\{\(\) => setOverClosed\(true\)\}/);
    expect(sheet).toMatch(/testID="match-over-backdrop"/);
    expect(sheet).toMatch(/accessibilityLabel=\{tr\('score\.closeResult'\)\}/);
    expect(i18n.t('score.closeResult', { lng: 'en' })).toBe('Close result');
    expect(i18n.t('score.closeResult', { lng: 'hi' })).toBe('नतीजा बंद करें');
  });
});
