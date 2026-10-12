/**
 * 1.4.5 UI: V144-6 (an abandoned match's header shows the replayed score, not 0–0), V144-7 (a tap on the Serving
 * badge never scores), V144-9 (POTM: one save per tap; the zero-points text in EN/HI) and the abandon panel
 * (who abandoned it, the side behind as information, the opposing captain's Report – EN and HI).
 */
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import React from 'react';
import { INDOOR_RULES } from '../../core/rules';
import { addPoint, type MatchEvent } from '../../core/scoring';
import type { Match } from '../../core/types';
import { computeState } from '../../core/scoring';
import i18n from '../../i18n';

// These suites cover the v1 team-half scoring model (still behind core/liveFlags LEGACY_HALVES).
jest.mock('../../core/liveFlags', () => ({ LEGACY_HALVES: true, TEAM_HALF_TAP: true, CHIP_DEBOUNCE_MS: 250 }));
jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null, MaterialCommunityIcons: () => null }));
jest.mock('expo-image', () => ({ Image: () => null }));
jest.mock('expo-haptics', () => ({ impactAsync: () => Promise.resolve(), notificationAsync: () => Promise.resolve(), ImpactFeedbackStyle: {}, NotificationFeedbackType: {} }));
jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ id: 'm1' }),
  router: { replace: jest.fn(), back: jest.fn(), canGoBack: () => true, push: jest.fn() },
}));
jest.mock('react-native-safe-area-context', () => {
  const { View } = require('react-native');
  return { SafeAreaView: View, SafeAreaProvider: View, useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) };
});
jest.mock('../../state/AuthContext', () => ({ useAuth: () => ({ isAdmin: false, termsOk: true }), useMe: () => ({ id: 'a1', name: 'A1 Surname' }) }));
const mockPicker = {
  getCameraPermissionsAsync: jest.fn(),
  requestCameraPermissionsAsync: jest.fn(),
  launchCameraAsync: jest.fn(),
  launchImageLibraryAsync: jest.fn(),
};
jest.mock('expo-image-picker', () => ({
  PermissionStatus: { DENIED: 'denied', GRANTED: 'granted', UNDETERMINED: 'undetermined' },
  getCameraPermissionsAsync: (...a: unknown[]) => mockPicker.getCameraPermissionsAsync(...a),
  requestCameraPermissionsAsync: (...a: unknown[]) => mockPicker.requestCameraPermissionsAsync(...a),
  launchCameraAsync: (...a: unknown[]) => mockPicker.launchCameraAsync(...a),
  launchImageLibraryAsync: (...a: unknown[]) => mockPicker.launchImageLibraryAsync(...a),
}));

const players = (p: string) => Array.from({ length: 6 }, (_, i) => ({ id: `${p}${i + 1}`, name: `${p.toUpperCase()}${i + 1} Surname`, photoURL: null }));
const RULES = { ...INDOOR_RULES, bestOf: 1 as const, pointsPerSet: 5, decidingSetPoints: 5, winBy: 1, pointCap: null };
const mockBackend = {
  saveMatchProgress: jest.fn(async () => {}),
  updateMatch: jest.fn(async () => {}),
  setPlayerOfMatch: jest.fn(async (_m: string, _p: string) => {}),
  uploadMatchPhoto: jest.fn(async (_m: string, _u: string, _uri: string, _p?: (f: number) => void) => {}),
  getRankings: jest.fn(),
  reportAbandon: jest.fn(async (_m: string) => {}),
  resolveMatch: jest.fn(async (_m: string, _a: string) => {}),
  reviewMatch: jest.fn(async (_m: string, _d: string) => {}),
  answerAbandonRequest: jest.fn(async (_m: string, _a: string) => {}),
};
jest.mock('../../services/backend', () => ({ backend: mockBackend }));
// The byte-level photo check has its own tests (photoFile.test.ts); here every picked file is fine.
const mockReadPhoto = jest.fn(async (_uri: string, _type?: string | null) => ({ blob: {}, type: 'image/jpeg', ext: 'jpg', size: 1000 }));
jest.mock('../../services/photoFile', () => ({ ...jest.requireActual('../../services/photoFile'), readPhoto: (u: string, t?: string | null) => mockReadPhoto(u, t) }));


// confirmAsk → the in-app dialog / Alert: answered "yes" here
jest.mock('../../services/dialogs', () => ({ ...jest.requireActual('../../services/dialogs'), confirmAsk: jest.fn(async () => true) }));

const credited = (ids: (string | undefined)[], side: 'A' | 'B' = 'A'): MatchEvent[] => {
  let ev: MatchEvent[] = [];
  for (const id of ids) ev = addPoint(RULES, ev, side, { at: 1, playerId: id });
  return ev;
};
const make = (over: Partial<Match> = {}): Match =>
  ({
    id: 'm1',
    teamA: { teamId: null, name: 'Delhi Spikers', color: '#D93636', players: players('a') },
    teamB: { teamId: null, name: 'Mumbai Blockers', color: '#2B2B2B', players: players('b') },
    rules: RULES, firstServe: 'A', events: [], status: 'live', createdBy: 'a1', scorerId: 'a1',
    participantIds: [...players('a'), ...players('b')].map((p) => p.id), captains: { A: 'a1', B: 'b1' },
    startedAt: 1, finishedAt: null, updatedAt: 1, createdAt: 1, lineups: null,
    ...over,
  }) as unknown as Match;

beforeEach(async () => {
  jest.clearAllMocks();
  await i18n.changeLanguage('en');
});

describe('V144-6 / V144-7: the scoreboard', () => {
  const { LiveScoreboard } = require('../ViewerParts');
  const tA = { name: 'Delhi Spikers', color: '#D93636' };
  const tB = { name: 'Mumbai Blockers', color: '#2B2B2B' };
  it("V144-6: an abandoned match (not live) shows the replayed current score with showCurrent – Tester's 0:4 showed 0–0", async () => {
    const st = computeState(RULES, credited([undefined, undefined, undefined, undefined], 'B'), 'A');
    const r = await render(<LiveScoreboard teamA={tA} teamB={tB} st={st} setsNeeded={1} live={false} />);
    expect(screen.getByTestId('viewer-score-B').props.children).toBe(0); // the sets (the old header)
    await r.rerender(<LiveScoreboard teamA={tA} teamB={tB} st={st} setsNeeded={1} live={false} showCurrent />);
    expect(screen.getByTestId('viewer-score-A').props.children).toBe(0);
    expect(screen.getByTestId('viewer-score-B').props.children).toBe(4);
  });
  it('V144-7: a press on the Serving badge of the scorer panel never scores; the panel still does', async () => {
    const onTeamPoint = jest.fn(() => true);
    const st = computeState(RULES, credited([undefined]), 'A');
    await render(<LiveScoreboard teamA={tA} teamB={tB} st={st} setsNeeded={1} live onTeamPoint={onTeamPoint} />);
    const side = st.serving;
    expect(screen.getByTestId(`serving-${side}`)).toBeTruthy();
    await fireEvent.press(screen.getByTestId(`serving-guard-${side}`));
    await fireEvent.press(screen.getByTestId(`serving-${side}`));
    expect(onTeamPoint).not.toHaveBeenCalled();
    expect(screen.getByTestId(`serving-guard-${side}`).props.accessible).toBe(false); // not a control for AT
    await fireEvent.press(screen.getByTestId(`team-panel-${side}`));
    expect(onTeamPoint).toHaveBeenCalledWith(side);
  });
});

describe('V144-9: Player of the Match', () => {
  const { PotmPicker } = require('../Potm');
  const finished = () => make({ events: credited(['a2', 'a2', 'a3', 'a2', 'a3']), status: 'finished', finishedAt: Date.now() - 1000 });
  it('two taps on "Confirm" before the save returns → one save; the first tap is never swallowed (HI)', async () => {
    await i18n.changeLanguage('hi');
    let release: () => void = () => {};
    mockBackend.setPlayerOfMatch.mockImplementationOnce(() => new Promise<void>((r) => (release = r)));
    await render(<PotmPicker match={finished()} uid="a1" />);
    const btn = screen.getByTestId('potm-confirm');
    expect(btn).toHaveTextContent('A2 पक्का करें');
    await act(async () => {
      fireEvent.press(btn);
      fireEvent.press(btn);
    });
    expect(mockBackend.setPlayerOfMatch).toHaveBeenCalledTimes(1);
    expect(mockBackend.setPlayerOfMatch).toHaveBeenCalledWith('m1', 'a2');
    await act(async () => release());
    // after the save returned, a new tap saves again (the guard is released)
    await act(async () => {
      fireEvent.press(screen.getByTestId('potm-confirm'));
    });
    expect(mockBackend.setPlayerOfMatch).toHaveBeenCalledTimes(2);
  });
  it('the zero-points rule reads naturally in English and Hindi', async () => {
    expect(i18n.t('potm.zeroHint')).toBe('If any player has points, players with 0 points can’t be Player of the Match.');
    await i18n.changeLanguage('hi');
    expect(i18n.t('potm.zeroHint')).toBe('अगर किसी खिलाड़ी के अंक हैं, तो 0 अंक वाले खिलाड़ी प्लेयर ऑफ़ द मैच नहीं बन सकते।');
  });
});

describe('abandon panel (V144-1, interim review policy)', () => {
  const { AbandonPanel } = require('../AbandonPanel');
  const nameOf = (id: string) => (id === 'a1' ? 'Aarav' : id === 'b1' ? 'Bhavna' : undefined);
  const abandoned = (over: Partial<Match> = {}) =>
    make({ status: 'abandoned', events: credited([undefined, undefined, undefined, undefined], 'B'), maxEvents: 4, finishedAt: 5,
      abandon: { by: 'a1', at: 5, events: 4, mode: 'review', review: 'pending', behind: true, score: { setsA: 0, setsB: 0, currentA: 0, currentB: 4 } }, ...over });
  it.each(['en', 'hi'])('shows who abandoned it and the score, the side behind as information, review pending; B\'s captain can report (%s)', async (lang) => {
    await i18n.changeLanguage(lang);
    await render(<AbandonPanel match={abandoned()} meId="b1" isAdmin={false} nameOf={nameOf} />);
    expect(screen.getByTestId('abandon-panel-by')).toHaveTextContent(i18n.t('abandon.abandonedBy', { name: 'Aarav', score: i18n.t('verify.scoreAt', { a: 0, b: 4, set: 1, sa: 0, sb: 0, done: '' }) }) /* 1.4.7 (V146-7) */);
    expect(screen.getByTestId('abandon-panel-behind')).toHaveTextContent(i18n.t('abandon.sideBehind', { team: 'Delhi Spikers' }));
    expect(screen.getByTestId('abandon-panel-pending')).toHaveTextContent(i18n.t('abandon.reviewPending'));
    expect(screen.getByTestId('abandon-report')).toHaveTextContent(i18n.t('abandon.report'));
    if (lang === 'hi') expect(i18n.t('abandon.report')).toMatch(/[\u0900-\u097F]/);
    await act(async () => {
      fireEvent.press(screen.getByTestId('abandon-report'));
    });
    expect(mockBackend.reportAbandon).toHaveBeenCalledWith('m1');
  });
  it("no Report for the abandoner's own side or an outsider; 'flag' mode shows behind as the reason", async () => {
    const r = await render(<AbandonPanel match={abandoned()} meId="a2" isAdmin={false} nameOf={nameOf} />);
    expect(screen.queryByTestId('abandon-report')).toBeNull();
    await r.rerender(<AbandonPanel match={abandoned({ abandon: { by: 'a1', at: 5, events: 4, mode: 'flag', review: 'pending', behind: true } })} meId="zz" isAdmin={false} nameOf={nameOf} />);
    expect(screen.queryByTestId('abandon-report')).toBeNull();
    expect(screen.getByTestId('abandon-panel-behind')).toHaveTextContent(i18n.t('abandon.behindReason', { team: 'Delhi Spikers' }));
  });
  it('an admin who isn\'t part of it gets reinstate / confirm; a participant admin gets none', async () => {
    const r = await render(<AbandonPanel match={abandoned()} meId="adm" isAdmin nameOf={nameOf} />);
    expect(screen.getByTestId('resolve-reinstate-m1')).toBeTruthy();
    expect(screen.getByTestId('resolve-confirm_abandon-m1')).toBeTruthy();
    await act(async () => {
      fireEvent.press(screen.getByTestId('resolve-confirm_abandon-m1'));
    });
    expect(mockBackend.resolveMatch).toHaveBeenCalledWith('m1', 'confirm_abandon');
    await r.rerender(<AbandonPanel match={abandoned()} meId="b2" isAdmin nameOf={nameOf} />);
    expect(screen.queryByTestId('resolve-reinstate-m1')).toBeNull();
  });
  it("'consent' request: the opposing captain agrees / declines", async () => {
    const m = make({ events: credited([undefined, undefined], 'B'), maxEvents: 2, abandonRequest: { by: 'a1', at: 1, side: 'A', agreedBy: [] } });
    await render(<AbandonPanel match={m} meId="b1" isAdmin={false} nameOf={nameOf} />);
    expect(screen.getByTestId('abandon-panel-request')).toHaveTextContent(i18n.t('abandon.requestBy', { name: 'Aarav' }));
    await act(async () => {
      fireEvent.press(screen.getByTestId('abandon-agree'));
    });
    expect(mockBackend.answerAbandonRequest).toHaveBeenCalledWith('m1', 'agree');
  });
});
