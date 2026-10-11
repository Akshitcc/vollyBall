import AsyncStorage from '@react-native-async-storage/async-storage';
import { fireEvent, render, screen } from '@testing-library/react-native';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { Text } from 'react-native';
import { LanguageSwitch } from '../../components/LanguageSwitch';
import i18n, { DEFAULT_LANGUAGE, LANGUAGE_STORAGE_KEY, loadStoredLanguage, setLanguage } from '../index';
import { LanguageGate } from '../LanguageGate';

jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

function Screen() {
  const { t } = useTranslation();
  return (
    <>
      <LanguageSwitch />
      <Text testID="title">{t('home.ready')}</Text>
      <Text testID="tab">{t('tabs.tournaments')}</Text>
      <Text testID="greeting">{t('home.greeting', { name: 'Akshit' })}</Text>
    </>
  );
}

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.clearAllMocks();
  await i18n.changeLanguage(DEFAULT_LANGUAGE);
});

describe('language switch', () => {
  it('opens in English by default (nothing stored)', async () => {
    expect(await loadStoredLanguage()).toBe('en');
    await render(
      <LanguageGate>
        <Screen />
      </LanguageGate>,
    );
    expect(await screen.findByText('Ready to play?')).toBeTruthy();
    expect(screen.getByTestId('tab').props.children).toBe('Tournaments');
    expect(screen.getByTestId('lang-en').props.accessibilityState).toEqual({ selected: true });
  });

  it('switching to हिन्दी changes the rendered text immediately and persists the choice', async () => {
    await render(<Screen />);
    expect(screen.getByTestId('title').props.children).toBe('Ready to play?');

    await fireEvent.press(screen.getByTestId('lang-hi'));

    expect(screen.getByTestId('title').props.children).toBe('खेलने के लिए तैयार?');
    expect(screen.getByTestId('tab').props.children).toBe('टूर्नामेंट');
    expect(screen.getByTestId('greeting').props.children).toBe('नमस्ते Akshit 👋');
    expect(screen.getByTestId('lang-hi').props.accessibilityState).toEqual({ selected: true });
    expect(AsyncStorage.setItem).toHaveBeenCalledWith(LANGUAGE_STORAGE_KEY, 'hi');
    expect(await AsyncStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe('hi');

    // ...and back to English
    await fireEvent.press(screen.getByTestId('lang-en'));
    expect(screen.getByTestId('title').props.children).toBe('Ready to play?');
    expect(await AsyncStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe('en');
  });

  it('restores the saved language on the next app start', async () => {
    await AsyncStorage.setItem(LANGUAGE_STORAGE_KEY, 'hi');
    await render(
      <LanguageGate>
        <Screen />
      </LanguageGate>,
    );
    expect(await screen.findByText('खेलने के लिए तैयार?')).toBeTruthy();
  });

  it('ignores an invalid stored value and stays in English', async () => {
    await AsyncStorage.setItem(LANGUAGE_STORAGE_KEY, 'fr');
    expect(await loadStoredLanguage()).toBe('en');
    expect(i18n.language).toBe('en');
  });

  it('setLanguage still switches if storage fails', async () => {
    (AsyncStorage.setItem as jest.Mock).mockRejectedValueOnce(new Error('disk full'));
    await setLanguage('hi');
    expect(i18n.language).toBe('hi');
  });
});
