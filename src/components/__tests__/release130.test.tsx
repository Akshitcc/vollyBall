/**
 * 1.3.0 UI: T&C gate screen, balance-only wallet, result confirmation panel, B121 browser-pass fixes
 * (nested button, team name wrap, compact login, too-short / paste-cut notices, phone leftovers,
 * colour rings, tournament picker, memories "Add photo", HI seed captions).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import React from 'react';
import * as RN from 'react-native';
import i18n from '../../i18n';
import { TERMS_VERSION } from '../../core/terms';
import type { Match } from '../../core/types';
import { palette } from '../../theme';
import { INDOOR_RULES, type RuleSet } from '../../core/rules';
import { addPoint, computeState, summarize, type MatchEvent } from '../../core/scoring';

const QUICK = { ...INDOOR_RULES, bestOf: 1, pointsPerSet: 3, winBy: 1, pointCap: null, sideSwitchEvery: null, decidingSideSwitchEvery: null, decidingSwitchAt: null } as RuleSet;
let ev: MatchEvent[] = [];
for (let i = 0; i < 3; i++) ev = addPoint(QUICK, ev, 'A', { at: 1, playerId: 'a2' });
const EVENTS = ev;

jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null, MaterialCommunityIcons: () => null }));
jest.mock('react-native-webview', () => ({ WebView: () => null }));
jest.mock('expo-router', () => ({ router: { push: jest.fn(), replace: jest.fn(), back: jest.fn() }, useLocalSearchParams: () => ({}), Stack: { Screen: () => null } }));
jest.mock('react-native-safe-area-context', () => {
  const { View } = require('react-native');
  return { SafeAreaView: View, useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }), SafeAreaProvider: View };
});
const mockAcceptTerms = jest.fn(async (_v: string) => undefined);
jest.mock('../../state/AuthContext', () => ({
  useAuth: () => ({ isAdmin: false, termsOk: false, acceptTerms: (v: string) => mockAcceptTerms(v) }),
  useMe: () => ({ id: 'a1', name: 'Aarav', phone: '+919876543210', photoURL: null, city: '' }),
}));
jest.mock('../../services/session', () => ({ signOut: jest.fn() }));
jest.mock('../LocationPicker', () => ({ LocationPicker: () => null, placeReady: () => true }));
jest.mock('react-native-maps', () => ({ __esModule: true, default: () => null, Marker: () => null, Circle: () => null }));
const mockBackend = {
  getWallet: jest.fn(async () => ({ balance: 260, points: 40, wins: 5, potm: 1, matchPoints: 160, bonus: 100, winsToNextBonus: 5, countedMatches: 7, awaitingConfirmation: 1, flagged: 1 })),
  confirmResult: jest.fn(async () => undefined),
  rejectResult: jest.fn(async () => undefined),
  reviewMatch: jest.fn(async () => undefined),
  searchTeams: jest.fn(async () => [] as unknown[]),
  createTeam: jest.fn(async () => 'T1'),
  listMemories: jest.fn(async () => []),
  watchMyMatches: jest.fn((_: string, cb: (v: unknown[]) => void) => (cb(mockMatches), () => {})),
  sendOtp: jest.fn(),
};
let mockMatches: unknown[] = [];
jest.mock('../../services/backend', () => ({ backend: mockBackend }));
jest.mock('../../services/camera', () => ({ cameraAccess: jest.fn(), hasCameraButton: () => false, isPhone: () => false, openSettings: jest.fn(), pickPhoto: jest.fn(async () => null), pickPhotos: jest.fn(async () => []), MAX_GALLERY_PICK: 10, requestCamera: jest.fn(), takePhoto: jest.fn() }));

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
    startedAt: 0,
    startedServerAt: 0,
    finishedAt: 30 * 60_000,
    finishedServerAt: 30 * 60_000,
    verification: { status: 'pending' },
    rules: QUICK,
    ...over,
  }) as unknown as Match;

const allText = () => JSON.stringify(screen.toJSON());

beforeEach(async () => {
  await AsyncStorage.clear();
  await i18n.changeLanguage('en');
  jest.clearAllMocks();
  mockMatches = [];
});
afterAll(async () => {
  await i18n.changeLanguage('en');
});

describe('item 1: T&C gate screen (DRAFT, EN + HI)', () => {
  const Terms = require('../../app/terms').default;
  it('shows the DRAFT badge and version; Accept is disabled until the box is ticked, then accepts this version', async () => {
    await render(<Terms />);
    expect(screen.getByTestId('terms-draft-badge')).toBeTruthy();
    expect(screen.getByTestId('terms-version').props.children).toContain(TERMS_VERSION);
    expect(screen.getByTestId('terms-accept').props.accessibilityState).toMatchObject({ disabled: true });
    await act(async () => fireEvent.press(screen.getByTestId('terms-accept')));
    expect(mockAcceptTerms).not.toHaveBeenCalled();
    await act(async () => fireEvent.press(screen.getByTestId('terms-checkbox')));
    expect(screen.getByTestId('terms-checkbox').props.accessibilityState).toMatchObject({ checked: true });
    await act(async () => fireEvent.press(screen.getByTestId('terms-accept')));
    expect(mockAcceptTerms).toHaveBeenCalledWith(TERMS_VERSION);
  });
  it.each(['en', 'hi'])('%s: no ID-number field and no cash/redeem offer (Hindi text in Hindi)', async (lng) => {
    {
      await i18n.changeLanguage(lng);
      await render(<Terms />);
      const text = allText();
      if (lng === 'hi') expect(text).toMatch(/[\u0900-\u097F]/);
      expect(text).not.toMatch(/aadhaar|आधार|redeem|withdraw|₹|रिडीम/i);
      expect(allText()).not.toContain('"placeholder"');
    }
  });
});

describe('item 4: wallet shows the balance only', () => {
  const Wallet = require('../../app/wallet').default;
  it.each(['en', 'hi'])('%s: balance, derived bonus, waiting and flagged counts; no redeem/cash wording or buttons', async (lng) => {
    {
      await i18n.changeLanguage(lng);
      await render(<Wallet />);
      await act(async () => {});
      expect(allText()).toContain('260');
      expect(screen.getByTestId('wallet-bonus')).toBeTruthy();
      expect(screen.getByTestId('wallet-awaiting')).toBeTruthy();
      expect(screen.getByTestId('wallet-flagged')).toBeTruthy();
      expect(allText()).not.toMatch(/redeem|withdraw|cash ?out|transfer to|₹|rupee|रुपये|रिडीम|निकाल/i);
      expect(allText()).not.toContain('"accessibilityRole":"button"');
    }
  });
});

describe('item 5: result confirmation panel', () => {
  const { ResultPanel } = require('../ResultBadge');
  const nameOf = (u: string) => ({ a1: 'Aarav', b1: 'Kavya' })[u];
  it('the scoring side sees "waiting for" and no buttons', async () => {
    await render(<ResultPanel match={mkMatch()} meId="a1" isAdmin={false} nameOf={nameOf} />);
    expect(screen.queryByTestId('confirm-result')).toBeNull();
    expect(screen.getByTestId('result-captains')).toBeTruthy();
    expect(allText()).toContain('Kavya');
  });
  it('the opposing captain confirms, or rejects with a reason', async () => {
    await render(<ResultPanel match={mkMatch()} meId="b1" isAdmin={false} nameOf={nameOf} />);
    await act(async () => fireEvent.press(screen.getByTestId('confirm-result')));
    expect(mockBackend.confirmResult).toHaveBeenCalledWith('m1');
    await act(async () => fireEvent.press(screen.getByTestId('reject-result')));
    await fireEvent.changeText(screen.getByTestId('reject-reason'), 'Wrong score');
    await act(async () => fireEvent.press(screen.getByTestId('reject-send')));
    expect(mockBackend.rejectResult).toHaveBeenCalledWith('m1', 'Wrong score');
  });
  it('a flagged (short) match shows the flagged state; an admin gets approve / void', async () => {
    const short = mkMatch({ finishedAt: 8 * 60_000, finishedServerAt: 8 * 60_000 } as Partial<Match>);
    await render(<ResultPanel match={short} meId="x" isAdmin nameOf={nameOf} />);
    expect(screen.getByTestId('result-flagged')).toBeTruthy();
    await act(async () => fireEvent.press(screen.getByTestId('admin-approve')));
    expect(mockBackend.reviewMatch).toHaveBeenCalledWith('m1', 'approve');
  });
});

describe('B121-1 / B121-5: score half', () => {
  const { TeamHalf, teamNameSize } = require('../LiveScoring');
  const props = { side: 'B', name: 'Yamuna Blockers United Club', color: '#001F4D', score: 3, setsWon: 0, setsToWin: 2, serving: false, point: null, timeoutsLeft: 2, compact: false, showHint: false, onPoint: jest.fn(), onTimeout: jest.fn(), height: 300 };
  it('the timeout chip is not inside the scoring button (no <button> in a <button>)', async () => {
    await render(<TeamHalf {...props} />);
    let n = screen.getByTestId('timeout-B').parent;
    while (n) {
      expect(n.props.testID).not.toBe('tap-B');
      n = n.parent;
    }
    await act(async () => fireEvent.press(screen.getByTestId('timeout-B')));
    expect(props.onTimeout).toHaveBeenCalled();
    expect(props.onPoint).not.toHaveBeenCalled();
  });
  it('a long Team B name wraps to 2 lines at a smaller size instead of truncating', async () => {
    await render(<TeamHalf {...props} />);
    const name = screen.getByTestId('team-name-B');
    expect(name.props.numberOfLines).toBe(2);
    expect(teamNameSize(props.name).fontSize).toBeLessThan(teamNameSize('Short').fontSize);
  });
});

describe('B121-3: login fits at 360×640 (EN + HI)', () => {
  const Login = require('../../app/login').default;
  it('the brand block is compact below 720 px of window height (360×640), full on a tall phone', async () => {
    const { isCompactLogin } = require('../../app/login');
    expect(isCompactLogin(640)).toBe(true);
    expect(isCompactLogin(915)).toBe(false);
    for (const lng of ['en', 'hi']) {
      await i18n.changeLanguage(lng);
      const r = await render(<Login />); // the test window is tall
      expect(r.getByTestId('login-brand')).toBeTruthy();
      expect(r.getByTestId('send-otp')).toBeTruthy();
    }
  });
});

describe('B121-7: team name notices', () => {
  const NewTeam = require('../../app/team/new').default;
  it('1 character says "too short"; a 61-character paste keeps 40 and says so', async () => {
    await render(<NewTeam />);
    await fireEvent.changeText(screen.getByTestId('team-name'), 'B');
    expect(screen.getByTestId('team-name-short').props.children).toMatch(/too short/i);
    await fireEvent.changeText(screen.getByTestId('team-name'), 'B'.repeat(61));
    expect(screen.getByTestId('team-name').props.value).toHaveLength(40);
    expect(screen.getByTestId('team-name-cut').props.children).toMatch(/40/);
    await fireEvent.changeText(screen.getByTestId('team-name'), 'B'.repeat(10));
    expect(screen.queryByTestId('team-name-cut')).toBeNull();
    expect(screen.queryByTestId('team-name-short')).toBeNull();
  });
  it('B121-6: the navy swatch carries the contrast ring and the selection ring is outside it', async () => {
    await render(<NewTeam />);
    const fill = screen.getByTestId('team-colour-fill-001F4D');
    expect(RN.StyleSheet.flatten(fill.props.style)).toMatchObject({ borderColor: palette.blueLine });
    await act(async () => fireEvent.press(screen.getByTestId('team-colour-001F4D')));
    expect(screen.getByTestId('team-colour-001F4D').props.accessibilityState).toMatchObject({ selected: true });
  });
});

describe('B121-8: phone field leftovers', () => {
  const { PhoneInput } = require('../PhoneInput');
  function H() {
    const [v, setV] = React.useState('');
    return <PhoneInput value={v} onChangeText={setV} testID="ph" />;
  }
  it('a bare "+91" left in the field shows the inline error once focus leaves', async () => {
    await render(<H />);
    await fireEvent(screen.getByTestId('ph'), 'focus');
    await fireEvent.changeText(screen.getByTestId('ph'), '+91');
    expect(screen.queryByTestId('ph-error')).toBeNull();
    await fireEvent(screen.getByTestId('ph'), 'blur');
    expect(screen.getByTestId('ph-error')).toBeTruthy();
    await fireEvent(screen.getByTestId('ph'), 'focus');
    await fireEvent.changeText(screen.getByTestId('ph'), '9876543210');
    await fireEvent(screen.getByTestId('ph'), 'blur');
    expect(screen.queryByTestId('ph-error')).toBeNull();
  });
  it('the team add-player and match add-player fields use the shared PhoneInput (letters refused)', () => {
    const fs = require('fs');
    const path = require('path');
    for (const f of ['../../app/team/[id].tsx', '../TeamBuilder.tsx']) expect(fs.readFileSync(path.join(__dirname, f), 'utf8')).toMatch(/<PhoneInput /);
  });
});

describe('B121-6: team dots', () => {
  const { MatchCard } = require('../MatchCard');
  it('navy Team B dot has the light-blue ring on match cards (Home / Score)', async () => {
    await render(<MatchCard m={mkMatch({ status: 'live' } as Partial<Match>)} />);
    expect(RN.StyleSheet.flatten(screen.getByTestId('team-dot-B').props.style)).toMatchObject({ borderColor: palette.blueLine });
    expect(RN.StyleSheet.flatten(screen.getByTestId('team-dot-A').props.style).borderColor).toBeUndefined();
  });
});

describe('B121-2: tournament team picker', () => {
  const NewTournament = require('../../app/tournament/new').default;
  it('offers only teams with at least 6 players and says how many were left out', async () => {
    jest.useFakeTimers();
    const team = (id: string, n: number) => ({ id, name: id, color: '#D93636', memberIds: Array.from({ length: n }, (_, i) => `${id}${i}`) });
    mockBackend.searchTeams.mockResolvedValue([team('Big', 6), team('Small', 2)]);
    await render(<NewTournament />);
    await act(async () => {
      await jest.advanceTimersByTimeAsync(300);
    });
    expect(screen.getByTestId('add-team-Big')).toBeTruthy();
    expect(screen.queryByTestId('add-team-Small')).toBeNull();
    expect(screen.getByTestId('tournament-too-small').props.children).toMatch(/1 team.*6 players/);
    jest.useRealTimers();
  });
});

describe('B121-9: Add photo on /memories', () => {
  const Memories = require('../../app/memories').default;
  const { photoTargets } = require('../../app/memories');
  it('lists my finished matches only, then offers the photo picker for the chosen one', async () => {
    mockMatches = [mkMatch(), mkMatch({ id: 'm2', status: 'live' } as Partial<Match>), mkMatch({ id: 'm3', scorerId: 'zz', createdBy: 'zz', teamA: { teamId: null, name: 'X', color: '#000000', players: [] } } as Partial<Match>)];
    expect(photoTargets(mockMatches as Match[], 'a1').map((m: Match) => m.id)).toEqual(['m1']);
    await render(<Memories />);
    await act(async () => fireEvent.press(screen.getByTestId('memories-add-photo')));
    expect(screen.getByTestId('memories-pick-m1')).toBeTruthy();
    expect(screen.queryByTestId('memories-pick-m2')).toBeNull();
    await act(async () => fireEvent.press(screen.getByTestId('memories-pick-m1')));
    expect(screen.getByTestId('memories-choose-photo')).toBeTruthy();
  });
});

describe('B121-4: demo seed captions', () => {
  const { demoPhotoUrl } = require('../../services/backend/demoSeed');
  it('are centred (no clipped first letters in a square crop) and Hindi in Hindi', () => {
    const en = decodeURIComponent(demoPhotoUrl(0, 'en'));
    const hi = decodeURIComponent(demoPhotoUrl(0, 'hi'));
    expect(en).toContain('text-anchor="middle"');
    expect(en).toContain('Spike!');
    expect(hi).toContain('स्पाइक!');
    expect(hi).not.toContain('Spike!');
  });
});
