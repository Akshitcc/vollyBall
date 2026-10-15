/**
 * T&C acceptance gate (1.3.0): shown after sign-in and BEFORE registration, and again whenever the
 * T&C version changes. The text is a clearly marked DRAFT (EN + HI). Points are in-app only: there is
 * no cash value, no redeem and no ID-number collection anywhere in the app.
 */
import { Ionicons } from '@expo/vector-icons';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { LanguageSwitch } from '../components/LanguageSwitch';
import { Button } from '../components/ui';
import { TERMS_IS_DRAFT, TERMS_VERSION } from '../core/terms';
import { translateError } from '../i18n/format';
import { signOut } from '../services/session';
import { useAuth } from '../state/AuthContext';
import { colors, radius, type, themed } from '../theme';

/** Sections of the draft text, in order (keys under terms.* in both locales). */
export const TERMS_SECTIONS = ['points', 'fairPlay', 'data', 'conduct', 'changes'] as const;

export default function TermsScreen() {
  const { t } = useTranslation();
  const { acceptTerms } = useAuth();
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const accept = async () => {
    setBusy(true);
    setError(null);
    try {
      await acceptTerms(TERMS_VERSION);
    } catch (e) {
      setError(translateError(e, t));
    } finally {
      setBusy(false);
    }
  };
  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ padding: 16, paddingBottom: 40 }} testID="terms-screen">
      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 12, gap: 8 }}>
        {TERMS_IS_DRAFT ? (
          <View style={s.draft} accessible accessibilityLabel={t('terms.draftA11y')} testID="terms-draft-badge">
            <Ionicons name="alert-circle" size={14} color={colors.white} />
            <Text style={s.draftText}>{t('terms.draft')}</Text>
          </View>
        ) : null}
        <View style={{ flex: 1 }} />
        <LanguageSwitch showLabel={false} />
      </View>
      <Text style={[type.h2, { color: colors.text }]} accessibilityRole="header">{t('terms.title')}</Text>
      <Text style={[type.caption, { color: colors.muted, marginTop: 4 }]} testID="terms-version">{t('terms.version', { v: TERMS_VERSION })}</Text>
      {TERMS_IS_DRAFT ? <Text style={[type.body, s.draftNote]}>{t('terms.draftNote')}</Text> : null}
      {TERMS_SECTIONS.map((k) => (
        <View key={k} style={s.section}>
          <Text style={[type.h3, { color: colors.text }]} accessibilityRole="header">{t(`terms.${k}Title`)}</Text>
          <Text style={[type.body, { color: colors.text, marginTop: 4 }]}>{t(`terms.${k}Body`)}</Text>
        </View>
      ))}
      <Pressable
        onPress={() => setChecked((c) => !c)}
        accessibilityRole="checkbox"
        accessibilityState={{ checked }}
        accessibilityLabel={t('terms.agree')}
        style={s.check}
        testID="terms-checkbox"
      >
        <View style={[s.box, checked && { backgroundColor: colors.ink, borderColor: colors.ink }]}>
          {checked ? <Ionicons name="checkmark" size={18} color={colors.white} /> : null}
        </View>
        <Text style={[type.body, { color: colors.text, flex: 1 }]}>{t('terms.agree')}</Text>
      </Pressable>
      {error ? <Text style={[type.body, { color: colors.danger, marginBottom: 8 }]} accessibilityRole="alert">{error}</Text> : null}
      <Button title={t('terms.accept')} icon="checkmark-circle" onPress={accept} loading={busy} disabled={!checked} disabledHint={t('terms.tickFirst')} testID="terms-accept" big />
      <Button title={t('profileForm.differentNumber')} icon="log-out" variant="ghost" onPress={() => void signOut()} testID="terms-sign-out" />
    </ScrollView>
  );
}

const s = themed(() => StyleSheet.create({
  draft: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: colors.danger, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  draftText: { color: colors.white, fontWeight: '900', fontSize: 12, letterSpacing: 1 },
  draftNote: { color: colors.text, backgroundColor: colors.tint, borderRadius: radius.sm, padding: 10, marginTop: 10 },
  section: { backgroundColor: colors.card, borderRadius: radius.md, padding: 14, marginTop: 12, borderWidth: 1, borderColor: colors.hairline },
  check: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14, minHeight: 48, marginTop: 8 },
  box: { width: 26, height: 26, borderRadius: 6, borderWidth: 2, borderColor: colors.border, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.card },
}));
