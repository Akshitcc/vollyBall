/** Fix re-test of build 209: clean back href, court name prefill, dialog keyboard focus. (Map: previewMap.test.) */
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import React from 'react';
import { Platform } from 'react-native';
import { placeFromCourt } from '../../core/geo';
import { confirmAsk, notify } from '../../services/dialogs';
import { DialogHost, initialFocusIndex } from '../DialogHost';
import TabsLayout from '../../app/(tabs)/_layout';
import '../../i18n';

jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
const mockSetParams = jest.fn();
let mockRouteParams: object | undefined;
jest.mock('expo-router', () => {
  const Tabs = () => null;
  (Tabs as unknown as { Screen: unknown }).Screen = () => null;
  return { Tabs, useNavigation: () => ({ setParams: mockSetParams }) };
});
jest.mock('expo-router/react-navigation', () => ({ useRoute: () => ({ key: 'tabs-1', name: '(tabs)', params: mockRouteParams }) }));

// Deterministic (fix re-test 210 #0): every test runs on fake timers – no real delays – and time
// only moves when a test advances it. The per-test timeout is a backstop for a busy machine (the
// first render of RN's Modal loads modules lazily, which is slow when the CPU is saturated).
const T = 15_000;
beforeAll(() => {
  // load RN's Modal (lazily required by react-native) up front, not inside a timed test
  void require('react-native').Modal;
}, T);
beforeEach(() => {
  jest.useFakeTimers();
});
afterEach(() => {
  jest.useRealTimers();
});

test('the tabs under a deep link drop its params as soon as they mount (back href is a clean "/")', async () => {
  mockRouteParams = { id: 'team_smashers' };
  await render(<TabsLayout />);
  expect(mockSetParams).not.toHaveBeenCalled(); // deferred one tick (see the layout)
  await act(async () => jest.advanceTimersByTime(1));
  expect(mockSetParams).toHaveBeenCalledWith({ id: undefined });
  mockSetParams.mockClear();
  mockRouteParams = { screen: 'index' };
  await render(<TabsLayout />);
  await act(async () => jest.advanceTimersByTime(1));
  expect(mockSetParams).not.toHaveBeenCalled();
}, T);

test('"Start a match here" names the place after the court, not its area', () => {
  const court = { name: 'Lodhi Garden Sand Court', location: { lat: 28.5931, lng: 77.2197, name: 'Lodhi Garden' } };
  expect(placeFromCourt(court)).toEqual({ lat: 28.5931, lng: 77.2197, name: 'Lodhi Garden Sand Court' });
  expect(placeFromCourt({ ...court, name: '  ' }).name).toBe('Lodhi Garden');
}, T);

describe('web dialog keyboard support', () => {
  test('focus goes to the safe button when there is a destructive choice, else the primary one', () => {
    expect(initialFocusIndex([{ text: 'Keep playing', style: 'cancel', value: false }, { text: 'Abandon', style: 'destructive', value: true }])).toBe(0);
    expect(initialFocusIndex([{ text: 'Cancel', style: 'cancel', value: false }, { text: 'OK', value: true }])).toBe(1);
    expect(initialFocusIndex([{ text: 'OK', value: true }])).toBe(0);
  }, T);

  test('Esc cancels, Tab stays inside, focus returns afterwards', async () => {
    const restoreOS = Platform.OS;
    (Platform as { OS: string }).OS = 'web';
    (global as { window?: unknown }).window = global.window ?? {};
    const handlers: ((e: unknown) => void)[] = [];
    const trigger = { focus: jest.fn() };
    const btns = [{ focus: jest.fn() }, { focus: jest.fn() }];
    const doc = {
      activeElement: trigger as unknown,
      querySelectorAll: () => btns,
      querySelector: () => null,
      addEventListener: (_: string, h: (e: unknown) => void) => handlers.push(h),
      removeEventListener: (_: string, h: (e: unknown) => void) => handlers.splice(handlers.indexOf(h), 1),
      contains: () => true,
    };
    (global as { document?: unknown }).document = doc;
    try {
      await render(<DialogHost />);
      let p!: Promise<boolean>;
      await act(async () => {
        p = confirmAsk('Abandon this match?', { title: 'Abandon match', confirmLabel: 'Abandon', cancelLabel: 'Keep playing', destructive: true });
      });
      await act(async () => jest.advanceTimersByTime(100));
      expect(handlers).toHaveLength(2); // keydown + focusin
      expect(btns[0].focus).toHaveBeenCalled(); // "Keep playing" (the safe choice) has focus
      expect(btns[1].focus).not.toHaveBeenCalled();
      doc.activeElement = btns[0];
      const key = (k: string, shiftKey = false) => {
        const e = { key: k, shiftKey, preventDefault: jest.fn(), stopPropagation: jest.fn() };
        handlers.forEach((h) => h(e));
        return e;
      };
      expect(key('Tab').preventDefault).toHaveBeenCalled(); // focus never leaves the dialog
      expect(btns[1].focus).toHaveBeenCalled();
      expect(key('Tab', true).preventDefault).toHaveBeenCalled();
      expect(key('a').preventDefault).not.toHaveBeenCalled();
      await act(async () => {
        key('Escape');
      });
      await expect(p).resolves.toBe(false);
      expect(screen.queryByTestId('app-dialog')).toBeNull();
      expect(handlers).toHaveLength(0);
      await act(async () => jest.advanceTimersByTime(600));
      expect(trigger.focus).toHaveBeenCalled(); // back to the button that opened it
      await act(async () => notify('Saved', 'All good'));
      expect(screen.getByTestId('app-dialog')).toBeTruthy();
      await fireEvent.press(screen.getByText('OK'));
    } finally {
      delete (global as { document?: unknown }).document;
      (Platform as { OS: string }).OS = restoreOS;
    }
  }, T);

  test('focus returns to the menu button when the menu item that opened the dialog is gone', async () => {
    const restoreOS = Platform.OS;
    (Platform as { OS: string }).OS = 'web';
    const handlers: Record<string, (e: unknown) => void> = {};
    const menuItem = { focus: jest.fn() };
    const menuButton = { focus: jest.fn(), closest: () => null };
    const btns = [{ focus: jest.fn() }, { focus: jest.fn() }];
    const doc = {
      activeElement: menuItem as unknown,
      body: {},
      querySelectorAll: () => btns,
      querySelector: () => null,
      addEventListener: (t: string, h: (e: unknown) => void) => (handlers[t] = h),
      removeEventListener: (t: string) => delete handlers[t],
      contains: (el: unknown) => el !== menuItem, // the menu closed: its item left the page
    };
    (global as { document?: unknown }).document = doc;
    try {
      await render(<DialogHost />);
      let p!: Promise<boolean>;
      await act(async () => {
        p = confirmAsk('Abandon this match?', { confirmLabel: 'Abandon', cancelLabel: 'Keep playing', destructive: true });
      });
      // the closing menu hands focus to its own button, after the dialog focused "Keep playing"
      await act(async () => jest.advanceTimersByTime(20));
      handlers.focusin({ target: menuButton });
      doc.activeElement = menuButton;
      btns[0].focus.mockClear();
      await act(async () => jest.advanceTimersByTime(40));
      expect(btns[0].focus).toHaveBeenCalled(); // taken back into the dialog
      await act(async () => handlers.keydown({ key: 'Escape', preventDefault: jest.fn(), stopPropagation: jest.fn() }));
      await expect(p).resolves.toBe(false);
      await act(async () => jest.advanceTimersByTime(600));
      expect(menuItem.focus).not.toHaveBeenCalled();
      expect(menuButton.focus).toHaveBeenCalled();
    } finally {
      delete (global as { document?: unknown }).document;
      (Platform as { OS: string }).OS = restoreOS;
    }
  }, T);

  test('focus returns to the element the caller names (Abandon -> the score menu button)', async () => {
    const restoreOS = Platform.OS;
    (Platform as { OS: string }).OS = 'web';
    const handlers: Record<string, (e: unknown) => void> = {};
    const menuItem = { focus: jest.fn() };
    const scoreMenu = { focus: jest.fn() };
    const asked: string[] = [];
    const doc = {
      activeElement: menuItem as unknown,
      body: {},
      querySelectorAll: () => [{ focus: jest.fn() }, { focus: jest.fn() }],
      querySelector: (sel: string) => (asked.push(sel), sel === '[data-testid="score-menu"]' ? scoreMenu : null),
      addEventListener: (t: string, h: (e: unknown) => void) => (handlers[t] = h),
      removeEventListener: (t: string) => delete handlers[t],
      contains: (el: unknown) => el !== menuItem,
    };
    (global as { document?: unknown }).document = doc;
    try {
      await render(<DialogHost />);
      let p!: Promise<boolean>;
      await act(async () => {
        p = confirmAsk('Abandon this match?', { returnFocusTo: 'score-menu' });
      });
      await act(async () => jest.advanceTimersByTime(20));
      await act(async () => handlers.keydown({ key: 'Escape', preventDefault: jest.fn(), stopPropagation: jest.fn() }));
      await expect(p).resolves.toBe(false);
      await act(async () => jest.advanceTimersByTime(50));
      expect(scoreMenu.focus).toHaveBeenCalled();
    } finally {
      delete (global as { document?: unknown }).document;
      (Platform as { OS: string }).OS = restoreOS;
    }
  }, T);
});
