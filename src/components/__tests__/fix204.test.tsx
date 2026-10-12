/** Fix re-test of build 204: clean back route (#1), court screen (#3), time format, web dialog. */
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import React from 'react';
import { Platform } from 'react-native';
import i18n from '../../i18n';
import { formatWhenT } from '../../i18n/format';
import { backFallback, leakedTabParams } from '../../services/nav';
import { confirmAsk, notify } from '../../services/dialogs';
import { DialogHost } from '../DialogHost';
import CourtPage from '../../app/court/[id]';

jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('react-native-maps', () => ({ __esModule: true, default: () => null, Marker: () => null, PROVIDER_GOOGLE: 'google' }));
const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ id: 'c1' }),
  router: { push: (...a: unknown[]) => mockPush(...a), canGoBack: () => true, back: jest.fn(), replace: jest.fn() },
  Stack: { Screen: () => null },
}));
jest.mock('../../services/backend', () => ({
  backend: {
    listCourts: async () => [
      { id: 'c1', name: 'Lodhi Garden Sand Court', location: { lat: 28.5931, lng: 77.2197, name: 'Lodhi Garden' }, surface: 'beach', addedBy: 'seed2', createdAt: new Date(2026, 9, 1).getTime() },
    ],
  },
}));

// Load-safe (fix re-test 214 #2): the court page and the in-app dialog render once up front, so a cold
// cache's module loading isn't timed inside the first dialog test; then a tight per-test timeout.
const WARM_T = 15_000;
jest.setTimeout(5_000);
beforeAll(async () => {
  void require('react-native').Modal;
  await render(<CourtPage />);
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
  await screen.unmount();
  const os = Platform.OS;
  (Platform as { OS: string }).OS = 'web'; // the in-app dialog is the web path
  (global as { window?: unknown }).window = global.window ?? {};
  await render(<DialogHost />);
  let p!: Promise<boolean>;
  await act(async () => {
    p = confirmAsk('warm-up');
  });
  await fireEvent.press(screen.getByText('Cancel'));
  await p;
  await screen.unmount();
  (Platform as { OS: string }).OS = os;
  mockPush.mockClear();
}, WARM_T);
const restoreOS = Platform.OS;
afterEach(async () => {
  (Platform as { OS: string }).OS = restoreOS;
  await act(async () => {
    await i18n.changeLanguage('en');
  });
});

describe('#1 back from a deep-linked screen lands on a clean route', () => {
  test('params leaked onto the tabs are cleared; navigator keys and cleared keys are left alone', () => {
    expect(leakedTabParams({ id: 'team_smashers' })).toEqual({ id: undefined });
    expect(leakedTabParams({ fromTeamId: 'team_smashers' })).toEqual({ fromTeamId: undefined });
    expect(leakedTabParams({ id: undefined })).toBeNull(); // no repeat setParams
    expect(leakedTabParams({ screen: 'index', params: {} })).toBeNull();
    expect(leakedTabParams(undefined)).toBeNull();
  });
  test('court pages fall back to the Map tab', () => {
    expect(backFallback('court/[id]', { id: 'c1' })).toBe('/map');
  });
});

test('times have no leading zero ("7:00 pm", not "07:00 pm")', () => {
  const s = formatWhenT(new Date(2026, 9, 11, 19, 0).getTime());
  expect(s).toMatch(/, 7:00 pm$/i);
  expect(s).not.toMatch(/07:00/);
});

describe('#3 court screen (court pins and rows open it)', () => {
  test('shows the court and starts a match there', async () => {
    await render(<CourtPage />);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(screen.getAllByText('Lodhi Garden Sand Court').length).toBeGreaterThan(0);
    expect(screen.getByTestId('court-surface').props.children).toBe('Beach');
    expect(screen.getByText('Lodhi Garden')).toBeTruthy();
    expect(screen.getByText('Added 1 Oct 2026')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('court-start-match'));
    expect(mockPush).toHaveBeenCalledWith('/match/new?courtId=c1');
  });
});

describe('web: in-app translated dialog instead of the browser OK/Cancel box', () => {
  beforeEach(() => {
    (Platform as { OS: string }).OS = 'web';
    (global as { window?: unknown }).window = global.window ?? {};
  });
  test('confirm: translated buttons, resolves with the choice; Cancel resolves false', async () => {
    const confirmSpy = jest.fn();
    (window as unknown as { confirm: unknown }).confirm = confirmSpy;
    await render(<DialogHost />);
    let p!: Promise<boolean>;
    await act(async () => {
      p = confirmAsk('Abandon this match?', { title: 'Abandon match', confirmLabel: 'Abandon', cancelLabel: 'Keep playing' });
    });
    expect(screen.getByTestId('app-dialog-title').props.children).toBe('Abandon match');
    expect(screen.getByTestId('app-dialog-message').props.children).toBe('Abandon this match?');
    expect(screen.getByText('Keep playing')).toBeTruthy();
    await fireEvent.press(screen.getByText('Abandon'));
    await expect(p).resolves.toBe(true);
    expect(screen.queryByTestId('app-dialog')).toBeNull();
    expect(confirmSpy).not.toHaveBeenCalled();
    await act(async () => {
      p = confirmAsk('Reset?');
    });
    await fireEvent.press(screen.getByText('Cancel'));
    await expect(p).resolves.toBe(false);
  });
  test('Hindi labels and notify', async () => {
    await act(async () => {
      await i18n.changeLanguage('hi');
    });
    await render(<DialogHost />);
    let p!: Promise<boolean>;
    await act(async () => {
      p = confirmAsk('डेमो रीसेट करें?');
    });
    expect(screen.getByTestId('app-dialog-title').props.children).toBe('क्या आप पक्का हैं?');
    expect(screen.getByText('रद्द करें')).toBeTruthy();
    await fireEvent.press(screen.getByText('रद्द करें'));
    await expect(p).resolves.toBe(false);
    await act(async () => notify('मैच छोड़ा नहीं जा सका', 'नेटवर्क'));
    await fireEvent.press(screen.getByText('ठीक है'));
    expect(screen.queryByTestId('app-dialog')).toBeNull();
  });
});
