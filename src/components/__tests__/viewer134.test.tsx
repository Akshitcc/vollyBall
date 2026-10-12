/**
 * 1.3.4 viewer: the big scores never disappear (QA D133-4: blank at ~1024 px – a stalled entering
 * animation started a window-height away), checked at 1024 and 1280 px; offline / queued-photo
 * indicator (D133-1); "Team point" in the Timeline; read-only chips carry no action hint;
 * remaining photo slots (D133-2).
 */
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import React from 'react';
import { Dimensions } from 'react-native';
import { INDOOR_RULES } from '../../core/rules';
import type { Match } from '../../core/types';
import i18n from '../../i18n';
import MatchScreen from '../../app/match/[id]/index';
import { LiveScoreboard, ROLL_PX } from '../ViewerParts';
import { computeState } from '../../core/scoring';
import { connectivity } from '../../services/connectivity';

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
const realWindow = Dimensions.get('window');
beforeEach(() => {
  jest.useFakeTimers();
  connectivity.setSimulatedOffline(false);
});
afterEach(async () => {
  connectivity.setSimulatedOffline(false);
  Dimensions.set({ window: realWindow, screen: realWindow });
  await act(async () => {
    await i18n.changeLanguage('en');
  });
  jest.useRealTimers();
});
const setWidth = (width: number) => {
  const w = { ...realWindow, width, height: 594 };
  Dimensions.set({ window: w, screen: w });
};
const flat = (s: unknown): Record<string, unknown> => Object.assign({}, ...([s].flat(Infinity as 1) as object[]).filter(Boolean));

describe('D133-4: big team scores at tablet / desktop widths', () => {
  for (const width of [1024, 1280]) {
    it(`${width} px: both scores are shown and stay mounted when they change (no window-height slide-in)`, async () => {
      setWidth(width);
      const rules = { ...INDOOR_RULES, bestOf: 3 as const, pointsPerSet: 25, winBy: 2 };
      const teamA = { name: 'Delhi Smashers', color: '#D93636' };
      const teamB = { name: 'Yamuna Blockers', color: '#001F4D' };
      const evs = [pt('A', 1), pt('B', 2), pt('B', 3)];
      const st = (n: number) => computeState(rules, evs.slice(0, n), 'A');
      const r = await render(<LiveScoreboard teamA={teamA} teamB={teamB} st={st(1)} setsNeeded={2} live />);
      const before = screen.getByTestId('viewer-score-B');
      expect(screen.getByTestId('viewer-score-A').props.children).toBe(1);
      await r.rerender(<LiveScoreboard teamA={teamA} teamB={teamB} st={st(3)} setsNeeded={2} live />);
      const after = screen.getByTestId('viewer-score-B');
      expect(after.props.children).toBe(2);
      expect(after).toBe(before); // same element: never re-mounted off-screen
      // the roll is a small nudge inside the score box, never an entering animation from off-screen
      let node = after.parent;
      while (node && !node.props.entering && node.type !== 'View') node = node.parent;
      expect(node?.props.entering).toBeUndefined();
      expect(ROLL_PX).toBeLessThan(42); // less than half of the 84 px score line
      expect(screen.getByTestId('team-name-B').props.children).toBe('Yamuna Blockers');
    });
  }
});

describe('viewer page', () => {
  it('D133-1: offline → "Offline – the score may be behind"; back online → no indicator', async () => {
    await open([pt('A', 1)]);
    expect(screen.queryByTestId('viewer-sync')).toBeNull();
    await act(async () => connectivity.setSimulatedOffline(true));
    expect(screen.getByTestId('viewer-sync')).toHaveTextContent('⚠ Offline – the score may be behind');
    await act(async () => connectivity.setSimulatedOffline(false));
    expect(screen.queryByTestId('viewer-sync')).toBeNull();
  });

  it('Timeline: a team tap (no player) reads "<team> · Team point"', async () => {
    await open([pt('A', 1, 'a2'), pt('B', 2)]);
    const before = screen.queryAllByText('Mumbai Blockers · Team point').length; // the live ticker
    await fireEvent.press(screen.getByTestId('match-tab-timeline'));
    expect(screen.queryAllByText('Mumbai Blockers · Team point')).toHaveLength(before + 1); // + the Timeline row
    expect(screen.queryAllByText(/^A2 Surname/).length).toBeGreaterThan(0); // the credited one keeps the player
  });

  it('read-only court chips: a label with the points, no action hint', async () => {
    await open([pt('A', 1, 'a2')]);
    const chip = screen.getByTestId('court-tile-a2');
    expect(chip.props.accessibilityLabel).toBe('A2 Surname, position 2, 1 points');
    expect(chip.props.accessibilityHint).toBeUndefined();
  });

  it('D133-2: the Photos tab shows the remaining photo slots (50 per match)', async () => {
    await open([pt('A', 1)]);
    await fireEvent.press(screen.getByTestId('match-tab-photos'));
    const slots = screen.getAllByTestId('photo-slots'); // live section + Photos tab
    expect(slots.length).toBeGreaterThan(0);
    for (const x of slots) expect(x).toHaveTextContent('0 of 50 photos · 50 more can be added');
  });
});

// 1.4.3 (QA V142-9): the Stats tab leaves out shot-type rows that are 0 for both teams
describe('V142-9: team stats rows', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());
  test('only spikes happened: the Spikes row shows; Blocks / Aces / Tips (0–0) and team-only (0–0) are left out; points and run stay', async () => {
    await open([{ ...pt('A', 1, 'a1'), kind: 'kill' } as Match['events'][number], pt('B', 2, 'b1'), { ...pt('A', 3, 'a2'), kind: 'kill' } as Match['events'][number]]);
    await fireEvent.press(screen.getByTestId('match-tab-stats'));
    expect(screen.getByTestId('team-stat-points')).toBeTruthy();
    expect(screen.getByTestId('team-stat-run')).toBeTruthy();
    expect(screen.getByTestId('team-stat-kill')).toBeTruthy();
    for (const k of ['block', 'ace', 'tip', 'teamOnly']) expect([k, screen.queryByTestId(`team-stat-${k}`)]).toEqual([k, null]);
  });
  test('a row that is 0 for one team only still shows (0 – 1)', async () => {
    await open([{ ...pt('B', 1, 'b1'), kind: 'ace' } as Match['events'][number], pt('A', 2)]);
    await fireEvent.press(screen.getByTestId('match-tab-stats'));
    expect(screen.getByTestId('team-stat-ace')).toBeTruthy();
    expect(screen.getByTestId('team-stat-teamOnly')).toBeTruthy(); // A's point had no player
    expect(screen.queryByTestId('team-stat-kill')).toBeNull();
  });
});
