/** English / हिन्दी segmented switch. Changes the whole app instantly and remembers the choice. */
import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { LANGUAGES, currentLanguage, setLanguage, type Language } from '../i18n';
import { colors, radius, currentTheme } from '../theme';

export function LanguageSwitch({ dark, style, showLabel = true }: { dark?: boolean; style?: StyleProp<ViewStyle>; showLabel?: boolean }) {
  const { t, i18n } = useTranslation();
  const active: Language = currentLanguage();
  void i18n.language; // re-render on change
  // 1.4.23 (V1422-4): in Night the switch always uses its on-dark colours (ink on navy was 1.07:1).
  dark = dark || currentTheme() === 'night';
  const fg = dark ? colors.white : colors.ink;
  return (
    <View style={[{ flexDirection: 'row', alignItems: 'center' }, style]} testID="language-switch">
      {showLabel && (
        <>
          <Ionicons name="language" size={18} color={fg} />
          <Text style={{ color: fg, fontWeight: '800', marginLeft: 6, marginRight: 10, fontSize: 14 }}>{t('language.label')}</Text>
        </>
      )}
      {/* 1.4.2 (QA info): real buttons (web: <button>, Enter/Space work, in the tab order) – a radio group
          without arrow-key handling was a focusable div that announced the wrong thing */}
      <View
        style={{ flexDirection: 'row', borderRadius: radius.pill, borderWidth: 2, borderColor: dark ? colors.primary : colors.ink, overflow: 'hidden' }}
      >
        {LANGUAGES.map((lng) => {
          const on = lng === active;
          return (
            <Pressable
              key={lng}
              testID={`lang-${lng}`}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              // web: a toggle button says whether it is on (aria-pressed); native reads accessibilityState
              {...({ 'aria-pressed': on } as object)}
              accessibilityLabel={t('language.switchTo', { name: t(`language.${lng}`) })}
              onPress={() => !on && setLanguage(lng)}
              hitSlop={6}
              style={{
                paddingHorizontal: 14,
                paddingVertical: 7,
                backgroundColor: on ? (dark ? colors.primary : colors.ink) : 'transparent',
              }}
            >
              <Text style={{ fontWeight: '800', fontSize: 14, color: on ? (dark ? colors.ink : colors.white) : fg }}>
                {/* Each option is written in its own script so anyone can find it. */}
                {lng === 'en' ? 'English' : 'हिन्दी'}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
