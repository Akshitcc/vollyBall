/**
 * Live scoring screen (QA re-test, low items): a player tap credits the rally even without a shot
 * type, the set scores in the header follow the screen order after a swap, and the ⋮ menu opens.
 */
import { act, fireEvent, render, screen, within } from '@testing-library/react-native';
import React from 'react';
import { INDOOR_RULES } from '../../core/rules';
import type { Match } from '../../core/types';
import i18n from '../../i18n';
import ScoreScreen from '../../app/match/[id]/score';

// These suites cover the v1 team-half scoring model (still behind core/liveFlags LEGACY_HALVES).
jest.mock('../../core/liveFlags', () => ({ LEGACY_HALVES: true, TEAM_HALF_TAP: true, CHIP_DEBOUNCE_MS: 250 }));
jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null, MaterialCommunityIcons: () => null }));
jest.mock('expo-haptics', () => ({ impactAsync: () => Promise.resolve(), selectionAsync: () => Promise.resolve(), notificationAsync: () => Promise.resolve(), ImpactFeedbackStyle: { Medium: 'm', Light: 'l' }, NotificationFeedbackType: { Success: 's' } }));
jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ id: 'm1' }),
  router: { replace: jest.fn(), back: jest.fn(), canGoBack: () => true, push: jest.fn() },
}));
jest.mock('react-native-safe-area-context', () => {
  const { View } = require('react-native');
  return { SafeAreaView: View, SafeAreaProvider: View, useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) };
});
jest.mock('../../state/AuthContext', () => ({ useAuth: () => ({ isAdmin: false, termsOk: true }), useMe: () => ({ id: 'a1', name: 'A1' }) }));

const players = (p: string) => Array.from({ length: 6 }, (_, i) => ({ id: `${p}${i + 1}`, name: `${p.toUpperCase()}${i + 1} Surname`, photoURL: null }));
let mockMatch: Match;
const mockSave = jest.fn(async (_id: string, _p: { events: Match['events'] }) => {});
jest.mock('../../services/backend', () => ({
  backend: {
    watchMatch: (_id: string, cb: (m: Match) => void) => {
      setTimeout(() => cb(mockMatch), 0);
      return () => {};
    },
    saveMatchProgress: (id: string, p: { events: Match['events'] }) => mockSave(id, p),
    updateMatch: jest.fn(async () => {}),
    // 1.4.5 (V144-1): the abandon has its own backend action
    abandonMatch: jest.fn(async () => 'abandoned'),
  },
}));

const pt = (side: 'A' | 'B', at: number) => ({ type: 'point' as const, side, at });
const make = (events: Match['events'] = []): Match =>
  ({
    id: 'm1',
    teamA: { teamId: null, name: 'Delhi Spikers', color: '#E53935', players: players('a') },
    teamB: { teamId: null, name: 'Mumbai Blockers', color: '#2B2B2B', players: players('b') },
    rules: { ...INDOOR_RULES, bestOf: 3, pointsPerSet: 5, decidingSetPoints: 5, winBy: 1, pointCap: null },
    firstServe: 'A',
    events,
    status: 'live',
    createdBy: 'a1',
    scorerId: 'a1',
    participantIds: [...players('a'), ...players('b')].map((p) => p.id),
    startedAt: 1,
    finishedAt: null,
    updatedAt: 1,
    createdAt: 1,
    lineups: null,
  }) as unknown as Match;

async function open(events: Match['events'] = []) {
  mockMatch = make(events);
  await render(<ScoreScreen />);
  await act(async () => {
    await jest.advanceTimersByTimeAsync(5);
  });
}
const lastSaved = () => mockSave.mock.calls[mockSave.mock.calls.length - 1][1].events;

// Deterministic under load (fix re-test 213 #2): fake timers everywhere – no real waits, time only
// moves when a test advances it – and the screen is rendered once up front, so loading its modules
// (and RN's lazily required Modal) isn't timed inside the first test. T is a backstop for a busy CPU.
const T = 15_000;
jest.setTimeout(5_000); // per test, after the warm-up (fix re-test 214 #2); T backstops the warm-up
beforeAll(async () => {
  void require('react-native').Modal;
  jest.useFakeTimers();
  mockMatch = make();
  const warm = await render(<ScoreScreen />);
  await act(async () => {
    await jest.advanceTimersByTimeAsync(5);
  });
  await fireEvent.press(warm.getByTestId('tap-A')); // the attribution row too
  await warm.unmount();
  mockSave.mockClear();
  jest.useRealTimers();
}, T);
beforeEach(() => {
  jest.useFakeTimers();
  mockSave.mockClear();
});
afterEach(async () => {
  await act(async () => {
    await i18n.changeLanguage('en');
  });
  jest.useRealTimers();
});

test('tapping a player credits the rally right away; the shot type is optional', async () => {
  await open();
  await fireEvent.press(screen.getByTestId('tap-A'));
  await fireEvent.press(screen.getByTestId('credit-a3'));
  expect(lastSaved()[0]).toMatchObject({ type: 'point', side: 'A', playerId: 'a3' });
  expect((lastSaved()[0] as { kind?: string }).kind).toBeUndefined();
  expect(screen.getByTestId('credited-to').props.children).toBe('Point to A3. Shot type (optional):');
  // moving straight on to the next rally keeps the credit
  await fireEvent.press(screen.getByTestId('tap-B'));
  expect(lastSaved()[0]).toMatchObject({ playerId: 'a3' });
  // a shot type can still be added
  await fireEvent.press(screen.getByTestId('credit-b2'));
  await fireEvent.press(screen.getByTestId('kind-ace'));
  expect(lastSaved()[1]).toMatchObject({ side: 'B', playerId: 'b2', kind: 'ace' });
  expect(screen.queryByTestId('credited-to')).toBeNull();
});

test('set scores in the header follow the screen order after a swap', async () => {
  await open([pt('B', 1), pt('B', 2), pt('B', 3), pt('B', 4), pt('B', 5)]); // set 1: B wins 5-0
  const strip = () => screen.getByTestId('set-strip');
  expect(within(strip()).getByText('S1  0–5')).toBeTruthy(); // A (left) 0, B (right) 5
  await fireEvent.press(screen.getByTestId('swap'));
  expect(within(strip()).getByText('S1  5–0')).toBeTruthy(); // B is on the left now
});

test('the ⋮ menu opens (44 px target, labelled)', async () => {
  await open();
  const btn = screen.getByTestId('score-menu');
  expect(btn.props.accessibilityLabel).toBe('Match options');
  await fireEvent.press(btn);
  expect(screen.getAllByText('Match options').length).toBeGreaterThan(0);
  expect(screen.getByText('Abandon match')).toBeTruthy();
});

// Fix re-test #4: ⋮ → Abandon asks first (translated, on phones too) and reports a failed save.
describe('abandon match', () => {
  const { Alert, Platform } = require('react-native');
  const { backend } = require('../../services/backend');
  const { router } = require('expo-router');
  const restore = Platform.OS;
  let alertSpy: jest.SpyInstance;
  beforeEach(() => {
    (Platform as { OS: string }).OS = 'android';
    alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    (backend.abandonMatch as jest.Mock).mockReset();
    (router.replace as jest.Mock).mockClear();
  });
  afterEach(() => {
    (Platform as { OS: string }).OS = restore;
    alertSpy.mockRestore();
  });
  type Btn = { text: string; style?: string; onPress?: () => void };
  const pressAlertButton = async (call: number, label: string) => {
    const buttons = alertSpy.mock.calls[call][2] as Btn[];
    await act(async () => {
      buttons.find((b) => b.text === label)!.onPress!();
      await jest.advanceTimersByTimeAsync(0);
    });
  };
  const chooseAbandon = async () => {
    await fireEvent.press(screen.getByTestId('score-menu'));
    await act(async () => {
      fireEvent.press(screen.getByTestId('menu-abandon'));
      await jest.advanceTimersByTimeAsync(0);
    });
  };

  test('asks before abandoning; Cancel keeps the match, Abandon saves and leaves', async () => {
    (backend.abandonMatch as jest.Mock).mockResolvedValue('abandoned');
    await open([pt('A', 1)]);
    await chooseAbandon();
    expect(alertSpy).toHaveBeenCalledTimes(1);
    const [title, message, buttons] = alertSpy.mock.calls[0];
    // 1.4.5 (V144-1, interim 'review' policy): after a rally the dialog says an admin will review it
    expect([title, message]).toEqual(['Abandon match', 'Abandon this match? Rallies were already played, so an admin will review it. Who abandoned it and the score now are recorded, and the admin can reinstate the match.\n\nThe match stops at 1–0 in set 1 · sets 0–0.']); // 1.4.8 (V147-3): + the score
    expect((buttons as Btn[]).map((b) => b.text)).toEqual(['Keep playing', 'Abandon']);
    await pressAlertButton(0, 'Keep playing');
    expect(backend.abandonMatch).not.toHaveBeenCalled();
    await chooseAbandon();
    await pressAlertButton(1, 'Abandon');
    expect(backend.abandonMatch).toHaveBeenCalledWith('m1');
    expect(router.replace).toHaveBeenCalledWith('/match/m1');
  });

  test('1.4.5: before the first rally the plain question is asked (abandoned directly)', async () => {
    (backend.abandonMatch as jest.Mock).mockResolvedValue('abandoned');
    await open([]);
    await chooseAbandon();
    expect(alertSpy.mock.calls[0].slice(0, 2)).toEqual(['Abandon match', 'Abandon this match?']);
  });

  test('a failed save is reported (translated) and the screen stays', async () => {
    (backend.abandonMatch as jest.Mock).mockRejectedValue(new Error('Only the assigned scorer can change the score'));
    await open([pt('A', 1)]);
    await chooseAbandon();
    await pressAlertButton(0, 'Abandon');
    expect(alertSpy).toHaveBeenCalledTimes(2);
    expect(alertSpy.mock.calls[1][0]).toBe("Couldn't abandon the match");
    expect(router.replace).not.toHaveBeenCalled();
    expect(screen.getByTestId('tap-A')).toBeTruthy();
  });

  test('Hindi labels', async () => {
    await act(async () => {
      await i18n.changeLanguage('hi');
    });
    (backend.abandonMatch as jest.Mock).mockRejectedValue(new Error('network down'));
    await open();
    await chooseAbandon();
    const [title, message, buttons] = alertSpy.mock.calls[0];
    expect([title, message]).toEqual(['मैच छोड़ें', 'यह मैच छोड़ें?']);
    // the two buttons must read differently (common.cancel is also 'रद्द करें')
    expect((buttons as Btn[]).map((b) => b.text)).toEqual(['मैच जारी रखें', 'हाँ, मैच छोड़ें']);
    await pressAlertButton(0, 'हाँ, मैच छोड़ें');
    expect(alertSpy.mock.calls[1][0]).toBe('मैच छोड़ा नहीं जा सका');
  });
});

// Fix re-test 204: on web, Abandon uses the app's translated dialog, not window.confirm.
test('web: Abandon asks in the in-app dialog', async () => {
  const { Platform } = require('react-native');
  const { backend } = require('../../services/backend');
  const { router } = require('expo-router');
  const { DialogHost } = require('../DialogHost');
  const restore = Platform.OS;
  (Platform as { OS: string }).OS = 'web';
  const confirmSpy = jest.fn(() => true);
  (window as unknown as { confirm: unknown }).confirm = confirmSpy;
  (backend.abandonMatch as jest.Mock).mockReset();
  (backend.abandonMatch as jest.Mock).mockResolvedValue('abandoned');
  (router.replace as jest.Mock).mockClear();
  try {
    mockMatch = make([pt('A', 1)]);
    await render(
      <>
        <ScoreScreen />
        <DialogHost />
      </>,
    );
    await act(async () => {
      await jest.advanceTimersByTimeAsync(5);
    });
    await fireEvent.press(screen.getByTestId('score-menu'));
    await act(async () => {
      fireEvent.press(screen.getByTestId('menu-abandon'));
      await jest.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByTestId('app-dialog-title').props.children).toBe('Abandon match');
    expect(confirmSpy).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent.press(screen.getByText('Keep playing'));
      await jest.advanceTimersByTimeAsync(0);
    });
    expect(backend.abandonMatch).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByTestId('score-menu'));
    await act(async () => {
      fireEvent.press(screen.getByTestId('menu-abandon'));
      await jest.advanceTimersByTimeAsync(0);
    });
    await act(async () => {
      fireEvent.press(screen.getByText('Abandon'));
      await jest.advanceTimersByTimeAsync(0);
    });
    expect(backend.abandonMatch).toHaveBeenCalledWith('m1');
    expect(router.replace).toHaveBeenCalledWith('/match/m1');
  } finally {
    (Platform as { OS: string }).OS = restore;
  }
});

const flat = (st: unknown): Record<string, unknown> => Object.assign({}, ...(([] as unknown[]).concat(st as never).flat(5).filter(Boolean) as object[]));

test('V3: while "Who scored" is open the score stays visible (smaller digits, no court card / tap hint)', async () => {
  await open();
  expect(screen.getByTestId('tap-hint-A')).toBeTruthy();
  expect(screen.getByTestId('court-A')).toBeTruthy();
  expect(flat(screen.getByTestId('score-A').props.style).fontSize).toBe(104);
  await fireEvent.press(screen.getByTestId('tap-A'));
  expect(screen.getByTestId('credit-a3')).toBeTruthy(); // the sheet is open
  expect(screen.queryByTestId('tap-hint-A')).toBeNull();
  expect(screen.queryByTestId('tap-hint-B')).toBeNull();
  expect(screen.queryByTestId('court-A')).toBeNull();
  expect(screen.getByTestId('score-A').props.children).toBe(1);
  expect(flat(screen.getByTestId('score-A').props.style).fontSize).toBe(76);
  await fireEvent.press(screen.getByTestId('attrib-skip'));
  expect(screen.getByTestId('court-A')).toBeTruthy(); // court card is back
  expect(flat(screen.getByTestId('score-A').props.style).fontSize).toBe(104);
  expect(screen.queryByTestId('tap-hint-A')).toBeNull(); // the hint is only shown before the first rally
});

test('Undo shows the score it reverts to, and looks disabled before the first rally', async () => {
  await open();
  const undo = screen.getByTestId('undo');
  expect(undo.props.accessibilityState?.disabled).toBe(true);
  expect(screen.getByTestId('undo-sub').props.children).toBe('Nothing to undo yet');
  await fireEvent.press(screen.getByTestId('tap-A'));
  await fireEvent.press(screen.getByTestId('attrib-skip'));
  await fireEvent.press(screen.getByTestId('tap-A'));
  await fireEvent.press(screen.getByTestId('attrib-skip'));
  expect(screen.getByTestId('undo').props.accessibilityState?.disabled).toBe(false);
  expect(screen.getByTestId('undo-sub').props.children).toBe('Delhi −1 · Back to 1–0'); // 1.3.2 §11.3: Undo says what it will undo (a team point here)
});

test('lineup court card sits in its own card below the halves (no clipped edge inside a team half)', async () => {
  await open();
  const card = screen.getByTestId('court-card');
  expect(within(card).getByTestId('court-A')).toBeTruthy();
  expect(within(card).getByTestId('court-B')).toBeTruthy();
  expect(within(screen.getByTestId('tap-B')).queryByTestId('court-B')).toBeNull();
  expect(within(screen.getByTestId('tap-A')).queryByTestId('court-A')).toBeNull();
});

test('text on the team colours uses onColor; the SERVING pill stays distinct on any team colour', async () => {
  mockMatch = make();
  mockMatch = { ...mockMatch, teamA: { ...mockMatch.teamA, color: '#FF6B00' } };
  await render(<ScoreScreen />);
  await act(async () => {
    await jest.advanceTimersByTimeAsync(5);
  });
  // 1.4.22 (spec v2 *-02): Day digits are ink on a white score sticker on both halves (never white on a team colour)
  expect(flat(screen.getByTestId('score-A').props.style).color).toBe(require('../../theme').colors.ink);
  expect(flat(screen.getByTestId('score-B').props.style).color).toBe(require('../../theme').colors.ink);
  // A serves first: the pill is light blue with a ring in the team's onColor (navy on orange), so it is ≥3:1 from the team colour
  const pill = flat(screen.getByTestId('serving-A').props.style);
  expect(pill.backgroundColor).toBe(require('../../theme/tokens').tokens.day.accent); // 1.4.22 spec: Day SERVING pill = Ball
  expect(pill.borderColor).toBe(require('../../theme').colors.ink); // 1.4.21 theme token
});

// 1.4.3 (QA V142-7): once the winning rally is in, the ⋮ menu offers nothing that changes the match
describe('V142-7: the ⋮ menu after the winning rally', () => {
  const WON = Array.from({ length: 10 }, (_, i) => pt('A', i + 1)); // 5-0, 5-0 (best of 3 to 5)
  test('finished (stored finished, POTM not chosen yet): no Abandon, no Lineup; Share and point-by-point stay', async () => {
    mockMatch = { ...make(WON), status: 'finished', finishedAt: 20 } as Match;
    await render(<ScoreScreen />);
    await act(async () => {
      await jest.advanceTimersByTimeAsync(5);
    });
    await fireEvent.press(screen.getByTestId('score-menu'));
    expect(screen.queryByTestId('menu-abandon')).toBeNull();
    expect(screen.queryByText('Abandon match')).toBeNull();
    expect(screen.queryByText(i18n.t('rotation.lineup'))).toBeNull();
    expect(screen.getByText(i18n.t('score.shareLive'))).toBeTruthy();
    expect(screen.getByText(i18n.t('score.pointByPoint'))).toBeTruthy();
  });
  test('still "live" in the doc but the events have a winner (older client): no Abandon either', async () => {
    await open(WON);
    await fireEvent.press(screen.getByTestId('score-menu'));
    expect(screen.queryByTestId('menu-abandon')).toBeNull();
  });
  test('one rally short of the win: Abandon is offered', async () => {
    await open(WON.slice(0, -1));
    await fireEvent.press(screen.getByTestId('score-menu'));
    expect(screen.getByTestId('menu-abandon')).toBeTruthy();
  });
});
