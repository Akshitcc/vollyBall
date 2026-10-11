/**
 * 1.3.4 score screen: the offline / pending indicator (QA D133-1, tested with the demo-style
 * "Simulate offline"), a bench credit refused by the backend (D133-5), screen-reader hints that say
 * a single tap scores, the Hindi Undo subtitle on 2 lines, long team names wrapping, chip width.
 */
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import React from 'react';
import { StyleSheet } from 'react-native';
import { INDOOR_RULES } from '../../core/rules';
import type { Match } from '../../core/types';
import i18n from '../../i18n';
import ScoreScreen from '../../app/match/[id]/score';
import { connectivity } from '../../services/connectivity';

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
const mockSave = jest.fn(async (_id: string, _p: { events: Match['events'] }): Promise<void> => {});
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


const offlineError = () => new TypeError('Network request failed (offline)');

jest.setTimeout(15_000);
beforeEach(async () => {
  jest.useFakeTimers();
  await require('@react-native-async-storage/async-storage').clear(); // no unsynced score cache from another test
  mockSave.mockReset();
  mockSave.mockImplementation(async () => {
    if (connectivity.isSimulatedOffline()) throw offlineError();
  });
  connectivity.setSimulatedOffline(false);
  connectivity.reportNetworkSuccess();
});
afterEach(async () => {
  connectivity.setSimulatedOffline(false);
  connectivity.reportNetworkSuccess();
  await act(async () => {
    await i18n.changeLanguage('en');
  });
  jest.useRealTimers();
});
const tap = async (id: string) => {
  await fireEvent.press(screen.getByTestId(`court-tile-${id}`));
  await act(async () => {
    await jest.advanceTimersByTimeAsync(300); // past the chip debounce
  });
};

describe('D133-1: offline / pending indicator', () => {
  it('✓ Synced → "Offline · N pending" while offline (one per rally) → back online: retried, ✓ Synced', async () => {
    await open();
    expect(txt('sync-label')).toBe('✓ Synced');
    await act(async () => connectivity.setSimulatedOffline(true));
    await tap('a1');
    expect(txt('sync-label')).toBe('⚠ Offline · 1 pending');
    await tap('a2');
    expect(txt('sync-label')).toBe('⚠ Offline · 2 pending');
    // the rallies are on screen (kept on the phone) even though nothing was saved
    expect(mockSave).toHaveBeenCalled();
    await act(async () => connectivity.setSimulatedOffline(false));
    await act(async () => {
      await jest.advanceTimersByTimeAsync(10);
    });
    expect(txt('sync-label')).toBe('Syncing 2…'); // 1.3.5: the flush is visible
    await act(async () => {
      await jest.advanceTimersByTimeAsync(900);
    });
    expect(txt('sync-label')).toBe('✓ Synced');
    expect(lastSaved()).toHaveLength(2);
  });

  it('a slow save shows "Syncing 1…" (not "Synced") until the backend confirms it', async () => {
    let release: () => void = () => {};
    await open();
    mockSave.mockImplementationOnce(() => new Promise<void>((r) => (release = r)));
    await tap('a1');
    expect(txt('sync-label')).toBe('Syncing 1…');
    await act(async () => {
      release();
      await jest.advanceTimersByTimeAsync(5);
    });
    expect(txt('sync-label')).toBe('✓ Synced');
  });

  it('a network failure on a phone (no simulation) also flips it to offline, and the retry clears it', async () => {
    await open();
    mockSave.mockImplementationOnce(async () => {
      throw offlineError();
    });
    await tap('a1');
    expect(txt('sync-label')).toBe('⚠ Offline · 1 pending');
    expect(connectivity.isOnline()).toBe(false);
    await act(async () => {
      await jest.advanceTimersByTimeAsync(5100); // the 5 s retry
    });
    expect(txt('sync-label')).toBe('Syncing 1…');
    await act(async () => {
      await jest.advanceTimersByTimeAsync(900);
    });
    expect(txt('sync-label')).toBe('✓ Synced');
    expect(connectivity.isOnline()).toBe(true);
  });

  it('Hindi', async () => {
    await act(async () => {
      await i18n.changeLanguage('hi');
    });
    await open();
    await act(async () => connectivity.setSimulatedOffline(true));
    await tap('a1');
    expect(txt('sync-label')).toBe('⚠ ऑफ़लाइन · 1 बाकी');
  });
});

describe('D133-1 retest: the scorer header in each state (EN + HI)', () => {
  // One render per state; each checks the visible header label and that offline is drawn in the warning colour.
  const color = () => StyleSheet.flatten(screen.getByTestId('sync-label').props.style).color;
  const headerIn = async (lang: 'en' | 'hi') => {
    await act(async () => {
      await i18n.changeLanguage(lang);
    });
    const seen: Record<string, string> = {};
    await open();
    seen.synced = txt('sync-label');
    const syncedColor = color();

    // slow save → syncing
    let release: () => void = () => {};
    mockSave.mockImplementationOnce(() => new Promise<void>((r) => (release = r)));
    await tap('a1');
    seen.syncing = txt('sync-label');
    await act(async () => {
      release();
      await jest.advanceTimersByTimeAsync(5);
    });

    // demo "Simulate offline" switched on, nothing pending yet
    await act(async () => connectivity.setSimulatedOffline(true));
    seen.simulatedIdle = txt('sync-label');
    expect(color()).not.toBe(syncedColor);
    // …then two rallies scored while simulated offline
    await tap('a2');
    await tap('a3');
    seen.simulatedPending = txt('sync-label');
    await act(async () => connectivity.setSimulatedOffline(false));
    await act(async () => {
      await jest.advanceTimersByTimeAsync(10);
    });
    seen.flushing = txt('sync-label');
    await act(async () => {
      await jest.advanceTimersByTimeAsync(900);
    });
    seen.backOnline = txt('sync-label');

    // phone, no simulation: a save fails with a network error
    mockSave.mockImplementationOnce(async () => {
      throw offlineError();
    });
    await tap('a4');
    seen.failedSave = txt('sync-label');
    expect(color()).not.toBe(syncedColor);
    await act(async () => {
      await jest.advanceTimersByTimeAsync(6000);
    });

    // phone, a save that hangs (no answer at all) → offline after 4 s
    mockSave.mockImplementationOnce(() => new Promise<void>(() => {}));
    await tap('a5');
    await act(async () => {
      await jest.advanceTimersByTimeAsync(4100);
    });
    seen.hangingSave = txt('sync-label');
    return seen;
  };

  it('English', async () => {
    expect(await headerIn('en')).toEqual({
      synced: '✓ Synced',
      syncing: 'Syncing 1…',
      simulatedIdle: '⚠ Offline – saved on phone',
      simulatedPending: '⚠ Offline · 2 pending',
      flushing: 'Syncing 2…',
      backOnline: '✓ Synced',
      failedSave: '⚠ Offline · 1 pending',
      hangingSave: '⚠ Offline · 1 pending',
    });
  });
  it('Hindi', async () => {
    const hi = await headerIn('hi');
    expect(hi.synced).toBe('✓ सिंक हो गया');
    expect(hi.simulatedPending).toBe('⚠ ऑफ़लाइन · 2 बाकी');
    expect(hi.failedSave).toBe('⚠ ऑफ़लाइन · 1 बाकी');
    expect(hi.hangingSave).toBe('⚠ ऑफ़लाइन · 1 बाकी');
    expect(hi.simulatedIdle).toMatch(/^⚠ /);
    expect(hi.syncing).not.toBe(hi.synced);
    expect(hi.backOnline).toBe('✓ सिंक हो गया');
  });
});

describe('D133-5: a credit for a player who is not on court', () => {
  it('the backend refusal (not_on_court) is shown translated and not retried as "offline"', async () => {
    await open();
    mockSave.mockImplementationOnce(async () => {
      throw Object.assign(new Error('That player is not on court'), { code: 'not_on_court' });
    });
    await tap('a1');
    expect(txt('sync-label')).toBe('✕ Not saved');
    expect(screen.getByText(i18n.t('errors.codes.not_on_court'))).toBeTruthy();
    const calls = mockSave.mock.calls.length;
    await act(async () => {
      await jest.advanceTimersByTimeAsync(6000);
    });
    expect(mockSave.mock.calls.length).toBe(calls);
  });
});

describe('lows', () => {
  it('screen-reader text: chips and panels say one tap scores; no "double-tap"', async () => {
    await open();
    const chip = screen.getByTestId('court-tile-a1');
    expect(chip.props.accessibilityLabel).toBe('A1 Surname, position 1, 0 points');
    expect(chip.props.accessibilityHint).toBe('One tap gives A1 Surname and Delhi Spikers the point.');
    const panel = screen.getByTestId('team-panel-B');
    expect(panel.props.accessibilityHint).toBe('One tap gives Mumbai Blockers a point with no player credit.');
    expect(JSON.stringify([chip.props.accessibilityLabel, panel.props.accessibilityLabel])).not.toMatch(/double/i);
  });

  it('long team names wrap (2 lines, shrink) on the scorer panel instead of "Yamuna Block…"', async () => {
    await open([], { teamB: { teamId: null, name: 'Yamuna Blockers', color: '#001F4D', players: players('b') } } as Partial<Match>);
    const name = screen.getByTestId('team-name-B');
    expect(name.props.numberOfLines).toBe(2);
    expect(name.props.adjustsFontSizeToFit).toBe(true);
    expect(name.props.children).toBe('Yamuna Blockers');
  });

  it('Hindi Undo subtitle has 2 lines (was cut off at 1)', async () => {
    await act(async () => {
      await i18n.changeLanguage('hi');
    });
    await open();
    await tap('a1');
    const sub = screen.getByTestId('undo-sub');
    expect(sub.props.numberOfLines).toBe(2);
    expect(txt('undo-sub')).toContain('वापस');
  });

  it('scorer chips are at least 48 dp wide (and 90 high)', async () => {
    await open();
    const st = StyleSheet.flatten(screen.getByTestId('court-tile-a1').props.style);
    expect(st.minWidth).toBeGreaterThanOrEqual(48);
    expect(st.minHeight).toBeGreaterThanOrEqual(90);
  });
});

describe('Profile > About (sign-up hardening b) and the demo-only tools', () => {
  const { AboutCard, DemoQaTools } = require('../AboutCard');
  it('shows the backend mode and, for the API, its host (EN/HI)', async () => {
    await render(<AboutCard kind="api" apiHost="192.168.1.10:4000" />);
    expect(screen.getByTestId('about-backend').props.accessibilityLabel).toBe('Backend: API server');
    expect(screen.getByTestId('about-api-host').props.accessibilityLabel).toBe('API host: 192.168.1.10:4000');
    expect(screen.queryByTestId('about-demo-note')).toBeNull();
    await act(async () => {
      await i18n.changeLanguage('hi');
    });
    await render(<AboutCard kind="demo" />);
    expect(screen.getByTestId('about-backend').props.accessibilityLabel).toBe('बैकएंड: डेमो (डेटा इसी फ़ोन पर रहता है)');
    expect(screen.getByTestId('about-demo-note')).toBeTruthy();
    expect(screen.queryByTestId('about-api-host')).toBeNull();
  });
  it('the testing tools (Demo admin, Simulate offline) render nothing unless the backend is the demo one', async () => {
    await render(<DemoQaTools />); // this file's backend is a plain mock, like the API / Firebase ones
    expect(screen.queryByTestId('demo-qa-tools')).toBeNull();
    expect(screen.queryByTestId('demo-admin-switch')).toBeNull();
  });
});
