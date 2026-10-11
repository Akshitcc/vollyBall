/** 1.3.7: read-only T&C (About VolleyLive > Terms & Conditions), same DRAFT text as the gate. */
import React from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, Text, View } from 'react-native';
import { TERMS_IS_DRAFT, TERMS_VERSION } from '../core/terms';
import { colors, type } from '../theme';
import { TERMS_SECTIONS } from './terms';

export default function TermsViewScreen() {
  const { t } = useTranslation();
  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ padding: 16, paddingBottom: 40 }} testID="terms-view">
      <Text style={[type.caption, { color: colors.muted }]}>{t('terms.version', { v: TERMS_VERSION })}</Text>
      {TERMS_IS_DRAFT ? <Text style={[type.body, { color: colors.danger, marginTop: 6, fontWeight: '700' }]}>{t('terms.draftNote')}</Text> : null}
      {TERMS_SECTIONS.map((k) => (
        <View key={k} style={{ marginTop: 14 }}>
          <Text style={[type.h3, { color: colors.text }]} accessibilityRole="header">{t(`terms.${k}Title`)}</Text>
          <Text style={[type.body, { color: colors.text, marginTop: 4 }]}>{t(`terms.${k}Body`)}</Text>
        </View>
      ))}
    </ScrollView>
  );
}
