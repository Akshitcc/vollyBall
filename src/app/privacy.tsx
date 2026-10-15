/**
 * 1.3.7: Privacy Policy – DRAFT, NOT LEGALLY REVIEWED. Same content as docs/privacy-policy-draft.md;
 * it must be reviewed by a lawyer (DPDP Act 2023) before the app is published.
 */
import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, Text, View } from 'react-native';
import { colors, currentTheme, type } from '../theme';

export const PRIVACY_IS_DRAFT = true;
export const PRIVACY_SECTIONS = ['collect', 'use', 'share', 'storage', 'rights', 'children', 'contact'] as const;

export default function PrivacyScreen() {
  const { t } = useTranslation();
  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ padding: 16, paddingBottom: 40 }} testID="privacy-screen">
      {PRIVACY_IS_DRAFT ? (
        <View style={{ flexDirection: 'row', gap: 6, backgroundColor: colors.danger, borderRadius: 12, padding: 10 }} testID="privacy-draft-badge">
          <Ionicons name="alert-circle" size={18} color={currentTheme() === 'night' ? colors.ink : colors.white} />
          <Text style={{ color: currentTheme() === 'night' ? colors.ink : colors.white, fontWeight: '700', flex: 1 }}>{t('privacy.draftNote')}</Text>
        </View>
      ) : null}
      {PRIVACY_SECTIONS.map((k) => (
        <View key={k} style={{ marginTop: 14 }}>
          <Text style={[type.h3, { color: colors.text }]} accessibilityRole="header">{t(`privacy.${k}Title`)}</Text>
          <Text style={[type.body, { color: colors.text, marginTop: 4 }]}>{t(`privacy.${k}Body`)}</Text>
        </View>
      ))}
    </ScrollView>
  );
}
