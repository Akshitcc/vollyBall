/**
 * i18n setup: i18next + react-i18next, English (default) and Hindi.
 *
 * - The app always starts in English. It only switches to Hindi when the user
 *   picks it with the language switch (login screen or Profile).
 * - The choice is stored on the device (AsyncStorage) and applied instantly
 *   (react-i18next re-renders every component using `useTranslation`).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './locales/en';
import hi from './locales/hi';

export const LANGUAGES = ['en', 'hi'] as const;
export type Language = (typeof LANGUAGES)[number];
export const DEFAULT_LANGUAGE: Language = 'en';
export const LANGUAGE_STORAGE_KEY = 'volleylive.language';

export const resources = { en: { translation: en }, hi: { translation: hi } } as const;

export const isLanguage = (x: unknown): x is Language => typeof x === 'string' && (LANGUAGES as readonly string[]).includes(x);

if (!i18n.isInitialized) {
  i18n.use(initReactI18next).init({
    resources,
    lng: DEFAULT_LANGUAGE,
    fallbackLng: DEFAULT_LANGUAGE,
    supportedLngs: [...LANGUAGES],
    interpolation: { escapeValue: false }, // React already escapes
    returnNull: false,
    initAsync: false, // resources are bundled, so init synchronously
  });
}

export function currentLanguage(): Language {
  return isLanguage(i18n.language) ? i18n.language : DEFAULT_LANGUAGE;
}

/** Change the language now and remember it on this device. */
export async function setLanguage(lng: Language): Promise<void> {
  await i18n.changeLanguage(lng);
  try {
    await AsyncStorage.setItem(LANGUAGE_STORAGE_KEY, lng);
  } catch {
    // storage errors shouldn't block the switch
  }
}

/** Apply the saved choice (if any). Falls back to English. */
export async function loadStoredLanguage(): Promise<Language> {
  let lng: Language = DEFAULT_LANGUAGE;
  try {
    const saved = await AsyncStorage.getItem(LANGUAGE_STORAGE_KEY);
    if (isLanguage(saved)) lng = saved;
  } catch {
    // ignore – stay on English
  }
  if (i18n.language !== lng) await i18n.changeLanguage(lng);
  return lng;
}

/**
 * Locale for Date#toLocale*String. English uses en-IN ("15 Oct 2026"), not the device default,
 * which printed US dates ("10/15/2026") on US-locale browsers (fix re-test #2).
 */
export function dateLocale(): string {
  return currentLanguage() === 'hi' ? 'hi-IN' : 'en-IN';
}

export default i18n;
