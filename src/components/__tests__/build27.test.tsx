/**
 * Build 27 UI: photo viewer, Player of the Match picker/badge, the live camera's permission
 * messages and upload chip (offline queue), the profile rank card and the Rankings screen, and the
 * score screen's camera button (in the top bar, never over the score or "Who scored").
 */
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import React from 'react';
import { Platform } from 'react-native';
import { INDOOR_RULES } from '../../core/rules';
import { addPoint, type MatchEvent } from '../../core/scoring';
import type { Match, MatchPhoto } from '../../core/types';
import i18n from '../../i18n';

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
let mockMatch: Match;
const mockBackend = {
  watchMatch: (_id: string, cb: (m: Match) => void) => {
    setTimeout(() => cb(mockMatch), 0);
    return () => {};
  },
  saveMatchProgress: jest.fn(async () => {}),
  updateMatch: jest.fn(async () => {}),
  setPlayerOfMatch: jest.fn(async (_m: string, _p: string) => {}),
  uploadMatchPhoto: jest.fn(async (_m: string, _u: string, _uri: string, _p?: (f: number) => void) => {}),
  getRankings: jest.fn(),
};
jest.mock('../../services/backend', () => ({ backend: mockBackend }));
// The byte-level photo check has its own tests (photoFile.test.ts); here every picked file is fine.
const mockReadPhoto = jest.fn(async (_uri: string, _type?: string | null) => ({ blob: {}, type: 'image/jpeg', ext: 'jpg', size: 1000 }));
jest.mock('../../services/photoFile', () => ({ ...jest.requireActual('../../services/photoFile'), readPhoto: (u: string, t?: string | null) => mockReadPhoto(u, t) }));

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
    rules: RULES,
    firstServe: 'A',
    events: [],
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

beforeEach(async () => {
  jest.clearAllMocks();
  await i18n.changeLanguage('en');
});

describe('photo viewer', () => {
  const { PhotoGrid, PhotoViewer } = require('../PhotoGallery');
  const photos: MatchPhoto[] = [1, 2, 3].map((n) => ({ id: `p${n}`, matchId: 'm1', url: `https://x/${n}.jpg`, uploadedBy: 'a2', createdAt: 1_700_000_000_000 }));
  function Harness() {
    const [at, setAt] = React.useState<number | null>(null);
    return (
      <>
        <PhotoGrid photos={photos} onOpen={setAt} testID="t" />
        <PhotoViewer photos={photos} index={at} onClose={() => setAt(null)} nameOf={() => 'A2 Surname'} />
      </>
    );
  }
  it('opens full screen at the tapped photo; next / previous / close; EN and HI labels', async () => {
    await render(<Harness />);
    expect(screen.queryByTestId('photo-viewer')).toBeNull();
    await fireEvent.press(screen.getByTestId('t-1'));
    expect(screen.getByTestId('photo-viewer')).toBeTruthy();
    expect(screen.getByTestId('viewer-counter').props.children).toBe('2 / 3');
    expect(screen.getByLabelText('Close photo')).toBeTruthy();
    expect(screen.getByTestId('viewer-caption').props.children).toMatch(/^Added by A2 Surname · /);
    await fireEvent.press(screen.getByTestId('viewer-next'));
    expect(screen.getByTestId('viewer-counter').props.children).toBe('3 / 3');
    expect(screen.queryByTestId('viewer-next')).toBeNull(); // last photo
    await fireEvent.press(screen.getByTestId('viewer-prev'));
    await fireEvent.press(screen.getByTestId('viewer-prev'));
    expect(screen.getByTestId('viewer-counter').props.children).toBe('1 / 3');
    expect(screen.queryByTestId('viewer-prev')).toBeNull();
    await act(async () => {
      await i18n.changeLanguage('hi');
    });
    expect(screen.getByLabelText('फ़ोटो बंद करें')).toBeTruthy();
    expect(screen.getByTestId('viewer-counter').props.children).toBe('फ़ोटो 1 / 3');
    await fireEvent.press(screen.getByTestId('viewer-close'));
    expect(screen.queryByTestId('photo-viewer')).toBeNull();
  });
});

describe('Player of the Match', () => {
  const { PotmBadge, PotmPicker } = require('../Potm');
  const finished = (over: Partial<Match> = {}) => make({ events: credited(['a2', 'a2', 'a3', 'a2', 'a3']), status: 'finished', finishedAt: Date.now() - 1000, ...over });

  it('auto-picks the top scorer, the scorer can override, confirm saves the choice', async () => {
    await render(<PotmPicker match={finished()} uid="a1" />);
    expect(screen.getByTestId('potm-auto-note').props.children).toMatch(/A2 Surname, most points \(3\)/);
    expect(screen.getByTestId('potm-pick-a2').props.accessibilityState).toMatchObject({ selected: true });
    await fireEvent.press(screen.getByTestId('potm-pick-a3'));
    expect(screen.getByTestId('potm-pick-a3').props.accessibilityState).toMatchObject({ selected: true });
    expect(screen.getByText('Confirm A3')).toBeTruthy();
    await act(async () => {
      await fireEvent.press(screen.getByTestId('potm-confirm'));
    });
    expect(mockBackend.setPlayerOfMatch).toHaveBeenCalledWith('m1', 'a3');
  });

  it.each(['en', 'hi'])('QA C130-3: 0-point players are disabled, with a hint (%s)', async (lang) => {
    await i18n.changeLanguage(lang);
    await render(<PotmPicker match={finished()} uid="a1" />);
    expect(screen.getByTestId('potm-pick-b4').props.accessibilityState).toEqual({ selected: false, disabled: true });
    expect(screen.getByTestId('potm-pick-b4').props.accessibilityHint).toBe(i18n.t('potm.zeroHint'));
    expect(screen.getByTestId('potm-pick-a3').props.accessibilityState).toEqual({ selected: false, disabled: false });
    expect(screen.getByTestId('potm-zero-hint')).toHaveTextContent(i18n.t('potm.zeroHint'));
    await fireEvent.press(screen.getByTestId('potm-pick-b4'));
    expect(screen.getByTestId('potm-pick-a2').props.accessibilityState).toMatchObject({ selected: true }); // still the auto pick
    await i18n.changeLanguage('en');
  });

  it('QA C130-3: when nobody was credited, every player stays choosable and no hint shows', async () => {
    await render(<PotmPicker match={finished({ events: [] })} uid="a1" />);
    expect(screen.queryByTestId('potm-zero-hint')).toBeNull();
    expect(screen.getByTestId('potm-pick-b4').props.accessibilityState).toEqual({ selected: false, disabled: false });
  });

  it('shows nothing to non-scorers, while live, or after 24 h; the badge once confirmed', async () => {
    const r = await render(<PotmPicker match={finished()} uid="a2" />);
    expect(screen.queryByTestId('potm-picker')).toBeNull();
    await r.rerender(<PotmPicker match={finished({ status: 'live' })} uid="a1" />);
    expect(screen.queryByTestId('potm-picker')).toBeNull();
    await r.rerender(<PotmPicker match={finished({ finishedAt: Date.now() - 25 * 3600_000 })} uid="a1" />);
    expect(screen.queryByTestId('potm-picker')).toBeNull();
    await r.rerender(<PotmBadge match={finished({ playerOfMatchId: 'a3' })} />);
    expect(screen.getByTestId('potm-badge')).toBeTruthy();
    expect(screen.getByText('A3 Surname')).toBeTruthy();
    expect(screen.getByText('2 pts')).toBeTruthy();
  });

  it('translates a refusal (e.g. already confirmed elsewhere)', async () => {
    const { CodedError } = require('../../core/codedError');
    mockBackend.setPlayerOfMatch.mockRejectedValueOnce(new CodedError('potm_already_set', 'x'));
    await render(<PotmPicker match={finished()} uid="a1" />);
    await act(async () => {
      await fireEvent.press(screen.getByTestId('potm-confirm'));
    });
    expect(screen.getByTestId('potm-error').props.children).toBe('The Player of the Match has already been confirmed.');
  });
});

describe('live camera: permission messages', () => {
  const { LiveCameraButton } = require('../MatchCamera');
  const setOS = (os: string) => Object.defineProperty(Platform, 'OS', { get: () => os, configurable: true });
  const realOS = Platform.OS;
  afterEach(() => setOS(realOS));

  it('phone: explains before the OS prompt; denied → message with Open settings and gallery (EN/HI)', async () => {
    setOS('android');
    mockPicker.getCameraPermissionsAsync.mockResolvedValue({ granted: false, status: 'undetermined', canAskAgain: true });
    mockPicker.requestCameraPermissionsAsync.mockResolvedValue({ granted: false, status: 'denied', canAskAgain: false });
    await render(<LiveCameraButton matchId="m1" uid="a1" />);
    await act(async () => {
      await fireEvent.press(screen.getByTestId('live-camera'));
    });
    expect(screen.getByTestId('camera-explain')).toBeTruthy();
    expect(screen.getByText('Allow the camera?')).toBeTruthy();
    expect(mockPicker.requestCameraPermissionsAsync).not.toHaveBeenCalled(); // our explanation first
    await act(async () => {
      await fireEvent.press(screen.getByTestId('camera-explain-continue'));
    });
    expect(mockPicker.requestCameraPermissionsAsync).toHaveBeenCalled();
    expect(screen.getByTestId('camera-denied')).toBeTruthy();
    expect(screen.getByTestId('camera-open-settings')).toBeTruthy();
    expect(screen.getByTestId('camera-use-gallery')).toBeTruthy();
    expect(mockPicker.launchCameraAsync).not.toHaveBeenCalled();
    await act(async () => {
      await i18n.changeLanguage('hi');
    });
    expect(screen.getByText('कैमरा की अनुमति बंद है')).toBeTruthy();
    expect(screen.getByText('सेटिंग्स खोलें')).toBeTruthy();
  });

  it('phone: already denied for good → straight to the message; granted → camera, photo queued', async () => {
    setOS('ios');
    mockPicker.getCameraPermissionsAsync.mockResolvedValueOnce({ granted: false, status: 'denied', canAskAgain: false });
    const r = await render(<LiveCameraButton key="1" matchId="m1" uid="a1" />);
    await act(async () => {
      await fireEvent.press(screen.getByTestId('live-camera'));
    });
    expect(screen.getByTestId('camera-denied')).toBeTruthy();
    mockPicker.getCameraPermissionsAsync.mockResolvedValueOnce({ granted: true, status: 'granted', canAskAgain: true });
    mockPicker.launchCameraAsync.mockResolvedValueOnce({ canceled: false, assets: [{ uri: 'file:///cam.jpg', fileSize: 1000 }] });
    await r.rerender(<LiveCameraButton key="2" matchId="m1" uid="a1" />);
    await act(async () => {
      await fireEvent.press(screen.getByTestId('live-camera'));
    });
    expect(mockBackend.uploadMatchPhoto).toHaveBeenCalledWith('m1', 'a1', 'file:///cam.jpg', expect.any(Function), { idempotencyKey: expect.stringMatching(/^q_[a-z0-9]+_[a-z0-9]+$/) });
  });

  /** A fake document whose file input "picks" the given file when clicked; records the accept list. */
  function fakeDocument(file: { name: string; size: number; type: string } | null) {
    const seen: { accept?: string } = {};
    const listeners: Record<string, () => void> = {};
    const input = {
      type: '',
      style: {} as Record<string, string>,
      files: file ? [file] : [],
      set accept(v: string) {
        seen.accept = v;
      },
      addEventListener: (ev: string, fn: () => void) => (listeners[ev] = fn),
      remove: () => {},
      click: () => setTimeout(() => (file ? listeners.change?.() : listeners.cancel?.()), 0),
    };
    return { seen, doc: { createElement: () => input, body: { appendChild: () => {} } } };
  }

  it('web (PRD PHOTO-01): no camera button – the live button opens the file picker with the allow-list; a too-large photo is refused', async () => {
    setOS('web');
    const g = globalThis as { document?: unknown; URL: { createObjectURL?: unknown } };
    const oldDoc = g.document;
    const oldCreate = g.URL.createObjectURL;
    const f = fakeDocument({ name: 'big.jpg', size: 11 * 1024 * 1024, type: 'image/jpeg' });
    g.document = f.doc;
    g.URL.createObjectURL = () => 'blob:big';
    try {
      await render(<LiveCameraButton matchId="m1" uid="a1" label />);
      expect(screen.getByText('Add photo')).toBeTruthy();
      expect(screen.getByTestId('live-camera').props.accessibilityHint).toBe('Choose a photo from this device.');
      await act(async () => {
        await fireEvent.press(screen.getByTestId('live-camera'));
        await new Promise((r) => setTimeout(r, 5));
      });
      expect(screen.queryByTestId('camera-explain')).toBeNull();
      expect(f.seen.accept).toBe('image/jpeg,image/png,image/webp,image/heic,image/gif'); // no stray ",image/*"
      expect(mockPicker.launchCameraAsync).not.toHaveBeenCalled();
      expect(screen.getByTestId('camera-error')).toBeTruthy();
      expect(screen.getByText('Photos must be smaller than 10 MB. Pick a smaller one.')).toBeTruthy();
      expect(mockBackend.uploadMatchPhoto).not.toHaveBeenCalled();
    } finally {
      g.document = oldDoc;
      g.URL.createObjectURL = oldCreate;
    }
  });

  it('every backend: a file refused by the byte check (SVG, renamed .txt) is not queued; translated error (EN/HI)', async () => {
    setOS('android');
    const { photoError } = require('../../services/photoFile');
    const { photoQueue } = require('../../services/photoQueue');
    await photoQueue._reset();
    mockPicker.launchImageLibraryAsync.mockResolvedValueOnce({ canceled: false, assets: [{ uri: 'file:///notes.jpg', fileSize: 500, mimeType: 'image/jpeg' }] });
    mockReadPhoto.mockRejectedValueOnce(photoError('photo_type'));
    await render(<LiveCameraButton matchId="m1" uid="a1" />);
    await act(async () => {
      await fireEvent(screen.getByTestId('live-camera'), 'longPress');
    });
    expect(mockReadPhoto).toHaveBeenCalledWith('file:///notes.jpg', 'image/jpeg');
    expect(screen.getByText('Only JPEG, PNG, WebP, HEIC or GIF photos can be uploaded.')).toBeTruthy();
    expect(photoQueue._items()).toEqual([]);
    expect(mockBackend.uploadMatchPhoto).not.toHaveBeenCalled();
  });
});

describe('upload chip + offline queue', () => {
  const { UploadChip } = require('../MatchCamera');
  const { photoQueue } = require('../../services/photoQueue');
  beforeEach(async () => {
    await photoQueue._reset();
    jest.useFakeTimers();
  });
  afterEach(() => jest.useRealTimers());

  it('offline: stays queued (AsyncStorage) with a "waiting" chip, retries and uploads when back online', async () => {
    const AsyncStorage = require('@react-native-async-storage/async-storage');
    mockBackend.uploadMatchPhoto.mockRejectedValueOnce(new TypeError('Network request failed'));
    await render(<UploadChip matchId="m1" />);
    await act(async () => {
      await photoQueue.add('m1', 'a1', 'file:///a.jpg');
    });
    expect(screen.getByTestId('upload-chip-text').props.children).toBe('Offline · 1 photo waiting');
    expect(JSON.parse(await AsyncStorage.getItem('volleylive-photo-queue-v1'))).toHaveLength(1);
    let release!: () => void;
    mockBackend.uploadMatchPhoto.mockImplementationOnce(async (_m, _u, _uri, onProgress) => {
      onProgress?.(0.4);
      await new Promise<void>((r) => (release = r));
    });
    await act(async () => {
      await jest.advanceTimersByTimeAsync(5_100); // first retry after 5 s
    });
    expect(screen.getByTestId('upload-chip-text').props.children).toBe('Uploading 40%');
    await act(async () => {
      release();
      await jest.advanceTimersByTimeAsync(10);
    });
    expect(screen.getByTestId('upload-chip-text').props.children).toBe('Photo added');
    expect(JSON.parse(await AsyncStorage.getItem('volleylive-photo-queue-v1'))).toEqual([]);
    await act(async () => {
      await jest.advanceTimersByTimeAsync(3_100);
    });
    expect(screen.queryByTestId('upload-chip')).toBeNull();
  });

  it('refused (not a player / bad file): dropped from the queue with a translated failure', async () => {
    const { CodedError } = require('../../core/codedError');
    mockBackend.uploadMatchPhoto.mockRejectedValueOnce(new CodedError('photo_not_allowed', 'no'));
    await render(<UploadChip matchId="m1" />);
    await act(async () => {
      await photoQueue.add('m1', 'zz', 'file:///a.jpg');
    });
    expect(photoQueue._items()).toEqual([]);
    expect(screen.getByTestId('upload-chip-text').props.children).toBe('Photo not added · tap');
    await fireEvent.press(screen.getByTestId('upload-chip'));
    expect(screen.getByText('Only the players and the scorer of this match can add photos.')).toBeTruthy();
  });
});

describe('profile rank card and Rankings screen', () => {
  const { RankCard } = require('../RankCard');
  const row = (playerId: string, rank: number | null, extra = {}) => ({ playerId, name: `${playerId} Name`, matches: 4, wins: 3, points: 20, potm: 1, rankingPoints: 75, winPct: 75, rank, ...extra });

  it('"Rank #N of M" with points, matches, wins, win % and POTM count; unranked hint', async () => {
    const a = await render(<RankCard rankings={{ ranked: [row('x', 1), row('a1', 2)], total: 7, minMatches: 3, me: row('a1', 2) }} />);
    const again = (x: React.ReactElement) => a.rerender(x);
    expect(screen.getByTestId('profile-rank').props.accessibilityLabel).toBe('Rank #2 of 7');
    expect(screen.getByTestId('profile-rank-num').props.children).toBe('#2');
    expect(screen.getByTestId('profile-rank-points').props.children).toBe(75);
    expect(screen.getByTestId('profile-rank-matches').props.children).toBe(4);
    expect(screen.getByTestId('profile-rank-wins').props.children).toBe(3);
    expect(screen.getByTestId('profile-rank-winpct').props.children).toBe('75%');
    expect(screen.getByTestId('profile-potm-count').props.children).toBe(1);
    await again(<RankCard rankings={{ ranked: [], total: 0, minMatches: 3, me: row('a1', null, { matches: 2 }) }} />);
    expect(screen.getByTestId('profile-rank').props.accessibilityLabel).toBe('Not ranked yet');
    expect(screen.getByText('Not ranked yet')).toBeTruthy();
    expect(screen.getByTestId('profile-rank-hint').props.children).toBe('Play 1 more finished match to get ranked.');
    await act(async () => {
      await i18n.changeLanguage('hi');
    });
    expect(screen.getByTestId('profile-rank').props.accessibilityLabel).toBe('अभी रैंक नहीं मिली');
  });

  it('Rankings screen lists the top players with your own row highlighted', async () => {
    mockBackend.getRankings.mockResolvedValueOnce({ ranked: [row('x', 1), row('a1', 2), row('y', 3)], total: 3, minMatches: 3, me: row('a1', 2) });
    const Rankings = require('../../app/rankings').default;
    await render(<Rankings />);
    await act(async () => {});
    expect(screen.getByTestId('ranking-me')).toBeTruthy();
    expect(screen.getByTestId('ranking-1')).toBeTruthy();
    expect(screen.getByTestId('ranking-3')).toBeTruthy();
    expect(screen.getByTestId('ranking-me').props.accessibilityLabel).toMatch(/#2 a1 Name, You/);
  });
});

describe('score screen: live camera', () => {
  const ScoreScreen = require('../../app/match/[id]/score').default;
  it('camera button sits in the top bar; the "Who scored" sheet and the score stay visible', async () => {
    jest.useFakeTimers();
    mockMatch = make();
    await render(<ScoreScreen />);
    await act(async () => {
      await jest.advanceTimersByTimeAsync(5);
    });
    expect(screen.getByTestId('live-camera')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('tap-A'));
    expect(screen.getByTestId('attrib-skip')).toBeTruthy();
    expect(screen.getByTestId('live-camera')).toBeTruthy();
    expect(screen.getByTestId('score-A').props.children).toBe(1);
    // the button is part of the top bar row (same parent as the ⋮ menu), not an overlay
    const cam = screen.getByTestId('live-camera');
    const menu = screen.getByTestId('score-menu');
    const rowOf = (n: { parent: unknown }) => {
      let p = n.parent as { type?: unknown; props?: { style?: unknown }; parent?: unknown } | null;
      while (p && typeof p.type !== 'string') p = p.parent as typeof p;
      return p;
    };
    expect(rowOf(cam as never)).toBe(rowOf(menu as never));
    jest.useRealTimers();
  });

  it('1.3.0 (QA retest 1.2.1 INFO): after the POTM is confirmed the match is closed: undo does nothing, no POTM left on a re-opened match', async () => {
    jest.useFakeTimers();
    mockMatch = make({ events: credited(['a2', 'a2', 'a2', 'a3', 'a2']), status: 'finished', finishedAt: 5, playerOfMatchId: 'a2' });
    await render(<ScoreScreen />);
    await act(async () => {
      await jest.advanceTimersByTimeAsync(5);
    });
    expect(screen.getByTestId('potm-badge')).toBeTruthy(); // confirmed: the dialog shows the badge
    expect(screen.queryByTestId('undo-last')).toBeNull();
    const before = mockBackend.saveMatchProgress.mock.calls.length;
    await act(async () => {
      await fireEvent.press(screen.getByTestId('undo'));
    });
    expect(mockBackend.saveMatchProgress.mock.calls.length).toBe(before);
    jest.useRealTimers();
  });

  it.each(['en', 'hi'])('1.3.1 (QA C130-4): with a POTM set the footer Undo looks disabled and says why (%s)', async (lang) => {
    jest.useFakeTimers();
    await i18n.changeLanguage(lang);
    mockMatch = make({ events: credited(['a2', 'a2', 'a2', 'a3', 'a2']), status: 'finished', finishedAt: 5, playerOfMatchId: 'a2' });
    await render(<ScoreScreen />);
    await act(async () => {
      await jest.advanceTimersByTimeAsync(5);
    });
    const u = screen.getByTestId('undo');
    expect(u.props.accessibilityState).toMatchObject({ disabled: true });
    expect(screen.getByTestId('undo-sub')).toHaveTextContent(i18n.t('score.undoClosed'));
    expect(u.props.accessibilityLabel).toContain(i18n.t('score.undoClosed'));
    const flat = (st: unknown): Record<string, unknown> => (Array.isArray(st) ? Object.assign({}, ...st.map(flat)) : ((st as object) ?? {}) as Record<string, unknown>);
    const { colors } = require('../../theme');
    const bg = typeof u.props.style === 'function' ? flat(u.props.style({ pressed: false })).backgroundColor : flat(u.props.style).backgroundColor;
    expect(bg).toBe(colors.disabledBg);
    await i18n.changeLanguage('en');
    jest.useRealTimers();
  });

  it.each(['en', 'hi'])('1.3.1+ (QA C131-1): the selected scorer chip shows the full first name (wraps/shrinks, tick on the avatar) (%s)', async (lang) => {
    jest.useFakeTimers();
    await i18n.changeLanguage(lang);
    const named = players('a').map((p, i) => (i === 0 ? { ...p, name: 'Aarav Sharma' } : p));
    mockMatch = make({ teamA: { teamId: null, name: 'Delhi Smashers', color: '#D93636', players: named } as Match['teamA'] });
    await render(<ScoreScreen />);
    await act(async () => {
      await jest.advanceTimersByTimeAsync(5);
    });
    await fireEvent.press(screen.getByTestId('tap-A'));
    await fireEvent.press(screen.getByTestId('credit-a1'));
    const name = screen.getByTestId('credit-name-a1');
    expect(name).toHaveTextContent('Aarav'); // the whole first name, no ellipsis text
    expect(name.props.numberOfLines).toBeGreaterThanOrEqual(2); // may wrap instead of "Aa…"
    expect(name.props.adjustsFontSizeToFit).toBe(true);
    const flat = (st: unknown): Record<string, unknown> => (Array.isArray(st) ? Object.assign({}, ...st.map(flat)) : ((st as object) ?? {}) as Record<string, unknown>);
    expect(flat(name.props.style).flex).toBe(1); // takes the free width of the chip
    // the tick no longer takes width beside the name: it is absolutely positioned on the avatar
    const tick = screen.getByTestId('credit-tick-a1');
    expect(flat(tick.props.style).position).toBe('absolute');
    expect(screen.getByTestId('credit-a1').props.accessibilityState).toMatchObject({ selected: true });
    expect(screen.queryByTestId('credit-tick-a2')).toBeNull();
    await i18n.changeLanguage('en');
    jest.useRealTimers();
  });

  it('match over: the POTM picker is in the result dialog, auto-pick selected', async () => {
    jest.useFakeTimers();
    mockMatch = make({ events: credited(['a2', 'a2', 'a2', 'a3']) });
    await render(<ScoreScreen />);
    await act(async () => {
      await jest.advanceTimersByTimeAsync(5);
    });
    await fireEvent.press(screen.getByTestId('tap-A')); // match point won
    await fireEvent.press(screen.getByTestId('attrib-skip'));
    expect(screen.getByTestId('potm-picker')).toBeTruthy();
    expect(screen.getByTestId('potm-pick-a2').props.accessibilityState).toMatchObject({ selected: true });
    jest.useRealTimers();
  });
});
