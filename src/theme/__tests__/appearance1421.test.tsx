/** 1.4.21 Appearance screen at 360 px, EN + HI, both themes (layout is also checked in the 421 screenshots). */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, render } from '@testing-library/react-native';
import React from 'react';
import i18n from '../../i18n';
import { THEME_KEY, ThemeProvider } from '../ThemeProvider';

jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({ __esModule: true, default: () => ({ width: 360, height: 800, scale: 2, fontScale: 1 }) }));
const at = (h: number) => new Date(2026, 9, 13, h, 0, 0);

describe('360 px layout', () => {
  it('Appearance renders at 360 px in EN + HI, both themes, with every option reachable', async () => {
    const AppearanceScreen = require('../../app/appearance').default;
    for (const lang of ['en', 'hi'] as const) for (const s of ['day', 'night'] as const) {
      await i18n.changeLanguage(lang);
      await AsyncStorage.setItem(THEME_KEY, JSON.stringify({ setting: s }));
      const r = await render(<ThemeProvider uid={null} nowFn={() => at(12).getTime()}>{() => <AppearanceScreen />}</ThemeProvider>);
      await act(async () => { await Promise.resolve(); await Promise.resolve(); });
      await r.findByTestId('appearance-auto');
      for (const k of ['auto', 'day', 'night']) expect(r.getByTestId(`appearance-${k}`).props.accessibilityState.checked).toBe(k === s);
      await fireEvent.press(r.getByTestId('appearance-auto'));
      expect(r.getByTestId('appearance-now')).toBeTruthy();
      expect(r.getByText(i18n.getFixedT(lang)('appearance.anim'))).toBeTruthy();
      r.unmount();
    }
    await i18n.changeLanguage('en');
  });
});

describe('Home greeting – live, first name, EN + HI', () => {
  const { HomeGreeting } = require('../../components/HomeGreeting');
  it.each(['en', 'hi'] as const)('%s: 11:59 morning → 12:00 afternoon without a reload', async (lang) => {
    jest.useFakeTimers();
    await i18n.changeLanguage(lang);
    let clock = new Date(2026, 9, 13, 11, 59, 30).getTime();
    const r = await render(<ThemeProvider uid={null} nowFn={() => clock}>{() => <HomeGreeting name="Aarav Sharma" />}</ThemeProvider>);
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    const T = i18n.getFixedT(lang);
    expect(r.getByTestId('home-greeting').props.children).toBe(T('greet.morning', { name: 'Aarav' }));
    clock = new Date(2026, 9, 13, 12, 0, 1).getTime();
    await act(async () => { jest.advanceTimersByTime(31_000); });
    expect(r.getByTestId('home-greeting').props.children).toBe(T('greet.afternoon', { name: 'Aarav' }));
    r.unmount();
    jest.useRealTimers();
    await i18n.changeLanguage('en');
  });
});
