/** English / हिन्दी segmented switch. Changes the whole app instantly and remembers the choice. */
import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { LANGUAGES, currentLanguage, setLanguage, type Language } from '../i18n';
import { colors, radius } from '../theme';

export function LanguageSwitch({ dark, style, showLabel = true }: { dark?: boolean; style?: StyleProp<ViewStyle>; showLabel?: boolean }) {
  const { t, i18n } = useTranslation();
  const active: Language = currentLanguage();
  void i18n.language; // re-render on change
  const fg = dark ? colors.white : colors.ink;
  return (
    <View style={[{ flexDirection: 'row', alignItems: 'center' }, style]} testID="language-switch">
      {showLabel && (
        <>
          <Ionicons name="language" size={18} color={fg} />
          <Text style={{ color: fg, fontWeight: '800', marginLeft: 6, marginRight: 10, fontSize: 14 }}>{t('language.label')}</Text>
        </>
      )}
      <View
        accessibilityRole="radiogroup"
        style={{ flexDirection: 'row', borderRadius: radius.pill, borderWidth: 2, borderColor: dark ? colors.primary : colors.ink, overflow: 'hidden' }}
      >
        {LANGUAGES.map((lng) => {
          const on = lng === active;
          return (
            <Pressable
              key={lng}
              testID={`lang-${lng}`}
              accessibilityRole="radio"
              accessibilityState={{ selected: on }}
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
