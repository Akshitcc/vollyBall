/**
 * 1.3.5 (QA E134-1) integration: the tester's real path through the real screens, with the real
 * router, the real demo backend and the real connectivity store (nothing about the header is mocked):
 *   Profile tab → Testing tools → "Simulate offline" on → Score tab → "Continue scoring" → tap a player.
 * The header must show "Offline · N pending", then "Syncing N…" after the switch goes off, and never
 * "✓ Synced" while offline or with pending writes. Also: the switch survives a restart (reload).
 */
import { act, fireEvent, screen } from '@testing-library/react-native';
import { renderRouter } from 'expo-router/testing-library';
import React from 'react';

jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null, MaterialCommunityIcons: () => null }));
jest.mock('expo-image', () => ({ Image: () => null }));
jest.mock('expo-haptics', () => ({
  impactAsync: () => Promise.resolve(),
  selectionAsync: () => Promise.resolve(),
  notificationAsync: () => Promise.resolve(),
  ImpactFeedbackStyle: { Medium: 'm', Light: 'l', Heavy: 'h' },
  NotificationFeedbackType: { Success: 's', Warning: 'w', Error: 'e' },
}));
jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);

// Not used in a demo build (the demo backend is the real one here); keeps firebase's ESM out of jest.
jest.mock('../../services/backend/firebaseBackend', () => ({ FirebaseBackend: class {} }));

const SEED1 = '+919000000010';
jest.setTimeout(60_000);

async function settle(ms = 50) {
  await act(async () => {
    await jest.advanceTimersByTimeAsync(ms);
  });
}

/** Signs in through the demo backend like the login screen does, and accepts the T&C (setup only). */
async function signedIn() {
  const { backend } = require('../../services/backend');
  const { TERMS_VERSION } = require('../../core/terms');
  const otp = backend.sendOtp(SEED1, null);
  await jest.advanceTimersByTimeAsync(600);
  const s = await otp;
  const done = s.confirm('123456');
  await jest.advanceTimersByTimeAsync(600);
  await done;
  const uid = (await new Promise<{ uid: string } | null>((r) => backend.onAuthChanged(r)))!.uid;
  await backend.acceptTerms(uid, TERMS_VERSION);
  return backend;
}

/** Advances the clock until the query finds something (the demo backend answers asynchronously). */
async function until<T>(q: () => T[], ms = 8000): Promise<T[]> {
  for (let t = 0; t < ms; t += 100) {
    const r = q();
    if (r.length) return r;
    await settle(100);
  }
  throw new Error('not found in time: ' + JSON.stringify(screen.queryAllByText(/./).map((n) => n.props.children).slice(0, 40)));
}

function app(initialUrl = '/profile') {
  return renderRouter(
    {
      _layout: require('../../app/_layout').default,
      '(tabs)/_layout': require('../../app/(tabs)/_layout').default,
      '(tabs)/index': () => null,
      '(tabs)/map': () => null,
      '(tabs)/tournaments': () => null,
      '(tabs)/score': require('../../app/(tabs)/score').default,
      '(tabs)/profile': require('../../app/(tabs)/profile').default,
      'match/[id]/score': require('../../app/match/[id]/score').default,
      'match/[id]/index': () => null,
    },
    { initialUrl },
  );
}
const label = () => {
  const c = screen.getByTestId('sync-label').props.children;
  return Array.isArray(c) ? c.join('') : String(c);
};

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
});
afterEach(() => {
  jest.clearAllTimers();
  jest.useRealTimers();
});

test('Profile → Simulate offline → Score tab → Continue scoring → tap: pending count, then Syncing, never Synced while offline', async () => {
  await signedIn();
  const r = app();
  await (r as unknown as Promise<unknown>); // RNTL 14: render is async
  await settle(1500);
  // 1) Profile tab: Testing tools (demo only) → Simulate offline
  const sw = await screen.findByTestId('simulate-offline-switch');
  await fireEvent(sw, 'valueChange', true);
  await settle();
  // 2) Score tab (pressed in the tab bar, as a user does)
  await fireEvent.press(screen.getAllByText('Score').slice(-1)[0]); // the tab bar label
  await settle(800);
  // 3) "Continue scoring" on the seeded live match
  await fireEvent.press((await until(() => screen.queryAllByText('Continue scoring')))[0]);
  await settle(1500);
  expect(label()).toBe('⚠ Offline – saved on phone');
  // 4) tap two players
  const chips = screen.getAllByTestId(/^court-tile-/).filter((n) => n.props.accessibilityRole === 'button');
  const seen: string[] = [];
  for (const i of [0, 1]) {
    await fireEvent.press(chips[i]);
    await settle(400);
    seen.push(label());
  }
  expect(seen).toEqual(['⚠ Offline · 1 pending', '⚠ Offline · 2 pending']);
  await settle(6000); // a retry while still offline changes nothing
  expect(label()).toBe('⚠ Offline · 2 pending');
  // 4b) reload / app restart on the scorer (still offline): the count and the points come back
  const score = () => screen.getAllByTestId(/^score-/).map((n) => n.props.children).join('|');
  const before = score();
  await act(async () => screen.unmount());
  const r2 = app('/match/match_live/score');
  await (r2 as unknown as Promise<unknown>);
  await settle(1500);
  expect(label()).toBe('⚠ Offline · 2 pending');
  expect(score()).toBe(before);
  await settle(6000);
  expect(label()).toBe('⚠ Offline · 2 pending');
  // 5) back online (the switch off): the waiting rallies are sent: "Syncing 2…", then "✓ Synced"
  const { connectivity } = require('../../services/connectivity');
  await act(async () => connectivity.setSimulatedOffline(false));
  await settle(20);
  expect(label()).toBe('Syncing 2…');
  await settle(1000);
  expect(label()).toBe('✓ Synced');
});

test('"Simulate offline" survives a reload (demo only)', async () => {
  const AsyncStorage = require('@react-native-async-storage/async-storage');
  await AsyncStorage.setItem('volleylive-demo-sim-offline-v1', '1');
  jest.isolateModules(() => {
    // a fresh app start: new demo backend and connectivity store, as after a browser reload
    const { connectivity } = require('../../services/connectivity');
    require('../../services/backend');
    (globalThis as { __c?: unknown }).__c = connectivity;
  });
  await settle(100);
  const c = (globalThis as { __c?: { isSimulatedOffline(): boolean } }).__c!;
  expect(c.isSimulatedOffline()).toBe(true);
});

describe('web tab bar (the cause of E134-1): a tab press stays inside the app', () => {
  const { inAppLinkPress } = require('../../services/nav');
  it('plain left click: preventDefault (no browser navigation = no full page reload), then navigate', () => {
    const onPress = jest.fn();
    const e = { preventDefault: jest.fn(), button: 0, currentTarget: { target: '' } };
    inAppLinkPress(onPress, { web: true, href: '/score' })(e);
    expect(e.preventDefault).toHaveBeenCalled();
    expect(onPress).toHaveBeenCalledWith(e);
  });
  it('ctrl/cmd click, middle click or target=_blank: left to the browser (new tab)', () => {
    for (const extra of [{ ctrlKey: true }, { metaKey: true }, { button: 1 }, { currentTarget: { target: '_blank' } }]) {
      const onPress = jest.fn();
      const e = { preventDefault: jest.fn(), button: 0, ...extra };
      inAppLinkPress(onPress, { web: true, href: '/score' })(e);
      expect(e.preventDefault).not.toHaveBeenCalled();
      expect(onPress).not.toHaveBeenCalled();
    }
  });
  it('phones (no links): just navigates', () => {
    const onPress = jest.fn();
    inAppLinkPress(onPress, { web: false, href: '/score' })({});
    expect(onPress).toHaveBeenCalled();
  });
  it('the tab bar button on the web: a press calls preventDefault and still switches tab', async () => {
    const { TabButton } = require('../../app/(tabs)/_layout');
    const { Text } = require('react-native');
    const { render } = require('@testing-library/react-native');
    const onPress = jest.fn();
    await render(
      <TabButton web href="/score" onPress={onPress} testID="tab-score">
        <Text>Score</Text>
      </TabButton>,
    );
    const e = { preventDefault: jest.fn(), button: 0, currentTarget: { target: '' } };
    await fireEvent.press(screen.getByText('Score'), e);
    expect(e.preventDefault).toHaveBeenCalled();
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});

test('1.3.8 (V137-14): Profile header has Edit beside the title; the pincode line has a translated label (EN/HI)', async () => {
  await signedIn();
  const r = app();
  await (r as unknown as Promise<unknown>);
  await settle(1500);
  const pin = await screen.findByTestId('profile-pin-district');
  const text = () => {
    const c = pin.props.children;
    return (Array.isArray(c) ? c : [c]).filter((x: unknown) => typeof x === 'string').join('');
  };
  expect(text()).toMatch(/^Pincode: 110001( · |$)/);
  expect(screen.getByTestId('profile-edit')).toBeTruthy();
  const i18n = require('../../i18n').default;
  await act(async () => {
    await i18n.changeLanguage('hi');
  });
  await settle(100);
  expect(text()).toMatch(/^पिनकोड: 110001/);
  await act(async () => {
    await i18n.changeLanguage('en');
  });
});

test('V1413-7 (1.4.14): tapping a testing-tool row (its label) flips the switch; the row is one accessible switch', async () => {
  await signedIn();
  await (app() as unknown as Promise<unknown>);
  await settle(1500);
  const { connectivity } = require('../../services/connectivity');
  const row = await screen.findByTestId('simulate-offline-switch-row');
  expect(row.props.accessibilityRole).toBe('switch');
  expect(row.props.accessibilityState).toEqual({ checked: false });
  await fireEvent.press(screen.getByText('Simulate offline'));
  await settle();
  expect(connectivity.isSimulatedOffline()).toBe(true);
  expect(screen.getByTestId('simulate-offline-switch-row').props.accessibilityState).toEqual({ checked: true });
  expect(screen.getByTestId('simulate-offline-switch').props.value).toBe(true);
  await fireEvent.press(screen.getByTestId('simulate-offline-switch-row'));
  await settle();
  expect(connectivity.isSimulatedOffline()).toBe(false);
});
