/**
 * 1.3.2 Live match v2 (design-spec §11): tap a player chip to score (one atomic event, live counts,
 * undo label, team-only "Opp. error" point, debounce, ≥48 dp targets, disabled when finished), the
 * safe-area bottom bar, the gallery multi-select through the photo checks, and the photo sheet.
 */
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import React from 'react';
import { StyleSheet } from 'react-native';
import { INDOOR_RULES } from '../../core/rules';
import type { Match } from '../../core/types';
import i18n from '../../i18n';
import ScoreScreen from '../../app/match/[id]/score';
import { TEAM_HALF_TAP } from '../../core/liveFlags';
import { queuePickedPhotos } from '../../services/photoPick';

let mockInsets = { top: 0, bottom: 0, left: 0, right: 0 };
jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null, MaterialCommunityIcons: () => null }));
jest.mock('expo-image', () => ({ Image: () => null }));
const mockHaptic = jest.fn();
jest.mock('expo-haptics', () => ({
  impactAsync: (s: string) => (mockHaptic('impact', s), Promise.resolve()),
  selectionAsync: () => Promise.resolve(),
  notificationAsync: (s: string) => (mockHaptic('notify', s), Promise.resolve()),
  ImpactFeedbackStyle: { Medium: 'm', Light: 'l', Heavy: 'h' },
  NotificationFeedbackType: { Success: 's', Warning: 'w', Error: 'e' },
}));
jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ id: 'm1' }),
  router: { replace: jest.fn(), back: jest.fn(), canGoBack: () => true, push: jest.fn() },
}));
jest.mock('react-native-safe-area-context', () => {
  const { View } = require('react-native');
  return { SafeAreaView: View, SafeAreaProvider: View, useSafeAreaInsets: () => mockInsets };
});
jest.mock('../../state/AuthContext', () => ({ useAuth: () => ({ isAdmin: false, termsOk: true, user: { uid: 'a1' } }), useMe: () => ({ id: 'a1', name: 'A1' }) }));
const mockLaunch = jest.fn();
jest.mock('expo-image-picker', () => ({
  launchImageLibraryAsync: (o: unknown) => mockLaunch(o),
  launchCameraAsync: jest.fn(),
  getCameraPermissionsAsync: jest.fn(async () => ({ granted: true })),
  requestCameraPermissionsAsync: jest.fn(async () => ({ granted: true })),
  MediaTypeOptions: { Images: 'Images' },
}));

const players = (p: string) => Array.from({ length: 6 }, (_, i) => ({ id: `${p}${i + 1}`, name: `${p.toUpperCase()}${i + 1} Surname`, photoURL: null }));
let mockMatch: Match;
const mockSave = jest.fn(async (_id: string, _p: { events: Match['events'] }) => {});
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
    saveMatchProgress: (id: string, p: { events: Match['events'] }) => mockSave(id, p),
    updateMatch: jest.fn(async () => {}),
  },
}));

const make = (events: Match['events'] = [], over: Partial<Match> = {}): Match =>
  ({
    id: 'm1',
    teamA: { teamId: null, name: 'Delhi Spikers', color: '#D93636', players: players('a') },
    teamB: { teamId: null, name: 'Mumbai Blockers', color: '#001F4D', players: players('b') },
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
    ...over,
  }) as unknown as Match;

async function open(events: Match['events'] = [], over: Partial<Match> = {}) {
  mockMatch = make(events, over);
  await render(<ScoreScreen />);
  await act(async () => {
    await jest.advanceTimersByTimeAsync(5);
  });
}
const lastSaved = () => mockSave.mock.calls[mockSave.mock.calls.length - 1][1].events;
const txt = (id: string) => {
  const c = screen.getByTestId(id).props.children;
  return Array.isArray(c) ? c.join('') : String(c);
};

jest.setTimeout(15_000);
beforeEach(() => {
  jest.useFakeTimers();
  mockSave.mockClear();
  mockHaptic.mockClear();
  mockInsets = { top: 0, bottom: 0, left: 0, right: 0 };
});
afterEach(async () => {
  await act(async () => {
    await i18n.changeLanguage('en');
  });
  jest.useRealTimers();
});

describe('score screen v2: tap a player to score', () => {
  it('ships with team-half tapping OFF (waits on product confirmation)', () => {
    expect(TEAM_HALF_TAP).toBe(false);
  });

  it('a chip tap saves ONE event (team +1 and player +1); the chip count, the score and the undo label follow', async () => {
    await open();
    expect(screen.queryByTestId('tap-A')).toBeNull();
    await fireEvent.press(screen.getByTestId('court-tile-a3'));
    expect(mockSave).toHaveBeenCalledTimes(1);
    expect(lastSaved()).toEqual([expect.objectContaining({ type: 'point', side: 'A', playerId: 'a3' })]);
    expect(txt('court-pts-a3')).toMatch(/^1/);
    expect(txt('viewer-score-A')).toBe('1');
    expect(txt('undo-sub')).toContain('A3');
    expect(mockHaptic).toHaveBeenCalledWith('impact', 'm');
    // undo reverts both
    await fireEvent.press(screen.getByTestId('undo'));
    expect(lastSaved()).toEqual([]);
    expect(txt('court-pts-a3')).toMatch(/^0/);
    expect(txt('viewer-score-A')).toBe('0');
  });

  it('a double tap on the same chip within the debounce counts once', async () => {
    await open();
    await fireEvent.press(screen.getByTestId('court-tile-b2'));
    await fireEvent.press(screen.getByTestId('court-tile-b2'));
    expect(mockSave).toHaveBeenCalledTimes(1);
    await act(async () => {
      await jest.advanceTimersByTimeAsync(300);
    });
    await fireEvent.press(screen.getByTestId('court-tile-b2'));
    expect(lastSaved()).toHaveLength(2);
  });

  it('"+1 · Opp. error" is a team point with no player credit', async () => {
    await open();
    await fireEvent.press(screen.getByTestId('team-point-B'));
    expect(lastSaved()).toHaveLength(1);
    expect(lastSaved()[0]).toMatchObject({ type: 'point', side: 'B' });
    expect((lastSaved()[0] as { playerId?: string }).playerId).toBeUndefined();
    expect(txt('viewer-score-B')).toBe('1');
  });

  it('chips are ≥ 48 dp (84 dp tall) and are disabled once the match is over', async () => {
    const win = (side: 'A' | 'B', n: number, at0: number) => Array.from({ length: n }, (_, i) => ({ type: 'point' as const, side, at: at0 + i }));
    await open();
    const st = StyleSheet.flatten(screen.getByTestId('court-tile-a1').props.style);
    expect((st.minHeight ?? st.height) as number).toBeGreaterThanOrEqual(48);
    await screen.unmount();
    await open([...win('A', 5, 1), ...win('A', 5, 10)], { status: 'finished' } as Partial<Match>);
    mockSave.mockClear();
    await fireEvent.press(screen.getByTestId('court-tile-a1'));
    expect(mockSave).not.toHaveBeenCalled();
  });

  it('the Undo/Swap/Stats bar sits above the gesture inset', async () => {
    mockInsets = { top: 24, bottom: 48, left: 0, right: 0 };
    await open();
    expect(StyleSheet.flatten(screen.getByTestId('score-bottom-bar').props.style).paddingBottom).toBe(48);
    await screen.unmount();
    mockInsets = { top: 0, bottom: 0, left: 0, right: 0 };
    await open();
    expect(StyleSheet.flatten(screen.getByTestId('score-bottom-bar').props.style).paddingBottom).toBe(16);
  });

  it('works in Hindi', async () => {
    await act(async () => {
      await i18n.changeLanguage('hi');
    });
    await open();
    await fireEvent.press(screen.getByTestId('court-tile-a2'));
    expect(txt('undo-sub')).toMatch(/[\u0900-\u097F]/);
  });
});

describe('gallery multi-select goes through the same checks and queue', () => {
  const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...new Array(200).fill(1), 0xff, 0xd9]);
  const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...new Array(200).fill(2), 0x82]);
  const SVG = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>'.padEnd(300, ' '));
  const files: Record<string, [Uint8Array, string]> = { 'f:1': [JPEG, 'image/jpeg'], 'f:2': [PNG, 'image/png'], 'f:3': [SVG, 'image/svg+xml'], 'f:4': [new TextEncoder().encode('just text, renamed to .png'.padEnd(300, '.')), 'image/png'] };
  const realFetch = global.fetch;
  beforeAll(() => {
    global.fetch = jest.fn(async (u: string) => ({ ok: true, status: 200, blob: async () => new Blob([files[u][0] as BlobPart], { type: files[u][1] }) })) as unknown as typeof fetch;
  });
  afterAll(() => {
    global.fetch = realFetch;
  });

  it('valid files are queued; bad type / spoofed / too large are refused one by one; over the limit is dropped', async () => {
    jest.useRealTimers();
    const add = jest.fn(async () => {});
    const picked = [
      { uri: 'f:1', fileSize: JPEG.length, mimeType: 'image/jpeg' },
      { uri: 'f:2', fileSize: PNG.length, mimeType: 'image/png' },
      { uri: 'f:3', fileSize: SVG.length, mimeType: 'image/svg+xml' },
      { uri: 'f:4', fileSize: 300, mimeType: 'image/png' }, // a text file renamed .png: magic bytes refuse it
      { uri: 'f:1', fileSize: 50 * 1024 * 1024, mimeType: 'image/jpeg' },
      ...Array.from({ length: 7 }, () => ({ uri: 'f:1', fileSize: JPEG.length, mimeType: 'image/jpeg' })),
    ];
    const r = await queuePickedPhotos(picked, 'm1', 'a1', { add });
    expect(r.dropped).toBe(2); // 12 picked, limit 10
    expect(r.failed.map((f) => f.index)).toEqual([2, 3, 4]);
    expect(r.failed.map((f) => (f.error as { code?: string }).code)).toEqual(['photo_type', 'photo_type', 'photo_too_large']);
    expect(r.queued).toBe(7);
    expect(add).toHaveBeenCalledTimes(7);
    expect(add).toHaveBeenCalledWith('m1', 'a1', 'f:1');
  });

  it('the native picker is asked for multi-select with a limit of 10', async () => {
    jest.useRealTimers();
    const { Platform } = require('react-native');
    const os = Platform.OS;
    Platform.OS = 'android';
    try {
      const { pickPhotos, MAX_GALLERY_PICK } = require('../../services/camera');
      expect(MAX_GALLERY_PICK).toBe(10);
      mockLaunch.mockResolvedValueOnce({ canceled: false, assets: Array.from({ length: 12 }, (_, i) => ({ uri: `u${i}`, fileSize: 10, mimeType: 'image/jpeg' })) });
      const got = await pickPhotos();
      expect(mockLaunch).toHaveBeenCalledWith(expect.objectContaining({ allowsMultipleSelection: true, selectionLimit: 10 }));
      expect(got).toHaveLength(10);
    } finally {
      Platform.OS = os;
    }
  });
});
